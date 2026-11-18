import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  configMissingError,
  serverSupabasePublishableKey,
  serverSupabaseServiceRoleKey,
  serverSupabaseUrl,
} from "./env";

/**
 * Service-rolleklient. Må KUN indlæses inde i en handler, efter at kalderen
 * er verificeret. Filnavnet (*.server.ts) holder modulet ude af klientbundtet.
 */

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

export function getServiceClient(): SupabaseClient {
  const url = serverSupabaseUrl();
  const serviceKey = serverSupabaseServiceRoleKey();
  if (!url || !serviceKey) {
    throw configMissingError(
      "PAP_SUPABASE_URL og/eller PAP_SUPABASE_SERVICE_ROLE_KEY (eller SUPABASE_-fallback) er ikke sat.",
    );
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: keyAwareFetch(serviceKey) },
  });
}

/** Publishable-klient på serveren, uden session. Bruges til tokenvalidering. */
export function getPublishableServerClient(): SupabaseClient {
  const url = serverSupabaseUrl();
  const key = serverSupabasePublishableKey();
  if (!url || !key) {
    throw configMissingError(
      "PAP_SUPABASE_URL og/eller PAP_SUPABASE_PUBLISHABLE_KEY (eller SUPABASE_-fallback) er ikke sat.",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: keyAwareFetch(key) },
  });
}
