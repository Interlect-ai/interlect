import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { useServerFn } from "@tanstack/react-start";
import {
  resolveInvitation,
  acceptInvitationAsNewUser,
  acceptInvitationAsExistingUser,
  type InvitationPreview,
} from "@/lib/auth/invitations.functions";
import { useSession } from "@/lib/auth/useSession";
import { supabase } from "@/lib/supabase/client";
import { AiOrb } from "@/components/ai/AiOrb";
import {
  AuthCreated,
  AuthDone,
  AuthExpired,
  AuthLoadError,
  AuthScreen,
  DONE_DELAY_MS,
  MIN_PASSWORD_LENGTH,
} from "@/components/auth/AuthScreen";
import { InvitationForm } from "@/components/auth/InvitationForm";
import { translate, type MessageKey } from "@/lib/i18n/translate";
import { useT } from "@/lib/i18n/useT";
import { pageMeta } from "@/lib/i18n/page-head";

export const Route = createFileRoute("/invitation/accept")({
  validateSearch: z.object({ token: z.string().optional() }),
  head: () => ({
    meta: [
      ...pageMeta("invitation"),
      // i18n-keep: link previews (og:) stay Danish; a crawler never knows the fund's language.
      { property: "og:title", content: "Accepter invitation — Interlect" },
      // i18n-keep: link preview
      {
        property: "og:description",
        content: "Aktivér din inviterede adgang til investeringstesens arbejdsflade.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
      // The link carries the one-time token: never pass it on in a Referer header.
      { name: "referrer", content: "no-referrer" },
    ],
  }),
  component: AcceptInvitationPage,
});

type LoadState =
  | { kind: "loading" }
  | { kind: "invalid" }
  | { kind: "error" }
  | { kind: "ready"; preview: InvitationPreview };

// The server's messages for people (access.server: GENERIC_INVITATION_ERROR and rateLimit),
// which it sends in Danish; they are recognised here and shown in the page's language.
// Anything else (validation details, "Unauthorized", network) is never shown as it is.
const GENERIC_INVITATION_ERROR = translate("da", "auth.invitation.unusable");
const RATE_LIMITED = translate("da", "auth.invitation.rateLimited");
const FALLBACK_ERROR: MessageKey = "auth.invitation.failed";

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : "";
}

function toUserMessage(cause: unknown): MessageKey {
  const message = messageOf(cause);
  if (message === GENERIC_INVITATION_ERROR) return "auth.invitation.unusable";
  if (message === RATE_LIMITED) return "auth.invitation.rateLimited";
  if (message === "Unauthorized") return "auth.invitation.signedOut";
  return FALLBACK_ERROR;
}

// Same shape as the server's check (32 random bytes in base64url): a mangled link is a dead
// link, not a network problem.
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,128}$/;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function AcceptInvitationPage() {
  const { token } = Route.useSearch();
  const navigate = useNavigate();
  const t = useT();
  const { status, session } = useSession();
  const resolve = useServerFn(resolveInvitation);
  const acceptNew = useServerFn(acceptInvitationAsNewUser);
  const acceptExisting = useServerFn(acceptInvitationAsExistingUser);

  const [load, setLoad] = useState<LoadState>(token ? { kind: "loading" } : { kind: "invalid" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [signedInName, setSignedInName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorFor, setErrorFor] = useState<"email" | "password" | "form">("form");
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  // The access was created, but signing in right after failed.
  const [created, setCreated] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // The variant the form was sent as: signing in during "Opret adgang" must not swap the card.
  const [submittedAs, setSubmittedAs] = useState<"new" | "signed_in" | null>(null);

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
        // The server answers every unusable link (unknown, used, revoked, expired) the same
        // way on purpose, so that answer gets one calm explanation. A network error or the
        // rate limit says nothing about the link, so it offers another try instead.
        if (messageOf(cause) === GENERIC_INVITATION_ERROR) {
          setLoad({ kind: "invalid" });
        } else {
          console.error("[invitation] resolve failed", messageOf(cause));
          setLoad({ kind: "error" });
        }
      });
    return () => {
      active = false;
    };
  }, [token, resolve, attempt]);

  // The signed-in variant greets the user by name (own profile row, RLS allows it).
  useEffect(() => {
    const user = session?.user;
    if (status !== "signed_in" || !user) return;
    let active = true;
    void supabase
      .from("profiles")
      .select("full_name")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data, error: profileError }) => {
        if (!active) return;
        if (profileError) console.error("[invitation] profile lookup failed", profileError.message);
        const name = (data?.["full_name"] as string | null | undefined)?.trim();
        // "" when neither is known: the card then just says "Du er logget ind".
        setSignedInName(name || user.email || "");
      });
    return () => {
      active = false;
    };
  }, [status, session]);

  useEffect(() => {
    if (!done) return;
    const timer = window.setTimeout(() => void navigate({ to: "/", replace: true }), DONE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [done, navigate]);

  const signedIn = status === "signed_in";

  function fail(message: string, field: "email" | "password" | "form" = "form") {
    setError(message);
    setErrorFor(field);
  }

  async function accept() {
    if (!token || pending || done) return;
    if (!signedIn) {
      if (!email.trim()) {
        fail(t("auth.invitation.emailMissing"), "email");
        return;
      }
      if (!EMAIL_PATTERN.test(email.trim())) {
        fail(t("auth.invitation.emailInvalid"), "email");
        return;
      }
      if (password.length < MIN_PASSWORD_LENGTH) {
        fail(t("auth.invitation.passwordShort", { count: MIN_PASSWORD_LENGTH }), "password");
        return;
      }
    }
    setError(null);
    setPending(true);
    setSubmittedAs(signedIn ? "signed_in" : "new");
    try {
      if (signedIn) {
        await acceptExisting({ data: { token } });
      } else {
        await acceptNew({
          data: {
            token,
            email,
            password,
            ...(fullName.trim() ? { fullName: fullName.trim() } : {}),
          },
        });
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: email.trim().toLowerCase(),
          password,
        });
        if (signInError) {
          // The access exists and the link is used; only the automatic sign-in failed.
          console.error("[invitation] sign-in after accept failed", signInError.message);
          setCreated(true);
          return;
        }
        // A new access sets up two-step sign-in before anything else.
        void navigate({ to: "/mfa", replace: true });
        return;
      }
      setDone(true);
    } catch (cause) {
      if (toUserMessage(cause) === FALLBACK_ERROR) {
        console.error("[invitation] accept failed", messageOf(cause));
      }
      fail(t(toUserMessage(cause)));
      setSubmittedAs(null);
    } finally {
      setPending(false);
    }
  }

  if (load.kind === "invalid") {
    return (
      <AuthScreen>
        <AuthExpired onLogin={() => void navigate({ to: "/login" })} />
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

  if (created) {
    return (
      <AuthScreen>
        <AuthCreated onLogin={() => void navigate({ to: "/login", replace: true })} />
      </AuthScreen>
    );
  }

  if (done) {
    return (
      <AuthScreen>
        <AuthDone title={t("auth.invitation.activated")} />
      </AuthScreen>
    );
  }

  // Before the first submit, wait for the session (and the signed-in name), so a signed-in
  // user never sees the new-user fields for a moment.
  const waitingForSession =
    submittedAs === null && (status === "loading" || (signedIn && signedInName === null));

  if (load.kind === "loading" || waitingForSession) {
    return (
      <AuthScreen>
        <div role="status" className="flex flex-col items-center gap-3 py-6">
          <AiOrb size={64} tone="neutral" state="working" />
          <span className="text-list text-ink-3">{t("auth.invitation.loading")}</span>
        </div>
      </AuthScreen>
    );
  }

  return (
    <AuthScreen>
      <InvitationForm
        preview={load.preview}
        signedIn={submittedAs ? submittedAs === "signed_in" : signedIn}
        signedInName={signedInName}
        fullName={fullName}
        onFullName={setFullName}
        email={email}
        onEmail={(value) => {
          setEmail(value);
          setError(null);
        }}
        password={password}
        onPassword={(value) => {
          setPassword(value);
          setError(null);
        }}
        error={error}
        errorFor={errorFor}
        pending={pending}
        onSubmit={() => void accept()}
        loginLink={
          <Link to="/login" className="font-medium text-ink-1 hover:underline">
            {t("auth.invitation.loginFirst")}
          </Link>
        }
      />
    </AuthScreen>
  );
}
