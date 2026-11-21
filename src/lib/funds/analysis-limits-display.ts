/**
 * What the section Analysegrænser shows (spec B6): pure helpers over the server's
 * `AnalysisLimitsView`, so the states (standard, tight limit, month reached) are tested without a
 * browser. Amounts are kroner; they are only shown to Admin and Lead (beslutningslog 2. nov).
 */
import type { Language } from "../i18n/language.ts";
import type { AnalysisLimitKind, AnalysisLimitsView, RunCostStats } from "./analysis-limits.ts";

/** "10 kr." in Danish, "DKK 10" in English; `exact` keeps two decimals (averages, the month). */
export function formatDkk(value: number, language: Language, exact = false): string {
  const digits = exact && !Number.isInteger(value) ? 2 : 0;
  const number = new Intl.NumberFormat(language === "en" ? "en-IE" : "da-DK", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(exact ? value : Math.round(value));
  // A no-break space, so "DKK" or "kr." never ends a line on its own.
  return language === "en" ? `DKK\u00a0${number}` : `${number}\u00a0kr.`;
}

/** "1,64–2,11 kr." / "DKK 1.64–2.11": the cheapest and dearest run, one currency mark. */
export function formatDkkRange(low: number, high: number, language: Language): string {
  const number = (value: number) =>
    new Intl.NumberFormat(language === "en" ? "en-IE" : "da-DK", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  return language === "en"
    ? `DKK\u00a0${number(low)}–${number(high)}`
    : `${number(low)}–${number(high)}\u00a0kr.`;
}

/**
 * The limit is tighter than what the team's runs usually cost: new runs will be made smaller (or
 * ask first). Only judged on real runs from the last 30 days, never on a guess.
 */
export function limitIsTight(kind: AnalysisLimitKind & { costs: RunCostStats | null }): boolean {
  return kind.costs !== null && kind.costs.averageDkk > kind.capDkk;
}

export interface MonthState {
  /** Null = no monthly limit. */
  capDkk: number | null;
  usedDkk: number;
  /** 0–100 of the monthly limit; null without one. */
  pct: number | null;
  /** No new analysis starts until next month or a higher limit. */
  reached: boolean;
}

/** The smallest run a month can still start (CAP_LIMITS_DKK.screening.min on the server is 1 kr.). */
const SMALLEST_RUN_DKK = 1;

export function monthState(
  view: Pick<AnalysisLimitsView, "monthlyCapDkk" | "monthUsedDkk">,
): MonthState {
  const cap = view.monthlyCapDkk;
  const used = Math.max(0, view.monthUsedDkk);
  if (cap === null) return { capDkk: null, usedDkk: used, pct: null, reached: false };
  return {
    capDkk: cap,
    usedDkk: used,
    pct: cap <= 0 ? 100 : Math.min(100, (used / cap) * 100),
    // The server refuses a new run when less than the smallest run is left (run-plan.server.ts).
    reached: cap - used < SMALLEST_RUN_DKK,
  };
}

/**
 * When the monthly limit starts over: the first of next month at 00:00 UTC, the month the database
 * counts in (0125, 0131), so the page and the server agree also just after midnight on the first
 * (C4-6). The page shows the date in the reader's own time.
 */
export function nextMonthStart(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

export type CapInput =
  { ok: true; value: number | null } | { ok: false; reason: "number" | "range" };

/**
 * A typed limit: empty = the level's standard (null); otherwise a whole or decimal number of
 * kroner inside [min, max]. Accepts "12,5" as well as "12.5".
 */
export function parseCapInput(raw: string, min: number, max: number): CapInput {
  const text = raw.trim().replace(/\s/g, "").replace(",", ".");
  if (text === "") return { ok: true, value: null };
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return { ok: false, reason: "number" };
  const value = Number(text);
  if (value < min || value > max) return { ok: false, reason: "range" };
  return { ok: true, value };
}
