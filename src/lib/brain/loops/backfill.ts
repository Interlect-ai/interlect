import type { LoopContext, LoopHandler } from "../worker.server";
import { BACKFILL_PAGE_SIZE, backfillKey, backfillStopKey, parseBackfillKey } from "../backfill";
import { captureKey } from "../capture";
import { enqueueBrain } from "../queue.server";

/**
 * BACKFILL · "Indlæs eksisterende cases i Brain". One message = one page of 20 cases:
 * it enqueues L0 for each case (with L1 after it for "Fuld forståelse") and then the next page.
 * Every L0 key of a run uses the run's start time, so a retried page sends the same keys and
 * the queue (duplicate = already queued) and the job rows drop the repeats. A run stops when its
 * stop row exists: later pages enqueue nothing, and its L0/L1 jobs that have not started skip.
 */
export const backfillLoop: LoopHandler = async (ctx) => {
  const key = parseBackfillKey(ctx.key);
  if (!key) return { status: "skipped", stats: { reason: "invalid_key" } };
  const { level, runId, page, startedAt } = key;

  if (await isStopped(ctx, backfillStopKey(level, runId))) {
    return { status: "skipped", stats: { reason: "stopped", level, runId, page } };
  }

  const from = page * BACKFILL_PAGE_SIZE;
  const { data, error } = await ctx.service
    .from("cases")
    .select("id")
    .eq("fund_id", ctx.fundId)
    .order("id", { ascending: true })
    .range(from, from + BACKFILL_PAGE_SIZE - 1);
  if (error) throw new Error(`backfill cases: ${error.message}`);
  const caseIds = (data ?? []).map((row) => row["id"] as string);

  // The L0 key carries the level ("search:" / "full:"), so L0 knows whether L1 follows and
  // which run's stop row to check.
  for (const caseId of caseIds) {
    await enqueueBrain({
      fundId: ctx.fundId,
      loop: "L0_capture",
      key: captureKey(caseId, startedAt, level),
    });
  }
  await ctx.recordStep("enqueue", { cases: caseIds.length });

  const last = caseIds.length < BACKFILL_PAGE_SIZE;
  if (!last) {
    await enqueueBrain({
      fundId: ctx.fundId,
      loop: "BACKFILL",
      key: backfillKey(level, runId, page + 1),
    });
  }
  return { status: "done", stats: { level, runId, page, cases: caseIds.length, last } };
};

async function isStopped(ctx: LoopContext, stopKey: string): Promise<boolean> {
  const { data, error } = await ctx.service
    .from("brain_jobs")
    .select("id")
    .eq("fund_id", ctx.fundId)
    .eq("loop", "BACKFILL")
    .eq("key", stopKey)
    .maybeSingle();
  if (error) throw new Error(`backfill stop lookup: ${error.message}`);
  return data !== null;
}
