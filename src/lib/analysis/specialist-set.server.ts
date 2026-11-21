import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingError } from "../brain/capabilities.ts";
import type { DeepSpecialist, PromptModuleOverrideRow } from "./specialist-prompts";
import {
  FUND_SPECIALIST_COLUMNS,
  resolveSpecialistSet,
  type FundSpecialistRow,
} from "./specialist-set.ts";
import { serverText } from "../i18n/server-text.ts";
import {
  readSetupStageChoice,
  rowsForStageList,
  rowsForStageMerge,
  stagesOfRows,
  type SetupStage,
  type SetupStageChoice,
} from "./setup-stage.ts";

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
 *
 * an analysis passes the stage it runs with (`profile.teamSetup?.stage`, null when the
 * version has nothing per stage): the stage's own set when it has one, else the shared set, and
 * per module the stage's own text before the shared text (setup-stage.ts). Without `stage` (the
 * editor's own reads, reworked per stage) every row is returned as before.
 */
export async function loadSpecialistSet(
  client: SupabaseClient,
  configVersionId: string,
  stage?: SetupStage | null,
): Promise<{
  set: DeepSpecialist[];
  rows: FundSpecialistRow[];
  overrides: Map<string, PromptModuleOverrideRow>;
}> {
  const [allRows, overrideResult] = await Promise.all([
    loadFundSpecialistRows(client, configVersionId),
    client
      .from("prompt_module_overrides")
      .select("stage, module_id, mandate, evidence_tests, risk_areas")
      .eq("config_version_id", configVersionId),
  ]);
  if (overrideResult.error) {
    throw new Error(serverText("analysisServer.specialists.overridesNotLoaded"));
  }
  const allOverrides = (overrideResult.data ?? []) as unknown as Array<
    PromptModuleOverrideRow & { module_id: string; stage?: string | null }
  >;
  const rows = stage === undefined ? allRows : rowsForStageList(allRows, stage);
  const overrideRows =
    stage === undefined
      ? allOverrides
      : rowsForStageMerge(allOverrides, stage, (row) => row.module_id);
  const overrides = new Map<string, PromptModuleOverrideRow>(
    overrideRows.map((row) => [row.module_id, row]),
  );
  return { set: resolveSpecialistSet(rows, overrides), rows, overrides };
}

/**
 * The most specialists one deep run on this version can have: the largest of the shared
 * set and each stage's own set (the version's rows without a stage would add up every stage's).
 * An old version has only the shared set, so this is its set's size as before.
 */
export async function loadLargestSpecialistSetSize(
  client: SupabaseClient,
  configVersionId: string,
): Promise<number> {
  const rows = await loadFundSpecialistRows(client, configVersionId);
  return Math.max(
    ...[null, ...stagesOfRows(rows)].map(
      (stage) => resolveSpecialistSet(rowsForStageList(rows, stage)).length,
    ),
  );
}

/**
 * The stage choice a run was made with (`validation_result.setupStage`), for the deep
 * analysis on a screening: the worker and the run's plan use the screening's stage, as the start
 * did. Null without a run, for a run made and for a version with nothing per stage.
 */
export async function loadRunSetupStage(
  client: SupabaseClient,
  fundId: string,
  runId: string | null,
): Promise<SetupStageChoice | null> {
  if (!runId) return null;
  const { data, error } = await client
    .from("analysis_runs")
    .select("validation_result")
    .eq("id", runId)
    .eq("fund_id", fundId)
    .maybeSingle();
  // The wrong stage would run (and pay for) the wrong setup: stop visibly instead.
  if (error) throw new Error(serverText("analysisServer.specialists.notLoaded"));
  const validation = (data?.["validation_result"] ?? null) as { setupStage?: unknown } | null;
  return readSetupStageChoice(validation?.setupStage);
}
