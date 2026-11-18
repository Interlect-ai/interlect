import { useEffect, useId, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { motion, useAnimationControls, useReducedMotion } from "motion/react";
import { supabase } from "@/lib/supabase/client";
import { useSession } from "@/lib/auth/useSession";
import { isTotpCode, mfaStep, normalizeTotpCode } from "@/lib/auth/mfa";
import { EASE } from "@/lib/motion";
import { useT } from "@/lib/i18n/useT";
import type { MessageKey } from "@/lib/i18n/translate";
import { pageMeta } from "@/lib/i18n/page-head";
import { AiOrb } from "@/components/ai/AiOrb";
import {
  AuthButton,
  AuthDone,
  AuthError,
  AuthField,
  AuthHeading,
  AuthScreen,
  DONE_DELAY_MS,
} from "@/components/auth/AuthScreen";

/**
 * Two-step sign-in, in the login frame. After a password sign-in the user either sets up
 * a TOTP factor (QR code and key, then a code) or answers a code for the factor they have. The
 * prototype has no MFA step; the page reuses the login frame's own parts (AuthScreen).
 * The real check is on the server and in the database (aal2 when the user has a factor).
 */
export const Route = createFileRoute("/mfa")({
  head: () => ({
    meta: [...pageMeta("mfa"), { name: "robots", content: "noindex" }],
  }),
  component: MfaPage,
});

type Load =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "challenge"; factorId: string }
  | { kind: "enroll"; factorId: string; qr: string; secret: string };

/** GoTrue returns the QR code as an SVG data URL; older versions return the bare SVG. */
function qrSource(qr: string): string {
  return qr.startsWith("data:") ? qr : `data:image/svg+xml;utf-8,${encodeURIComponent(qr)}`;
}

function groupSecret(secret: string): string {
  return secret.replace(/(.{4})/g, "$1 ").trim();
}

async function prepare(): Promise<Load> {
  // The levels come from the stored session; refresh it so a factor set up in another tab or
  // on another device counts (else this tab would try to set up a second one).
  const refreshed = await supabase.auth.refreshSession();
  if (refreshed.error) throw refreshed.error;
  const level = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (level.error) throw level.error;
  const step = mfaStep(level.data);
  if (step === "ok") return { kind: "loading" };
  const factors = await supabase.auth.mfa.listFactors();
  if (factors.error) throw factors.error;
  if (step === "challenge") {
    const factor = factors.data.totp[0];
    if (!factor) throw new Error("No verified TOTP factor");
    return { kind: "challenge", factorId: factor.id };
  }
  // A set-up that was left half way leaves an unverified factor; start over with a new one.
  for (const factor of factors.data.all) {
    if (factor.status !== "verified") {
      const removed = await supabase.auth.mfa.unenroll({ factorId: factor.id });
      if (removed.error) throw removed.error;
    }
  }
  const enrolled = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: "Interlect",
  });
  if (enrolled.error) throw enrolled.error;
  return {
    kind: "enroll",
    factorId: enrolled.data.id,
    qr: qrSource(enrolled.data.totp.qr_code),
    secret: enrolled.data.totp.secret,
  };
}

function MfaPage() {
  const navigate = useNavigate();
  const { status } = useSession();
  const reduced = useReducedMotion();
  const t = useT();
  const shake = useAnimationControls();
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [code, setCode] = useState("");
  const [error, setError] = useState<MessageKey | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState<MessageKey | null>(null);
  const errorId = useId();
  // One set-up per attempt, also when React runs the effect twice in development.
  const started = useRef(-1);

  useEffect(() => {
    if (status === "signed_out" || status === "unconfigured") {
      void navigate({ to: "/login", replace: true });
      return;
    }
    if (status !== "signed_in" || done || started.current === attempt) return;
    started.current = attempt;
    let active = true;
    setLoad({ kind: "loading" });
    prepare()
      .then((next) => {
        if (!active) return;
        if (next.kind === "loading") void navigate({ to: "/", replace: true });
        else setLoad(next);
      })
      .catch((cause: unknown) => {
        console.error("[mfa] set-up failed", cause instanceof Error ? cause.message : cause);
        if (active) setLoad({ kind: "error" });
      });
    return () => {
      active = false;
    };
  }, [status, attempt, done, navigate]);

  useEffect(() => {
    if (!done) return;
    const timer = window.setTimeout(() => void navigate({ to: "/", replace: true }), DONE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [done, navigate]);

  const normalized = normalizeTotpCode(code);
  const ready = isTotpCode(normalized);

  async function verify() {
    if (load.kind !== "challenge" && load.kind !== "enroll") return;
    if (!ready || pending) return;
    setError(null);
    setPending(true);
    let failure: MessageKey | null = null;
    try {
      const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({
        factorId: load.factorId,
        code: normalized,
      });
      if (verifyError) {
        failure = verifyError.status === 429 ? "auth.mfa.rateLimited" : "auth.mfa.wrongCode";
      }
    } catch (cause) {
      console.error("[mfa] verify threw", cause instanceof Error ? cause.message : cause);
      failure = "auth.mfa.wrongCode";
    }
    setPending(false);
    if (failure) {
      setError(failure);
      setCode("");
      if (!reduced) {
        void shake.start({
          x: [0, -6, 5, -3, 2, 0],
          transition: { duration: 0.42, ease: EASE.standard },
        });
      }
      return;
    }
    setDone(load.kind === "enroll" ? "auth.mfa.enabled" : "auth.login.welcome");
  }

  async function signOut() {
    await supabase.auth.signOut().catch(() => {});
    void navigate({ to: "/login", replace: true });
  }

  const signOutLink = (
    <button
      type="button"
      onClick={() => void signOut()}
      className="self-center text-list text-ink-3 hover:text-ink-1 hover:underline"
    >
      {t("auth.mfa.signOut")}
    </button>
  );

  if (done) {
    return (
      <AuthScreen>
        <AuthDone title={t(done)} />
      </AuthScreen>
    );
  }

  if (load.kind === "loading") {
    return (
      <AuthScreen>
        <div role="status" className="flex flex-col items-center gap-3 py-6">
          <AiOrb size={64} tone="neutral" state="working" />
          <span className="text-list text-ink-3">{t("auth.mfa.loading")}</span>
        </div>
      </AuthScreen>
    );
  }

  if (load.kind === "error") {
    return (
      <AuthScreen>
        <div className="flex flex-col gap-5">
          <AuthHeading title={t("auth.mfa.enrollTitle")} />
          <AuthError>{t("auth.mfa.failed")}</AuthError>
          <AuthButton
            type="button"
            ready
            pending={false}
            pendingLabel={t("auth.mfa.retry")}
            onClick={() => setAttempt((n) => n + 1)}
          >
            {t("auth.mfa.retry")}
          </AuthButton>
          {signOutLink}
        </div>
      </AuthScreen>
    );
  }

  const enrolling = load.kind === "enroll";

  return (
    <AuthScreen>
      <form
        noValidate
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          void verify();
        }}
      >
        <AuthHeading
          eyebrow={enrolling ? t("auth.mfa.enrollEyebrow") : undefined}
          title={enrolling ? t("auth.mfa.enrollTitle") : t("auth.mfa.challengeTitle")}
          subtitle={enrolling ? t("auth.mfa.enrollSubtitle") : t("auth.mfa.challengeSubtitle")}
        />

        {load.kind === "enroll" && (
          <div className="flex flex-col items-center gap-3">
            {/* A QR code needs a light ground to scan, also in the dark theme. */}
            <span className="rounded-lg bg-white p-3 shadow-[inset_0_0_0_1px_var(--line-strong)]">
              <img src={load.qr} alt={t("auth.mfa.qrAlt")} width={168} height={168} />
            </span>
            <span className="text-center text-meta text-ink-3">{t("auth.mfa.secretLabel")}</span>
            <code className="rounded-md bg-sunken px-3 py-1.5 text-center font-mono text-list tracking-[0.06em] break-all text-ink-1 select-all">
              {groupSecret(load.secret)}
            </code>
          </div>
        )}

        <motion.div animate={shake}>
          <AuthField
            label={t("auth.mfa.code")}
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus={!enrolling}
            maxLength={9}
            placeholder="123 456"
            className="tracking-[0.2em]"
            invalid={Boolean(error)}
            errorId={errorId}
            value={code}
            onChange={(event) => {
              setCode(event.target.value);
              setError(null);
            }}
          />
        </motion.div>

        {error && <AuthError id={errorId}>{t(error)}</AuthError>}

        <AuthButton ready={ready} pending={pending} pendingLabel={t("auth.mfa.verifying")}>
          {t("auth.mfa.verify")}
        </AuthButton>

        {signOutLink}
      </form>
    </AuthScreen>
  );
}
