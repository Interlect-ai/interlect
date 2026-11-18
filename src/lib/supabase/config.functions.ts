import { createServerFn } from "@tanstack/react-start";

import type { Language } from "@/lib/i18n/language";
import { serverSupabasePublishableKey, serverSupabaseUrl } from "./env";

export type PublicSupabaseConfig = {
  url: string | null;
  publishableKey: string | null;
};

export type PublicAppConfig = {
  supabase: PublicSupabaseConfig;
  /** The installation's language for pages before a team is known. */
  language: Language;
};

/**
 * Offentlig konfiguration til browserklienten. Kun projekt-URL og den
 * publishable nøgle, som per design er offentlig. Ingen service-rollenøgle.
 * Desuden installationens sprog (kun "da" eller "en"), så log ind og invitationen
 * vises på det sprog, nye teams starter på.
 */
export const getPublicAppConfig = createServerFn({ method: "GET" }).handler(
  async (): Promise<PublicAppConfig> => {
    const { installationLanguage } = await import("@/lib/i18n/installation-language.server");
    return {
      supabase: {
        url: serverSupabaseUrl() ?? null,
        publishableKey: serverSupabasePublishableKey() ?? null,
      },
      language: await installationLanguage(),
    };
  },
);
