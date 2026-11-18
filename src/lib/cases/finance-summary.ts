/**
 * Finanser on the screening (Case Screening v5, "Screening = grundtal"): four key
 * figures and one chart of revenue and gross profit per year, from the figures the code
 * calculated from the annual reports (financial-metrics.ts). Nothing is guessed: a figure that
 * cannot be calculated says "Ikke oplyst" (never "0 mdr."), and a company without reports
 * gets no card.
 */
import type { FinancialMetric, FinancialMetricsReport } from "../analysis/financial-metrics.ts";
import { formatMetricValue, formatRunway } from "../analysis/financial-format.ts";
import type { Language } from "../i18n/language.ts";
import { translate } from "../i18n/translate.ts";

export interface FinanceSummary {
  /** The card's number: the latest revenue, else the latest gross profit. */
  headline: { label: string; value: string };
  /** The four figures of the focus page; one that cannot be calculated reads "Ikke oplyst". */
  kpis: { label: string; value: string }[];
  /** The last four years, oldest first (null = not in the report). */
  years: { year: string; revenue: number | null; grossProfit: number | null }[];
  /** Which series the chart shows (a small company often reports gross profit only). */
  hasRevenue: boolean;
  /** The amounts' currency when it is not DKK (a foreign registry). */
  currency?: string;
}

function metric(report: FinancialMetricsReport, key: string): FinancialMetric | null {
  return report.metrics.find((entry) => entry.key === key) ?? null;
}

function latestValue(entry: FinancialMetric | null): number | null {
  const value = entry?.latest?.value;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function yearOf(periodEnd: string | undefined): string {
  return periodEnd?.slice(0, 4) ?? "";
}

export function financeSummary(
  report: FinancialMetricsReport | null | undefined,
  language: Language = "da",
): FinanceSummary | null {
  if (!report || report.years.length === 0) return null;
  const revenue = metric(report, "revenue");
  const grossProfit = metric(report, "gross_profit");
  const revenueNow = latestValue(revenue);
  const grossNow = latestValue(grossProfit);
  const lead = revenueNow !== null ? revenue : grossNow !== null ? grossProfit : null;
  if (!lead || !lead.latest || lead.latest.value === null) return null;

  const kpis: { label: string; value: string }[] = [];
  const add = (
    label: string,
    entry: FinancialMetric | null,
    format?: (value: number) => string,
  ) => {
    const value = latestValue(entry);
    kpis.push({
      label,
      value:
        entry && value !== null
          ? format
            ? format(value)
            : formatMetricValue(entry, value, language)
          : translate(language, "finance.summary.notReported"),
    });
  };
  const leadYear = yearOf(lead.latest.periodEnd);
  add(
    translate(
      language,
      lead === revenue ? "finance.summary.revenueYear" : "finance.summary.grossProfitYear",
      {
        year: leadYear,
      },
    ),
    lead,
  );
  add(
    translate(language, "finance.summary.growth"),
    lead === revenue ? metric(report, "revenue_growth") : metric(report, "gross_profit_growth"),
  );
  add(translate(language, "finance.summary.grossMargin"), metric(report, "gross_margin"));
  // 0 months is an estimate that the last reported cash has run out since the report, not a
  // figure the company reported: it reads "Ikke oplyst" like a missing one.
  add(translate(language, "finance.summary.runway"), metric(report, "runway_today"), (months) =>
    months > 0
      ? translate(language, "finance.summary.approx", { value: formatRunway(months, language) })
      : translate(language, "finance.summary.notReported"),
  );

  const pointFor = (entry: FinancialMetric | null, periodEnd: string) => {
    const point = entry?.series.find((item) => item.periodEnd === periodEnd);
    return typeof point?.value === "number" && Number.isFinite(point.value) ? point.value : null;
  };
  const years = report.years.slice(-4).map((periodEnd) => ({
    year: yearOf(periodEnd),
    revenue: pointFor(revenue, periodEnd),
    grossProfit: pointFor(grossProfit, periodEnd),
  }));

  return {
    headline: {
      label: kpis[0]!.label,
      value: formatMetricValue(lead, lead.latest.value, language),
    },
    kpis,
    years,
    hasRevenue: years.some((year) => year.revenue !== null),
    ...(report.currency ? { currency: report.currency } : {}),
  };
}
