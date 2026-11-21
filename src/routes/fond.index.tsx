import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/ds/AppShell";
import { FundConfigWorkspace } from "@/components/funds/FundConfigWorkspace";
import { FundPageHeader } from "@/components/funds/FundPageHeader";
import { parsePlace, type SetupPlaceKey } from "@/lib/funds/setup-places";
import { useT } from "@/lib/i18n/useT";
import { pageMeta } from "@/lib/i18n/page-head";

/**
 * Teamopsætning: one page for "Ny", "Redigér" and "Fortsæt kladde".
 * `?sted=` is the place (Jeres tese, Sådan screener vi, Sådan analyserer vi, Gennemse og udgiv);
 * `?ny=1` starts a new thesis on the same page (`/fond/ny` sends people here).
 */
interface FundSetupSearch {
  sted?: SetupPlaceKey;
  ny?: 1;
}

export const Route = createFileRoute("/fond/")({
  validateSearch: (search: Record<string, unknown>): FundSetupSearch => {
    const place = parsePlace(search["sted"]);
    const isNew = search["ny"] === 1 || search["ny"] === "1" || search["ny"] === true;
    return { ...(place ? { sted: place } : {}), ...(isNew ? { ny: 1 as const } : {}) };
  },
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
  const { sted, ny } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <AppShell title={t("nav.fundSetup")} redesigned>
      <FundPageHeader title={t("nav.fundSetup")}>
        <FundConfigWorkspace
          place={sted ?? "thesis"}
          onPlaceChange={(place) =>
            void navigate({
              search: (previous) => {
                const { sted: _old, ...rest } = previous;
                return place === "thesis" ? rest : { ...rest, sted: place };
              },
              replace: true,
            })
          }
          creatingNew={ny === 1}
          onNew={() => void navigate({ search: { ny: 1 } })}
          onNewDone={() => void navigate({ search: {} })}
        />
      </FundPageHeader>
    </AppShell>
  );
}
