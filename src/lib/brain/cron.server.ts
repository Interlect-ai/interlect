import { getServiceClient } from "@/lib/supabase/admin.server";
import { isAuthorizedCron, nightlyKey } from "./cron";
import { isBrainEnabled } from "./flags";
import { enqueueBrain, requeueStaleCaptures } from "./queue.server";

/**
 * The nightly cron: removes AI log payloads older than 90 days, enqueues
 * RETENTION and L4_nightly for every fund with the date as key, and re-queues capture marks that
 * were never settled. L4 itself stops after its free reconciliation when the fund has nothing new
 * (06 L4). Later tickets add WATCH (when switched on) and the weekly loops. No model call
 * here.
 */
export async function handleBrainCron(request: Request, now = new Date()): Promise<Response> {
  if (!isAuthorizedCron(request.headers.get("authorization"), process.env["CRON_SECRET"])) {
    return new Response("Unauthorized", { status: 401 });
  }
  // The AI log's 90 days hold whether Brain is on or not, and also for a quiet fund.
  const { error: purgeError } = await getServiceClient().rpc("ai_call_log_purge");
  if (purgeError) console.error("[cron] ai_call_log_purge", purgeError.message);
  if (!isBrainEnabled()) return Response.json({ enqueued: 0, reason: "disabled" });

  const { data: funds, error } = await getServiceClient().from("funds").select("id");
  if (error) {
    console.error("[brain-cron] funds", error.message);
    return Response.json({ error: "funds could not be listed" }, { status: 500 });
  }
  const key = nightlyKey(now);
  let enqueued = 0;
  let failed = 0;
  let requeued = 0;
  for (const fund of funds ?? []) {
    const fundId = fund["id"] as string;
    // Each part on its own, so a failed L4 enqueue never skips the retention or the re-queue.
    const parts: Array<[string, () => Promise<unknown>]> = [
      ["RETENTION", () => enqueueBrain({ fundId, loop: "RETENTION", key })],
      ["L4_nightly", () => enqueueBrain({ fundId, loop: "L4_nightly", key })],
      [
        "requeue",
        async () => {
          requeued += await requeueStaleCaptures(fundId, now);
        },
      ],
    ];
    let fundFailed = false;
    for (const [part, run] of parts) {
      try {
        await run();
      } catch (cause) {
        fundFailed = true;
        console.error(
          `[brain-cron] fund ${fundId} ${part}`,
          cause instanceof Error ? cause.message : cause,
        );
      }
    }
    if (fundFailed) failed += 1;
    else enqueued += 1;
  }
  return Response.json({ enqueued, requeued, failed, key }, { status: failed ? 500 : 200 });
}
