import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/lib/supabase/client";
import { useSession } from "@/lib/auth/useSession";
import { mfaStep } from "@/lib/auth/mfa";
import { useT } from "@/lib/i18n/useT";
import { LoadingState, PermissionDeniedState } from "@/components/states/StateBlocks";

/**
 * Skjuler arbejdsfladen for uautentificerede besøgende. Dette er UX, ikke
 * sikkerhed: hver serverfunktion validerer selv brugerens token og roller.
 * En bruger med to-trins-login og en session uden koden sendes til /mfa;
 * serveren og databasen afviser den session alligevel.
 */
export function RequireSession({ children }: { children: ReactNode }) {
  const { status, session } = useSession();
  const navigate = useNavigate();
  const t = useT();
  const token = session?.access_token ?? null;
  // Shown once the MFA level has been checked; a refreshed token is checked again in the
  // background, so the page never unmounts on a refresh.
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (status === "signed_out") {
      void navigate({ to: "/login", replace: true });
    }
  }, [status, navigate]);

  useEffect(() => {
    if (status !== "signed_in" || !token) return;
    let active = true;
    void supabase.auth.mfa.getAuthenticatorAssuranceLevel().then(({ data, error }) => {
      if (!active) return;
      if (!error && data && mfaStep(data) === "challenge") {
        void navigate({ to: "/mfa", replace: true });
        return;
      }
      setChecked(true);
    });
    return () => {
      active = false;
    };
  }, [status, token, navigate]);

  if (status === "unconfigured") {
    return <PermissionDeniedState body={t("shell.session.unconfigured")} />;
  }

  if (status !== "signed_in" || !checked) {
    return <LoadingState title={t("shell.session.checking")} />;
  }

  return <>{children}</>;
}
