import type { Language } from "../i18n/language.ts";
import { translate, type MessageKey, type TranslateVars } from "../i18n/translate.ts";

/**
 * The finance specialist's numbers are checked in code before they are saved and
 * calculated on. A number is kept only when it can be found in the evidence it cites (read with
 * its unit and scale) and, where the register has the same fact for the same period, when it
 * agrees with the register. Pure and tested; no model call.
 *
 * What this does not prove: that the evidence is right (that is the evidence status), or that
 * a small count such as "3 customers" is the right "3" (it only has to appear in the text).
 */

export interface CheckedFinancialInput {
  metric: string;
  value: number;
  unit: string;
  periodStart: string | null;
  periodEnd: string | null;
  evidenceId: string;
}

/** The text the model could read for one piece of evidence. */
export interface EvidenceText {
  claim?: string | null | undefined;
  excerpt?: string | null | undefined;
}

/** One audited annual report from the register; amounts in the report's own currency. */
export interface RegistryAnchor {
  periodStart: string;
  periodEnd: string;
  currency: string;
  revenue: number | null;
  cash: number | null;
}

export type DropReason =
  "evidence_missing" | "not_in_evidence" | "registry_mismatch" | "registry_unit";

export interface DroppedFinancialInput<T extends CheckedFinancialInput = CheckedFinancialInput> {
  input: T;
  reason: DropReason;
  /** The register figure the input disagreed with (registry_mismatch only). */
  registryValue?: number;
  registryCurrency?: string;
}

export interface FinancialInputCheck<T extends CheckedFinancialInput = CheckedFinancialInput> {
  kept: T[];
  dropped: DroppedFinancialInput<T>[];
}

/** A figure may differ this much from the register before it counts as a contradiction. */
export const REGISTRY_TOLERANCE = 0.05;
const MIN_RELATIVE_TOLERANCE = 0.005;
const MAX_ROUNDING_TOLERANCE = 0.1;
const DAY_MS = 24 * 60 * 60 * 1000;

const RATE_METRICS = new Set(["monthly_churn_rate", "monthly_growth_rate"]);
const COUNT_METRICS = new Set(["new_customers", "customers"]);

const SCALE_WORDS: Array<[RegExp, number]> = [
  [/^(mia\.?|milliard(er)?|bn|billions?)$/i, 1e9],
  [/^(mio\.?|mill\.?|mln|millions?|millioner|mn|m)$/i, 1e6],
  [/^(tusind|thousands?|tkr\.?|t\.kr\.?|k|t\.?)$/i, 1e3],
];

const COMPACT_SCALE: Record<string, number> = { T: 1e3, K: 1e3, M: 1e6 };
const ISO = "DKK|EUR|USD|SEK|NOK|GBP|CHF|ISK|PLN|JPY|CAD|AUD";
const COMPACT_PREFIX = new RegExp(`^([TKM])(${ISO})$`, "i");
const COMPACT_SUFFIX = new RegExp(`^(${ISO})([TKM])$`, "i");

/** Compact Nordic forms: TDKK, MDKK, mEUR, DKKm. Returns the scale and the bare currency. */
function compactMoney(word: string): { scale: number; currency: string } | null {
  const prefix = word.match(COMPACT_PREFIX);
  if (prefix)
    return { scale: COMPACT_SCALE[prefix[1]!.toUpperCase()]!, currency: prefix[2]!.toUpperCase() };
  const suffix = word.match(COMPACT_SUFFIX);
  if (suffix)
    return { scale: COMPACT_SCALE[suffix[2]!.toUpperCase()]!, currency: suffix[1]!.toUpperCase() };
  return null;
}

function scaleOfWord(word: string): number | null {
  for (const [pattern, scale] of SCALE_WORDS) if (pattern.test(word)) return scale;
  return compactMoney(word)?.scale ?? null;
}

/**
 * The multiplier a unit string states ("mio. EUR" → 1e6, "DKK" → 1, "t.kr." → 1e3); null when
 * the scale is not stated clearly (two scales, or a number we do not know), because an unknown
 * scale must never be read as "no scale".
 */
export function unitScale(unit: string): number | null {
  const tokens = unit.split(/[^A-Za-zÆØÅæøå0-9']+/).filter(Boolean);
  const scales = new Set<number>();
  for (const token of tokens) {
    if (/^'?000$/.test(token)) {
      scales.add(1e3);
      continue;
    }
    const scale = scaleOfWord(token);
    if (scale !== null) scales.add(scale);
    else if (/\d/.test(token)) return null;
  }
  if (scales.size > 1) return null;
  return [...scales][0] ?? 1;
}

const ISO_CURRENCIES = /\b(DKK|EUR|USD|SEK|NOK|GBP|CHF|ISK|PLN|JPY|CAD|AUD)\b/;

/** The ISO currency a unit names ("kr" counts as DKK); null when none is stated. */
export function unitCurrency(unit: string): string | null {
  const tokens = unit.split(/[^A-Za-zÆØÅæøå0-9']+/).filter(Boolean);
  for (const token of tokens) {
    const compact = compactMoney(token);
    if (compact) return compact.currency;
  }
  const upper = unit.toUpperCase();
  return upper.match(ISO_CURRENCIES)?.[1] ?? (/\b(T?KR)\b/.test(upper) ? "DKK" : null);
}

interface ParsedNumber {
  /** Every reading of the written number (a lone "1,200" is both 1.2 and 1200). */
  readings: Array<{ value: number; quantum: number }>;
  scale: number | null;
}

const NUMBER_PATTERN =
  /(\d{1,3}(?:[ \u00a0\u202f'\u2019]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?)(?:\s*([A-Za-zæøåÆØÅ]+\.?(?:kr\.?)?))?/g;

function readingsOf(raw: string): Array<{ value: number; quantum: number }> {
  const compact = raw.replace(/[ \u00a0\u202f'\u2019]/g, "");
  const dots = (compact.match(/\./g) ?? []).length;
  const commas = (compact.match(/,/g) ?? []).length;
  const make = (digits: string, decimals: number) => ({
    value: Number(digits),
    quantum: 10 ** -decimals,
  });
  if (dots && commas) {
    const decimalMark = compact.lastIndexOf(".") > compact.lastIndexOf(",") ? "." : ",";
    const thousandsMark = decimalMark === "." ? "," : ".";
    const cleaned = compact.split(thousandsMark).join("");
    const decimals = cleaned.length - cleaned.indexOf(decimalMark) - 1;
    return [make(cleaned.replace(decimalMark, "."), decimals)];
  }
  const mark = dots ? "." : commas ? "," : null;
  if (!mark) return [make(compact, 0)];
  const count = mark === "." ? dots : commas;
  const afterLast = compact.length - compact.lastIndexOf(mark) - 1;
  const grouped = compact.split(mark).join("");
  if (count > 1) return [make(grouped, 0)];
  const decimal = make(compact.replace(mark, "."), afterLast);
  // "1,200" or "1.200": three digits after a lone mark read as a thousands group or a decimal.
  return afterLast === 3 ? [make(grouped, 0), decimal] : [decimal];
}

function parseNumbers(text: string): ParsedNumber[] {
  const parsed: ParsedNumber[] = [];
  for (const match of text.matchAll(NUMBER_PATTERN)) {
    const word = match[2]?.trim();
    parsed.push({
      readings: readingsOf(match[1]!),
      scale: word ? scaleOfWord(word) : null,
    });
  }
  return parsed;
}

/** Scales a table header or note states ("beløb i t.kr.", "(000 DKK)", "in millions"); applied to bare numbers. */
function headerScales(text: string): number[] {
  const scales: number[] = [];
  const lead = String.raw`(?:bel.b|amounts?)?\s*(?:\b(?:i|in)\b|\()\s*`;
  if (new RegExp(`${lead}(?:mio\\.?|millions?|millioner)\\b`, "i").test(text)) scales.push(1e6);
  if (
    new RegExp(`${lead}(?:t\\.?\\s?kr\\.?|tkr|thousands?|tusinde?|'?000)(?![\\d.,])`, "i").test(
      text,
    )
  ) {
    scales.push(1e3);
  }
  return scales;
}

/** The amounts this input could be written as in a text: as stated, and with its unit's scale. */
function targetsOf(input: CheckedFinancialInput): number[] {
  const value = Math.abs(input.value);
  if (RATE_METRICS.has(input.metric)) {
    // 0.05 may be written "5 %"; 5 may be written "5 %" or "0,05".
    return [value, value * 100, value / 100];
  }
  if (COUNT_METRICS.has(input.metric)) return [value];
  const scale = unitScale(input.unit);
  // An unknown scale keeps every reading open; the check is then as lenient as it can be.
  return scale === null ? [value, value * 1e3, value * 1e6, value * 1e9] : [value * scale];
}

/** Whether `text` states `target` (any reading, any stated scale, within its own rounding). */
export function textStatesAmount(text: string, targets: number[]): boolean {
  const extra = headerScales(text);
  for (const number of parseNumbers(text)) {
    const scales = number.scale !== null ? [number.scale] : [1, ...extra];
    for (const reading of number.readings) {
      for (const scale of scales) {
        const found = reading.value * scale;
        const rounding = (reading.quantum * scale) / 2;
        for (const target of targets) {
          // Rounding never excuses more than 10 %: "2 mio." is not 1,5 mio.
          const tolerance = Math.max(
            Math.min(rounding, target * MAX_ROUNDING_TOLERANCE),
            target * MIN_RELATIVE_TOLERANCE,
          );
          if (Math.abs(found - target) <= tolerance) return true;
        }
      }
    }
  }
  return false;
}

function daysBetween(a: string, b: string): number {
  return Math.abs(Date.parse(a) - Date.parse(b)) / DAY_MS;
}

/**
 * A revenue or cash figure for a period the register covers, whose unit does not state a clear
 * currency and scale, cannot be compared; it is dropped rather than silently left unchecked.
 */
function registryUnitUnreadable(
  input: CheckedFinancialInput,
  anchors: readonly RegistryAnchor[],
): boolean {
  if (input.metric !== "annual_revenue" && input.metric !== "cash") return false;
  if (!input.periodEnd || Number.isNaN(Date.parse(input.periodEnd))) return false;
  if (!anchors.some((anchor) => daysBetween(anchor.periodEnd, input.periodEnd!) <= 31)) {
    return false;
  }
  return unitCurrency(input.unit) === null || unitScale(input.unit) === null;
}

/** The register figure this input is comparable with, or null when none is (then it is not compared). */
function registryFigure(
  input: CheckedFinancialInput,
  anchors: RegistryAnchor[],
): { value: number; currency: string } | null {
  if (input.metric !== "annual_revenue" && input.metric !== "cash") return null;
  if (!input.periodEnd || Number.isNaN(Date.parse(input.periodEnd))) return null;
  if (input.metric === "annual_revenue") {
    // Only a full year is comparable with an annual report.
    if (!input.periodStart || Number.isNaN(Date.parse(input.periodStart))) return null;
    if (daysBetween(input.periodStart, input.periodEnd) < 330) return null;
  }
  const currency = unitCurrency(input.unit);
  const scale = unitScale(input.unit);
  if (!currency || scale === null) return null;
  const anchor = anchors.find(
    (candidate) =>
      candidate.currency === currency && daysBetween(candidate.periodEnd, input.periodEnd!) <= 31,
  );
  if (!anchor) return null;
  const value = input.metric === "cash" ? anchor.cash : anchor.revenue;
  return value === null || value === 0 ? null : { value, currency };
}

/**
 * Splits the finance specialist's inputs into the ones to keep and the ones to drop.
 * `evidence` maps an evidence id to the text the model could read; `anchors` are the audited
 * register reports of the same company (empty when the company is not confirmed).
 */
export function checkFinancialInputs<T extends CheckedFinancialInput>(
  inputs: readonly T[],
  evidence: ReadonlyMap<string, EvidenceText>,
  anchors: readonly RegistryAnchor[],
): FinancialInputCheck<T> {
  const kept: T[] = [];
  const dropped: DroppedFinancialInput<T>[] = [];
  for (const input of inputs) {
    const row = evidence.get(input.evidenceId);
    if (!row) {
      dropped.push({ input, reason: "evidence_missing" });
      continue;
    }
    // A zero cannot be told from a missing figure by looking for it in the text.
    if (input.value !== 0) {
      const text = `${row.claim ?? ""}\n${row.excerpt ?? ""}`;
      if (!textStatesAmount(text, targetsOf(input))) {
        dropped.push({ input, reason: "not_in_evidence" });
        continue;
      }
    }
    if (registryUnitUnreadable(input, anchors)) {
      dropped.push({ input, reason: "registry_unit" });
      continue;
    }
    const figure = registryFigure(input, [...anchors]);
    const scale = unitScale(input.unit);
    if (figure && scale !== null) {
      const stated = Math.abs(input.value) * scale;
      if (Math.abs(stated - Math.abs(figure.value)) / Math.abs(figure.value) > REGISTRY_TOLERANCE) {
        dropped.push({
          input,
          reason: "registry_mismatch",
          registryValue: figure.value,
          registryCurrency: figure.currency,
        });
        continue;
      }
    }
    kept.push(input);
  }
  return { kept, dropped };
}

function text(language: Language, key: string, vars?: TranslateVars) {
  return translate(language, `analysisServer.financeCheck.${key}` as MessageKey, vars);
}

/** One warning per dropped input, in the fund's language; stored with the run's quality audit. */
export function financialInputCheckWarnings(
  dropped: readonly DroppedFinancialInput[],
  language: Language = "da",
): string[] {
  return dropped.map(({ input, reason, registryValue, registryCurrency }) => {
    const period = input.periodEnd ?? input.periodStart ?? "-";
    const vars = {
      metric: input.metric,
      value: String(input.value),
      unit: input.unit,
      period,
      registry:
        registryValue === undefined ? "" : `${Math.round(registryValue)} ${registryCurrency ?? ""}`,
    };
    return text(language, reason, vars);
  });
}
