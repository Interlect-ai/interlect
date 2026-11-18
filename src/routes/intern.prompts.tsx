import { createFileRoute, notFound } from "@tanstack/react-router";
import { getInternalPagesEnabled } from "@/lib/internal/internal-pages.functions";
import { InternalPage } from "@/components/internal/InternalPage";
import { PromptsView } from "@/components/internal/PromptsView";

export const Route = createFileRoute("/intern/prompts")({
  // Never in a customer installation (they run production); decided on the server.
  beforeLoad: async () => {
    if (!(await getInternalPagesEnabled())) throw notFound();
  },
  head: () => ({
    meta: [{ title: "Prompts (intern) — Interlect" }, { name: "robots", content: "noindex" }],
  }),
  component: () => (
    <InternalPage section="prompts">
      <PromptsView />
    </InternalPage>
  ),
});
