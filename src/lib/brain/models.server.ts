import type { SupabaseClient } from "@supabase/supabase-js";
import type { PricedModel } from "@/lib/analysis/budgets";
import { PRICED_BRAIN_MODELS } from "./settings";

/**
 * Model and prompt per fund (06 intro). brain_model_config chooses a model per role and
 * brain_prompt_versions an active prompt per key; without a row the defaults in code apply.
 * Only models with a known price can be reserved for, so another model falls back to the
 * default and the switch is logged (a model switch also needs the eval set, 11).
 */
export type BrainModelRole = "extractor" | "resolver" | "page_writer" | "reflector" | "curator";

export const DEFAULT_BRAIN_MODELS: Record<BrainModelRole, PricedModel> = {
  extractor: "openai/gpt-5.4-mini",
  resolver: "openai/gpt-5.4-mini",
  page_writer: "openai/gpt-5.4-mini",
  reflector: "openai/gpt-5.4-mini",
  curator: "openai/gpt-5.4-mini",
};
const PRICED_CHAT_MODELS: readonly PricedModel[] = PRICED_BRAIN_MODELS;

export async function brainModel(
  service: SupabaseClient,
  fundId: string,
  role: BrainModelRole,
): Promise<PricedModel> {
  const { data, error } = await service
    .from("brain_model_config")
    .select("model")
    .eq("fund_id", fundId)
    .eq("role", role)
    .maybeSingle();
  if (error) throw new Error(`brain_model_config: ${error.message}`);
  const chosen = data?.["model"] as string | undefined;
  if (!chosen) return DEFAULT_BRAIN_MODELS[role];
  if ((PRICED_CHAT_MODELS as readonly string[]).includes(chosen)) return chosen as PricedModel;
  console.warn(`[brain] ${role}: model ${chosen} has no price in code, using the default`);
  return DEFAULT_BRAIN_MODELS[role];
}

/** The fund's active prompt for the key (L6), else the repo's version 1. */
export async function brainPrompt(
  service: SupabaseClient,
  fundId: string,
  key: string,
  fallback: string,
): Promise<{ body: string; version: number | "repo" }> {
  const { data, error } = await service
    .from("brain_prompt_versions")
    .select("body, version")
    .eq("fund_id", fundId)
    .eq("prompt_key", key)
    .eq("status", "active")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`brain_prompt_versions: ${error.message}`);
  if (!data) return { body: fallback, version: "repo" };
  return { body: data["body"] as string, version: data["version"] as number };
}
