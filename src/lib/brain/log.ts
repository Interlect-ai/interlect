/**
 * brain_log entries (migration 0043): every insert, update, invalidation and merge by a
 * loop or a user, with before/after, so it can be shown and rolled back. Pure file (tested).
 */
import type { BrainLoop } from "./jobs.ts";

export type BrainLogAction =
  | "insert"
  | "update"
  | "invalidate"
  | "merge"
  | "split"
  | "activate"
  | "retire"
  | "delete"
  | "revert"
  | "approve"
  | "reject";

export interface BrainLogEntry {
  fundId: string;
  /** A loop ("L4_nightly", "RETENTION"), "system", or "user:<uuid>". */
  actor: BrainLoop | "system" | `user:${string}`;
  action: BrainLogAction;
  objectKind: string;
  objectId: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  reason?: string | null;
  jobId?: string | null;
}

/** Same rule as the CHECK on brain_log.actor. */
const ACTOR = /^(L[0-8](_[a-z_]+)?|INGEST|BACKFILL|WATCH|RETENTION|system|user:[0-9a-f-]{36})$/;

export function brainLogRow(entry: BrainLogEntry): Record<string, unknown> {
  if (!ACTOR.test(entry.actor)) throw new Error(`Invalid brain_log actor ${entry.actor}.`);
  return {
    fund_id: entry.fundId,
    actor: entry.actor,
    action: entry.action,
    object_kind: entry.objectKind,
    object_id: entry.objectId,
    before: entry.before ?? null,
    after: entry.after ?? null,
    reason: entry.reason ? entry.reason.slice(0, 2000) : null,
    job_id: entry.jobId ?? null,
  };
}

export interface RevertStep {
  objectKind: string;
  objectId: string;
  /** What undoing the entry means for the object. */
  kind: "remove" | "restore" | "reactivate";
  /** The state to restore ("restore"), from the entry's before. */
  state: Record<string, unknown> | null;
}

/**
 * Plans the rollback of a loop run (rule 5): the entries in reverse order, each turned into
 * the opposite step. An insert is removed, an update or merge restores its before, an
 * invalidation or retirement is reactivated. Entries that are already reverts or that have no
 * before to restore are skipped. The loop that owns the object kind applies the steps.
 */
export function planRevert(
  entries: ReadonlyArray<Pick<BrainLogEntry, "action" | "objectKind" | "objectId" | "before">>,
): RevertStep[] {
  const steps: RevertStep[] = [];
  for (const entry of [...entries].reverse()) {
    const base = { objectKind: entry.objectKind, objectId: entry.objectId };
    switch (entry.action) {
      case "insert":
        steps.push({ ...base, kind: "remove", state: null });
        break;
      case "update":
      case "merge":
        if (entry.before) steps.push({ ...base, kind: "restore", state: entry.before });
        break;
      case "invalidate":
      case "retire":
      case "delete":
        steps.push({ ...base, kind: "reactivate", state: entry.before ?? null });
        break;
      default:
        break;
    }
  }
  return steps;
}
