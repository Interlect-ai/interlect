/**
 * "Udfyld" on Økonomi: which raw figures a person types in for each key
 * figure that could not be found, and how a typed amount is read. The figures are the ones the
 * metrics engine calculates from (`manual-financials.ts`), so margin, burn and runway are still
 * calculated in code, never typed in as a result. Pure, so tested.
 */
import type { ManualFinancialMetric } from "../analysis/manual-financials.ts";

export type EconomyKpiKey = "revenue" | "gross_margin" | "operating_burn" | "runway_today";

/** The four key figures the Økonomi tab always shows, in the prototype's order. */
export const ECONOMY_KPI_KEYS: readonly EconomyKpiKey[] = [
  "revenue",
  "gross_margin",
  "operating_burn",
  "runway_today",
];

/**
 * The figures to type in for a key figure: revenue is the revenue; the gross margin is gross
 * profit over revenue; burn comes from the year's operating cash flow; runway is the cash at the
 * year end over that burn.
 */
export const KPI_INPUTS: Readonly<Record<EconomyKpiKey, readonly ManualFinancialMetric[]>> = {
  revenue: ["revenue"],
  gross_margin: ["gross_profit", "revenue"],
  operating_burn: ["cash_flow_operating"],
  runway_today: ["cash", "cash_flow_operating"],
};

/** Words a typed amount may carry: a unit (mio., k …) and a currency; anything else is refused. */
const UNIT_WORDS: Readonly<Record<string, number>> = {
  mia: 1e9,
  bn: 1e9,
  billion: 1e9,
  b: 1e9,
  mio: 1e6,
  million: 1e6,
  m: 1e6,
  tusind: 1e3,
  thousand: 1e3,
  t: 1e3,
  k: 1e3,
};
const CURRENCY_WORDS = new Set(["kr", "dkk", "eur", "usd", "sek", "nok", "gbp", "chf", "pln"]);

/**
 * A typed amount in whole currency units: "1.250.000", "1,250,000", "-850.000", "kr -850.000",
 * "(850.000)", "1,5 mio.", "1.5m", "2k", "12.5". With both "." and "," the last one is the decimal
 * mark; with one kind used once, three digits after it mean thousands ("1.250"), otherwise a
 * decimal ("1,5"). Null when it cannot be read for certain (a guess is never saved): letters that
 * are no unit or currency ("1e5"), two units, or digits split by spaces in an odd way.
 */
export function parseAmount(text: string): number | null {
  const raw = text.trim().toLowerCase();
  if (!raw) return null;
  const negative = /[-−–]/.test(raw) || /^\(.*\)$/.test(raw);
  let multiplier = 1;
  let units = 0;
  for (const word of raw.match(/[a-zæøå]+/g) ?? []) {
    if (UNIT_WORDS[word] !== undefined) {
      multiplier = UNIT_WORDS[word]!;
      units += 1;
    } else if (!CURRENCY_WORDS.has(word)) {
      return null;
    }
  }
  if (units > 1) return null;
  // The number itself: the digits, separators and spaces between digits.
  const numberPart = raw
    .replace(/[a-zæøå]+\.?/g, " ")
    .replace(/[^\d.,\s]/g, " ")
    .trim()
    .replace(/(\d)\s+(?=\d{3}\b)/g, "$1");
  if (!/^\d[\d.,]*$/.test(numberPart)) return null;
  const lastComma = numberPart.lastIndexOf(",");
  const lastDot = numberPart.lastIndexOf(".");
  let normalized: string;
  if (lastComma >= 0 && lastDot >= 0) {
    const decimalAt = Math.max(lastComma, lastDot);
    normalized = `${numberPart.slice(0, decimalAt).replace(/[.,]/g, "")}.${numberPart.slice(decimalAt + 1)}`;
  } else {
    const separator = lastComma >= 0 ? "," : lastDot >= 0 ? "." : null;
    const count = separator ? numberPart.split(separator).length - 1 : 0;
    const after = separator ? numberPart.length - numberPart.lastIndexOf(separator) - 1 : 0;
    normalized =
      !separator || count > 1 || after === 3
        ? numberPart.replace(/[.,]/g, "")
        : numberPart.replace(separator, ".");
  }
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  const value = Number(normalized) * multiplier;
  if (!Number.isFinite(value) || Math.abs(value) >= 1e15) return null;
  return negative && value !== 0 ? -value : value;
}

/** The year a new figure is entered for: the latest report's year, else last calendar year. */
export function defaultInputYear(years: readonly string[], now: number): number {
  const last = years[years.length - 1];
  if (last) return Number(last.slice(0, 4));
  return new Date(now).getUTCFullYear() - 1;
}

/**
 * "Find med Brain": the raw figures (of `metrics`, e.g. a key figure's `KPI_INPUTS`) the
 * case still lacks for a year, i.e. neither an annual report ending in that year nor a figure
 * entered on the case has them. Brain only looks for these, so a search is never spent on a
 * figure the case already has.
 */
export function missingFigures(
  metrics: readonly ManualFinancialMetric[],
  year: number,
  statements: readonly { periodEnd: string; lineItems: readonly { metric: string }[] }[],
  inputs: readonly { metric: ManualFinancialMetric; fiscalYear: number }[],
): ManualFinancialMetric[] {
  const has = (metric: ManualFinancialMetric) =>
    statements.some(
      (statement) =>
        Number(statement.periodEnd.slice(0, 4)) === year &&
        statement.lineItems.some((item) => item.metric === metric),
    ) || inputs.some((input) => input.fiscalYear === year && input.metric === metric);
  return metrics.filter((metric) => !has(metric));
}
