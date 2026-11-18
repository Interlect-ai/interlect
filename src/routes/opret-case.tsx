import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/ds/AppShell";
import { useActiveFund } from "@/lib/funds/useActiveFund";
import { IntakeFlow } from "@/components/intake/IntakeFlow";
import { LoadingState, NoAccess } from "@/components/ds/States";
import { hasCapability } from "@/lib/domain/workflow";
import type { FundRole } from "@/lib/domain/types";
import { useT } from "@/lib/i18n/useT";
import { pageMeta } from "@/lib/i18n/page-head";

export const Route = createFileRoute("/opret-case")({
  head: () => ({
    meta: [
      ...pageMeta("createCase"),
      // i18n-keep: link previews (og:) stay Danish; a crawler never knows the fund's language.
      { property: "og:title", content: "Opret case — Interlect" },
      // i18n-keep: link preview
      {
        property: "og:description",
        content: "Selskab, Find, Bekræft, Screening. Kun navnet eller CVR er påkrævet.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: OpretCasePage,
});

/**
 * Selskab → Find → Bekræft → Interlect arbejder (`src/components/intake/`). The old long
 * form is gone. A Læser (no `create_case`) gets the no-access state, never the flow.
 */
function OpretCasePage() {
  const t = useT();
  const { fundId, fund } = useActiveFund();
  const canCreate = fund ? hasCapability(fund.roles as FundRole[], "create_case") : true;
  return (
    <AppShell title={t("intake.route.title")} redesigned>
      {!fund || !fundId ? (
        <LoadingState title={t("intake.route.loading")} />
      ) : !canCreate ? (
        <NoAccess title={t("intake.route.noAccessTitle")} body={t("intake.route.noAccessBody")} />
      ) : (
        <IntakeFlow key={fundId} fundId={fundId} />
      )}
    </AppShell>
  );
}
