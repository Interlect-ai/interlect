import { serverText } from "@/lib/i18n/server-text";

/**
 * Serverens miljøopslag mod det eksterne Supabase-projekt "PAP-intelligence".
 * Værdierne gemmes som PAP_-hemmeligheder (SUPABASE_-præfikset er reserveret
 * af platformen). De ældre navne understøttes fortsat som fallback.
 * Læs altid inde i en handler — aldrig på modulniveau.
 */
export function serverSupabaseUrl(): string | undefined {
  return process.env["PAP_SUPABASE_URL"] ?? process.env["SUPABASE_URL"];
}

export function serverSupabasePublishableKey(): string | undefined {
  return process.env["PAP_SUPABASE_PUBLISHABLE_KEY"] ?? process.env["SUPABASE_PUBLISHABLE_KEY"];
}

export function serverSupabaseServiceRoleKey(): string | undefined {
  return process.env["PAP_SUPABASE_SERVICE_ROLE_KEY"] ?? process.env["SUPABASE_SERVICE_ROLE_KEY"];
}

/**
 * Kastes når server-konfiguration mangler. Den tekniske detalje logges kun
 * server-side (synlig i Vercel-logs) -- brugeren må aldrig se variabelnavne.
 */
export function configMissingError(technicalDetail: string): Error {
  console.error(`[server-config] ${technicalDetail}`);
  return new Error(serverText("appServer.system.technical"));
}
