import { createFileRoute } from "@tanstack/react-router";
import { handleHealth } from "@/lib/health.server";

/** Up or down for customer:new and release.yml; no detail, no login needed. */
export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: () => handleHealth(),
    },
  },
});
