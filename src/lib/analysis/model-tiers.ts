import { AI_BUDGETS, type PricedModel } from "./budgets.ts";
import { floorDkk, planRunScope, type RunScope } from "./run-planner.ts";

/**
 * AI-niveauer pr. fond: Let, Middel og Tung, valgt særskilt for
 * screening og dyb analyse. Et niveau er en gruppe modeller i Vercel AI Gateway, og tabellen
 * herunder er det ENE sted, de konkrete modeller skiftes. Niveauet styrer kun analysemodellen;
 * research (Sonar / Sonar Pro) og Brains egne løkker bruger faste modeller, så kilder og
 * Brains selvtest forbliver sammenlignelige på tværs af niveauer.
 *
 * Priser pr. million tokens (AI Gateway 30. sep 2026): gpt-5.4-mini 0,75/4,50, gpt-5.4 2,50/15,
 * gpt-5.5 5/30. Det er samme prisfaktor som loftet: Middel er 3,3x Let og Tung er 2x Middel.
 */
export const AI_TIERS = ["light", "medium", "heavy"] as const;
export type AiTier = (typeof AI_TIERS)[number];

/** Standard for alle fonde og nye kunder (ikke mini som). */
export const DEFAULT_AI_TIER: AiTier = "medium";

export type AiRunKind = "screening" | "deep";

/** What happens when a full analysis does not fit the team's limit. */
export const LIMIT_ACTIONS = ["shrink", "ask"] as const;
export type LimitAction = (typeof LIMIT_ACTIONS)[number];
export const DEFAULT_LIMIT_ACTION: LimitAction = "shrink";

/** What the person chose when a full analysis did not fit the limit (spec B.1 punkt 3). */
export const LIMIT_CHOICES = ["reduce", "raise_once"] as const;
export type LimitChoice = (typeof LIMIT_CHOICES)[number];

/** The action from the database; an unknown or missing value falls back to the default. */
export function normalizeLimitAction(value: unknown): LimitAction {
  return value === "ask" || value === "shrink" ? value : DEFAULT_LIMIT_ACTION;
}

export function isAiTier(value: unknown): value is AiTier {
  return typeof value === "string" && (AI_TIERS as readonly string[]).includes(value);
}

/** Tier from the database; an unknown or missing value falls back to the default. */
export function normalizeAiTier(value: unknown): AiTier {
  return isAiTier(value) ? value : DEFAULT_AI_TIER;
}

export const TIER_MODELS: Record<AiRunKind, Record<AiTier, PricedModel>> = {
  screening: {
    light: "openai/gpt-5.4-mini",
    medium: "openai/gpt-5.4",
    heavy: "openai/gpt-5.5",
  },
  deep: {
    light: "openai/gpt-5.4-mini",
    medium: "openai/gpt-5.4",
    heavy: "openai/gpt-5.5",
  },
};

interface BudgetParts {
  researchUsd: number;
  /** Screening: the analysis step. Deep: specialists + synthesis. */
  analysisUsd: number;
  specialistsUsd: number;
  synthesisUsd: number;
}

/**
 * The tier's standard cap. The USD parts are rounded down from the DKK cap at the same
 * exchange rate as AI_BUDGETS, so a run never passes the DKK cap shown to the user. The light
 * screening and the medium deep analysis are the caps the product has had so far (5 kr / 35 kr).
 */
const TIER_BASE: Record<AiRunKind, Record<AiTier, { dkk: number; usd: number } & BudgetParts>> = {
  screening: {
    light: {
      dkk: 5,
      usd: 0.77,
      researchUsd: 0.46,
      analysisUsd: 0.31,
      specialistsUsd: 0,
      synthesisUsd: 0,
    },
    medium: {
      dkk: 10,
      usd: 1.54,
      researchUsd: 0.46,
      analysisUsd: 1.08,
      specialistsUsd: 0,
      synthesisUsd: 0,
    },
    heavy: {
      dkk: 17,
      usd: 2.63,
      researchUsd: 0.46,
      analysisUsd: 2.17,
      specialistsUsd: 0,
      synthesisUsd: 0,
    },
  },
  deep: {
    light: {
      dkk: 20,
      usd: 3.09,
      researchUsd: 1.9,
      analysisUsd: 1.19,
      specialistsUsd: 0.93,
      synthesisUsd: 0.26,
    },
    medium: {
      dkk: 35,
      usd: 5.4,
      researchUsd: 1.9,
      analysisUsd: 3.5,
      specialistsUsd: 2.75,
      synthesisUsd: 0.75,
    },
    heavy: {
      dkk: 60,
      usd: 9.28,
      researchUsd: 1.9,
      analysisUsd: 7.38,
      specialistsUsd: 5.85,
      synthesisUsd: 1.53,
    },
  },
};

/**
 * The rate the table above is worked out at, and the rate of every run stored before 0123. A new
 * run uses the one rate in ai_settings (`usd_to_dkk`), so its cap in kroner is also what
 * the credit ledger books.
 */
export const TABLE_USD_TO_DKK: number = AI_BUDGETS.exchangeRateDkkPerUsd;

/** A typo must never be able to burn money: hard limits for what a fund may confirm. */
export const CAP_LIMITS_DKK: Record<AiRunKind, { min: number; max: number }> = {
  screening: { min: 1, max: 100 },
  deep: { min: 5, max: 500 },
};

export interface RunBudget {
  dkk: number;
  usd: number;
  researchUsd: number;
  analysisUsd: number;
  specialistsUsd: number;
  synthesisUsd: number;
}

/** What one run uses: resolved once when it starts and kept on the run. */
export interface RunPlan {
  kind: AiRunKind;
  tier: AiTier;
  model: PricedModel;
  budget: RunBudget;
  /** True when the fund has confirmed its own cap instead of the tier's standard. */
  customCap: boolean;
  /** The rate from kroner to dollars the budget is worked out at, kept on the run (0123). */
  usdToDkk: number;
  /** What the run does inside its limit. Worked out again the same from the stored run. */
  scope: RunScope;
  /**
   * True for the plan runs had (and while the columns of 0036 do not exist yet).
   * A legacy plan is not written to the run's tier and cap columns.
   */
  legacy: boolean;
  /**
   * What a continuation after a stop at the price limit reserves and may spend,
   * only the parts the stopped run did not finish (`run-continuation.ts`). Absent: the whole budget.
   */
  reserve?: RunReserve | undefined;
}

/** What a run reserves in the credit ledger, against the team's month, and may spend. */
export interface RunReserve {
  usd: number;
  /** The same in kroner at the run's rate, rounded up to whole øre. */
  dkk: number;
}

function ceil2(value: number): number {
  return Math.ceil(value * 100 - 1e-9) / 100;
}

/** A reservation of `usd` dollars on this plan: never more than the plan, also in kroner. */
export function reserveOf(plan: RunPlan, usd: number): RunReserve {
  return { usd, dkk: Math.min(plan.budget.dkk, ceil2(usd * plan.usdToDkk)) };
}

/** What the run reserves and may spend: a continuation's missing parts, else its whole budget. */
export function planReserve(plan: RunPlan): RunReserve {
  return plan.reserve ?? { usd: plan.budget.usd, dkk: plan.budget.dkk };
}

/**
 * The plan a stored run may spend (the worker path): a run keeps what it reserved in
 * `estimated_cost`, its plan's dollars or, for a continuation, only the missing parts.
 * A value at or above the plan never raises what the run may use.
 */
export function storedReserve(plan: RunPlan, estimatedCost: unknown): RunPlan {
  if (estimatedCost === null || estimatedCost === undefined) return plan;
  const usd = Number(estimatedCost);
  if (!Number.isFinite(usd) || usd < 0 || usd >= plan.budget.usd - 0.000001) return plan;
  return { ...plan, reserve: reserveOf(plan, usd) };
}

/**
 * The four standard specialists of the deep analysis. A fund can switch them off and add its own
 * Every specialist call keeps the same share of the budget as with the four, so the
 * run's standard cap follows the number of specialists (see `baseBudget`).
 */
export const STANDARD_SPECIALIST_COUNT = 4;

export function isValidCapDkk(kind: AiRunKind, value: unknown): value is number {
  const { min, max } = CAP_LIMITS_DKK[kind];
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

export function standardCapDkk(
  kind: AiRunKind,
  tier: AiTier,
  specialistCount: number = STANDARD_SPECIALIST_COUNT,
): number {
  return baseBudget(kind, tier, specialistCount).dkk;
}

function floor4(value: number): number {
  return Math.floor(value * 10_000 + 1e-9) / 10_000;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/**
 * The tier's standard cap for a run with `specialistCount` specialists. Screening and a deep run
 * with the four standard specialists get the table's values unchanged. Otherwise only the
 * specialist part changes (one quarter of the table's specialist part per specialist) and the USD
 * cap is the sum of the parts. The standard is a sum in kroner (spec B.0: "Middel 35, Tung 60 kr.;
 * stiger med teamets egne specialister"), so the DKK cap grows with the dollars from the table's
 * own kroner, rounded up to whole kroner, never through a copy of the exchange rate: the one rate
 * in ai_settings turns the kroner into the run's dollars (`resolveRunBudget`).
 */
function baseBudget(
  kind: AiRunKind,
  tier: AiTier,
  specialistCount: number,
): { dkk: number; usd: number } & BudgetParts {
  const base = TIER_BASE[kind][tier];
  const count = Math.max(1, Math.floor(specialistCount));
  if (kind !== "deep" || count === STANDARD_SPECIALIST_COUNT) return base;
  const specialistsUsd = floor4((base.specialistsUsd * count) / STANDARD_SPECIALIST_COUNT);
  const analysisUsd = round4(specialistsUsd + base.synthesisUsd);
  const usd = round4(base.researchUsd + analysisUsd);
  return {
    dkk: Math.ceil((base.dkk * usd) / base.usd - 1e-9),
    usd,
    researchUsd: base.researchUsd,
    analysisUsd,
    specialistsUsd,
    synthesisUsd: base.synthesisUsd,
  };
}

/**
 * The budget for a run. Without a confirmed cap it is the tier's standard. With one, the cap
 * is the fund's real limit. The dollars are the cap at `usdToDkk`, so the parts follow the rate the
 * ledger books at. The fixed shares (research / analysis / specialists / synthesis) hold
 * while they cover what the run needs; under that the planner decides what fits, and the
 * parts never add up to more than the cap. A deep run's standard follows its number of
 * specialists.
 */
export function resolveRunBudget(
  kind: AiRunKind,
  tier: AiTier,
  capDkk: number | null,
  specialistCount: number = STANDARD_SPECIALIST_COUNT,
  usdToDkk: number = TABLE_USD_TO_DKK,
): { budget: RunBudget; customCap: boolean; scope: RunScope } {
  const base = baseBudget(kind, tier, specialistCount);
  const cap = capDkk === null || !isValidCapDkk(kind, capDkk) ? base.dkk : capDkk;
  const customCap = cap !== base.dkk;
  const usd = !customCap && usdToDkk === TABLE_USD_TO_DKK ? base.usd : floor4(cap / usdToDkk);
  const scale = usd / base.usd;
  const shares =
    usd === base.usd
      ? {
          researchUsd: base.researchUsd,
          analysisUsd: base.analysisUsd,
          specialistsUsd: base.specialistsUsd,
          synthesisUsd: base.synthesisUsd,
        }
      : {
          researchUsd: floor4(base.researchUsd * scale),
          analysisUsd: floor4(base.analysisUsd * scale),
          specialistsUsd: floor4(base.specialistsUsd * scale),
          synthesisUsd: floor4(base.synthesisUsd * scale),
        };
  const { scope, parts } = planRunScope({
    kind,
    model: TIER_MODELS[kind][tier],
    capUsd: usd,
    specialistCount,
    shares,
  });
  return { budget: { dkk: cap, usd, ...parts }, customCap, scope };
}

export function buildRunPlan(
  kind: AiRunKind,
  tier: AiTier,
  capDkk: number | null,
  specialistCount: number = STANDARD_SPECIALIST_COUNT,
  usdToDkk: number = TABLE_USD_TO_DKK,
): RunPlan {
  const { budget, customCap, scope } = resolveRunBudget(
    kind,
    tier,
    capDkk,
    specialistCount,
    usdToDkk,
  );
  return {
    kind,
    tier,
    model: TIER_MODELS[kind][tier],
    budget,
    customCap,
    usdToDkk,
    scope,
    legacy: false,
  };
}

/** An earlier run's research can stand in for this run's only when it searched at least as much. */
export function researchCovers(earlier: RunScope, wanted: RunScope): boolean {
  return wanted.tracks.every((track) => earlier.tracks.includes(track));
}

/** The lowest limit a run at this level can run at, in whole kroner (spec B.1 punkt 5). */
export function lowestCapDkk(
  kind: AiRunKind,
  tier: AiTier,
  specialistCount: number = STANDARD_SPECIALIST_COUNT,
  usdToDkk: number = TABLE_USD_TO_DKK,
): number {
  return Math.max(
    CAP_LIMITS_DKK[kind].min,
    floorDkk(kind, TIER_MODELS[kind][tier], specialistCount, usdToDkk),
  );
}

/**
 * Who can lift a run that cannot start under the bottom for its level (spec B.1 punkt 5):
 * the installation, when its own hard limit is under the bottom (the team cannot raise it), else
 * the team's Admin or Lead. The bottom follows the run's own specialists, so the case's thesis.
 */
export function tooLowCause(
  kind: AiRunKind,
  tier: AiTier,
  platformCapDkk: number,
  specialistCount: number = STANDARD_SPECIALIST_COUNT,
  usdToDkk: number = TABLE_USD_TO_DKK,
): "platform" | "team" {
  return platformCapDkk < lowestCapDkk(kind, tier, specialistCount, usdToDkk) ? "platform" : "team";
}

/**
 * The cap a new run gets when the installation has a hard limit: the fund's own cap (or null for
 * the tier's standard), unless that passes the limit, which then applies. A cap saved
 * before the limit was lowered is never trusted beyond it.
 */
export function capWithinPlatform(
  kind: AiRunKind,
  tier: AiTier,
  ownCapDkk: number | null,
  platformCapDkk: number,
  specialistCount: number = STANDARD_SPECIALIST_COUNT,
): number | null {
  const wanted = ownCapDkk ?? standardCapDkk(kind, tier, specialistCount);
  return wanted > platformCapDkk ? platformCapDkk : ownCapDkk;
}

/** The plan every run had: light screening (mini) and medium deep (gpt-5.4). */
export function legacyRunPlan(
  kind: AiRunKind,
  specialistCount: number = STANDARD_SPECIALIST_COUNT,
): RunPlan {
  return {
    ...buildRunPlan(kind, kind === "screening" ? "light" : "medium", null, specialistCount),
    legacy: true,
  };
}

/**
 * The plan a stored run was started with. A run from has no tier and gets the
 * legacy plan; otherwise the tier and cap on the run are used, never the fund's current
 * settings, so a resumed or retried step keeps the level and the cap it started with.
 */
export function planFromStoredRun(
  kind: AiRunKind,
  stored: { ai_tier?: unknown; cost_cap_dkk?: unknown; usd_to_dkk?: unknown },
  /** The run's specialists (its config version's set); four for every older run. */
  specialistCount: number = STANDARD_SPECIALIST_COUNT,
): RunPlan {
  if (!isAiTier(stored.ai_tier)) return legacyRunPlan(kind, specialistCount);
  const cap =
    stored.cost_cap_dkk === null || stored.cost_cap_dkk === undefined
      ? null
      : Number(stored.cost_cap_dkk);
  const rate = Number(stored.usd_to_dkk ?? TABLE_USD_TO_DKK);
  return buildRunPlan(
    kind,
    stored.ai_tier,
    cap !== null && isValidCapDkk(kind, cap) ? cap : null,
    specialistCount,
    Number.isFinite(rate) && rate > 0 ? rate : TABLE_USD_TO_DKK,
  );
}

/** The columns a new run stores for its plan; nothing for a legacy plan (see RunPlan.legacy). */
export function planColumns(plan: RunPlan): {
  ai_tier?: AiTier;
  cost_cap_dkk?: number;
  usd_to_dkk?: number;
} {
  return plan.legacy
    ? {}
    : { ai_tier: plan.tier, cost_cap_dkk: plan.budget.dkk, usd_to_dkk: plan.usdToDkk };
}

/**
 * The expected price of one run in DKK, for the warning that a cap is too low. Real averages per
 * tier are used when the fund has finished runs at the tier; until then this estimate applies
 * (light screening measured at about 0.2-0.3 kr; the other levels follow the model prices).
 */
const ESTIMATED_RUN_COST_DKK: Record<AiRunKind, Record<AiTier, number>> = {
  screening: { light: 0.3, medium: 1, heavy: 2 },
  deep: { light: 8, medium: 18, heavy: 36 },
};

export function estimatedRunCostDkk(kind: AiRunKind, tier: AiTier): number {
  return ESTIMATED_RUN_COST_DKK[kind][tier];
}

/**
 * A cap below the level's expected price will stop runs before they finish.
 * The interface shows this as a clear warning before the fund confirms.
 */
export function capBelowExpectedCost(
  kind: AiRunKind,
  capDkk: number,
  expectedDkk: number,
): boolean {
  return capDkk < expectedDkk;
}

/**
 * How long one analysis model call may take. The limit of a background function is 300 s and
 * the research before it takes about 30 s, so the bigger models get more time but never so much
 * that the function itself would be cut off. Light keeps the 90 s the screening always had
 * (measured: gpt-5.4 does not finish the screening in 90 s, live test 30 Sep 2026).
 */
export const SCREENING_CALL_TIMEOUT_MS: Record<AiTier, number> = {
  light: 90_000,
  medium: 180_000,
  heavy: 210_000,
};

/**
 * Deep analysis: one specialist call and the synthesis call, per level (each phase is its own
 * 300 s function; the calls inside a phase run in parallel). No call may exceed 220 s, so 80 s
 * remain in the function for set-up before the call and for saving, scoring, tasks and the Brain
 * hand-over after it (`MAX_CALL_TIMEOUT_MS` in deep-text-rules.ts, kept by a test). Measured on
 * Middel: the v10c synthesis wrote 11.1k tokens in 178 s, so 220 s leaves ~20 % room. Tung is
 * not measured on v10 (its v9 synthesis finished inside 240 s); Let (gpt-5.4-mini) is fast and
 * keeps the shorter limits.
 */
export const DEEP_CALL_TIMEOUT_MS: Record<AiTier, { specialist: number; synthesis: number }> = {
  light: { specialist: 210_000, synthesis: 180_000 },
  medium: { specialist: 210_000, synthesis: 220_000 },
  heavy: { specialist: 210_000, synthesis: 220_000 },
};
