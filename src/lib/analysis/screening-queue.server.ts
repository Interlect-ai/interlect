import { send } from "@vercel/queue";

/** The screening's analysis phase, in a function of its own after the research. */
export const SCREENING_QUEUE_TOPIC = "interlect-screening";

export type ScreeningQueueMessage = { runId: string };

export async function enqueueScreeningAnalysis(runId: string): Promise<string | null> {
  const { messageId } = await send<ScreeningQueueMessage>(
    SCREENING_QUEUE_TOPIC,
    { runId },
    {
      idempotencyKey: `interlect-screening:${runId}:analysis`,
      retentionSeconds: 24 * 60 * 60,
    },
  );
  return messageId;
}
