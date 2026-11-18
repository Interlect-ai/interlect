/**
 * ZDR, no training and EU per call live in src/lib/ai/gateway-options.ts: every call
 * names its model and whether its content is confidential or a public search. The flags are
 * re-exported here for the security page.
 */
export { shouldEnforceEuRegion, shouldEnforceZdr } from "../ai/gateway-options.ts";

/**
 * Fondens egen retrospektive hukommelse (RAG over tidligere beslutninger)
 * kræver migration 0011 (pgvector + fund_memory_entries) at være anvendt på
 * det aktuelle Supabase-projekt. Slukket som standard, så skema og kode kan
 * ligge klar uden at noget rent faktisk læser eller skriver til tabellerne,
 * før migrationen er bekræftet anvendt. Sæt AI_FUND_MEMORY_ENABLED=true når
 * det er tilfældet.
 */
export function isFundMemoryEnabled(): boolean {
  return process.env["AI_FUND_MEMORY_ENABLED"] === "true";
}
