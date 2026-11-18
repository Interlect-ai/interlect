import { createFileRoute, notFound } from "@tanstack/react-router";
import { getInternalPagesEnabled } from "@/lib/internal/internal-pages.functions";
import { InternalPage } from "@/components/internal/InternalPage";
import { ComponentGallery } from "@/components/internal/ComponentGallery";

export const Route = createFileRoute("/intern/komponenter")({
  // Never in a customer installation (they run production); decided on the server.
  beforeLoad: async () => {
    if (!(await getInternalPagesEnabled())) throw notFound();
  },
  head: () => ({
    meta: [{ title: "Komponenter (intern) — Interlect" }, { name: "robots", content: "noindex" }],
  }),
  component: () => (
    <InternalPage section="komponenter">
      <ComponentGallery />
    </InternalPage>
  ),
});
