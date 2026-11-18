import { createFileRoute } from "@tanstack/react-router";
import { handleBrainChat } from "@/lib/brain/chat/route.server";

/** Brain chat: one question, answered as an NDJSON stream (chat-contract.ts). */
export const Route = createFileRoute("/api/brain/chat")({
  server: {
    handlers: {
      POST: ({ request }) => handleBrainChat(request),
    },
  },
});
