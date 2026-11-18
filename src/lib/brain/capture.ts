/**
 * L0 capture (–5, 06 L0): pure helpers for the queue key,
 * the embedding price and the profile-vector hash. No I/O here (tested in capture.test.ts);
 * the SQL side is migration 0044 (brain_capture_case) and the loop is loops/capture.ts.
 */
import { createHash } from "node:crypto";

/** Same model and dimension as brain_chunks.embedding and fund_memory_entries. */
export const EMBEDDING_MODEL = "openai/text-embedding-3-small";
/** $0.02 per 1M tokens. */
export const EMBEDDING_USD_PER_TOKEN = 0.02 / 1_000_000;
/** Chunks embedded per L0 run; the rest follow on the next run or the nightly L4. */
export const EMBED_BATCH_LIMIT = 200;
/** A reservation must be above 0 (brain_reserve_budget). */
const MIN_RESERVATION_USD = 0.0001;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Where an L0 run comes from, carried in its queue key:
 *   "change": the case flow ("<caseId>:<ISO>"); L1 follows.
 *   "search": the backfill level Søgbar ("search:<caseId>:<ISO>"); L0 only, the episodes stay
 *             pending until the case changes again or a full backfill runs.
 *   "full":   the backfill level Fuld forståelse ("full:<caseId>:<ISO>"); L1 follows.
 * For both backfill origins the time is the run's start, so the run id can be derived from it.
 */
export type CaptureOrigin = "change" | "search" | "full";
const ORIGIN_PREFIX: Record<Exclude<CaptureOrigin, "change">, string> = {
  search: "search:",
  full: "full:",
};

/** L0 queue key: unique per change of the case, or per case in one backfill run. */
export function captureKey(
  caseId: string,
  changedAt: Date,
  origin: CaptureOrigin = "change",
): string {
  if (!UUID.test(caseId)) throw new Error("captureKey: case id must be a uuid");
  const key = `${caseId.toLowerCase()}:${changedAt.toISOString()}`;
  return origin === "change" ? key : `${ORIGIN_PREFIX[origin]}${key}`;
}

/** Reads a key from captureKey. Null for anything else. */
export function parseCaptureKey(
  key: string,
): { caseId: string; changedAt: Date; origin: CaptureOrigin } | null {
  let origin: CaptureOrigin = "change";
  let rest = key;
  for (const candidate of ["search", "full"] as const) {
    if (key.startsWith(ORIGIN_PREFIX[candidate])) {
      origin = candidate;
      rest = key.slice(ORIGIN_PREFIX[candidate].length);
    }
  }
  const separator = rest.indexOf(":");
  if (separator !== 36) return null;
  const caseId = rest.slice(0, separator);
  const changedAt = new Date(rest.slice(separator + 1));
  if (!UUID.test(caseId) || Number.isNaN(changedAt.getTime())) return null;
  return { caseId: caseId.toLowerCase(), changedAt, origin };
}

/** L1 follows L0 except for the backfill level Søgbar. */
export function captureExtracts(origin: CaptureOrigin): boolean {
  return origin !== "search";
}

/**
 * The most one embedding batch can cost, reserved before the call: at most one token per
 * 3 characters (Danish text averages about 4), plus 20 %.
 */
export function estimateEmbeddingUsd(texts: readonly string[]): number {
  const characters = texts.reduce((sum, text) => sum + text.length, 0);
  const usd = Math.ceil(characters / 3) * EMBEDDING_USD_PER_TOKEN * 1.2;
  return Math.max(MIN_RESERVATION_USD, Number(usd.toFixed(6)));
}

/** The actual price from the token count the provider returns. */
export function embeddingCostUsd(tokens: number): number {
  if (!Number.isFinite(tokens) || tokens <= 0) return 0;
  return Number((tokens * EMBEDDING_USD_PER_TOKEN).toFixed(8));
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** The profile vector is only recomputed when its text changed. */
export function profileNeedsUpdate(text: string | null, lastHash: string | null): boolean {
  if (!text || !text.trim()) return false;
  return sha256Hex(text) !== lastHash;
}
