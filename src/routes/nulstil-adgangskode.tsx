import { useEffect, useId, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { useServerFn } from "@tanstack/react-start";
import {
  completePasswordReset,
  resolvePasswordReset,
  type PasswordResetPreview,
} from "@/lib/auth/password-reset.functions";
import { EMAIL_PATTERN } from "@/lib/auth/guards";
import { AiOrb } from "@/components/ai/AiOrb";
import {
  AuthButton,
  AuthCreated,
  AuthError,
  AuthExpired,
  AuthField,
  AuthHeading,
  AuthLoadError,
  AuthScreen,
  MIN_PASSWORD_LENGTH,
  PasswordField,
} from "@/components/auth/AuthScreen";
import { translate, type MessageKey } from "@/lib/i18n/translate";
import { useT } from "@/lib/i18n/useT";
import { pageMeta } from "@/lib/i18n/page-head";

/**
 * "Nyt adgangskodelink": the page an Admin's one-time link opens. The person types their
 * e-mail and chooses a new password; the server checks the link and the e-mail and changes the
 * password. Nothing is signed in here: the person logs in with the new password afterwards (and
 * the authenticator app, if two-step sign-in is set up).
 */
export const Route = createFileRoute("/nulstil-adgangskode")({
  validateSearch: z.object({ token: z.string().optional() }),
  head: () => ({
    meta: [
      ...pageMeta("passwordReset"),
      { name: "robots", content: "noindex" },
      // The link carries the one-time token: never pass it on in a Referer header.
      { name: "referrer", content: "no-referrer" },
    ],
  }),
  component: PasswordResetPage,
});

type LoadState =
  | { kind: "loading" }
  | { kind: "invalid" }
  | { kind: "error" }
  | { kind: "ready"; preview: PasswordResetPreview };

// The server's messages for people (access.server) are Danish; they are recognised here and shown
// in the page's language. Anything else is never shown as it is.
const GENERIC_LINK_ERROR = translate("da", "auth.invitation.unusable");
const RATE_LIMITED = translate("da", "auth.invitation.rateLimited");

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : "";
}

function toUserMessage(cause: unknown): MessageKey {
  const message = messageOf(cause);
  if (message === GENERIC_LINK_ERROR) return "auth.reset.unusable";
  if (message === RATE_LIMITED) return "auth.invitation.rateLimited";
  return "auth.reset.failed";
}

// Same shape as the server's check (32 random bytes in base64url).
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,128}$/;

function PasswordResetPage() {
  const { token } = Route.useSearch();
  const navigate = useNavigate();
  const t = useT();
  const errorId = useId();
  const resolve = useServerFn(resolvePasswordReset);
  const complete = useServerFn(completePasswordReset);

  const [load, setLoad] = useState<LoadState>(token ? { kind: "loading" } : { kind: "invalid" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [errorFor, setErrorFor] = useState<"email" | "password" | "form">("form");
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!token || !TOKEN_PATTERN.test(token)) {
      setLoad({ kind: "invalid" });
      return;
    }
    let active = true;
    setLoad({ kind: "loading" });
    resolve({ data: { token } })
      .then((preview) => active && setLoad({ kind: "ready", preview }))
      .catch((cause: unknown) => {
        if (!active) return;
        // Every unusable link (unknown, used, revoked, expired) gets the same calm answer; a
        // network error or the rate limit says nothing about the link, so it offers another try.
        if (messageOf(cause) === GENERIC_LINK_ERROR) {
          setLoad({ kind: "invalid" });
        } else {
          console.error("[password-reset] resolve failed", messageOf(cause));
          setLoad({ kind: "error" });
        }
      });
    return () => {
      active = false;
    };
  }, [token, resolve, attempt]);

  function fail(message: string, field: "email" | "password" | "form" = "form") {
    setError(message);
    setErrorFor(field);
  }

  async function save() {
    if (!token || pending || done) return;
    if (!email.trim()) return fail(t("auth.reset.emailMissing"), "email");
    if (!EMAIL_PATTERN.test(email.trim())) return fail(t("auth.reset.emailInvalid"), "email");
    if (password.length < MIN_PASSWORD_LENGTH) {
      return fail(t("auth.reset.passwordShort", { count: MIN_PASSWORD_LENGTH }), "password");
    }
    setError(null);
    setPending(true);
    try {
      await complete({ data: { token, email: email.trim(), password } });
      setDone(true);
    } catch (cause) {
      if (toUserMessage(cause) === "auth.reset.failed") {
        console.error("[password-reset] complete failed", messageOf(cause));
      }
      fail(t(toUserMessage(cause)));
    } finally {
      setPending(false);
    }
  }

  const toLogin = () => void navigate({ to: "/login", replace: true });

  if (load.kind === "invalid") {
    return (
      <AuthScreen>
        <AuthExpired
          onLogin={toLogin}
          title={t("auth.reset.expiredTitle")}
          body={t("auth.reset.expiredBody")}
        />
      </AuthScreen>
    );
  }
  if (load.kind === "error") {
    return (
      <AuthScreen>
        <AuthLoadError onRetry={() => setAttempt((n) => n + 1)} />
      </AuthScreen>
    );
  }
  if (done) {
    return (
      <AuthScreen>
        <AuthCreated
          onLogin={toLogin}
          title={t("auth.reset.doneTitle")}
          body={t("auth.reset.doneBody")}
        />
      </AuthScreen>
    );
  }
  if (load.kind === "loading") {
    return (
      <AuthScreen>
        <div role="status" className="flex flex-col items-center gap-3 py-6">
          <AiOrb size={64} tone="neutral" state="working" />
          <span className="text-list text-ink-3">{t("auth.reset.loading")}</span>
        </div>
      </AuthScreen>
    );
  }

  const ready = email.trim().length > 0 && password.length >= MIN_PASSWORD_LENGTH;
  return (
    <AuthScreen>
      <form
        noValidate
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <AuthHeading eyebrow={t("auth.reset.eyebrow")} title={load.preview.fundName} />
        <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2.5 rounded-[18px] bg-canvas px-[18px] py-4 text-list">
          <dt className="text-ink-3">{t("auth.invitation.email")}</dt>
          <dd className="m-0 truncate font-mono text-[13px]">{load.preview.maskedEmail}</dd>
        </dl>
        <div className="flex flex-col gap-3">
          <AuthField
            label={t("auth.reset.email")}
            type="email"
            autoComplete="username"
            maxLength={320}
            invalid={Boolean(error) && errorFor === "email"}
            errorId={errorId}
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              setError(null);
            }}
          />
          <PasswordField
            label={t("auth.reset.choosePassword")}
            autoComplete="new-password"
            meter
            invalid={Boolean(error) && errorFor === "password"}
            errorId={errorId}
            value={password}
            onChange={(value) => {
              setPassword(value);
              setError(null);
            }}
          />
        </div>
        {error && <AuthError id={errorId}>{error}</AuthError>}
        <AuthButton ready={ready} pending={pending} pendingLabel={t("auth.reset.saving")}>
          {t("auth.reset.save")}
        </AuthButton>
      </form>
    </AuthScreen>
  );
}
