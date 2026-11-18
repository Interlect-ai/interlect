/**
 * "Find med Brain" under a Brain answer: which of a case's raw figures a question asks
 * for, and for which year. Only the four figures Brain can look for on a case
 * (`MANUAL_FINANCIAL_METRICS`); a question about anything else gets no button. Pure, so
 * tested.
 */
import type { ManualFinancialMetric } from "../analysis/manual-financials.ts";

// i18n-keep: patterns that read Danish and English questions, not text shown to anyone. Cash
// flow comes before cash, so "operating cash flow" is never read as the cash at the year end.
const ASKS: ReadonlyArray<readonly [ManualFinancialMetric, RegExp]> = [
  [
    "cash_flow_operating",
    /pengestr[øo]m\w*\s+fra\s+(?:den\s+)?drift|driftens\s+pengestr[øo]m|operating\s+cash[\s-]?flows?|cash[\s-]?flows?\s+from\s+operati/i,
  ],
  ["gross_profit", /brutto(?:fortjeneste|resultat|avance)|gross\s+profit/i],
  ["revenue", /oms[æa]e?tning|\brevenues?\b|\bturnover\b/i],
  ["cash", /\blikvid|kassebeholdning|\bcash\b(?![\s-]?(?:flow|burn))/i],
];

const YEAR = /\b(199\d|20\d\d)\b/;

export interface FieldQuestion {
  /** The figures asked for, in a fixed order (cash flow, gross profit, revenue, cash). */
  metrics: ManualFinancialMetric[];
  /** The first year in the question; null = the page's default year. */
  fiscalYear: number | null;
}

export function fieldsAskedFor(question: string): FieldQuestion | null {
  const metrics = ASKS.filter(([, pattern]) => pattern.test(question)).map(([metric]) => metric);
  if (metrics.length === 0) return null;
  const year = YEAR.exec(question)?.[1];
  return { metrics, fiscalYear: year ? Number(year) : null };
}
