/**
 * Brugere og adgang (prototype og adgang.dc.html, "Brugere og adgang", "Roller v3"): seat counters,
 * invite, members, invitations and "Hvad
 * hver rolle kan". Admin only: everyone else sees a calm locked page that names the fund's
 * admins. Every action is re-checked on the server (manage_users); the UI only hides and locks.
 */
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AppShell, scrollWorkspaceToTop } from "@/components/ds/AppShell";
import { Reveal, RevealGroup } from "@/components/ds/Reveal";
import { ErrorState, LoadingState, NoAccess } from "@/components/ds/States";
import { InvitationList } from "@/components/users/InvitationList";
import { InviteCard, type InvitePrefill } from "@/components/users/InviteCard";
import { MemberList } from "@/components/users/MemberList";
import { RoleMatrix } from "@/components/users/RoleMatrix";
import { SeatMeters } from "@/components/users/SeatMeters";
import { useUserActions } from "@/components/users/useUserActions";
import {
  getFundAdminNames,
  getSeatUsage,
  listInvitations,
  listMembers,
} from "@/lib/auth/access.functions";
import { joinNames } from "@/lib/auth/members-view";
import { useMyAccess } from "@/lib/auth/useMyAccess";
import { useActiveFund } from "@/lib/funds/useActiveFund";
import { useLanguage, useT } from "@/lib/i18n/useT";
import type { AppRole } from "@/lib/supabase/types";
import { pageMeta } from "@/lib/i18n/page-head";

export const Route = createFileRoute("/brugere")({
  head: () => ({
    meta: [...pageMeta("users"), { name: "robots", content: "noindex" }],
  }),
  component: UsersPage,
});

function UsersPage() {
  const t = useT();
  return (
    <AppShell title={t("users.page.title")} redesigned>
      <UsersContent />
    </AppShell>
  );
}

function UsersContent() {
  const { fundId } = useActiveFund();
  const access = useMyAccess(fundId);
  const t = useT();

  if (!fundId || access.isLoading) return <LoadingState title={t("users.page.loadingAccess")} />;
  if (access.isError) return <ErrorState onRetry={() => void access.refetch()} />;
  if (!access.data) {
    return <NoAccess title={t("users.page.noAccessTitle")} body={t("users.page.noAccessBody")} />;
  }
  if (!access.data.capabilities.includes("manage_users")) return <LockedPage fundId={fundId} />;
  return (
    <AdminPage fundId={fundId} myUserId={access.data.userId} settings={access.data.settings} />
  );
}

/** "Kun for admins": a calm page that says who to ask (names only, never e-mails). */
function LockedPage({ fundId }: { fundId: string }) {
  const load = useServerFn(getFundAdminNames);
  const admins = useQuery({
    queryKey: ["fund-admin-names", fundId],
    queryFn: () => load({ data: { fundId } }),
  });
  const t = useT();
  const language = useLanguage();
  const names = joinNames(admins.data ?? [], language);
  return (
    <div className="grid min-h-full place-items-center p-10">
      <NoAccess
        title={t("users.page.lockedTitle")}
        body={t("users.page.lockedBody", { names: names || t("users.page.lockedAnyAdmin") })}
      />
    </div>
  );
}

function AdminPage({
  fundId,
  myUserId,
  settings,
}: {
  fundId: string;
  myUserId: string;
  settings: import("@/lib/domain/workflow").FundSettings;
}) {
  const loadMembers = useServerFn(listMembers);
  const loadInvitations = useServerFn(listInvitations);
  const loadSeats = useServerFn(getSeatUsage);
  const members = useQuery({
    queryKey: ["members", fundId],
    queryFn: () => loadMembers({ data: { fundId } }),
  });
  const invitations = useQuery({
    queryKey: ["invitations", fundId],
    queryFn: () => loadInvitations({ data: { fundId } }),
  });
  const seats = useQuery({
    queryKey: ["seat-usage", fundId],
    queryFn: () => loadSeats({ data: { fundId } }),
    placeholderData: keepPreviousData,
  });
  const actions = useUserActions(fundId);
  const t = useT();
  const [prefill, setPrefill] = useState<InvitePrefill | null>(null);

  const inviteAgain = (email: string, role: AppRole) => {
    setPrefill({ email, role, nonce: Date.now() });
    scrollWorkspaceToTop();
  };

  return (
    <div className="flex max-w-[1180px] flex-col gap-[22px] px-4 pt-6 pb-[90px] md:px-10 md:pt-[30px]">
      <RevealGroup start={0} step={0.06}>
        <Reveal className="flex flex-wrap items-end gap-5">
          <div className="flex flex-col gap-1.5">
            <h1 className="m-0 text-[40px] leading-[1.05] font-semibold tracking-display">
              {t("users.page.title")}
            </h1>
            <span className="text-[15px] text-ink-3">{t("users.page.subtitle")}</span>
          </div>
          <div className="flex-1" />
          <SeatMeters usage={seats.data} />
        </Reveal>
        <Reveal>
          <InviteCard
            fundId={fundId}
            members={members.data ?? []}
            invitations={invitations.data ?? []}
            prefill={prefill}
          />
        </Reveal>
        <Reveal className="grid items-start gap-[18px] [grid-template-columns:repeat(auto-fit,minmax(min(100%,600px),1fr))]">
          <section className="flex min-w-0 flex-col gap-3">
            {members.isLoading && <LoadingState title={t("users.page.loadingMembers")} />}
            {members.isError && <ErrorState onRetry={() => void members.refetch()} />}
            {members.data && (
              <MemberList
                members={members.data}
                myUserId={myUserId}
                busy={actions.busyMembers}
                onChangeRole={(member, role) => void actions.changeRole(member, role)}
                onToggleStatus={(member) => void actions.toggleStatus(member)}
                onResetMfa={actions.resetMfa}
                onMakePasswordLink={actions.makePasswordLink}
              />
            )}
            {invitations.isError && <ErrorState onRetry={() => void invitations.refetch()} />}
            {invitations.data && (
              <InvitationList
                invitations={invitations.data}
                busy={actions.busyInvitations}
                onRevoke={actions.revokeInvitation}
                onInviteAgain={inviteAgain}
              />
            )}
          </section>
          <RoleMatrix
            settings={settings}
            onChangeSetting={actions.changeSetting}
            pending={actions.settingPending}
          />
        </Reveal>
      </RevealGroup>
    </div>
  );
}
