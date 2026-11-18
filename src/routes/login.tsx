import { useEffect, useId, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { motion, useAnimationControls, useReducedMotion } from "motion/react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase/client";
import { useSession } from "@/lib/auth/useSession";
import { EASE } from "@/lib/motion";
import { useT } from "@/lib/i18n/useT";
import {
  AuthButton,
  AuthError,
  AuthField,
  AuthHeading,
  AuthScreen,
  PasswordField,
} from "@/components/auth/AuthScreen";
import { pageMeta } from "@/lib/i18n/page-head";
import { emailFromHash } from "@/lib/auth/login-handoff";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      ...pageMeta("login"),
      // i18n-keep: link previews (og:) stay Danish; a crawler never knows the fund's language.
      { property: "og:title", content: "Log ind — Interlect" },
      // i18n-keep: link preview
      { property: "og:description", content: "Intern adgang kun efter invitation." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const { status } = useSession();
  const reduced = useReducedMotion();
  const t = useT();
  const shake = useAnimationControls();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const errorId = useId();
  // A sign-in from this form goes on to two-step sign-in; an existing session goes straight on.
  const signingIn = useRef(false);
  const passwordInput = useRef<HTMLInputElement>(null);

  // From interlect.ai/login: the e-mail comes in the address's # part. Fill it in, put the cursor in the
  // password and take the e-mail out of the address bar at once, so it is not left in history or a shared link.
  useEffect(() => {
    const handedOn = emailFromHash(window.location.hash);
    if (!handedOn) return;
    setEmail(handedOn);
    window.history.replaceState(
      window.history.state,
      "",
      window.location.pathname + window.location.search,
    );
    passwordInput.current?.focus();
  }, []);

  useEffect(() => {
    if (status === "signed_in" && !signingIn.current) {
      void navigate({ to: "/", replace: true });
    }
  }, [status, navigate]);

  const ready = email.trim().length > 0 && password.length > 0 && isSupabaseConfigured();

  async function submit() {
    if (!ready || pending) return;
    setError(null);
    setPending(true);
    signingIn.current = true;
    let failed: boolean;
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });
      failed = Boolean(signInError);
    } catch (cause) {
      console.error("[login] sign-in threw", cause instanceof Error ? cause.message : cause);
      failed = true;
    }
    setPending(false);
    if (failed) {
      signingIn.current = false;
      // Generic on purpose: never reveals whether the e-mail exists.
      setError(t("auth.login.failed"));
      if (!reduced) {
        void shake.start({
          x: [0, -6, 5, -3, 2, 0],
          transition: { duration: 0.42, ease: EASE.standard },
        });
      }
      return;
    }
    // Every password sign-in sets up or answers two-step sign-in; /mfa shows the check.
    void navigate({ to: "/mfa", replace: true });
  }

  return (
    <AuthScreen>
      <form
        noValidate
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <AuthHeading title={t("auth.login.title")} subtitle={t("auth.login.subtitle")} />

        {!isSupabaseConfigured() && <AuthError>{t("auth.login.notConfigured")}</AuthError>}

        <motion.div className="flex flex-col gap-3" animate={shake}>
          <AuthField
            label={t("auth.login.email")}
            type="email"
            autoComplete="username"
            maxLength={320}
            invalid={Boolean(error)}
            errorId={errorId}
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              setError(null);
            }}
          />
          <PasswordField
            inputRef={passwordInput}
            label={t("auth.login.password")}
            autoComplete="current-password"
            invalid={Boolean(error)}
            errorId={errorId}
            value={password}
            onChange={(value) => {
              setPassword(value);
              setError(null);
            }}
          />
        </motion.div>

        {error && <AuthError id={errorId}>{error}</AuthError>}

        <AuthButton ready={ready} pending={pending} pendingLabel={t("auth.login.pending")}>
          {t("auth.login.submit")}
        </AuthButton>

        <span className="text-center text-list leading-[1.5] text-ink-3">
          {t("auth.login.hasLink")} {t("auth.login.forgot")}
        </span>
      </form>
    </AuthScreen>
  );
}
