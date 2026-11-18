import { createFileRoute } from "@tanstack/react-router";
import { handleBrainBackfill } from "@/lib/brain/backfill-route.server";

/** Operator access to "Indlæs eksisterende cases i Brain". Needs CRON_SECRET. */
export const Route = createFileRoute("/api/brain/backfill")({
  server: {
    handlers: {
      POST: ({ request }) => handleBrainBackfill(request),
    },
  },
});
