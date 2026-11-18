import { createMiddleware } from "@tanstack/react-start";
import { LANGUAGE_HEADER, uiLanguage } from "@/lib/i18n/ui-language";
import { supabase, isSupabaseConfigured } from "./client";

/**
 * Sender brugerens access token med hvert serverfunktionskald, og sidens sprog, så serverens
 * beskeder kommer tilbage på samme sprog.
 */
export const attachSupabaseAuth = createMiddleware({ type: "function" }).client(
  async ({ next }) => {
    const language = { [LANGUAGE_HEADER]: uiLanguage() };
    if (!isSupabaseConfigured()) return next({ headers: language });
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return next({ headers: language });
    return next({ headers: { ...language, Authorization: `Bearer ${token}` } });
  },
);
