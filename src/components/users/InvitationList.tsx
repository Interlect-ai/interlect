/**
 * "Invitationer" (prototype Brugere og adgang): e-mail, role and date, a status chip
 * (Afventer, Accepteret, Udløbet, Tilbagekaldt) and one action: Tilbagekald while pending,
 * Invitér igen when expired or revoked (it only fills the form: the link cannot be recreated,
 * only its hash is stored). B10-2: a second pending invitation to the same address is shown
 * clearly; nothing is revoked automatically.
 */
import { motion, useReducedMotion } from "motion/react";
import { CircleCheck, CircleDashed, CircleX, Clock, type LucideIcon } from "lucide-react";
import type { InvitationListRow } from "@/lib/auth/access.functions";
import {
  duplicatePendingEmails,
  invitationStatus,
  shortDate,
  pendingInvitations,
  primaryRole,
  type InvitationStatus,
} from "@/lib/auth/members-view";
import { roleLabel } from "@/lib/auth/roles";
import type { Language } from "@/lib/i18n/language";
import { translate, type MessageKey } from "@/lib/i18n/translate";
import { useLanguage, useT } from "@/lib/i18n/useT";
import { EASE, REDUCED_FADE } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { AppRole } from "@/lib/supabase/types";

const STATUS: Record<
  InvitationStatus,
  { label: MessageKey; icon: LucideIcon; color: string; wash: string }
> = {
  pending: {
    label: "users.invitations.pending",
    icon: Clock,
    color: "var(--warning)",
    wash: "var(--warning-wash)",
  },
  accepted: {
    label: "users.invitations.accepted",
    icon: CircleCheck,
    color: "var(--positive)",
    wash: "var(--positive-wash)",
  },
  expired: {
    label: "users.invitations.expired",
    icon: CircleDashed,
    color: "var(--ink-3)",
    wash: "var(--bg-sunken)",
  },
  revoked: {
    label: "users.invitations.revoked",
    icon: CircleX,
    color: "var(--ink-3)",
    wash: "var(--bg-sunken)",
  },
};

function dateText(
  invitation: InvitationListRow,
  status: InvitationStatus,
  language: Language,
): string {
  const date = (value: string) => ({ date: shortDate(value, language) });
  switch (status) {
    case "pending":
      return translate(language, "users.invitations.expiresOn", date(invitation.expiresAt));
    case "expired":
      return translate(language, "users.invitations.expiredOn", date(invitation.expiresAt));
    case "accepted":
      return translate(
        language,
        "users.invitations.acceptedOn",
        date(invitation.acceptedAt ?? invitation.createdAt),
      );
    case "revoked":
      return translate(
        language,
        "users.invitations.revokedOn",
        date(invitation.revokedAt ?? invitation.createdAt),
      );
  }
}

export function InvitationList({
  invitations,
  busy,
  onRevoke,
  onInviteAgain,
}: {
  invitations: readonly InvitationListRow[];
  /** Invitation ids with a change in flight. */
  busy: ReadonlySet<string>;
  onRevoke: (invitation: InvitationListRow) => void;
  onInviteAgain: (email: string, role: AppRole) => void;
}) {
  const reduced = useReducedMotion();
  const t = useT();
  const language = useLanguage();
  const pending = pendingInvitations(invitations).length;
  const duplicates = duplicatePendingEmails(invitations);
  return (
    <>
      <div className="flex items-baseline gap-2.5 px-1 pt-3.5">
        <h2 className="m-0 text-title font-semibold tracking-title">
          {t("users.invitations.title")}
        </h2>
        <span className="text-list text-ink-4">
          {t("users.invitations.pendingCount", { count: pending })}
        </span>
      </div>
      <div className="flex flex-col rounded-lg bg-surface shadow-[0_0_0_1px_var(--line)]">
        {invitations.map((invitation, index) => {
          const status = invitationStatus(invitation);
          const chip = STATUS[status];
          const Icon = chip.icon;
          const role = primaryRole(invitation.roles);
          const duplicate = status === "pending" && duplicates.has(invitation.email.toLowerCase());
          return (
            <motion.div
              key={invitation.id}
              className={cn(
                "grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 border-t border-line py-2 pr-3 pl-4 first:border-t-0 md:grid-cols-[minmax(0,1fr)_auto_auto]",
              )}
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={reduced ? REDUCED_FADE : { duration: 0.38, ease: EASE.out }}
              data-invitation={invitation.email}
            >
              <span className="flex min-w-0 flex-col gap-px">
                <span className="truncate text-[15px] font-medium">{invitation.email}</span>
                <span className="text-meta text-ink-3">
                  {roleLabel(role, language)}, {dateText(invitation, status, language)}
                  {duplicate && (
                    <span className="text-warning">{t("users.invitations.duplicate")}</span>
                  )}
                </span>
              </span>
              <span
                className="inline-flex h-7 items-center gap-[7px] rounded-pill pr-3 pl-2.5 text-meta font-medium whitespace-nowrap"
                style={{ background: chip.wash }}
              >
                <Icon className="size-3" style={{ color: chip.color }} aria-hidden />
                {t(chip.label)}
              </span>
              <span className="col-span-2 flex justify-end md:col-span-1 md:min-w-[108px]">
                {status === "pending" && (
                  <button
                    type="button"
                    disabled={busy.has(invitation.id)}
                    onClick={() => onRevoke(invitation)}
                    className="inline-flex h-8 items-center rounded-pill bg-transparent px-3 text-meta font-medium whitespace-nowrap text-ink-3 outline-none transition-[background-color,color] duration-[var(--dur-quick)] hover:bg-critical-wash hover:text-critical focus-visible:ring-2 focus-visible:ring-action disabled:opacity-35"
                  >
                    {t("users.invitations.revoke")}
                  </button>
                )}
                {(status === "expired" || status === "revoked") && (
                  <button
                    type="button"
                    onClick={() => onInviteAgain(invitation.email, role)}
                    className="inline-flex h-8 items-center rounded-pill bg-transparent px-3 text-meta font-medium whitespace-nowrap text-ink-3 outline-none transition-[background-color,color] duration-[var(--dur-quick)] hover:bg-hover hover:text-ink-1 focus-visible:ring-2 focus-visible:ring-action"
                  >
                    {t("users.invitations.inviteAgain")}
                  </button>
                )}
              </span>
            </motion.div>
          );
        })}
        {invitations.length === 0 && (
          <div className="px-5 py-8 text-center text-[15px] text-ink-3">
            {t("users.invitations.none")}
          </div>
        )}
      </div>
    </>
  );
}
