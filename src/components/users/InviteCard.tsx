/**
 * "Invitér en kollega" (prototype Brugere og adgang): e-mail, one role as a sliding segment,
 * "Send invitation" with the neutral orb while it sends, and the one-time link with "Kopiér
 * link". One role per person in the UI, the server takes 1..n.
 *
 * The link is kept ONLY in this component's state: never in the URL, a cache, localStorage or a
 * log. It disappears when a new invitation is made, when the person leaves the page, or when
 * the component unmounts.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { LayoutGroup, motion, useReducedMotion } from "motion/react";
import { Check, CircleCheck, Copy, Mail } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ds/Button";
import { showToast } from "@/components/ds/Toast";
import { createInvitation } from "@/lib/auth/invitations.functions";
import { EMAIL_PATTERN } from "@/lib/auth/guards";
import { existingMemberFor, pendingInvitations } from "@/lib/auth/members-view";
import type { InvitationListRow, MemberRow } from "@/lib/auth/access.functions";
import { roleDescription, roleLabel, roleValues } from "@/lib/auth/roles";
import { useLanguage, useT } from "@/lib/i18n/useT";
import { userMessage } from "@/lib/errors/user-message";
import { EASE, REDUCED_FADE, SPRING } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { AppRole } from "@/lib/supabase/types";

export interface InvitePrefill {
  email: string;
  role: AppRole;
  /** Changes on every "Invitér igen", so the same address can be filled in twice. */
  nonce: number;
}

export function InviteCard({
  fundId,
  members,
  invitations,
  prefill,
}: {
  fundId: string;
  members: readonly MemberRow[];
  invitations: readonly InvitationListRow[];
  prefill: InvitePrefill | null;
}) {
  const reduced = useReducedMotion();
  const t = useT();
  const language = useLanguage();
  const queryClient = useQueryClient();
  const invite = useServerFn(createInvitation);
  const emailInput = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AppRole>("member");
  const [problem, setProblem] = useState<string | null>(null);
  const [link, setLink] = useState<{ url: string; to: string } | null>(null);
  const [copied, setCopied] = useState(false);

  // "Invitér igen" fills the form and puts the cursor in it.
  useEffect(() => {
    if (!prefill) return;
    setEmail(prefill.email);
    setRole(prefill.role);
    setProblem(null);
    emailInput.current?.focus({ preventScroll: true });
  }, [prefill]);

  const normalized = email.trim().toLowerCase();
  const valid = EMAIL_PATTERN.test(normalized);
  const existing = existingMemberFor(members, normalized);
  const alreadyPending =
    valid && pendingInvitations(invitations).some((invitation) => invitation.email === normalized);
  const ok = valid && !existing;

  const send = useMutation({
    mutationFn: () => invite({ data: { fundId, email: normalized, roles: [role] } }),
    onSuccess: (result) => {
      setProblem(null);
      setEmail("");
      setCopied(false);
      setLink({
        url: `${window.location.origin}/invitation/accept?token=${result.token}`,
        to: result.email,
      });
      void queryClient.invalidateQueries({ queryKey: ["invitations", fundId] });
      void queryClient.invalidateQueries({ queryKey: ["seat-usage", fundId] });
    },
    onError: (cause) => setProblem(userMessage(cause, t("users.invite.notCreated"), language)),
  });

  /** Arrow keys move and select, like a native radio group (one tab stop). */
  const onRoleKey = (event: KeyboardEvent<HTMLButtonElement>, current: AppRole) => {
    const keys = ["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown", "Home", "End"];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const index = roleValues.indexOf(current);
    const last = roleValues.length - 1;
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? last
          : event.key === "ArrowLeft" || event.key === "ArrowUp"
            ? index === 0
              ? last
              : index - 1
            : index === last
              ? 0
              : index + 1;
    const target = roleValues[next]!;
    setRole(target);
    event.currentTarget.parentElement
      ?.querySelector<HTMLButtonElement>(`[data-role-option="${target}"]`)
      ?.focus();
  };

  const submit = () => {
    if (ok && !send.isPending) send.mutate();
  };
  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") submit();
  };

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
    } catch {
      showToast({
        tone: "error",
        message: t("users.invite.copyFailed"),
      });
    }
  };

  const help = existing
    ? existing.status === "deactivated"
      ? t("users.invite.alreadyDeactivated")
      : t("users.invite.alreadyMember")
    : problem
      ? problem
      : alreadyPending
        ? t("users.invite.alreadyPending")
        : roleDescription(role, language);
  const helpCritical = Boolean(existing) || Boolean(problem);

  return (
    <div className="flex flex-col gap-3.5 rounded-xl bg-canvas px-[22px] py-5">
      <span className="text-section font-semibold">{t("users.invite.title")}</span>
      <div className="flex flex-wrap items-center gap-2.5">
        <label className="flex h-12 min-w-0 flex-[1_1_260px] items-center gap-2.5 rounded-[14px] bg-surface px-4 shadow-[inset_0_0_0_1px_var(--line-strong)] transition-shadow duration-[160ms] focus-within:shadow-[inset_0_0_0_1.5px_var(--action),0_0_0_4px_var(--action-wash)]">
          <Mail className="size-4 shrink-0 text-ink-4" strokeWidth={1.75} aria-hidden />
          <input
            ref={emailInput}
            type="email"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              setProblem(null);
            }}
            onKeyDown={onKey}
            placeholder={t("users.invite.emailPlaceholder")}
            aria-label={t("users.invite.emailAria")}
            autoComplete="off"
            className="min-w-0 flex-1 border-0 bg-transparent text-[16px] text-ink-1 outline-none placeholder:text-ink-4"
          />
        </label>
        <LayoutGroup id="invite-role">
          <div
            role="radiogroup"
            aria-label={t("users.invite.roleAria")}
            className="relative grid max-w-full grid-cols-4 rounded-pill bg-sunken p-1"
          >
            {roleValues.map((value) => {
              const active = role === value;
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  tabIndex={active ? 0 : -1}
                  data-role-option={value}
                  onClick={() => setRole(value)}
                  onKeyDown={(event) => onRoleKey(event, value)}
                  className={cn(
                    "relative h-10 w-24 rounded-pill text-list font-medium outline-none transition-[color,opacity] duration-[var(--dur-quick)] focus-visible:ring-2 focus-visible:ring-action",
                    active ? "text-ink-1" : "text-ink-3 hover:text-ink-1",
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId="invite-role-indicator"
                      className="absolute inset-0 rounded-pill bg-surface shadow-pill"
                      transition={reduced ? { duration: 0 } : SPRING.snappy}
                      aria-hidden
                    />
                  )}
                  <span className="relative">{roleLabel(value, language)}</span>
                </button>
              );
            })}
          </div>
        </LayoutGroup>
        <Button
          size="lg"
          variant="primary"
          className="h-12 px-5 disabled:bg-ink-4 disabled:opacity-100"
          disabled={!ok}
          pending={send.isPending}
          pendingLabel={t("users.invite.sending")}
          onClick={submit}
        >
          {t("users.invite.send")}
        </Button>
      </div>
      <span
        role={helpCritical ? "alert" : undefined}
        className={cn("text-list", helpCritical ? "text-critical" : "text-ink-3")}
      >
        {help}
      </span>

      {link && (
        <motion.div
          key={link.url}
          className="flex flex-col gap-2.5 rounded-lg bg-surface px-[18px] py-4 shadow-card"
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={reduced ? REDUCED_FADE : { duration: 0.42, ease: EASE.out }}
        >
          <span className="flex items-center gap-2 text-[15px] font-semibold">
            <CircleCheck className="size-4 text-positive" strokeWidth={1.75} aria-hidden />
            {t("users.invite.created")}
          </span>
          <span className="text-list text-ink-2">
            {t("users.invite.linkOnce", { email: link.to })}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-[1_1_300px] rounded-[12px] bg-canvas px-3.5 py-3 font-mono text-[13px] [overflow-wrap:anywhere] text-ink-1 select-all">
              {link.url}
            </code>
            <Button size="md" variant="primary" className="h-[42px] px-4" onClick={copy}>
              {copied ? (
                <Check className="size-4" strokeWidth={1.75} aria-hidden />
              ) : (
                <Copy className="size-4" strokeWidth={1.75} aria-hidden />
              )}
              {copied ? t("users.invite.copied") : t("users.invite.copyLink")}
            </Button>
          </div>
        </motion.div>
      )}
    </div>
  );
}
