/**
 * The figures the finance maths needs, taken straight from a register filing.
 * A screening reads the registers without any AI, so the revenue and cash it finds become
 * data points on the case (source: the register evidence) instead of staying only as text.
 */

/** Register line item -> the metric `calculateFinance` and the cards use. */
const REGISTRY_METRIC_TO_POINT: Record<string, string> = {
  revenue: "annual_revenue",
  cash: "cash",
};

/** A year filed as a full year; a short or long first/last year is not "annual". */
const FULL_YEAR_DAYS = { min: 350, max: 380 };

export interface RegistryEvidencePeriod {
  periodStart: string;
  periodEnd: string;
  facts: Array<{ metric: string; value: number; unit: string }>;
}

export interface RegistryDataPoint {
  metric: string;
  value: number;
  unit: string;
  periodStart: string;
  periodEnd: string;
  /** The evidence claim the point is taken from (looked up to its id when saved). */
  claim: string;
  /** Derived by the code from the register's figures, not a figure the report states. */
  estimated?: boolean;
}

function periodDays(period: RegistryEvidencePeriod): number {
  const days = (Date.parse(period.periodEnd) - Date.parse(period.periodStart)) / 86_400_000;
  return Number.isFinite(days) ? days : Number.NaN;
}

/**
 * Revenue and cash per filed year. Revenue is only an annual figure for a full-year period;
 * cash is a balance on the closing date and is kept for any period. A metric with no value
 * is skipped, never filled in. `claimOf` must give the same text the evidence row was saved with.
 */
export function registryDataPoints(
  periods: RegistryEvidencePeriod[],
  claimOf: (metric: string, value: number, unit: string, period: RegistryEvidencePeriod) => string,
): RegistryDataPoint[] {
  const points: RegistryDataPoint[] = [];
  for (const period of periods) {
    for (const fact of period.facts) {
      const metric = REGISTRY_METRIC_TO_POINT[fact.metric];
      if (!metric || !Number.isFinite(fact.value)) continue;
      if (metric === "annual_revenue") {
        const days = periodDays(period);
        if (!(days >= FULL_YEAR_DAYS.min && days <= FULL_YEAR_DAYS.max)) continue;
      }
      points.push({
        metric,
        value: fact.value,
        unit: fact.unit,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        claim: claimOf(fact.metric, fact.value, fact.unit, period),
      });
    }
  }
  return [...points, ...derivedOperatingExpenses(periods, claimOf)];
}

function factOf(period: RegistryEvidencePeriod, metric: string) {
  return period.facts.find((fact) => fact.metric === metric && Number.isFinite(fact.value));
}

/**
 * Monthly operating costs, so burn and runway can be calculated without AI. Operating
 * burn for a year is -(net result + depreciation), as in the metrics engine, and the costs are
 * revenue plus that burn, so `calculateFinance`'s net burn (costs - revenue) equals the burn.
 * Only a full year with revenue and net result in the same currency; a missing depreciation
 * counts as zero (the same assumption the metrics engine states). The point is anchored on the
 * net-result evidence and marked estimated.
 */
function derivedOperatingExpenses(
  periods: RegistryEvidencePeriod[],
  claimOf: (metric: string, value: number, unit: string, period: RegistryEvidencePeriod) => string,
): RegistryDataPoint[] {
  const points: RegistryDataPoint[] = [];
  for (const period of periods) {
    const days = periodDays(period);
    if (!(days >= FULL_YEAR_DAYS.min && days <= FULL_YEAR_DAYS.max)) continue;
    const revenue = factOf(period, "revenue");
    const netResult = factOf(period, "net_result");
    const depreciation = factOf(period, "depreciation");
    if (!revenue || !netResult || netResult.unit !== revenue.unit) continue;
    if (depreciation && depreciation.unit !== revenue.unit) continue;
    const yearlyCosts = revenue.value - netResult.value - Math.abs(depreciation?.value ?? 0);
    points.push({
      metric: "monthly_operating_expenses",
      value: Math.round((yearlyCosts / 12) * 100) / 100,
      unit: revenue.unit,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      claim: claimOf("net_result", netResult.value, netResult.unit, period),
      estimated: true,
    });
  }
  return points;
}
