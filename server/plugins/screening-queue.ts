import { definePlugin } from "nitro";
import { z } from "zod";
import {
  SCREENING_QUEUE_TOPIC,
  type ScreeningQueueMessage,
} from "../../src/lib/analysis/screening-queue.server";
import { runScreeningAnalysisPhase } from "../../src/lib/analysis/screening-analysis.server";
import { isMaintenanceMode } from "../../src/lib/maintenance-page";

const messageSchema = z.object({ runId: z.guid() });

/** The screening's analysis phase (the research phase runs in the request's waitUntil). */
export default definePlugin((nitro) => {
  nitro.hooks.hook("vercel:queue", async ({ message, metadata }) => {
    if (metadata.topicName !== SCREENING_QUEUE_TOPIC) return;
    // While the app is being rebuilt nothing writes to the database; the message comes back later.
    if (isMaintenanceMode()) {
      throw new Error(`Screeningskøen er sat på pause (MAINTENANCE_MODE): ${metadata.messageId}`);
    }
    const parsed = messageSchema.safeParse(message);
    if (!parsed.success) {
      throw new Error(`Ugyldig besked i screeningskøen: ${metadata.messageId}`);
    }
    const payload: ScreeningQueueMessage = parsed.data;
    console.info(
      `Screening ${payload.runId}: modtog analysefasen (levering ${metadata.deliveryCount}).`,
    );
    const result = await runScreeningAnalysisPhase(payload.runId);
    if (result === "busy") {
      throw new Error(`Screening ${payload.runId}: analysefasen kører allerede og genleveres.`);
    }
  });
});
