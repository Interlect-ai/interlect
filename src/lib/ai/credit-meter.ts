/**
 * Kreditmåleren: what the meter on Fondsopsætning and Overblik shows, pure
 * and tested. The balance is the installation's (one customer, one ledger); the month's usage is
 * only this fund's rows, split into Analyse, Spørg and Brain (the paid scopes; `eval` is paid by
 * Interlect and never shown). The states follow the credit rules: below the pause line (15 % of
 * what has been credited) Brain's background work pauses, at 0 kr. no new analysis starts and a
 * run in progress still finishes. While the installation does not enforce credits
 * (`ai_settings.credits_enforced` is off) nothing is stopped, so the meter shows usage only.
 */

import type { Language } from "../i18n/language.ts";
import { translate } from "../i18n/translate.ts";

export type MeterState = "not_enforced" | "ok" | "low" | "empty";

export interface MeterUsage {
  analysis: number;
  chat: number;
  brain: number;
}

/** Installationens visningsvaluta; regnskabet står altid i kroner. */
export type DisplayCurrency = "DKK" | "EUR";

export interface CreditMeter {
  /** Valuta og kurs, beløbene vises i (`ai_settings.display_currency`, `dkk_per_display_unit`). */
  currency: DisplayCurrency;
  /** Kroner pr. visningsenhed: 1 for DKK, fx 7,46 for EUR. */
  dkkPerUnit: number;
  enforced: boolean;
  /**
   * The installation's balance in kroner (credits minus usage), or for a team with its own
   * allowance the allowance minus the team's usage; may dip a little below 0.
   */
  balanceDkk: number;
  /**
   * This month's pool, as the database counts it for Brain's pause (0071): what was left when the
   * month began (never below 0) plus what has been credited since.
   */
  creditedDkk: number;
  /** balance / pool, 0–100; null when the pool is 0. */
  remainingPct: number | null;
  state: MeterState;
  /** The pause line from `ai_settings.brain_pause_at_remaining_pct`. */
  pausePct: number;
  /** This fund's usage this month. */
  usage: MeterUsage;
  /** Admin only. */
  canTopUp: boolean;
  /** A https payment link from the environment (Admin only), or null. */
  topUpUrl: string | null;
  /** Where "Fyld op" sends a request when there is no payment link (`AI_SUPPORT_EMAIL`, Admin only). */
  supportEmail: string | null;
  /** The fund's name, for the request. */
  fundName: string;
}

export const METER_SCOPES = ["analysis", "chat", "brain"] as const;
export type MeterScope = (typeof METER_SCOPES)[number];

/**
 * The month's pool, the same sum as `ai_reserve` uses for Brain (0071): the balance the month
 * began with (never below 0) plus the credits added since. `usageMonthDkk` is all of this month's
 * paid usage (every fund, not eval), so the opening balance is balance - added + usage.
 */
export function monthPool(input: {
  balanceDkk: number;
  addedThisMonthDkk: number;
  usageThisMonthDkk: number;
}): number {
  const opening = input.balanceDkk - input.addedThisMonthDkk + input.usageThisMonthDkk;
  return Math.max(opening, 0) + input.addedThisMonthDkk;
}

/** A team's own allowance: the cap and the team's usage since it was set. */
export interface TeamAllowance {
  allowanceDkk: number;
  usedDkk: number;
}

/** The row of `fund_credit_allowance` (an empty list: the team has no allowance of its own). */
export function parseAllowance(rows: unknown): TeamAllowance | null {
  const row = Array.isArray(rows) ? (rows[0] as Record<string, unknown> | undefined) : undefined;
  if (!row) return null;
  const allowanceDkk = Number(row["allowance_dkk"]);
  const usedDkk = Number(row["used_dkk"]);
  if (!Number.isFinite(allowanceDkk) || allowanceDkk <= 0 || !Number.isFinite(usedDkk)) return null;
  return { allowanceDkk, usedDkk };
}

/**
 * The balance a team sees. A team with its own allowance (the demo team on staging) sees the
 * allowance minus its own usage since it was set, always enforced: that is what `ai_reserve`
 * stops it at (and Brain pauses at the pause line of it). When the installation enforces its own
 * credits too, the lower of the two is shown, since both stop it. Every other team sees the
 * installation's balance and pool.
 */
export function withAllowance(
  installation: { enforced: boolean; balanceDkk: number; creditedDkk: number },
  allowance: TeamAllowance | null,
): { enforced: boolean; balanceDkk: number; creditedDkk: number } {
  if (!allowance) return installation;
  const own = allowance.allowanceDkk - allowance.usedDkk;
  return {
    enforced: true,
    balanceDkk: installation.enforced ? Math.min(own, installation.balanceDkk) : own,
    creditedDkk: allowance.allowanceDkk,
  };
}

/** Below this the next analysis cannot be reserved (the smallest cap is 1 kr.): shown as empty. */
export const EMPTY_BELOW_DKK = 1;

export function remainingPct(balanceDkk: number, creditedDkk: number): number | null {
  if (!(creditedDkk > 0)) return null;
  return Math.max(0, Math.min(100, (balanceDkk / creditedDkk) * 100));
}

export function meterState(input: {
  enforced: boolean;
  balanceDkk: number;
  creditedDkk: number;
  pausePct: number;
}): MeterState {
  if (!input.enforced) return "not_enforced";
  if (input.balanceDkk < EMPTY_BELOW_DKK) return "empty";
  const pct = remainingPct(input.balanceDkk, input.creditedDkk);
  return pct !== null && pct <= input.pausePct ? "low" : "ok";
}

/** The payment link only ever opens as https; anything else (empty, http, javascript:) is no link. */
export function safeTopUpUrl(raw: string | undefined | null): string | null {
  const text = raw?.trim();
  if (!text) return null;
  try {
    const url = new URL(text);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Sums ledger usage rows into the three paid scopes; other scopes (eval) are left out. */
export function sumUsage(rows: readonly { scope: unknown; amount_dkk: unknown }[]): MeterUsage {
  const usage: MeterUsage = { analysis: 0, chat: 0, brain: 0 };
  for (const row of rows) {
    const amount = Number(row.amount_dkk);
    if (!Number.isFinite(amount)) continue;
    if (row.scope === "analysis" || row.scope === "chat" || row.scope === "brain") {
      usage[row.scope] += amount;
    }
  }
  return usage;
}

/** The support address only ever becomes a mailto: when it is one plain address (no names, lists or line breaks). */
export function safeEmail(raw: string | undefined | null): string | null {
  const text = raw?.trim();
  if (!text || text.length > 254) return null;
  return /^[^\s@<>(),;:"\\]+@[^\s@<>(),;:"\\]+\.[^\s@<>(),;:"\\]+$/.test(text) ? text : null;
}

/**
 * The request "Fyld op" sends when there is no payment link: a mail to the support address with a
 * fixed subject tag (`[Interlect · Fyld op]`, easy to filter into its own folder) and the fund and
 * balance in the body. The reader's own mail program sends it; the app has no mail service.
 */
export function topUpMailto(input: {
  email: string;
  fundName: string;
  /** Saldoen som kunden ser den, fx "1.234 kr." eller "€165". */
  balanceText: string;
  state: MeterState;
  /** The fund's language; Danish when left out. */
  language?: Language;
}): string {
  const say = (key: Parameters<typeof translate>[1], vars?: Record<string, string>) =>
    translate(input.language ?? "da", key, vars);
  const subject = say("appServer.credits.mailSubject", { fund: input.fundName });
  const body = [
    say("appServer.credits.mailGreeting"),
    "",
    say("appServer.credits.mailRequest"),
    "",
    say("appServer.credits.mailFund", { fund: input.fundName }),
    say("appServer.credits.mailBalance", { balance: input.balanceText }),
    say("appServer.credits.mailAmount"),
  ].join("\n");
  return `mailto:${input.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function safeCurrency(value: unknown): DisplayCurrency {
  return value === "EUR" ? "EUR" : "DKK";
}

/** Kursen skal være et tal mellem 0 og 100; ellers regnes der 1:1 (kroner). */
export function safeRate(value: unknown, currency: DisplayCurrency): number {
  const rate = Number(value);
  if (currency === "DKK") return 1;
  return Number.isFinite(rate) && rate > 0 && rate <= 100 ? rate : 1;
}

/**
 * Et beløb i kroner, som kunden ser det i sin valuta: "1.234 kr." eller "€165". `exact`
 * giver to decimaler (forbrug pr. område). Et engelsk team ser kroner som "DKK 1,234".
 * Regnskabet i databasen berøres ikke.
 */
export function formatCredit(
  valueDkk: number,
  display: { currency: DisplayCurrency; dkkPerUnit: number },
  exact = false,
  language: Language = "da",
): string {
  const value = valueDkk / display.dkkPerUnit;
  const digits = exact ? 2 : 0;
  const locale = display.currency === "EUR" || language === "en" ? "en-IE" : "da-DK";
  const number = new Intl.NumberFormat(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(exact ? value : Math.round(value));
  if (display.currency === "EUR") return `€${number}`;
  return language === "en" ? `DKK ${number}` : `${number} kr.`;
}

const CREDIT_STOP_KEYS = [
  "appServer.credits.exhausted",
  "appServer.credits.helperExhausted",
] as const;

/**
 * True when an error is the server's "the balance is used up" refusal, in either language:
 * the page then shows "Fyld op" next to it, as and ask for.
 */
export function isCreditStop(message: string | null | undefined): boolean {
  if (!message) return false;
  return (["da", "en"] as const).some((language) =>
    CREDIT_STOP_KEYS.some((key) => message.includes(translate(language, key))),
  );
}
