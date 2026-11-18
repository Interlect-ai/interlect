import { createFileRoute } from "@tanstack/react-router";
import { handleBrainCron } from "@/lib/brain/cron.server";

/** Vercel Cron (nitro.config.ts, daily 02:15 UTC). Needs CRON_SECRET; off while BRAIN_ENABLED is unset. */
export const Route = createFileRoute("/api/brain/cron")({
  server: {
    handlers: {
      GET: ({ request }) => handleBrainCron(request),
    },
  },
});
