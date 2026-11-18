import { DuplicateMessageError, send } from "@vercel/queue";
import { getServiceClient } from "@/lib/supabase/admin.server";
import { captureKey } from "./capture";
import { isBrainEnabled } from "./flags";
import { brainIdempotencyKey, parseBrainQueueMessage, type BrainQueueMessage } from "./jobs";

/** The durable queue for every Brain loop. Consumed by server/plugins/brain-queue.ts. */
export const BRAIN_QUEUE_TOPIC = "interlect-brain";

/**
 * "queued": the queue has the message (also when it accepted it for later delivery, where
 * send() gives no message id). "duplicate": the same idempotency key was sent within the
 * retention window, so the message is already queued. "disabled": Brain is switched off.
 */
export type BrainEnqueueResult = "queued" | "duplicate" | "disabled";

/**
 * Sends one loop run to the queue. The queue refuses a repeated idempotency key with a 409
 * (DuplicateMessageError), which counts as already queued, so a retried step can send the same
 * keys again; the job row's unique (fund_id, loop, key) catches the rest. Does nothing while
 * Brain is switched off (BRAIN_ENABLED), so callers can enqueue unconditionally.
 */
export async function enqueueBrain(
  message: BrainQueueMessage,
  /** Delivered this many seconds later (L2 waits so an undo right after a move wins). */
  options: { delaySeconds?: number } = {},
): Promise<BrainEnqueueResult> {
  if (!isBrainEnabled()) return "disabled";
  const parsed = parseBrainQueueMessage(message);
  if (!parsed) throw new Error(`Invalid Brain queue message for loop ${message.loop}.`);
  // The queue does not deliver on a developer machine: the dev server (launch config
  // interlect-dev-brain) and scripts/brain-process-demo.ts run the loops themselves.
  if (skipQueueLocally()) return "disabled";
  try {
    await send<BrainQueueMessage>(BRAIN_QUEUE_TOPIC, parsed, {
      idempotencyKey: brainIdempotencyKey(parsed),
      retentionSeconds: 24 * 60 * 60,
      ...(options.delaySeconds ? { delaySeconds: options.delaySeconds } : {}),
    });
    return "queued";
  } catch (cause) {
    if (cause instanceof DuplicateMessageError) return "duplicate";
    throw cause;
  }
}

/**
 * "This case has changed": marks the case in brain_capture_queue and enqueues L0 for it.
 * Called after every step of the case flow. Never throws and never blocks the flow; a lost
 * call is caught by the nightly reconciliation (L4) through the same queue table.
 */
export async function enqueueBrainCapture(fundId: string, caseId: string): Promise<void> {
  if (!isBrainEnabled()) return;
  try {
    const changedAt = new Date();
    const { error } = await getServiceClient()
      .from("brain_capture_queue")
      .upsert(
        { fund_id: fundId, case_id: caseId, changed_at: changedAt.toISOString() },
        { onConflict: "fund_id,case_id" },
      );
    if (error) throw new Error(`capture queue: ${error.code ?? ""} ${error.message}`);
    await enqueueBrain({ fundId, loop: "L0_capture", key: captureKey(caseId, changedAt) });
  } catch (cause) {
    console.error("[brain] capture was not queued", {
      caseId,
      error: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

/** enqueueBrainCapture for the case behind an analysis run. Never throws. */
export async function enqueueBrainCaptureForRun(runId: string): Promise<void> {
  if (!isBrainEnabled()) return;
  try {
    const { data, error } = await getServiceClient()
      .from("analysis_runs")
      .select("fund_id, case_id")
      .eq("id", runId)
      .maybeSingle();
    if (error || !data) {
      console.error("[brain] capture run lookup failed", {
        runId,
        error: error?.code ?? "not found",
      });
      return;
    }
    await enqueueBrainCapture(data["fund_id"] as string, data["case_id"] as string);
  } catch (cause) {
    console.error("[brain] capture for run failed", {
      runId,
      error: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

/**
 * Marks older than this were not settled by an L0 run: the call was lost or the job failed
 * in every attempt. The nightly cron queues them again with a fresh mark time, so the key is new.
 */
export const STALE_CAPTURE_MINUTES = 10;

export async function requeueStaleCaptures(fundId: string, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - STALE_CAPTURE_MINUTES * 60_000).toISOString();
  const { data, error } = await getServiceClient()
    .from("brain_capture_queue")
    .select("case_id")
    .eq("fund_id", fundId)
    .lt("changed_at", cutoff)
    .limit(200);
  if (error) throw new Error(`capture queue: ${error.code ?? ""} ${error.message}`);
  for (const row of data ?? []) await enqueueBrainCapture(fundId, row["case_id"] as string);
  return data?.length ?? 0;
}

/** BRAIN_DEV_SKIP_ENQUEUE=1 outside production: nothing is sent to the queue. */
function skipQueueLocally(): boolean {
  return (
    process.env["NODE_ENV"] !== "production" &&
    !process.env["VERCEL_ENV"] &&
    process.env["BRAIN_DEV_SKIP_ENQUEUE"] === "1"
  );
}
