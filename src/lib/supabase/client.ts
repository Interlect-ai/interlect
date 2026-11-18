import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Browserklient mod det eksterne Supabase-projekt (Interlect.ai).
 * Kun den offentlige (publishable) nøgle bruges her. Service-rollenøglen
 * findes udelukkende i serverfunktioner.
 *
 * Konfigurationen leveres af serveren (rod-routens loader) og injiceres i
 * `window.__PAP_SUPABASE__`, fordi VITE_-variabler ikke kan gemmes som
 * hemmeligheder i dette projekt. Fallback til VITE_-variabler bevares til
 * lokal udvikling.
 */

export type PublicSupabaseRuntimeConfig = {
  url: string | null;
  publishableKey: string | null;
};

declare global {
  var __PAP_SUPABASE__: PublicSupabaseRuntimeConfig | undefined;
}

const envUrl = import.meta.env["VITE_SUPABASE_URL"] as string | undefined;
const envKey = import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] as string | undefined;

let runtimeConfig: PublicSupabaseRuntimeConfig = {
  url: envUrl ?? null,
  publishableKey: envKey ?? null,
};

/** Kaldes af rod-routen, når serverkonfigurationen er hentet. */
export function setPublicSupabaseConfig(config: PublicSupabaseRuntimeConfig): void {
  if (!config.url || !config.publishableKey) return;
  if (config.url === runtimeConfig.url && config.publishableKey === runtimeConfig.publishableKey) {
    return;
  }
  runtimeConfig = config;
  client = null;
}

function readConfig(): PublicSupabaseRuntimeConfig {
  if (runtimeConfig.url && runtimeConfig.publishableKey) return runtimeConfig;
  const injected = typeof window !== "undefined" ? window.__PAP_SUPABASE__ : undefined;
  if (injected?.url && injected.publishableKey) {
    runtimeConfig = injected;
  }
  return runtimeConfig;
}

export function isSupabaseConfigured(): boolean {
  const config = readConfig();
  return Boolean(config.url && config.publishableKey);
}

/** Opaque sb_-nøgler er ikke JWT'er; de sendes kun som apikey. */
function keyAwareFetch(key: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(init?.headers);
    if (key.startsWith("sb_") && headers.get("Authorization") === `Bearer ${key}`) {
      headers.delete("Authorization");
    }
    headers.set("apikey", key);
    return fetch(input, { ...init, headers });
  };
}

let client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  const { url, publishableKey } = readConfig();
  if (!url || !publishableKey) {
    throw new Error(
      "Supabase er ikke konfigureret. Tilføj PAP_SUPABASE_URL og PAP_SUPABASE_PUBLISHABLE_KEY.",
    );
  }
  if (!client) {
    client = createClient(url, publishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storageKey: "pap-intelligence-auth",
      },
      global: { fetch: keyAwareFetch(publishableKey) },
    });
  }
  return client;
}

/** Doven proxy: klienten oprettes først, når konfigurationen findes. */
export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, property, receiver) {
    return Reflect.get(getClient() as object, property, receiver);
  },
});
