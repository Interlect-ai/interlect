import { definePlugin } from "nitro";
import { z } from "zod";
import {
  DEEP_ANALYSIS_QUEUE_TOPIC,
  type DeepAnalysisQueueMessage,
} from "../../src/lib/analysis/deep-queue.server";
import { processDeepAnalysisPhase } from "../../src/lib/analysis/deep-worker.server";
import { isMaintenanceMode } from "../../src/lib/maintenance-page";

const messageSchema = z.object({
  runId: z.guid(),
  phase: z.enum(["public_research", "evidence_sheet", "specialists", "synthesis"]),
});

export default definePlugin((nitro) => {
  nitro.hooks.hook("vercel:queue", async ({ message, metadata }) => {
    if (metadata.topicName !== DEEP_ANALYSIS_QUEUE_TOPIC) return;
    // While the app is being rebuilt the old worker must not write to the database; the
    // message is redelivered later instead of being processed.
    if (isMaintenanceMode()) {
      throw new Error(`Analysekøen er sat på pause (MAINTENANCE_MODE): ${metadata.messageId}`);
    }

    const parsed = messageSchema.safeParse(message);
    if (!parsed.success) {
      throw new Error(`Ugyldig besked i analysekøen: ${metadata.messageId}`);
    }

    const payload: DeepAnalysisQueueMessage = parsed.data;
    console.info(
      `Dyb analyse ${payload.runId}: modtog fase ${payload.phase} (levering ${metadata.deliveryCount}).`,
    );
    const result = await processDeepAnalysisPhase(payload.runId, true, payload.phase);
    if (result === "busy") {
      throw new Error(
        `Dyb analyse ${payload.runId}: fase ${payload.phase} behandles allerede og skal genleveres.`,
      );
    }
  });
});
