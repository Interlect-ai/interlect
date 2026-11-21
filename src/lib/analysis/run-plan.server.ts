import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildRunPlan,
  CAP_LIMITS_DKK,
  capWithinPlatform,
  isValidCapDkk,
  legacyRunPlan,
  normalizeAiTier,
  normalizeLimitAction,
  planFromStoredRun,
  planReserve,
  storedReserve,
  tooLowCause,
  type AiRunKind,
  type LimitAction,
  type LimitChoice,
  type RunPlan,
} from "./model-tiers.ts";
import { continuationReserve, type StoppedRunProgress } from "./run-continuation.ts";
import { resolveSpecialistSet } from "./specialist-set.ts";
import { loadFundSpecialistRows, loadRunSetupStage } from "./specialist-set.server.ts";
import { rowsForStageList } from "./setup-stage.ts";
import { serverText } from "../i18n/server-text.ts";
import { loadAnalysisMonth, monthLeftDkk } from "../ai/analysis-month.server.ts";
import { MonthlyLimitError, reserveAnalysisCredits } from "../ai/credits.server.ts";
import { releaseStalledFundRuns } from "./run-release.server.ts";

/** Postgres "undefined_column": the fund columns of 0036 are not in the database yet. */
const UNDEFINED_COLUMN = "42703";

export interface FundAiSettingsRow {
  screeningTier: ReturnType<typeof normalizeAiTier>;
  deepTier: ReturnType<typeof normalizeAiTier>;
  screeningCapDkk: number | null;
  deepCapDkk: number | null;
  /** What happens when a full analysis does not fit the limit (0123). */
  limitAction: LimitAction;
  /** The team's monthly limit for analyses in kroner; null = none (0123). */
  monthlyCapDkk: number | null;
}

/** The installation's one rate and its hard limits, from ai_settings (0070, 0123). */
export interface PlatformLimits {
  usdToDkk: number;
  capsDkk: Record<AiRunKind, number>;
  monthlyCapDkk: number;
}

function parseMonthlyCap(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const cap = Number(value);
  return Number.isFinite(cap) && cap >= 0 ? cap : null;
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
  // Read on their own: while 0123 is on its way a run must stop, not fall back to the old plan.
  const { data: limits, error: limitsError } = await service
    .from("funds")
    .select("analysis_limit_action, monthly_cap_dkk")
    .eq("id", fundId)
    .maybeSingle();
  if (limitsError) {
    // i18n-keep: carries the database's own message; logged, and the person gets a calm fallback.
    throw new Error(`Teamets analysegrænser kunne ikke læses: ${limitsError.message}`);
  }
  return {
    screeningTier: normalizeAiTier(data["screening_tier"]),
    deepTier: normalizeAiTier(data["deep_tier"]),
    screeningCapDkk: parseCap("screening", data["screening_cap_dkk"]),
    deepCapDkk: parseCap("deep", data["deep_cap_dkk"]),
    limitAction: normalizeLimitAction(limits?.["analysis_limit_action"]),
    monthlyCapDkk: parseMonthlyCap(limits?.["monthly_cap_dkk"]),
  };
}

/** The one rate and the hard limits. Money is at stake: a failed read stops the run. */
export async function loadPlatformLimits(service: SupabaseClient): Promise<PlatformLimits> {
  const { data, error } = await service
    .from("ai_settings")
    .select(
      "usd_to_dkk, platform_screening_cap_dkk, platform_deep_cap_dkk, platform_monthly_cap_dkk",
    )
    .eq("id", true)
    .maybeSingle();
  if (error) {
    // i18n-keep: carries the database's own message; logged, and the person gets a calm fallback.
    throw new Error(`Installationens AI-indstillinger kunne ikke læses: ${error.message}`);
  }
  const usdToDkk = Number(data?.["usd_to_dkk"]);
  const screening = Number(data?.["platform_screening_cap_dkk"]);
  const deep = Number(data?.["platform_deep_cap_dkk"]);
  const monthly = Number(data?.["platform_monthly_cap_dkk"]);
  if (![usdToDkk, screening, deep, monthly].every(Number.isFinite) || usdToDkk <= 0) {
    // i18n-keep: an internal error; logged, and the person gets a calm fallback.
    throw new Error("Installationens AI-indstillinger kunne ikke læses: ugyldige værdier");
  }
  return { usdToDkk, capsDkk: { screening, deep }, monthlyCapDkk: monthly };
}

/** The plan a new run gets from the fund's settings, inside the installation's hard limits. */
function fundRunPlan(
  kind: AiRunKind,
  settings: FundAiSettingsRow,
  platform: PlatformLimits,
  specialistCount?: number,
  /** What is left of the team's month; a run never gets more than that. */
  monthLeft: number | null = null,
): RunPlan {
  const tier = kind === "screening" ? settings.screeningTier : settings.deepTier;
  const ownCap = kind === "screening" ? settings.screeningCapDkk : settings.deepCapDkk;
  const count = kind === "screening" ? undefined : specialistCount;
  const room =
    monthLeft === null ? platform.capsDkk[kind] : Math.min(platform.capsDkk[kind], monthLeft);
  const cap = capWithinPlatform(kind, tier, ownCap, room, count);
  return buildRunPlan(kind, tier, cap, count, platform.usdToDkk);
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
  return fundRunPlan(kind, settings, await loadPlatformLimits(service), specialistCount);
}

/**
 * A deep run that stopped at its price limit before this one: what it finished on which
 * model. Its steps are only taken over by a run on the same model.
 */
export interface StoppedRun {
  model: string;
  specialistIds: readonly string[];
  progress: StoppedRunProgress;
}

/**
 * The plan a new run starts on, or null when the team asks first and a full analysis does not fit
 * (the person then chooses: a smaller analysis, or the level's standard limit this one time). Under
 * the bottom for the level the run never starts (spec B.1 punkt 5): nothing is paid or reserved.
 *
 * A continuation after a stop at the price limit (`stopped`) is planned on the run's
 * own limit, and only what is missing has to fit in the month; it reserves only that (`reserve`).
 * When even that does not fit, it is planned on the month as a new run is.
 */
export async function planNewRun(
  service: SupabaseClient,
  input: {
    fundId: string;
    kind: AiRunKind;
    specialistCount?: number | undefined;
    choice?: LimitChoice | undefined;
    stopped?: StoppedRun | undefined;
  },
): Promise<RunPlan | null> {
  const { fundId, kind, specialistCount, choice, stopped } = input;
  const settings = await loadFundAiSettings(service, fundId);
  if (!settings) return legacyRunPlan(kind, specialistCount);
  const platform = await loadPlatformLimits(service);
  // (C4-8): a run that stands still on another case must not hold the month for 24 hours.
  if (settings.monthlyCapDkk !== null) await releaseStalledFundRuns(service, fundId);
  // The team's month shrinks the run like its own limit does; ai_reserve holds it under the row lock.
  const monthLeft =
    settings.monthlyCapDkk === null ? null : monthLeftDkk(await loadAnalysisMonth(service, fundId));
  const choose = (room: number | null): RunPlan => {
    const own = fundRunPlan(kind, settings, platform, specialistCount, room);
    return choice === "raise_once" && own.scope.status !== "full"
      ? fundRunPlan(
          kind,
          kind === "screening"
            ? { ...settings, screeningCapDkk: null }
            : { ...settings, deepCapDkk: null },
          platform,
          specialistCount,
          room,
        )
      : own;
  };
  const askFirst = (plan: RunPlan) =>
    plan.scope.status === "reduced" && settings.limitAction === "ask" && !choice;
  const reserveFor = (plan: RunPlan) =>
    stopped && kind === "deep" && stopped.model === plan.model && plan.scope.status !== "too_low"
      ? continuationReserve(plan, stopped.specialistIds, stopped.progress)
      : undefined;
  if (monthLeft !== null && stopped) {
    const unbounded = choose(null);
    const reserve = reserveFor(unbounded);
    if (reserve && reserve.dkk <= monthLeft) {
      return askFirst(unbounded) ? null : { ...unbounded, reserve };
    }
  }
  if (monthLeft !== null && monthLeft < CAP_LIMITS_DKK[kind].min) {
    throw new Error(serverText("appServer.credits.monthlyLimit"));
  }
  const plan = choose(monthLeft);
  if (plan.scope.status === "too_low") {
    // With the month as what binds it, raising the run's own limit would not help.
    if (monthLeft !== null && plan.budget.dkk === monthLeft) {
      throw new Error(serverText("appServer.credits.monthlyLimit"));
    }
    // The message says who can lift it. Under the installation's own limit the team
    // cannot; a deep run's bottom follows the case's thesis (its specialists), not the default.
    const tier = kind === "screening" ? settings.screeningTier : settings.deepTier;
    const count = kind === "screening" ? undefined : specialistCount;
    const cause = tooLowCause(kind, tier, platform.capsDkk[kind], count, platform.usdToDkk);
    throw new Error(
      serverText(
        cause === "platform"
          ? "analysisServer.runPlan.platformLimitTooLow"
          : kind === "deep"
            ? "analysisServer.runPlan.limitTooLowDeep"
            : "analysisServer.runPlan.limitTooLow",
      ),
    );
  }
  if (askFirst(plan)) return null;
  const reserve = reserveFor(plan);
  return reserve ? { ...plan, reserve } : plan;
}

/** How many times a run is planned again when another run took the month first (C4-11). */
const MONTH_REPLANS = 2;

/**
 * Reserves a planned run's limit in the credit ledger and returns the plan it got room for.
 * `planNewRun` reads the month before the row lock, so a run started at the same moment can take the
 * room first, and ai_reserve then refuses (0125). Instead of refusing a run the team lets shrink
 * (C4-11), it is planned again on what is left of the month and reserved smaller, at most
 * `MONTH_REPLANS` times. Only a smaller run on the same level and model is tried (the run's key and
 * its steps already follow them); anything else is refused as before, and so is a team that asks
 * first (its new plan is null: the person chooses again). A continuation reserves only its missing
 * parts (`planReserve`) and is planned again the same way.
 */
export async function reservePlannedRun(
  service: SupabaseClient,
  plan: RunPlan,
  input: {
    fundId: string;
    kind: AiRunKind;
    specialistCount?: number | undefined;
    choice?: LimitChoice | undefined;
    stopped?: StoppedRun | undefined;
    runId: string;
    userId: string;
  },
): Promise<{ plan: RunPlan; ledgerId: number }> {
  const { fundId, kind, specialistCount, choice, stopped, runId, userId } = input;
  let current = plan;
  for (let attempt = 0; ; attempt += 1) {
    const reserve = planReserve(current);
    try {
      const ledgerId = await reserveAnalysisCredits(service, {
        fundId,
        runId,
        capUsd: reserve.usd,
        capDkk: reserve.dkk,
        userId,
        model: current.model,
        kind: kind === "screening" ? "screening" : "deep_analysis",
      });
      return { plan: current, ledgerId };
    } catch (cause) {
      if (!(cause instanceof MonthlyLimitError) || attempt >= MONTH_REPLANS) throw cause;
      const again = await planNewRun(service, { fundId, kind, specialistCount, choice, stopped });
      if (
        !again ||
        again.model !== current.model ||
        again.tier !== current.tier ||
        !(planReserve(again).dkk < reserve.dkk)
      ) {
        throw cause;
      }
      current = again;
    }
  }
}

/**
 * The plan a stored run was started with (the worker path), with what it reserved when that was
 * less than the plan (a continuation's missing parts, `estimated_cost`).
 */
export async function loadStoredRunPlan(
  service: SupabaseClient,
  runId: string,
  kind: AiRunKind,
): Promise<RunPlan> {
  const { data, error } = await service
    .from("analysis_runs")
    .select(
      "ai_tier, cost_cap_dkk, usd_to_dkk, config_version_id, estimated_cost, fund_id, previous_run_id",
    )
    .eq("id", runId)
    .maybeSingle();
  // A run never resumes on a guessed plan: the wrong model or budget would cost money.
  if (error) {
    // i18n-keep: carries the database's own message; logged, and the person gets a calm fallback.
    throw new Error(`Kørslens AI-niveau kunne ikke læses: ${error.message}`);
  }
  if (!data) throw new Error(serverText("analysisServer.runPlan.runNotFound"));
  // A deep run's standard cap follows its specialists. They come from the run's config
  // version, which is locked after publishing, so this is the count the run started with.:
  // the set of the stage its screening used, as the start and the worker read it.
  const configVersionId = data["config_version_id"] as string | null;
  const specialistCount =
    kind === "deep" && configVersionId
      ? resolveSpecialistSet(
          rowsForStageList(
            await loadFundSpecialistRows(service, configVersionId),
            (
              await loadRunSetupStage(
                service,
                data["fund_id"] as string,
                data["previous_run_id"] as string | null,
              )
            )?.stage ?? null,
          ),
        ).length
      : undefined;
  return storedReserve(planFromStoredRun(kind, data, specialistCount), data["estimated_cost"]);
}

/**
 * The plans a new screening and a new deep analysis would use now (for displays and limits). The
 * limits are not readable with a member's own key (0123): pass the service client.
 */
export async function loadFundRunPlans(
  service: SupabaseClient,
  fundId: string,
): Promise<{ screening: RunPlan; deep: RunPlan }> {
  const settings = await loadFundAiSettings(service, fundId);
  if (!settings) return { screening: legacyRunPlan("screening"), deep: legacyRunPlan("deep") };
  const platform = await loadPlatformLimits(service);
  return {
    screening: fundRunPlan("screening", settings, platform),
    deep: fundRunPlan("deep", settings, platform),
  };
}
