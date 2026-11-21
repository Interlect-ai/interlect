/**
 * What the AI level call sends to the browser (beslutningslog 15. og 20. okt): the level,
 * the levels to choose between, whether the fund has its own cap and whether that cap is too low.
 * Never a model name and never an amount, for any role: kroner are for Admin and Lead in the section
 * Analysegrænser only (beslutningslog 2. nov), not in this call. The fund's prices are read on the
 * server only to work out the warning. Pure and tested.
 */
import {
  AI_TIERS,
  capBelowExpectedCost,
  capWithinPlatform,
  estimatedRunCostDkk,
  resolveRunBudget,
  STANDARD_SPECIALIST_COUNT,
  TABLE_USD_TO_DKK,
  type AiRunKind,
  type AiTier,
} from "../analysis/model-tiers.ts";
import type { FundAiSettingsRow } from "../analysis/run-plan.server.ts";

export interface AiKindSettings {
  tier: AiTier;
  tiers: { tier: AiTier }[];
  /** The fund has confirmed its own cap; "Brug standard" takes it away. */
  hasOwnCap: boolean;
  /** The cap is below what the chosen level usually costs: runs will stop before they finish. */
  capWarning: boolean;
}

export interface FundAiSettingsView {
  /** False until the database migration (0036) has run; the settings are then the old defaults. */
  available: boolean;
  canEdit: boolean;
  screening: AiKindSettings;
  deep: AiKindSettings;
}

export interface RunCostRow {
  kind: string;
  ai_tier: string | null;
  actual_cost: number | string | null;
}

/** A run from has no tier: screening ran light and deep analysis ran middle. */
function runTier(row: RunCostRow): AiTier | null {
  if (row.ai_tier && (AI_TIERS as readonly string[]).includes(row.ai_tier)) {
    return row.ai_tier as AiTier;
  }
  if (row.ai_tier === null) return row.kind === "screening" ? "light" : "medium";
  return null;
}

/** The real average of the fund's finished runs at this level, or the estimate until there are any. */
function expectedCostDkk(
  kind: AiRunKind,
  tier: AiTier,
  rows: readonly RunCostRow[],
  usdToDkk: number,
): number {
  const costs = rows
    .filter((row) => row.kind === kind && runTier(row) === tier)
    .map((row) => Number(row.actual_cost))
    .filter((cost) => Number.isFinite(cost) && cost > 0);
  if (costs.length === 0) return estimatedRunCostDkk(kind, tier);
  return (
    Math.round((costs.reduce((sum, cost) => sum + cost, 0) / costs.length) * usdToDkk * 100) / 100
  );
}

export function aiKindSettings(
  kind: AiRunKind,
  tier: AiTier,
  confirmedCapDkk: number | null,
  rows: readonly RunCostRow[],
  /** A deep run's specialists in the active version; the cap follows them. */
  specialistCount: number = STANDARD_SPECIALIST_COUNT,
  /** The installation's one rate. */
  usdToDkk: number = TABLE_USD_TO_DKK,
  /** The installation's hard limit: the warning judges the cap a new run really gets. */
  platformCapDkk?: number,
): AiKindSettings {
  const cap =
    platformCapDkk === undefined
      ? confirmedCapDkk
      : capWithinPlatform(kind, tier, confirmedCapDkk, platformCapDkk, specialistCount);
  const { budget } = resolveRunBudget(kind, tier, cap, specialistCount, usdToDkk);
  return {
    tier,
    tiers: AI_TIERS.map((item) => ({ tier: item })),
    hasOwnCap: confirmedCapDkk !== null,
    capWarning: capBelowExpectedCost(kind, budget.dkk, expectedCostDkk(kind, tier, rows, usdToDkk)),
  };
}

/** The whole answer of the AI level call; the same for every role except `canEdit`. */
export function fundAiSettingsView(input: {
  canEdit: boolean;
  /** Null until the database migration (0036) has run. */
  settings: FundAiSettingsRow | null;
  rows: readonly RunCostRow[];
  specialistCount: number;
  usdToDkk?: number;
  platformCapsDkk?: Record<AiRunKind, number>;
}): FundAiSettingsView {
  const { canEdit, settings, rows, specialistCount, usdToDkk, platformCapsDkk } = input;
  return {
    available: settings !== null,
    canEdit,
    screening: aiKindSettings(
      "screening",
      settings?.screeningTier ?? "light",
      settings?.screeningCapDkk ?? null,
      rows,
      STANDARD_SPECIALIST_COUNT,
      usdToDkk,
      platformCapsDkk?.screening,
    ),
    deep: aiKindSettings(
      "deep",
      settings?.deepTier ?? "medium",
      settings?.deepCapDkk ?? null,
      rows,
      specialistCount,
      usdToDkk,
      platformCapsDkk?.deep,
    ),
  };
}
