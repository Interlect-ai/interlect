import { createFileRoute, notFound } from "@tanstack/react-router";
import { getInternalPagesEnabled } from "@/lib/internal/internal-pages.functions";
import { InternalPage } from "@/components/internal/InternalPage";
import { ChartGallery } from "@/components/internal/ChartGallery";
import { ChartCatalog } from "@/components/internal/ChartCatalog";

export const Route = createFileRoute("/intern/grafer")({
  // Never in a customer installation (they run production); decided on the server.
  beforeLoad: async () => {
    if (!(await getInternalPagesEnabled())) throw notFound();
  },
  head: () => ({
    meta: [{ title: "Grafer (intern) — Interlect" }, { name: "robots", content: "noindex" }],
  }),
  component: () => (
    <InternalPage section="grafer">
      <div className="flex flex-col gap-10">
        <ChartCatalog />
        <ChartGallery />
      </div>
    </InternalPage>
  ),
});
