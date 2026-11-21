import { createFileRoute } from "@tanstack/react-router";
import { handleSetupDraft } from "@/lib/funds/setup-draft-route.server";

/** The setup draft per stage, answered as an NDJSON stream (setup-draft-route.server.ts). */
export const Route = createFileRoute("/api/fund-setup/draft")({
  server: {
    handlers: {
      POST: ({ request }) => handleSetupDraft(request),
    },
  },
});
