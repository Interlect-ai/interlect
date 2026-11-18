import { createMiddleware } from "@tanstack/react-start";
import {
  configMissingError,
  serverSupabasePublishableKey,
  serverSupabaseServiceRoleKey,
  serverSupabaseUrl,
} from "./env";
import { getRequestHeader } from "@tanstack/react-start/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { mfaSatisfied } from "@/lib/auth/mfa";

/**
 * Validerer kalderens Supabase-JWT kryptografisk hos Supabase Auth og lægger
 * en brugerscopet klient (RLS som brugeren), userId og e-mail i context.
 *
 * Bruger-ID udledes altid af det validerede token — aldrig af inputdata.
 * En bruger med en bekræftet MFA-faktor skal bruge en aal2-session; ellers 401.
 */

function keyAwareFetch(key: string, bearer?: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set("apikey", key);
    if (bearer) {
      headers.set("Authorization", `Bearer ${bearer}`);
    } else if (key.startsWith("sb_") && headers.get("Authorization") === `Bearer ${key}`) {
      headers.delete("Authorization");
    }
    return fetch(input, { ...init, headers });
  };
}

function unauthorized(): never {
  throw new Response("Unauthorized", { status: 401 });
}

/**
 * The same check for a plain server route (e.g. a streaming API route that is not a server
 * function): the Authorization header's token is verified with Supabase Auth, and the result is
 * a user-scoped client (RLS as the user) and the user id, or null when it is missing or invalid.
 * Throws only when the Supabase configuration is missing.
 */
export async function userFromAuthorizationHeader(
  header: string | null,
): Promise<{ supabase: SupabaseClient; userId: string } | null> {
  const url = serverSupabaseUrl();
  const key = serverSupabasePublishableKey();
  if (!url || !key) {
    throw configMissingError(
      "PAP_SUPABASE_URL og/eller PAP_SUPABASE_PUBLISHABLE_KEY (eller SUPABASE_-fallback) er ikke sat.",
    );
  }
  const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : null;
  if (!token) return null;
  const verifier = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: keyAwareFetch(key) },
  });
  const { data, error } = await verifier.auth.getUser(token);
  // An Auth outage is not "not signed in": the caller logs it and answers 500.
  if (error && ((error.status ?? 0) >= 500 || error.name === "AuthRetryableFetchError")) {
    throw new Error(`Supabase Auth: ${error.message}`);
  }
  if (error || !data.user) return null;
  if (!mfaSatisfied(data.user.factors, token)) return null;
  const supabase: SupabaseClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: keyAwareFetch(key, token) },
  });
  return { supabase, userId: data.user.id };
}

export const requireSupabaseAuth = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    const url = serverSupabaseUrl();
    const key = serverSupabasePublishableKey();
    if (!url || !key) {
      throw configMissingError(
        "PAP_SUPABASE_URL og/eller PAP_SUPABASE_PUBLISHABLE_KEY (eller SUPABASE_-fallback) er ikke sat.",
      );
    }

    const header = getRequestHeader("authorization") ?? getRequestHeader("Authorization");
    const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : null;
    if (!token) unauthorized();

    const verifier = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: keyAwareFetch(key) },
    });

    const { data, error } = await verifier.auth.getUser(token);
    if (error || !data.user) unauthorized();
    if (!mfaSatisfied(data.user.factors, token)) unauthorized();

    const supabase: SupabaseClient = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: keyAwareFetch(key, token) },
    });

    return next({
      context: {
        supabase,
        userId: data.user.id,
        email: (data.user.email ?? "").toLowerCase(),
        emailVerified: Boolean(data.user.email_confirmed_at),
      },
    });
  },
);
