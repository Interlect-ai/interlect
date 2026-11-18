/**
 * The page's actions with "Fortryd" (prototype: a 5 s toast). Fortryd is a new call with the
 * opposite value, not a rollback: a role change is undone by setting the previous roles, a
 * deactivation by reactivating (which can fail when the seats are full, and then says so).
 * Revoking an invitation has no Fortryd: the link is spent. Roles and status change at once
 * in the list and are put back, with a human sentence, when the server refuses.
 */
import { useCallback, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { showToast } from "@/components/ds/Toast";
import {
  myAccessQueryKey,
  setFundMemberSettings,
  setMemberRoles,
  setMemberStatus,
  listMembers,
  resetMemberMfa,
  type InvitationListRow,
  type MemberRow,
  type MyAccess,
} from "@/lib/auth/access.functions";
import { revokeInvitation } from "@/lib/auth/invitations.functions";
import { createPasswordReset } from "@/lib/auth/password-reset.functions";
import { undoStillValid } from "@/lib/auth/guards";
import { primaryRole } from "@/lib/auth/members-view";
import { roleLabel } from "@/lib/auth/roles";
import type { FundSettings } from "@/lib/domain/workflow";
import { userMessage } from "@/lib/errors/user-message";
import { useLanguage, useT } from "@/lib/i18n/useT";
import type { AppRole } from "@/lib/supabase/types";

const nameOf = (member: MemberRow) => member.fullName ?? member.email;

export function useUserActions(fundId: string) {
  const queryClient = useQueryClient();
  const t = useT();
  const language = useLanguage();
  const saveRoles = useServerFn(setMemberRoles);
  const saveStatus = useServerFn(setMemberStatus);
  const resetFactors = useServerFn(resetMemberMfa);
  const makeReset = useServerFn(createPasswordReset);
  const revoke = useServerFn(revokeInvitation);
  const saveSettings = useServerFn(setFundMemberSettings);
  const loadMembers = useServerFn(listMembers);
  const [busyMembers, setBusyMembers] = useState<ReadonlySet<string>>(new Set());
  const [busyInvitations, setBusyInvitations] = useState<ReadonlySet<string>>(new Set());

  const membersKey = ["members", fundId] as const;
  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["members", fundId] });
    void queryClient.invalidateQueries({ queryKey: ["invitations", fundId] });
    void queryClient.invalidateQueries({ queryKey: ["seat-usage", fundId] });
  }, [queryClient, fundId]);

  const mark = (id: string, on: boolean) =>
    setBusyMembers((previous) => {
      const next = new Set(previous);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const patchMember = (membershipId: string, patch: Partial<MemberRow>) =>
    queryClient.setQueryData<MemberRow[]>(membersKey, (rows) =>
      rows?.map((row) => (row.membershipId === membershipId ? { ...row, ...patch } : row)),
    );

  /** One change to a member: optimistic, put back and explained on failure. */
  const changeMember = async (
    member: MemberRow,
    patch: Partial<MemberRow>,
    run: () => Promise<unknown>,
    fallback: string,
  ): Promise<boolean> => {
    const before = queryClient.getQueryData<MemberRow[]>(membersKey);
    mark(member.membershipId, true);
    patchMember(member.membershipId, patch);
    try {
      await run();
      return true;
    } catch (cause) {
      if (before) queryClient.setQueryData(membersKey, before);
      showToast({ tone: "error", message: userMessage(cause, fallback, language) });
      return false;
    } finally {
      mark(member.membershipId, false);
      refresh();
    }
  };

  const setRoles = async (member: MemberRow, roles: AppRole[]) =>
    changeMember(
      member,
      { roles },
      () => saveRoles({ data: { fundId, membershipId: member.membershipId, roles } }),
      t("users.actions.roleFailed"),
    );

  const setStatus = async (member: MemberRow, status: MemberRow["status"]) =>
    changeMember(
      member,
      { status },
      () => saveStatus({ data: { fundId, membershipId: member.membershipId, status } }),
      t("users.actions.accessFailed"),
    );

  /**
   * Fortryd only runs while the person is still as this change left them: the current state
   * is fetched first, so a change made meanwhile (by another admin) is never overwritten.
   */
  const undoIfUnchanged = async (
    member: MemberRow,
    expected: { roles?: AppRole[]; status?: MemberRow["status"] },
    run: () => Promise<unknown>,
  ) => {
    try {
      const fresh = await loadMembers({ data: { fundId } });
      queryClient.setQueryData(membersKey, fresh);
      const current = fresh.find((row) => row.membershipId === member.membershipId);
      if (!undoStillValid(current, expected)) {
        showToast({
          tone: "error",
          message: t("users.actions.changedMeanwhile", { name: nameOf(member) }),
        });
        return;
      }
      await run();
    } catch (cause) {
      showToast({
        tone: "error",
        message: userMessage(cause, t("users.actions.undoFailed"), language),
      });
    }
  };

  const changeRole = async (member: MemberRow, role: AppRole) => {
    const previous = [...member.roles];
    if (previous.length === 1 && previous[0] === role) return;
    if (!(await setRoles(member, [role]))) return;
    showToast({
      // Danish writes the role in lower case mid-sentence ("er nu medlem"); English keeps it.
      message: t("users.actions.roleChanged", {
        name: nameOf(member),
        role: language === "da" ? roleLabel(role).toLowerCase() : roleLabel(role, language),
      }),
      onUndo: () =>
        void undoIfUnchanged(member, { roles: [role] }, () =>
          setRoles(member, [primaryRole(previous)]),
        ),
    });
  };

  const toggleStatus = async (member: MemberRow) => {
    const next = member.status === "active" ? "deactivated" : "active";
    const previous = member.status;
    if (!(await setStatus(member, next))) return;
    showToast({
      message:
        next === "deactivated"
          ? t("users.actions.deactivated", { name: nameOf(member) })
          : t("users.actions.reactivated", { name: nameOf(member) }),
      onUndo: () =>
        void undoIfUnchanged(member, { status: next }, () => setStatus(member, previous)),
    });
  };

  /**
   * "Nulstil to-trins-login": confirmed in a dialog first, no Fortryd (the factor is gone).
   * A second call for the same person while one is in flight is ignored (a ref, as state is async).
   */
  const mfaInFlight = useRef(new Set<string>());
  const resetMfa = async (member: MemberRow): Promise<boolean> => {
    if (mfaInFlight.current.has(member.membershipId)) return false;
    mfaInFlight.current.add(member.membershipId);
    mark(member.membershipId, true);
    try {
      const result = await resetFactors({
        data: { fundId, membershipId: member.membershipId },
      });
      showToast({
        message:
          result.verified > 0
            ? t("users.actions.mfaReset", { name: nameOf(member) })
            : t("users.actions.mfaNone", { name: nameOf(member) }),
      });
      return true;
    } catch (cause) {
      showToast({
        tone: "error",
        message: userMessage(cause, t("users.actions.mfaFailed"), language),
      });
      return false;
    } finally {
      mfaInFlight.current.delete(member.membershipId);
      mark(member.membershipId, false);
    }
  };

  /**
   * "Lav link til ny adgangskode": confirmed in a dialog first. Gives the one-time link
   * (shown once, by the dialog) or null after a toast saying why not.
   */
  const resetInFlight = useRef(new Set<string>());
  const makePasswordLink = async (
    member: MemberRow,
  ): Promise<{ url: string; email: string } | null> => {
    if (resetInFlight.current.has(member.membershipId)) return null;
    resetInFlight.current.add(member.membershipId);
    mark(member.membershipId, true);
    try {
      const result = await makeReset({ data: { fundId, membershipId: member.membershipId } });
      return {
        url: `${window.location.origin}/nulstil-adgangskode?token=${result.token}`,
        email: result.email,
      };
    } catch (cause) {
      showToast({
        tone: "error",
        message: userMessage(cause, t("users.actions.passwordLinkFailed"), language),
      });
      return null;
    } finally {
      resetInFlight.current.delete(member.membershipId);
      mark(member.membershipId, false);
    }
  };

  const revokeMutation = useMutation({
    mutationFn: async (invitation: InvitationListRow) => {
      setBusyInvitations((previous) => new Set(previous).add(invitation.id));
      try {
        await revoke({ data: { fundId, invitationId: invitation.id } });
      } finally {
        setBusyInvitations((previous) => {
          const next = new Set(previous);
          next.delete(invitation.id);
          return next;
        });
      }
    },
    onSuccess: () => showToast({ message: t("users.actions.revoked") }),
    onError: (cause) =>
      showToast({
        tone: "error",
        message: userMessage(cause, t("users.actions.revokeFailed"), language),
      }),
    onSettled: refresh,
  });

  const settingsMutation = useMutation({
    mutationFn: (change: Partial<FundSettings>) => saveSettings({ data: { fundId, ...change } }),
    onMutate: async (change) => {
      const key = myAccessQueryKey(fundId);
      await queryClient.cancelQueries({ queryKey: key });
      const before = queryClient.getQueryData<MyAccess | null>(key);
      queryClient.setQueryData<MyAccess | null>(key, (old) =>
        old ? { ...old, settings: { ...old.settings, ...change } } : old,
      );
      return { before };
    },
    onError: (cause, _change, context) => {
      if (context?.before) queryClient.setQueryData(myAccessQueryKey(fundId), context.before);
      showToast({
        tone: "error",
        message: userMessage(cause, t("users.actions.settingFailed"), language),
      });
    },
    onSettled: () => {
      // The menu and every page read the capabilities from here.
      void queryClient.invalidateQueries({ queryKey: myAccessQueryKey(fundId) });
    },
  });

  return {
    busyMembers,
    busyInvitations,
    changeRole,
    toggleStatus,
    resetMfa,
    makePasswordLink,
    revokeInvitation: (invitation: InvitationListRow) => revokeMutation.mutate(invitation),
    changeSetting: (change: Partial<FundSettings>) => settingsMutation.mutate(change),
    settingPending: settingsMutation.isPending,
  };
}
