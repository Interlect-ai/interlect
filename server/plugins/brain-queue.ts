import { definePlugin } from "nitro";
import { BRAIN_QUEUE_TOPIC } from "../../src/lib/brain/queue.server";
import { processBrainMessage } from "../../src/lib/brain/worker.server";
import { isMaintenanceMode } from "../../src/lib/maintenance-page";

export default definePlugin((nitro) => {
  nitro.hooks.hook("vercel:queue", async ({ message, metadata }) => {
    if (metadata.topicName !== BRAIN_QUEUE_TOPIC) return;
    // While the app is being rebuilt nothing may write; the message is redelivered later.
    if (isMaintenanceMode()) {
      throw new Error(`Brain-køen er sat på pause (MAINTENANCE_MODE): ${metadata.messageId}`);
    }
    const outcome = await processBrainMessage(message);
    // Throwing gives the message back to the queue (redelivered after retryAfterSeconds).
    if (outcome.action === "retry") {
      throw new Error(`Brain ${metadata.messageId}: ${outcome.reason}, genleveres.`);
    }
  });
});
