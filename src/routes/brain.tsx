import { createFileRoute } from "@tanstack/react-router";
import { BrainPage } from "@/components/brain/BrainPage";
import { pageMeta } from "@/lib/i18n/page-head";

interface BrainSearch {
  /** A thread id (not content). */
  traad?: string;
  /** "kort": Hjernekortet. "kilder": Brains kilder. (Gamle `?vis=laert` ignoreres.) */
  vis?: "kort" | "kilder";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const Route = createFileRoute("/brain")({
  head: () => ({
    meta: [...pageMeta("brain"), { name: "robots", content: "noindex" }],
  }),
  validateSearch: (search: Record<string, unknown>): BrainSearch => {
    const id = typeof search["traad"] === "string" ? search["traad"] : "";
    return {
      ...(UUID.test(id) ? { traad: id } : {}),
      ...(search["vis"] === "kort" || search["vis"] === "kilder" ? { vis: search["vis"] } : {}),
    };
  },
  component: BrainRoute,
});

function BrainRoute() {
  const { traad, vis } = Route.useSearch();
  return <BrainPage threadId={traad} map={vis === "kort"} sources={vis === "kilder"} />;
}
