/**
 * The invitation card (Login og invitation.dc.html, screens "invite" and
 * "invite-signed-in"): fund name, a box with the masked e-mail, the role and who invited,
 * then either the new-user fields (name, e-mail from the invitation, a new password with the
 * strength meter) or "Du er logget ind som …". Pure, so the visual harness can draw it; the
 * route owns the state and the server calls.
 */
import { useId, type ReactNode } from "react";
import { UserRound } from "lucide-react";
import type { InvitationPreview } from "@/lib/auth/invitations.functions";
import { roleLabel } from "@/lib/auth/roles";
import { useLanguage, useT } from "@/lib/i18n/useT";
import {
  AuthButton,
  AuthError,
  AuthField,
  AuthHeading,
  MIN_PASSWORD_LENGTH,
  PasswordField,
} from "@/components/auth/AuthScreen";

/** "Jonas Berg" → "JB"; one word gives one letter. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  const first = parts[0]!.slice(0, 1);
  const last = parts.length > 1 ? parts[parts.length - 1]!.slice(0, 1) : "";
  return `${first}${last}`.toLocaleUpperCase("da-DK");
}

/** Puts a link where the sentence says `{link}` (the sentence's order differs per language). */
function withLink(sentence: string, link: ReactNode): ReactNode {
  const [before, after = ""] = sentence.split("{link}");
  return (
    <>
      {before}
      {link}
      {after}
    </>
  );
}

export function InvitationForm({
  preview,
  signedIn,
  signedInName,
  fullName,
  onFullName,
  email,
  onEmail,
  password,
  onPassword,
  error,
  errorFor = "form",
  pending,
  onSubmit,
  loginLink,
}: {
  preview: InvitationPreview;
  signedIn: boolean;
  signedInName: string | null;
  fullName: string;
  onFullName: (value: string) => void;
  email: string;
  onEmail: (value: string) => void;
  password: string;
  onPassword: (value: string) => void;
  error: string | null;
  /** Which field the error is about, so it can be marked for screen readers. */
  errorFor?: "email" | "password" | "form";
  pending: boolean;
  onSubmit: () => void;
  /** "Log ind først" as a router link (the harness passes a plain one). */
  loginLink: ReactNode;
}) {
  const errorId = useId();
  const t = useT();
  const language = useLanguage();
  const roles = preview.roles.map((role) => roleLabel(role, language)).join(", ");
  const readyNew = email.trim().length > 0 && password.length >= MIN_PASSWORD_LENGTH;
  return (
    <form
      noValidate
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <AuthHeading eyebrow={t("auth.invitation.invitedTo")} title={preview.fundName} />

      <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2.5 rounded-[18px] bg-canvas px-[18px] py-4 text-list">
        <dt className="text-ink-3">{t("auth.invitation.email")}</dt>
        <dd className="m-0 truncate font-mono text-[13px]">{preview.maskedEmail}</dd>
        <dt className="text-ink-3">
          {preview.roles.length > 1 ? t("auth.invitation.roles") : t("auth.invitation.role")}
        </dt>
        <dd className="m-0 flex items-center gap-[7px] font-medium">
          <UserRound className="size-[13px] shrink-0 text-action" strokeWidth={1.75} aria-hidden />
          {roles}
        </dd>
        {preview.invitedBy && (
          <>
            <dt className="text-ink-3">{t("auth.invitation.invitedBy")}</dt>
            <dd className="m-0 truncate">{preview.invitedBy}</dd>
          </>
        )}
      </dl>

      {signedIn ? (
        <div className="flex items-center gap-3 rounded-[16px] px-4 py-3.5 shadow-[inset_0_0_0_1px_var(--line)]">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-sunken text-list font-semibold">
            {initials(signedInName ?? "") || (
              <UserRound className="size-4 text-ink-3" strokeWidth={1.75} aria-hidden />
            )}
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-[15px] font-medium">
              {signedInName
                ? t("auth.invitation.signedInAs", { name: signedInName })
                : t("auth.invitation.signedIn")}
            </span>
            <span className="text-meta text-ink-3">{t("auth.invitation.addedToAccount")}</span>
          </span>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <AuthField
            label={t("auth.invitation.name")}
            placeholder={t("auth.invitation.namePlaceholder")}
            autoComplete="name"
            maxLength={200}
            value={fullName}
            onChange={(event) => onFullName(event.target.value)}
          />
          <AuthField
            label={t("auth.invitation.inviteEmail")}
            type="email"
            autoComplete="username"
            maxLength={320}
            invalid={Boolean(error) && errorFor === "email"}
            errorId={errorId}
            value={email}
            onChange={(event) => onEmail(event.target.value)}
          />
          <PasswordField
            label={t("auth.invitation.choosePassword")}
            autoComplete="new-password"
            meter
            invalid={Boolean(error) && errorFor === "password"}
            errorId={errorId}
            value={password}
            onChange={onPassword}
          />
        </div>
      )}

      {error && <AuthError id={errorId}>{error}</AuthError>}

      <AuthButton
        ready={signedIn || readyNew}
        pending={pending}
        pendingLabel={signedIn ? t("auth.invitation.activating") : t("auth.invitation.creating")}
      >
        {signedIn ? t("auth.invitation.activate") : t("auth.invitation.create")}
      </AuthButton>

      {!signedIn && (
        <span className="text-center text-list text-ink-3">
          {withLink(t("auth.invitation.haveAccount"), loginLink)}
        </span>
      )}
    </form>
  );
}
