import { createFileRoute, notFound } from "@tanstack/react-router";
import { getInternalPagesEnabled } from "@/lib/internal/internal-pages.functions";
import { InternalPage } from "@/components/internal/InternalPage";
import { OrbGallery } from "@/components/internal/OrbGallery";

export const Route = createFileRoute("/intern/orbs")({
  // Never in a customer installation (they run production); decided on the server.
  beforeLoad: async () => {
    if (!(await getInternalPagesEnabled())) throw notFound();
  },
  head: () => ({
    meta: [{ title: "Orbs (intern) — Interlect" }, { name: "robots", content: "noindex" }],
  }),
  component: () => (
    <InternalPage section="orbs">
      <OrbGallery />
    </InternalPage>
  ),
});
