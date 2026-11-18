/**
 * "Indlæs eksisterende cases i Brain", pure helpers: levels, queue keys and the price
 * shown before anything runs. No I/O here (tested in backfill.test.ts); the loop is
 * loops/backfill.ts and the server side backfill.server.ts.
 */
import { AI_BUDGETS } from "../analysis/budgets.ts";

/** "search" = Søgbar (L0 only). "full" = Fuld forståelse (L0 + L1). */
export const BACKFILL_LEVELS = ["search", "full"] as const;
export type BackfillLevel = (typeof BACKFILL_LEVELS)[number];

/** Cases per queue message. */
export const BACKFILL_PAGE_SIZE = 20;

/**
 * Estimates per case. L0 is embeddings only: a case of ~25 chunks is ~5,000
 * tokens at $0.02 per million, so $0.0005 is an upper bound. L1 is about $0.10 per case.
 */
export const SEARCH_USD_PER_CASE = 0.0005;
export const EXTRACT_USD_PER_CASE = 0.1;

const RUN_ID = /^\d{8}T\d{6}Z$/;

/** One run of the backfill, from its start time: "20260930T093012Z". */
export function backfillRunId(startedAt: Date): string {
  return startedAt
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/[-:]/g, "");
}

/** The start time behind a run id; every L0 key of the run uses it, so a retry sends the same keys. */
export function backfillStartedAt(runId: string): Date | null {
  if (!RUN_ID.test(runId)) return null;
  const iso = `${runId.slice(0, 4)}-${runId.slice(4, 6)}-${runId.slice(6, 8)}T${runId.slice(9, 11)}:${runId.slice(11, 13)}:${runId.slice(13, 15)}Z`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) || backfillRunId(date) !== runId ? null : date;
}

/** Queue key of one page: "<level>:<runId>:<page>". */
export function backfillKey(level: BackfillLevel, runId: string, page: number): string {
  if (!Number.isInteger(page) || page < 0) throw new Error("backfillKey: page must be >= 0");
  if (!backfillStartedAt(runId)) throw new Error("backfillKey: invalid run id");
  return `${level}:${runId}:${page}`;
}

/** The job row that stops a run: its pages check for it before they enqueue anything. */
export function backfillStopKey(level: BackfillLevel, runId: string): string {
  if (!backfillStartedAt(runId)) throw new Error("backfillStopKey: invalid run id");
  return `${level}:${runId}:stop`;
}

export function parseBackfillKey(
  key: string,
): { level: BackfillLevel; runId: string; page: number; startedAt: Date } | null {
  const parts = key.split(":");
  if (parts.length !== 3) return null;
  const [level, runId, page] = parts as [string, string, string];
  if (!(BACKFILL_LEVELS as readonly string[]).includes(level)) return null;
  if (!/^(0|[1-9]\d{0,5})$/.test(page)) return null;
  const startedAt = backfillStartedAt(runId);
  if (!startedAt) return null;
  return { level: level as BackfillLevel, runId, page: Number(page), startedAt };
}

export type BackfillPrice = { usd: number; dkk: number };
export type BackfillEstimate = {
  cases: number;
  search: BackfillPrice;
  full: BackfillPrice;
};

/** The price shown before start. Rounded up to whole øre, never 0 for a non-empty fund. */
export function estimateBackfill(cases: number): BackfillEstimate {
  const count = Number.isFinite(cases) && cases > 0 ? Math.floor(cases) : 0;
  const search = count * SEARCH_USD_PER_CASE;
  const full = count * (SEARCH_USD_PER_CASE + EXTRACT_USD_PER_CASE);
  return { cases: count, search: price(search), full: price(full) };
}

function price(usd: number): BackfillPrice {
  const dkk = Math.ceil(usd * AI_BUDGETS.exchangeRateDkkPerUsd * 100) / 100;
  return { usd: Number(usd.toFixed(4)), dkk };
}
