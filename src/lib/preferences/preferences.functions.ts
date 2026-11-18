import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/lib/supabase/auth-middleware";
import { serverText } from "@/lib/i18n/server-text";

/**
 * P2: skjulte sektioner i analyserne, pr. bruger og på tværs af
 * enheder. Læses og skrives med brugerens egen klient, så RLS sikrer, at kun brugerens
 * egen række røres (migration 0022).
 */
// i18n-keep: a validation message; userMessage never shows it (the fallback stands in).
const sectionKey = z.string().regex(/^[a-z0-9._-]{1,80}$/, "Ugyldig sektionsnøgle.");

export const getHiddenSections = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<string[]> => {
    const { data, error } = await context.supabase
      .from("user_preferences")
      .select("hidden_sections")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(serverText("appServer.preferences.notLoaded"));
    return (data?.["hidden_sections"] as string[] | undefined) ?? [];
  });

export const setHiddenSections = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        add: z.array(sectionKey).max(100).default([]),
        remove: z.array(sectionKey).max(100).default([]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<string[]> => {
    // Tilføj/fjern flettes med den gemte liste, så ændringer fra en anden fane eller en
    // samtidig klik-serie ikke overskriver hinanden.
    const { data: row, error: readError } = await context.supabase
      .from("user_preferences")
      .select("hidden_sections")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (readError) throw new Error(serverText("appServer.preferences.notLoaded"));
    const current = (row?.["hidden_sections"] as string[] | undefined) ?? [];
    const next = [...new Set([...current, ...data.add])]
      .filter((key) => !data.remove.includes(key))
      .slice(0, 100);
    const { error } = await context.supabase
      .from("user_preferences")
      .upsert(
        { user_id: context.userId, hidden_sections: next, updated_at: new Date().toISOString() },
        { onConflict: "user_id" },
      );
    if (error) throw new Error(serverText("appServer.preferences.notSaved"));
    return next;
  });
