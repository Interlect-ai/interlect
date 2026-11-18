/**
 * The fund's language for server work without a request: the analysis workers run
 * from the queue, so no page sends its language. `withFundLanguage` runs the work with the fund's
 * language in scope, and `serverText()` reads it before the request header. The store lives on
 * `globalThis`, so `server-text.ts` (also imported by `*.functions.ts`) needs no Node import.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadFundLanguage } from "./fund-language.server.ts";
import type { Language } from "./language.ts";
import { LANGUAGE_SCOPE_KEY } from "./server-text.ts";

type Scope = AsyncLocalStorage<Language>;

function scope(): Scope {
  const holder = globalThis as unknown as Record<string, Scope | undefined>;
  return (holder[LANGUAGE_SCOPE_KEY] ??= new AsyncLocalStorage<Language>());
}

/** Runs `work` with `language` as the language of every `serverText()` inside it. */
export function withLanguage<T>(language: Language, work: () => Promise<T>): Promise<T> {
  return scope().run(language, work);
}

/** Runs `work` in the fund's language (Danish when it cannot be read, as before). */
export async function withFundLanguage<T>(
  client: SupabaseClient,
  fundId: string,
  work: () => Promise<T>,
): Promise<T> {
  return withLanguage(await loadFundLanguage(client, fundId), work);
}
