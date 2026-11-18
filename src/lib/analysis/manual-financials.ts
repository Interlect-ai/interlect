/**
 * The figures someone entered on a case's Økonomi ("Udfyld") join the
 * annual reports before the metrics are calculated, so growth, margin, burn and runway are
 * calculated in code exactly as for a report. Rules:
 *
 * - A report's own figure always wins: an entered figure is only used where the report for that
 *   year does not have it.
 * - A year without a report gets a calendar-year period of its own.
 * - Only figures in the reports' currency are used, so a growth rate never mixes currencies.
 * - Every entered figure carries `MANUAL_SOURCE` as its source, so it is never shown as coming
 *   from the annual report.
 */
import type { MetricsStatementInput } from "./financial-metrics.ts";

/** The raw figures a person can enter: the ones the metrics engine calculates from. */
export const MANUAL_FINANCIAL_METRICS = [
  "revenue",
  "gross_profit",
  "cash",
  "cash_flow_operating",
] as const;
export type ManualFinancialMetric = (typeof MANUAL_FINANCIAL_METRICS)[number];

/** The source of an entered figure (no link: it was typed in on the case). */
export const MANUAL_SOURCE = "interlect:entered";

export function isManualSource(source: string): boolean {
  return source === MANUAL_SOURCE;
}

export interface ManualFinancialInput {
  metric: ManualFinancialMetric;
  fiscalYear: number;
  value: number;
  currency: string;
}

export function withManualInputs(
  statements: readonly MetricsStatementInput[],
  inputs: readonly ManualFinancialInput[],
  currency = "DKK",
): MetricsStatementInput[] {
  const out = statements.map((statement) => ({
    ...statement,
    lineItems: [...statement.lineItems],
  }));
  const synthetic = new Map<number, MetricsStatementInput>();
  const newestReport = statements.reduce(
    (year, statement) => Math.max(year, Number(statement.periodEnd.slice(0, 4))),
    0,
  );
  for (const input of inputs) {
    if (input.currency !== currency || !Number.isFinite(input.value)) continue;
    // A figure for a year after the newest report (entered before that report came) is not used:
    // it would become the "latest" year and hide the report's own figures.
    if (newestReport > 0 && input.fiscalYear > newestReport) continue;
    const year = input.fiscalYear;
    // The newest report whose year ends in that calendar year.
    const report = out
      .filter((statement) => Number(statement.periodEnd.slice(0, 4)) === year)
      .sort((a, b) => (a.periodEnd < b.periodEnd ? 1 : -1))[0];
    const target =
      report ??
      synthetic.get(year) ??
      (() => {
        const created: MetricsStatementInput = {
          periodStart: `${year}-01-01`,
          periodEnd: `${year}-12-31`,
          sourceDocumentUrl: MANUAL_SOURCE,
          reportingClassText: null,
          lineItems: [],
        };
        synthetic.set(year, created);
        return created;
      })();
    if (target.lineItems.some((item) => item.metric === input.metric)) continue;
    target.lineItems.push({ metric: input.metric, value: input.value, source: MANUAL_SOURCE });
  }
  return [...out, ...synthetic.values()];
}

/**
 * The latest year a figure can be entered for. With annual reports: the newest report's year, so
 * an entered figure only fills a gap and never becomes the "latest" year ahead of a real filing
 * (that would hide the report's own figures and make the report look newer); a report's year is a
 * finished financial year, also when it ends mid-year. Without reports:
 * the last finished calendar year (a year still running has no full-year figures).
 */
export function maxInputYear(statements: readonly { periodEnd: string }[], now: number): number {
  const lastFinished = new Date(now).getUTCFullYear() - 1;
  const newest = statements.reduce(
    (year, statement) => Math.max(year, Number(statement.periodEnd.slice(0, 4))),
    0,
  );
  return newest > 0 ? newest : lastFinished;
}

export function inputYearAllowed(
  year: number,
  statements: readonly { periodEnd: string }[],
  now: number,
): boolean {
  return Number.isInteger(year) && year >= 1990 && year <= maxInputYear(statements, now);
}
