import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/ds/AppShell";
import { FundConfigWorkspace } from "@/components/funds/FundConfigWorkspace";
import { FundPageHeader } from "@/components/funds/FundPageHeader";
import { useT } from "@/lib/i18n/useT";
import { pageMeta } from "@/lib/i18n/page-head";

export const Route = createFileRoute("/fond/")({
  head: () => ({
    meta: [
      ...pageMeta("fundSetup"),
      // i18n-keep: link previews (og:) stay Danish; a crawler never knows the fund's language.
      { property: "og:title", content: "Teamopsætning — Interlect" },
      // i18n-keep: link preview
      {
        property: "og:description",
        content: "Versionsstyret mandat: gates, vægte, stadier, geografi, ticket og tærskel.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: FundConfigPage,
});

function FundConfigPage() {
  const t = useT();
  return (
    <AppShell title={t("nav.fundSetup")} redesigned>
      <FundPageHeader title={t("nav.fundSetup")}>
        <FundConfigWorkspace />
      </FundPageHeader>
    </AppShell>
  );
}
