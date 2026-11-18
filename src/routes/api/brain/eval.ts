import { createFileRoute } from "@tanstack/react-router";
import { handleBrainEval } from "@/lib/brain/eval/route.server";

/** Operator access to Brain's demo test set. Needs CRON_SECRET. */
export const Route = createFileRoute("/api/brain/eval")({
  server: {
    handlers: {
      POST: ({ request }) => handleBrainEval(request),
    },
  },
});
