import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase, isSupabaseConfigured } from "@/lib/supabase/client";

export interface SessionState {
  status: "loading" | "signed_in" | "signed_out" | "unconfigured";
  session: Session | null;
}

/**
 * Klientens sessionstilstand. Kun til brugerfladen — al reel autorisation
 * sker serverside i serverfunktionerne.
 */
export function useSession(): SessionState {
  const [state, setState] = useState<SessionState>({
    status: isSupabaseConfigured() ? "loading" : "unconfigured",
    session: null,
  });

  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    let active = true;

    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setState({
        status: data.session ? "signed_in" : "signed_out",
        session: data.session ?? null,
      });
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setState({ status: session ? "signed_in" : "signed_out", session });
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return state;
}
