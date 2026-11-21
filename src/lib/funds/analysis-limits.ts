/**
 * The section Analysegrænser (spor B2): the limits in kroner, for Admin and Lead only
 * (beslutningslog 2. nov). The AI level call for every role is `ai-settings-view.ts`, without an
 * amount. Pure and tested.
 */
import {
  CAP_LIMITS_DKK,
  lowestCapDkk,
  standardCapDkk,
  STANDARD_SPECIALIST_COUNT,
  capWithinPlatform,
  type AiRunKind,
  type AiTier,
  type LimitAction,
} from "../analysis/model-tiers.ts";
import type { FundAiSettingsRow, PlatformLimits } from "../analysis/run-plan.server.ts";

/** The database's own limit for a monthly limit (0123), under the installation's hard limit. */
export const MONTHLY_CAP_MAX_DKK = 10_000;

export interface AnalysisLimitKind {
  tier: AiTier;
  /** The team's own limit; null = the level's standard. */
  ownCapDkk: number | null;
  /** The level's standard limit. */
  standardCapDkk: number;
  /** What a new run gets now: the own limit or the standard, inside the installation's limit. */
  capDkk: number;
  minDkk: number;
  maxDkk: number;
}

/** What the team paid for its runs in the last 30 days, in kroner (the credit ledger). */
export interface RunCostStats {
  runs: number;
  averageDkk: number;
  lowestDkk: number;
  highestDkk: number;
}

export interface AnalysisLimitsView {
  /** False until the database migration (0036) has run. */
  available: boolean;
  limitAction: LimitAction;
  monthlyCapDkk: number | null;
  monthlyMaxDkk: number;
  /** What the team has used of the month: reserved runs with their cap, settled with their price. */
  monthUsedDkk: number;
  screening: AnalysisLimitKind & { costs: RunCostStats | null };
  deep: AnalysisLimitKind & { costs: RunCostStats | null };
}

/** A run that is no longer queued or running: its kind and how it ended. */
export interface FinishedRunRow {
  id: string;
  kind: string;
  status: string;
}

/** A run's settled row in the credit ledger: what the team paid for it in kroner (0114, 0131). */
export interface BookedRunRow {
  ref_id: string | null;
  amount_dkk: number | string | null;
}

/** What one run cost the team, in kroner. */
export interface RunCost {
  kind: string;
  dkk: number;
}

/** A run that ends here is finished and paid for (a screening that passes waits for approval). */
const DONE_STATUSES: ReadonlySet<string> = new Set(["complete", "awaiting_approval"]);

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * What the team paid per run, from the credit ledger: the same rows the month adds up, at
 * the rate each run was settled with, so the averages, the month and the ledger agree (spec B.4
 * test 7). A finished run counts; a run that stopped at its limit, failed or was cancelled counts
 * when it was paid for (more than 0 kr.). A run without a settled row is left out.
 */
export function bookedRunCosts(
  runs: readonly FinishedRunRow[],
  booked: readonly BookedRunRow[],
): RunCost[] {
  const paid = new Map<string, number>();
  for (const row of booked) {
    const amount = Number(row.amount_dkk);
    if (!row.ref_id || !Number.isFinite(amount) || amount < 0) continue;
    paid.set(row.ref_id, (paid.get(row.ref_id) ?? 0) + amount);
  }
  return runs.flatMap((run) => {
    const dkk = paid.get(run.id);
    if (dkk === undefined) return [];
    if (!DONE_STATUSES.has(run.status) && !(dkk > 0)) return [];
    return [{ kind: run.kind, dkk }];
  });
}

/** The average, lowest and highest of what the team paid for one kind of run. */
export function runCostStats(kind: AiRunKind, costs: readonly RunCost[]): RunCostStats | null {
  const prices = costs.filter((cost) => cost.kind === kind).map((cost) => cost.dkk);
  if (prices.length === 0) return null;
  return {
    runs: prices.length,
    averageDkk: round2(prices.reduce((sum, price) => sum + price, 0) / prices.length),
    lowestDkk: round2(Math.min(...prices)),
    highestDkk: round2(Math.max(...prices)),
  };
}

function limitKind(
  kind: AiRunKind,
  tier: AiTier,
  ownCapDkk: number | null,
  platform: PlatformLimits,
  specialistCount: number,
): AnalysisLimitKind {
  const standard = standardCapDkk(kind, tier, specialistCount);
  const cap = capWithinPlatform(kind, tier, ownCapDkk, platform.capsDkk[kind], specialistCount);
  return {
    tier,
    ownCapDkk,
    standardCapDkk: standard,
    capDkk: cap ?? standard,
    minDkk: lowestCapDkk(kind, tier, specialistCount, platform.usdToDkk),
    maxDkk: Math.min(CAP_LIMITS_DKK[kind].max, platform.capsDkk[kind]),
  };
}

export function analysisLimitsView(input: {
  /** Null until the database migration (0036) has run. */
  settings: FundAiSettingsRow | null;
  platform: PlatformLimits;
  specialistCount: number;
  monthUsedDkk: number;
  costs: readonly RunCost[];
}): AnalysisLimitsView {
  const { settings, platform, specialistCount, monthUsedDkk, costs } = input;
  return {
    available: settings !== null,
    limitAction: settings?.limitAction ?? "shrink",
    monthlyCapDkk: settings?.monthlyCapDkk ?? null,
    monthlyMaxDkk: Math.min(MONTHLY_CAP_MAX_DKK, platform.monthlyCapDkk),
    monthUsedDkk: round2(monthUsedDkk),
    screening: {
      ...limitKind(
        "screening",
        settings?.screeningTier ?? "light",
        settings?.screeningCapDkk ?? null,
        platform,
        STANDARD_SPECIALIST_COUNT,
      ),
      costs: runCostStats("screening", costs),
    },
    deep: {
      ...limitKind(
        "deep",
        settings?.deepTier ?? "medium",
        settings?.deepCapDkk ?? null,
        platform,
        specialistCount,
      ),
      costs: runCostStats("deep", costs),
    },
  };
}

/** The limit a change passes, or null when the installation allows it. */
export function overPlatformLimit(
  change: {
    screeningCapDkk?: number | null | undefined;
    deepCapDkk?: number | null | undefined;
    monthlyCapDkk?: number | null | undefined;
  },
  platform: PlatformLimits,
): { maxDkk: number } | null {
  const checks: Array<[number | null | undefined, number]> = [
    [change.screeningCapDkk, platform.capsDkk.screening],
    [change.deepCapDkk, platform.capsDkk.deep],
    [change.monthlyCapDkk, platform.monthlyCapDkk],
  ];
  for (const [value, maxDkk] of checks) {
    if (value !== null && value !== undefined && value > maxDkk) return { maxDkk };
  }
  return null;
}

/**
 * The lowest limit a changed setting needs at its level, or null when it can run. Only what the
 * person changes is checked: a limit saved earlier does not block another setting.
 */
export function belowLowestCap(
  changed: ReadonlyArray<{ kind: AiRunKind; tier: AiTier; capDkk: number | null }>,
  specialistCount: number,
  usdToDkk: number,
): { minDkk: number } | null {
  for (const { kind, tier, capDkk } of changed) {
    if (capDkk === null) continue;
    const minDkk = lowestCapDkk(kind, tier, specialistCount, usdToDkk);
    if (capDkk < minDkk) return { minDkk };
  }
  return null;
}
