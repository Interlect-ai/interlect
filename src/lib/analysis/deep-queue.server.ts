import { send } from "@vercel/queue";

export const DEEP_ANALYSIS_QUEUE_TOPIC = "interlect-deep-analysis";
export type DeepAnalysisPhase = "public_research" | "evidence_sheet" | "specialists" | "synthesis";

export type DeepAnalysisQueueMessage = {
  runId: string;
  phase: DeepAnalysisPhase;
};

export async function enqueueDeepAnalysisPhase(
  runId: string,
  phase: DeepAnalysisPhase,
): Promise<string | null> {
  const { messageId } = await send<DeepAnalysisQueueMessage>(
    DEEP_ANALYSIS_QUEUE_TOPIC,
    { runId, phase },
    {
      idempotencyKey: `interlect-deep:${runId}:${phase}`,
      retentionSeconds: 24 * 60 * 60,
    },
  );
  return messageId;
}
