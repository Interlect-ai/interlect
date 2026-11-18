import { createFileRoute } from "@tanstack/react-router";
import { RequireSession } from "@/components/auth/RequireSession";
import { ThesisWizard } from "@/components/funds/thesis/ThesisWizard";
import { pageMeta } from "@/lib/i18n/page-head";

export const Route = createFileRoute("/fond/ny")({
  head: () => ({
    meta: [
      ...pageMeta("newThesis"),
      // i18n-keep: link previews (og:) stay Danish; a crawler never knows the fund's language.
      { property: "og:title", content: "Ny investeringstese — Interlect" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: NewThesisPage,
});

function NewThesisPage() {
  return (
    <RequireSession>
      <ThesisWizard />
    </RequireSession>
  );
}
