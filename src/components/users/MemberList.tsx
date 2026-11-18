/**
 * "Medlemmer" (prototype Brugere og adgang): search and role filter, then one row per person:
 * avatar with initials (a person, not a logo), name and e-mail, the role with its menu, the
 * status chip and Deaktivér/Aktivér. Your own row and the last active Admin are locked (the
 * server and the database refuse them too). Rows fade in on first load only, never when the
 * list is filtered. "Nulstil to-trins-login" sits in a "…" menu that fades in
 * on hover (secondary actions hide) and is confirmed in a dialog, as it has no Fortryd.
 */
import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import {
  ChevronDown,
  CirclePause,
  CirclePlay,
  Ellipsis,
  KeyRound,
  LockKeyhole,
  Search,
} from "lucide-react";
import { Button } from "@/components/ds/Button";
import { Dialog } from "@/components/ds/Dialog";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuTrigger,
  useMenuOpen,
  type MenuTone,
} from "@/components/ds/Menu";
import { PasswordResetDialog } from "@/components/users/PasswordResetDialog";
import { roleVisual } from "@/components/users/role-visual";
import type { MemberRow } from "@/lib/auth/access.functions";
import {
  extraRoleCount,
  filterMembers,
  initials,
  lockText,
  memberLockReason,
  primaryRole,
  twoAdminsHint,
  type RoleFilter,
} from "@/lib/auth/members-view";
import { roleDescription, roleLabel, roleValues } from "@/lib/auth/roles";
import { useLanguage, useT } from "@/lib/i18n/useT";
import { EASE, REDUCED_FADE } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { AppRole } from "@/lib/supabase/types";

const MFA_TONE: MenuTone = { color: "warning", wash: "warning-wash" };

const pillBase =
  "inline-flex items-center whitespace-nowrap rounded-pill font-medium outline-none transition-[background-color,color] duration-[var(--dur-quick)] focus-visible:ring-2 focus-visible:ring-action";

export function MemberList({
  members,
  myUserId,
  busy,
  onChangeRole,
  onToggleStatus,
  onResetMfa,
  onMakePasswordLink,
}: {
  members: readonly MemberRow[];
  myUserId: string;
  /** Membership ids with a change in flight (their controls wait). */
  busy: ReadonlySet<string>;
  onChangeRole: (member: MemberRow, role: AppRole) => void;
  onToggleStatus: (member: MemberRow) => void;
  /** Resolves when the reset has settled; the dialog waits for it. */
  onResetMfa: (member: MemberRow) => Promise<unknown>;
  /** The one-time link for a new password, or null when it could not be made. */
  onMakePasswordLink: (member: MemberRow) => Promise<{ url: string; email: string } | null>;
}) {
  const t = useT();
  const language = useLanguage();
  const [query, setQuery] = useState("");
  // The person stays set while the dialog animates out, so its title keeps the name.
  const [mfaTarget, setMfaTarget] = useState<MemberRow | null>(null);
  const [mfaOpen, setMfaOpen] = useState(false);
  const [mfaPending, setMfaPending] = useState(false);
  const mfaName = mfaTarget ? (mfaTarget.fullName ?? mfaTarget.email) : "";
  const [passwordTarget, setPasswordTarget] = useState<MemberRow | null>(null);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [filter, setFilter] = useState<RoleFilter>("all");
  const visible = filterMembers(members, query, filter);

  // Fade the rows in once; a filtered list must not replay it.
  const [intro, setIntro] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setIntro(false), 1200);
    return () => clearTimeout(timer);
  }, []);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2.5 px-1">
        <h2 className="m-0 text-title font-semibold tracking-title">{t("users.members.title")}</h2>
        <div className="flex-1" />
        <label className="flex h-[38px] w-[220px] max-w-full items-center gap-2 rounded-pill bg-sunken px-3.5 transition-[background-color,box-shadow] duration-[var(--dur-quick)] focus-within:bg-surface focus-within:shadow-[inset_0_0_0_1.5px_var(--action)]">
          <Search className="size-4 shrink-0 text-ink-4" strokeWidth={1.75} aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("users.members.searchPlaceholder")}
            aria-label={t("users.members.searchAria")}
            className="min-w-0 flex-1 border-0 bg-transparent text-[14px] text-ink-1 outline-none placeholder:text-ink-4"
          />
        </label>
        <div className="flex gap-0.5" role="group" aria-label={t("users.members.filterAria")}>
          {(["all", ...roleValues] as const).map((value) => {
            const active = filter === value;
            return (
              <button
                key={value}
                type="button"
                aria-pressed={active}
                onClick={() => setFilter(value)}
                className={cn(
                  pillBase,
                  "h-8 px-[11px] text-meta",
                  active
                    ? "bg-inverse text-ink-inverse"
                    : "bg-transparent text-ink-3 hover:text-ink-1",
                )}
              >
                {value === "all" ? t("users.members.all") : roleLabel(value, language)}
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex flex-col rounded-lg bg-surface shadow-[0_0_0_1px_var(--line)]">
        {visible.map((member, index) => (
          <MemberRowView
            key={member.membershipId}
            member={member}
            members={members}
            index={index}
            intro={intro}
            myUserId={myUserId}
            busy={busy.has(member.membershipId)}
            onChangeRole={onChangeRole}
            onToggleStatus={onToggleStatus}
            onRequestMfaReset={(target) => {
              setMfaTarget(target);
              setMfaOpen(true);
            }}
            onRequestPasswordLink={(target) => {
              setPasswordTarget(target);
              setPasswordOpen(true);
            }}
          />
        ))}
        {visible.length === 0 && (
          <div className="px-5 py-8 text-center text-[15px] text-ink-3">
            {t("users.members.noMatch")}
          </div>
        )}
      </div>
      <Dialog
        open={mfaOpen}
        onOpenChange={(open) => {
          if (!mfaPending) setMfaOpen(open);
        }}
        title={t("users.members.resetMfaTitle", { name: mfaName })}
        description={t("users.members.resetMfaBody", { name: mfaName })}
        icon={KeyRound}
        tone={MFA_TONE}
        footer={
          <>
            <Button
              variant="quiet"
              size="md"
              className="h-[42px]"
              disabled={mfaPending}
              onClick={() => setMfaOpen(false)}
            >
              {t("users.members.cancel")}
            </Button>
            <Button
              variant="primary"
              size="md"
              className="h-[42px] px-5 text-[14px]"
              pending={mfaPending}
              onClick={async () => {
                if (!mfaTarget || mfaPending) return;
                setMfaPending(true);
                try {
                  await onResetMfa(mfaTarget);
                } finally {
                  setMfaPending(false);
                  setMfaOpen(false);
                }
              }}
            >
              {t("users.members.resetMfaConfirm")}
            </Button>
          </>
        }
      />
      <PasswordResetDialog
        member={passwordTarget}
        open={passwordOpen}
        onOpenChange={setPasswordOpen}
        onMake={onMakePasswordLink}
      />
    </>
  );
}

function MemberRowView({
  member,
  members,
  index,
  intro,
  myUserId,
  busy,
  onChangeRole,
  onToggleStatus,
  onRequestMfaReset,
  onRequestPasswordLink,
}: {
  member: MemberRow;
  members: readonly MemberRow[];
  index: number;
  intro: boolean;
  myUserId: string;
  busy: boolean;
  onChangeRole: (member: MemberRow, role: AppRole) => void;
  onToggleStatus: (member: MemberRow) => void;
  onRequestMfaReset: (member: MemberRow) => void;
  onRequestPasswordLink: (member: MemberRow) => void;
}) {
  const reduced = useReducedMotion();
  const t = useT();
  const language = useLanguage();
  const active = member.status === "active";
  const lock = memberLockReason(member, members, myUserId);
  const me = lock === "self";
  const adminHint = twoAdminsHint(member, members, language);
  const shown = primaryRole(member.roles);
  const extra = extraRoleCount(member.roles);
  const visual = roleVisual[shown];
  const RoleIcon = visual.icon;
  const name = member.fullName ?? member.email;

  return (
    <motion.div
      className={cn(
        "group/row grid min-h-[72px] grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 border-t border-line py-2.5 pr-3 pl-4 transition-opacity duration-300 first:border-t-0 md:grid-cols-[minmax(0,1fr)_auto_auto]",
        !active && "opacity-60",
      )}
      initial={intro && !reduced ? { opacity: 0 } : false}
      animate={{ opacity: 1 }}
      transition={reduced ? REDUCED_FADE : { duration: 0.36, ease: EASE.out, delay: index * 0.04 }}
      data-member={member.email}
    >
      <span className="flex min-w-0 items-center gap-3.5">
        <span
          aria-hidden
          className="grid size-[38px] flex-none place-items-center rounded-full bg-sunken text-[13px] font-semibold text-ink-2"
        >
          {initials(name)}
        </span>
        <span className="flex min-w-0 flex-col gap-px">
          <span className="flex items-center gap-2">
            <span className="truncate text-[15px] font-semibold">{name}</span>
            {me && <span className="text-micro text-ink-4">{t("users.members.you")}</span>}
          </span>
          <span className="truncate text-meta text-ink-3">{member.email}</span>
        </span>
      </span>

      {lock ? (
        <button
          type="button"
          disabled
          title={lockText(lock, language)}
          aria-label={`${roleLabel(shown, language)}. ${lockText(lock, language)}`}
          className={cn(pillBase, "h-9 cursor-default gap-2 pr-2.5 pl-3 text-list text-ink-1")}
        >
          <RoleIcon className="size-3.5" style={{ color: visual.color }} aria-hidden />
          {roleLabel(shown, language)}
          <LockKeyhole className="size-3 text-ink-4" aria-hidden />
        </button>
      ) : (
        <Menu>
          <RoleButton
            member={member}
            shown={shown}
            extra={extra}
            disabled={busy}
            hint={adminHint}
          />
          <MenuContent size="large" align="end" className="w-[340px]">
            <MenuLabel>
              {t("users.members.roleFor", { name: name.split(" ")[0] ?? name })}
            </MenuLabel>
            {roleValues.map((role) => (
              <MenuItem
                key={role}
                icon={roleVisual[role].icon}
                tone={roleVisual[role].tone}
                current={role === shown && extra === 0}
                description={roleDescription(role, language)}
                className="min-h-[58px]"
                onSelect={() => onChangeRole(member, role)}
              >
                {roleLabel(role, language)}
              </MenuItem>
            ))}
          </MenuContent>
        </Menu>
      )}

      <span className="col-span-2 flex items-center justify-between gap-2 md:col-span-1 md:min-w-[150px] md:justify-end">
        <span
          className="inline-flex h-7 items-center gap-[7px] rounded-pill pr-3 pl-2.5 text-meta font-medium whitespace-nowrap"
          style={{ background: active ? "var(--positive-wash)" : "var(--bg-sunken)" }}
        >
          {active ? (
            <CirclePlay className="size-3" style={{ color: "var(--positive)" }} aria-hidden />
          ) : (
            <CirclePause className="size-3" style={{ color: "var(--ink-3)" }} aria-hidden />
          )}
          {active ? t("users.members.active") : t("users.members.deactivated")}
        </span>
        {!me && (
          <span className="flex items-center gap-0.5">
            <button
              type="button"
              disabled={busy || lock === "last_admin"}
              title={
                lock === "last_admin" ? lockText("last_admin", language) : (adminHint ?? undefined)
              }
              onClick={() => onToggleStatus(member)}
              className={cn(
                pillBase,
                "h-8 bg-transparent px-3 text-meta text-ink-3 hover:bg-hover hover:text-ink-1 disabled:opacity-35 disabled:hover:bg-transparent",
              )}
            >
              {active ? t("users.members.deactivate") : t("users.members.activate")}
            </button>
            <Menu>
              <MenuTrigger asChild disabled={busy}>
                <button
                  type="button"
                  aria-label={t("users.members.moreActions", { name })}
                  className="grid size-8 place-items-center rounded-full text-ink-3 opacity-30 outline-none transition-[opacity,background-color,color] duration-[180ms] hover:bg-hover hover:text-ink-1 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-action group-hover/row:opacity-100 disabled:opacity-20 data-[state=open]:bg-hover data-[state=open]:opacity-100"
                >
                  <Ellipsis className="size-4" strokeWidth={1.75} aria-hidden />
                </button>
              </MenuTrigger>
              <MenuContent align="end" sideOffset={8} className="min-w-[260px]">
                <MenuItem
                  icon={LockKeyhole}
                  tone={MFA_TONE}
                  description={t("users.members.resetPasswordHint")}
                  onSelect={() => onRequestPasswordLink(member)}
                >
                  {t("users.members.resetPassword")}
                </MenuItem>
                <MenuItem
                  icon={KeyRound}
                  tone={MFA_TONE}
                  description={t("users.members.resetMfaHint")}
                  onSelect={() => onRequestMfaReset(member)}
                >
                  {t("users.members.resetMfa")}
                </MenuItem>
              </MenuContent>
            </Menu>
          </span>
        )}
      </span>
    </motion.div>
  );
}

function RoleButton({
  member,
  shown,
  extra,
  disabled,
  hint,
}: {
  member: MemberRow;
  shown: AppRole;
  extra: number;
  disabled: boolean;
  hint: string | null;
}) {
  const open = useMenuOpen();
  const t = useT();
  const language = useLanguage();
  const visual = roleVisual[shown];
  const name = member.fullName ?? member.email;
  const role = roleLabel(shown, language);
  const RoleIcon = visual.icon;
  return (
    <MenuTrigger asChild disabled={disabled}>
      <button
        type="button"
        title={hint ?? t("users.members.changeRole")}
        aria-label={
          extra > 0
            ? t("users.members.changeRoleAriaExtra", { name, role, count: extra })
            : t("users.members.changeRoleAria", { name, role })
        }
        className={cn(
          pillBase,
          "h-9 gap-2 pr-2.5 pl-3 text-list text-ink-1 hover:bg-sunken disabled:opacity-60",
          open ? "bg-sunken" : "bg-transparent",
        )}
      >
        <RoleIcon className="size-3.5" style={{ color: visual.color }} aria-hidden />
        {role}
        {extra > 0 && <span className="text-meta text-ink-4">+{extra}</span>}
        <ChevronDown
          className="size-3 text-ink-3 transition-transform duration-[280ms] ease-standard"
          style={{ transform: open ? "rotate(180deg)" : "none" }}
          aria-hidden
        />
      </button>
    </MenuTrigger>
  );
}
