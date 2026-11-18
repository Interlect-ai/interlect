import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildRunPlan,
  isValidCapDkk,
  legacyRunPlan,
  normalizeAiTier,
  planFromStoredRun,
  type AiRunKind,
  type RunPlan,
} from "./model-tiers.ts";
import { resolveSpecialistSet } from "./specialist-set.ts";
import { loadFundSpecialistRows } from "./specialist-set.server.ts";
import { serverText } from "../i18n/server-text.ts";

/** Postgres "undefined_column": the fund columns of 0036 are not in the database yet. */
const UNDEFINED_COLUMN = "42703";

export interface FundAiSettingsRow {
  screeningTier: ReturnType<typeof normalizeAiTier>;
  deepTier: ReturnType<typeof normalizeAiTier>;
  screeningCapDkk: number | null;
  deepCapDkk: number | null;
}

function parseCap(kind: AiRunKind, value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const cap = typeof value === "number" ? value : Number(value);
  // A stored value outside the hard limits is never trusted; the tier's standard applies.
  return isValidCapDkk(kind, cap) ? cap : null;
}

/** The fund's AI settings, or null while the columns of 0036 do not exist yet. */
export async function loadFundAiSettings(
  service: SupabaseClient,
  fundId: string,
): Promise<FundAiSettingsRow | null> {
  const { data, error } = await service
    .from("funds")
    .select("screening_tier, deep_tier, screening_cap_dkk, deep_cap_dkk")
    .eq("id", fundId)
    .maybeSingle();
  if (error) {
    if (error.code === UNDEFINED_COLUMN) {
      console.warn("[run-plan] fund AI settings columns are missing; using the pre-R-9b plan");
      return null;
    }
    // Money is at stake: a failed read must stop the run, not guess a plan.
    // i18n-keep: carries the database's own message; logged, and the person gets a calm fallback.
    throw new Error(`Teamets AI-indstillinger kunne ikke læses: ${error.message}`);
  }
  if (!data) throw new Error(serverText("analysisServer.runPlan.fundNotFound"));
  return {
    screeningTier: normalizeAiTier(data["screening_tier"]),
    deepTier: normalizeAiTier(data["deep_tier"]),
    screeningCapDkk: parseCap("screening", data["screening_cap_dkk"]),
    deepCapDkk: parseCap("deep", data["deep_cap_dkk"]),
  };
}

/**
 * The plan a new run uses: the fund's tier, model and cap, resolved once when the run starts.
 * A later change of the settings only affects later runs.
 */
export async function loadRunPlan(
  service: SupabaseClient,
  fundId: string,
  kind: AiRunKind,
  /** A deep run's number of specialists (the fund's set); four when not given. */
  specialistCount?: number,
): Promise<RunPlan> {
  const settings = await loadFundAiSettings(service, fundId);
  if (!settings) return legacyRunPlan(kind, specialistCount);
  return kind === "screening"
    ? buildRunPlan("screening", settings.screeningTier, settings.screeningCapDkk)
    : buildRunPlan("deep", settings.deepTier, settings.deepCapDkk, specialistCount);
}

/**
 * The plan a stored run was started with (the worker path). Falls back to the legacy plan while
 * the columns of 0036 do not exist yet.
 */
export async function loadStoredRunPlan(
  service: SupabaseClient,
  runId: string,
  kind: AiRunKind,
): Promise<RunPlan> {
  const { data, error } = await service
    .from("analysis_runs")
    .select("ai_tier, cost_cap_dkk, config_version_id")
    .eq("id", runId)
    .maybeSingle();
  if (error) {
    if (error.code === UNDEFINED_COLUMN) return legacyRunPlan(kind);
    // i18n-keep: carries the database's own message; logged, and the person gets a calm fallback.
    throw new Error(`Kørslens AI-niveau kunne ikke læses: ${error.message}`);
  }
  if (!data) throw new Error(serverText("analysisServer.runPlan.runNotFound"));
  // A deep run's standard cap follows its specialists. They come from the run's config
  // version, which is locked after publishing, so this is the count the run started with.
  const configVersionId = data["config_version_id"] as string | null;
  const specialistCount =
    kind === "deep" && configVersionId
      ? resolveSpecialistSet(await loadFundSpecialistRows(service, configVersionId)).length
      : undefined;
  return planFromStoredRun(kind, data, specialistCount);
}

/** The plans a new screening and a new deep analysis would use now (for displays and limits). */
export async function loadFundRunPlans(
  client: SupabaseClient,
  fundId: string,
): Promise<{ screening: RunPlan; deep: RunPlan }> {
  const settings = await loadFundAiSettings(client, fundId);
  if (!settings) return { screening: legacyRunPlan("screening"), deep: legacyRunPlan("deep") };
  return {
    screening: buildRunPlan("screening", settings.screeningTier, settings.screeningCapDkk),
    deep: buildRunPlan("deep", settings.deepTier, settings.deepCapDkk),
  };
}
