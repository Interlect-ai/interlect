import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingError } from "../brain/capabilities.ts";
import type { DeepSpecialist, PromptModuleOverrideRow } from "./specialist-prompts";
import {
  FUND_SPECIALIST_COLUMNS,
  resolveSpecialistSet,
  type FundSpecialistRow,
} from "./specialist-set.ts";
import { serverText } from "../i18n/server-text.ts";

/** The `fund_specialists` rows of one config version (none before 0076, i.e. the standard four). */
export async function loadFundSpecialistRows(
  client: SupabaseClient,
  configVersionId: string,
): Promise<FundSpecialistRow[]> {
  const { data, error } = await client
    .from("fund_specialists")
    .select(FUND_SPECIALIST_COLUMNS)
    .eq("config_version_id", configVersionId);
  if (error) {
    // Migration 0076 has not run on this database yet (Postgres or PostgREST "missing table"):
    // every version is then the standard four, as.
    if (isMissingError(error)) return [];
    // A fund's own set must never silently become the standard four (a paid run on the wrong
    // set): the run stops visibly instead and can be started again.
    throw new Error(serverText("analysisServer.specialists.notLoaded"));
  }
  return (data ?? []) as unknown as FundSpecialistRow[];
}

/**
 * The specialists a deep run with this config version runs: the fund's set with the
 * fund's own module text (`prompt_module_overrides`). Published versions are locked (0031, 0076),
 * so the worker reads the same set as the run was started with.
 */
export async function loadSpecialistSet(
  client: SupabaseClient,
  configVersionId: string,
): Promise<{
  set: DeepSpecialist[];
  rows: FundSpecialistRow[];
  overrides: Map<string, PromptModuleOverrideRow>;
}> {
  const [rows, overrideResult] = await Promise.all([
    loadFundSpecialistRows(client, configVersionId),
    client
      .from("prompt_module_overrides")
      .select("module_id, mandate, evidence_tests, risk_areas")
      .eq("config_version_id", configVersionId),
  ]);
  if (overrideResult.error) {
    throw new Error(serverText("analysisServer.specialists.overridesNotLoaded"));
  }
  const overrides = new Map<string, PromptModuleOverrideRow>(
    (overrideResult.data ?? []).map((row) => [
      row["module_id"] as string,
      row as unknown as PromptModuleOverrideRow,
    ]),
  );
  return { set: resolveSpecialistSet(rows, overrides), rows, overrides };
}
