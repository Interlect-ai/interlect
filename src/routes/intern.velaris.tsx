import { createFileRoute, notFound } from "@tanstack/react-router";
import { getInternalPagesEnabled } from "@/lib/internal/internal-pages.functions";
import { InternalPage } from "@/components/internal/InternalPage";
import { VelarisGallery } from "@/components/internal/VelarisGallery";

export const Route = createFileRoute("/intern/velaris")({
  // Never in a customer installation (they run production); decided on the server.
  beforeLoad: async () => {
    if (!(await getInternalPagesEnabled())) throw notFound();
  },
  head: () => ({
    meta: [{ title: "Velaris (intern) — Interlect" }, { name: "robots", content: "noindex" }],
  }),
  component: () => (
    <InternalPage section="velaris">
      <VelarisGallery />
    </InternalPage>
  ),
});
