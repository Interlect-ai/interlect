/**
 * The fund's language read on the server, for the AI calls that do not already
 * load the fund with its profile (Brain's background work, the assistants in Fondsopsætning).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_LANGUAGE, parseLanguage, type Language } from "./language.ts";

/**
 * The fund's language. A read that fails falls back to Danish and is logged: the text is then
 * written in Danish as before this ticket, which is better than stopping the work.
 */
export async function loadFundLanguage(client: SupabaseClient, fundId: string): Promise<Language> {
  const { data, error } = await client
    .from("funds")
    .select("language")
    .eq("id", fundId)
    .maybeSingle();
  if (error) {
    console.error("[loadFundLanguage]", error.message);
    return DEFAULT_LANGUAGE;
  }
  return parseLanguage((data as { language?: unknown } | null)?.language);
}
