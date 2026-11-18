import { getServiceClient } from "@/lib/supabase/admin.server";
import { cachedInstallationLanguage } from "./installation-language";
import { parseLanguage } from "./language";

/** The installation's language for new teams, read from its one settings row (0070). */
export const installationLanguage = cachedInstallationLanguage(async () => {
  const { data, error } = await getServiceClient()
    .from("ai_settings")
    .select("default_language")
    .eq("id", true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return parseLanguage((data as { default_language?: unknown } | null)?.default_language);
});
