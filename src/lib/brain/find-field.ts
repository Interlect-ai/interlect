/**
 * "Find med Brain" on a missing figure: the pure parts. Brain looks for ONE figure (a
 * metric in a year) in the case's own material and then on the web, and only ever proposes what it
 * can quote. Nothing is guessed: the figure must stand in the quote, the quote must stand in the
 * source text the model was given, and the currency must be a real code. Anything else is "not
 * found". The server (`find-field.server.ts`) does the searching and the saving.
 */
import {
  MANUAL_FINANCIAL_METRICS,
  type ManualFinancialMetric,
} from "../analysis/manual-financials.ts";
import type { Language } from "../i18n/language.ts";

export type FieldCertainty = "likely" | "company_stated";
export type FieldSourceKind = "case_material" | "web";

/** What the model is given to read: one numbered text per source. */
export type FindSource = {
  kind: FieldSourceKind;
  text: string;
  title: string | null;
  url: string | null;
};

/** A verified proposal, ready to be stored. */
export type FieldProposal = {
  metric: ManualFinancialMetric;
  fiscalYear: number;
  value: number;
  currency: string;
  certainty: FieldCertainty;
  sourceKind: FieldSourceKind;
  sourceTitle: string | null;
  sourceUrl: string | null;
  quote: string;
};

export function isFindableMetric(value: string): value is ManualFinancialMetric {
  return (MANUAL_FINANCIAL_METRICS as readonly string[]).includes(value);
}

// i18n-keep: search terms for the Danish material, not text shown to anyone.
const METRIC_TERMS: Record<ManualFinancialMetric, Record<Language, string>> = {
  revenue: { da: "omsætning", en: "revenue" },
  gross_profit: { da: "bruttofortjeneste", en: "gross profit" },
  cash: { da: "likvide beholdninger", en: "cash and cash equivalents" },
  cash_flow_operating: { da: "pengestrøm fra driften", en: "operating cash flow" },
};

export function metricTerm(metric: ManualFinancialMetric, language: Language): string {
  return METRIC_TERMS[metric][language];
}

/** The search inside the case's material: just the figure and the year, in the team's language. */
export function caseMaterialQuery(
  metric: ManualFinancialMetric,
  fiscalYear: number,
  language: Language,
): string {
  return `${metricTerm(metric, language)} ${fiscalYear}`;
}

/**
 * The one web query: the company's name and the figure, nothing else (public search terms; the
 * query passes `sanitizeWebQueries` again before it leaves).
 */
export function webQueryFor(
  companyName: string,
  metric: ManualFinancialMetric,
  fiscalYear: number,
): string {
  return `${companyName.trim()} ${METRIC_TERMS[metric].en} ${fiscalYear}`.slice(0, 120);
}

export const FIND_FIELD_SYSTEM = `You find ONE figure about ONE company in the numbered sources you are given. Rules:
- Answer only from the sources. Never use what you already know, never estimate, never add up or calculate.
- The figure must be for exactly the metric and the fiscal year asked about, for the company itself (not a competitor, a market or a group unless the source says it is the company's own figure).
- "quote" is a short passage (at most 300 characters) copied word for word from the source you used, and it must contain the figure as written there.
- "value" is the figure in whole currency units (write 12.5 million as 12500000). A loss or an outflow is negative.
- "currency" is the three-letter code (DKK, EUR, USD ...).
- "sourceIndex" is the number of the source the quote is copied from.
- If the sources do not give the figure for that year, answer found=false and leave the rest empty. That is a good answer.`;

export const FIND_FIELD_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["found", "value", "currency", "quote", "sourceIndex"],
  properties: {
    found: { type: "boolean" },
    value: { type: ["number", "null"] },
    currency: { type: ["string", "null"] },
    quote: { type: ["string", "null"] },
    sourceIndex: { type: ["integer", "null"] },
  },
} as const;

export type FindFieldAnswer = {
  found: boolean;
  value: number | null;
  currency: string | null;
  quote: string | null;
  sourceIndex: number | null;
};

export function findFieldPrompt(input: {
  companyName: string;
  metric: ManualFinancialMetric;
  fiscalYear: number;
  sources: readonly FindSource[];
}): string {
  return JSON.stringify({
    company: input.companyName,
    metric: METRIC_TERMS[input.metric].en,
    fiscalYear: input.fiscalYear,
    sources: input.sources.map((source, index) => ({
      sourceIndex: index + 1,
      text: source.text.slice(0, 3000),
    })),
  });
}

const SCALES: ReadonlyArray<[RegExp, number]> = [
  [/^(?:mia|mrd|billion|bn)\b\.?/i, 1e9],
  [/^(?:mio|million(?:er)?|mill|m)\b\.?/i, 1e6],
  [/^(?:tusind|thousand|k)\b\.?/i, 1e3],
];

type ScannedNumber = { values: number[]; signedNegative: boolean };

/** Every number in a text as it could be read (thousand separators or decimals, scale words). */
function scanNumbers(text: string): ScannedNumber[] {
  const out: ScannedNumber[] = [];
  const token = /\d[\d.,\u00a0\u202f ]*\d|\d/g;
  for (const match of text.matchAll(token)) {
    const start = match.index ?? 0;
    const raw = match[0].replace(/[\u00a0\u202f ]/g, "");
    const rest = text.slice(start + match[0].length).replace(/^[)\s\u00a0]+/, "");
    const scale = SCALES.find(([pattern]) => pattern.test(rest))?.[1] ?? 1;
    const bases = new Set<number>();
    // Only a real thousands grouping (1.234.567) or a plain integer reads as an integer; "12,5"
    // is a decimal and never 125.
    if (/^\d+$/.test(raw) || /^\d{1,3}([.,]\d{3})+$/.test(raw)) {
      bases.add(Number(raw.replace(/[.,]/g, "")));
    }
    const lastSeparator = Math.max(raw.lastIndexOf("."), raw.lastIndexOf(","));
    if (lastSeparator > 0 && raw.length - lastSeparator - 1 <= 2) {
      bases.add(
        Number(
          `${raw.slice(0, lastSeparator).replace(/[.,]/g, "")}.${raw.slice(lastSeparator + 1)}`,
        ),
      );
    }
    const before = text.slice(Math.max(0, start - 2), start);
    const after = text[start + match[0].length] ?? "";
    // A minus counts only when it is not a date or range hyphen (a digit or letter before it).
    const minus = /(^|[^\p{L}\p{N}])[-\u2212\u2013]\s?$/u.test(before + "");
    const parens = before.endsWith("(") && after === ")";
    out.push({
      values: [...bases].filter(Number.isFinite).map((base) => base * scale),
      signedNegative: minus || parens,
    });
  }
  return out;
}

/** Every number in a text as it could be read (absolute values). */
export function numbersInText(text: string): number[] {
  return scanNumbers(text).flatMap((entry) => entry.values);
}

const NEGATIVE_WORDS = /negativ|negative|underskud|\bloss\b|\bburn\b|outflow|udgang|minus/i;
const THOUSANDS_MARKERS = /\btkr\b|\btdkk\b|\bteur\b|i tusinde|in thousands|\(000/i;

/**
 * True when the quote states the value with the right sign. A sign belongs to the matched number
 * (a hyphen in a date does not count), and a positive value is refused when the quote shows a loss.
 */
export function quoteSupportsValue(quote: string, value: number): boolean {
  if (!Number.isFinite(value)) return false;
  const target = Math.abs(value);
  const hit = scanNumbers(quote).find((entry) =>
    entry.values.some((v) => Math.abs(v - target) <= Math.max(1e-9, target * 1e-9)),
  );
  if (!hit) return false;
  const negative = hit.signedNegative || NEGATIVE_WORDS.test(quote);
  return negative === value < 0;
}

const CURRENCY_MARKS: Record<string, RegExp> = {
  DKK: /\bDKK\b|\bkr\b|\bkroner\b/i,
  EUR: /\bEUR\b|€|\beuro\b/i,
  USD: /\bUSD\b|\$|\bdollars?\b/i,
  GBP: /\bGBP\b|£|\bpounds?\b/i,
  SEK: /\bSEK\b|\bkr\b/i,
  NOK: /\bNOK\b|\bkr\b/i,
};

/** The quote itself must name the currency (a code or its usual mark). */
export function quoteNamesCurrency(quote: string, currency: string): boolean {
  const mark = CURRENCY_MARKS[currency];
  return mark ? mark.test(quote) : new RegExp(`\\b${currency}\\b`).test(quote);
}

const squash = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Turns the model's answer into a proposal only when every claim holds up in code. Returns null
 * (= "Ikke fundet") otherwise; the reason is returned for the log, never shown as a figure.
 */
export function verifyFindAnswer(
  answer: FindFieldAnswer | null | undefined,
  input: {
    metric: ManualFinancialMetric;
    fiscalYear: number;
    sources: readonly FindSource[];
  },
): { proposal: FieldProposal } | { proposal: null; reason: string } {
  if (!answer || !answer.found) return { proposal: null, reason: "not_found" };
  const { value, currency, quote, sourceIndex } = answer;
  if (value === null || !Number.isFinite(value)) return { proposal: null, reason: "no_value" };
  if (Math.abs(value) >= 1e15) return { proposal: null, reason: "out_of_range" };
  if (!currency || !/^[A-Z]{3}$/.test(currency)) return { proposal: null, reason: "no_currency" };
  if (!quote || quote.trim().length === 0) return { proposal: null, reason: "no_quote" };
  const source =
    sourceIndex !== null && Number.isInteger(sourceIndex) ? input.sources[sourceIndex - 1] : null;
  if (!source) return { proposal: null, reason: "bad_source" };
  const cleanQuote = quote.trim().slice(0, 600);
  const seen = source.text.slice(0, 3000);
  if (!squash(seen).includes(squash(cleanQuote))) {
    return { proposal: null, reason: "quote_not_in_source" };
  }
  if (!quoteSupportsValue(cleanQuote, value)) {
    return { proposal: null, reason: "value_not_in_quote" };
  }
  // The quote itself must name the year, the currency and not be in thousands: otherwise a figure
  // for another year, another currency or another scale could be proposed.
  if (!cleanQuote.includes(String(input.fiscalYear))) {
    return { proposal: null, reason: "year_not_in_quote" };
  }
  if (!quoteNamesCurrency(cleanQuote, currency)) {
    return { proposal: null, reason: "currency_not_in_quote" };
  }
  if (THOUSANDS_MARKERS.test(seen)) return { proposal: null, reason: "thousands_scale" };
  return {
    proposal: {
      metric: input.metric,
      fiscalYear: input.fiscalYear,
      value,
      currency,
      // Brain never says "verified" (only a register does). The company's own material is what the
      // company states; a web page with a link is probable.
      certainty: source.kind === "web" ? "likely" : "company_stated",
      sourceKind: source.kind,
      sourceTitle: source.title,
      sourceUrl: source.url && /^https?:\/\//i.test(source.url) ? source.url : null,
      quote: cleanQuote,
    },
  };
}
