/**
 * Pure budget maths for Brain. The authoritative, concurrency-safe check is
 * public.brain_reserve_budget (migration 0040): it locks the fund's budget row, so
 * reservations are applied one at a time. This module mirrors that rule for tests,
 * pre-checks and the health page. Amounts are USD; comparisons use integer micro-dollars
 * so float rounding can never let a reservation slip over the limit.
 */
import type { BudgetScope } from "./jobs.ts";

/** Standard monthly limits (P9): learning ~500 kr, watch ~150 kr, chat and ingest 30 USD. */
export const DEFAULT_MONTHLY_LIMITS_USD: Record<BudgetScope, number> = {
  learning: 72,
  watch: 22,
  chat: 30,
  ingest: 30,
};

/** Same cap as brain_reserve_budget: one reservation covers one model call. */
export const MAX_SINGLE_RESERVATION_USD = 25;
/** Warn at 80 % of the limit. */
export const BUDGET_WARNING_SHARE = 0.8;

export type UsageStatus = "reserved" | "final" | "released";
export type UsageRow = { costUsd: number; status: UsageStatus; createdAt: Date };

export function toMicroUsd(usd: number): number {
  return Math.round(usd * 1_000_000);
}

export function fromMicroUsd(micro: number): number {
  return micro / 1_000_000;
}

/** First instant of the current calendar month in UTC (same as date_trunc('month', now(), 'UTC')). */
export function monthStartUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** Spend that counts against this month's limit: open reservations plus final costs. */
export function monthSpendUsd(rows: readonly UsageRow[], now: Date): number {
  const start = monthStartUtc(now).getTime();
  let micro = 0;
  for (const row of rows) {
    if (row.status === "released") continue;
    if (row.createdAt.getTime() < start) continue;
    micro += toMicroUsd(row.costUsd);
  }
  return fromMicroUsd(micro);
}

export function isValidReservationAmount(requestUsd: number): boolean {
  return Number.isFinite(requestUsd) && requestUsd > 0 && requestUsd <= MAX_SINGLE_RESERVATION_USD;
}

/** spent + request <= limit (exactly the limit is allowed). */
export function canReserve(input: {
  limitUsd: number;
  spentUsd: number;
  requestUsd: number;
}): boolean {
  if (!isValidReservationAmount(input.requestUsd)) return false;
  return toMicroUsd(input.spentUsd) + toMicroUsd(input.requestUsd) <= toMicroUsd(input.limitUsd);
}

/**
 * Applies reservations the way the row lock serialises them: each one sees every earlier
 * grant. Used to test the invariant that granted reservations never exceed the limit,
 * however many callers race.
 */
export function simulateSerialReservations(
  limitUsd: number,
  startSpentUsd: number,
  requestsUsd: readonly number[],
): { granted: boolean[]; spentUsd: number } {
  let spent = startSpentUsd;
  const granted: boolean[] = [];
  for (const request of requestsUsd) {
    const ok = canReserve({ limitUsd, spentUsd: spent, requestUsd: request });
    granted.push(ok);
    if (ok) spent = fromMicroUsd(toMicroUsd(spent) + toMicroUsd(request));
  }
  return { granted, spentUsd: spent };
}

/**
 * After the call the ledger row holds the actual price. It may exceed the reservation
 * (estimates are not exact); the overrun is reported so it can be watched.
 */
export function settleUsage(input: { reservedUsd: number; actualUsd: number }): {
  costUsd: number;
  overrunUsd: number;
} {
  const actual = Math.max(0, input.actualUsd);
  const overrun = Math.max(0, toMicroUsd(actual) - toMicroUsd(input.reservedUsd));
  return { costUsd: actual, overrunUsd: fromMicroUsd(overrun) };
}

export type BudgetLevel = "ok" | "warning" | "reached";

export function budgetLevel(spentUsd: number, limitUsd: number): BudgetLevel {
  if (limitUsd <= 0 || toMicroUsd(spentUsd) >= toMicroUsd(limitUsd)) return "reached";
  if (toMicroUsd(spentUsd) >= toMicroUsd(limitUsd * BUDGET_WARNING_SHARE)) return "warning";
  return "ok";
}

/** "2026-09" in UTC: one budget_reached insight per fund, scope and month. */
export function budgetMonthKey(now: Date): string {
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${now.getUTCFullYear()}-${month}`;
}
