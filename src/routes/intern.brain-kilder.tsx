import { createFileRoute, notFound } from "@tanstack/react-router";
import { getInternalPagesEnabled } from "@/lib/internal/internal-pages.functions";
import { useQuery } from "@tanstack/react-query";
import { BrainSources } from "@/components/brain/BrainSources";
import { AppShell } from "@/components/ds/AppShell";
import { ErrorState, LoadingState, NoAccess } from "@/components/ds/States";
import { getMyAccess, myAccessQueryKey } from "@/lib/auth/access.functions";
import { isAdminRole } from "@/lib/auth/is-admin";
import { useActiveFund } from "@/lib/funds/useActiveFund";

export const Route = createFileRoute("/intern/brain-kilder")({
  // Never in a customer installation (they run production); decided on the server.
  beforeLoad: async () => {
    if (!(await getInternalPagesEnabled())) throw notFound();
  },
  head: () => ({
    meta: [
      { title: "Brain · Kilder (intern) — Interlect" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: BrainSourcesRoute,
});

/**
 * Brain · Kilder. An internal Admin page until the real Kilder page is designed: it
 * holds no fund design of its own. Only admins see it (a UI gate; every server function checks
 * the capability itself).
 */
function BrainSourcesRoute() {
  const { fundId, fund, isLoading: fundsLoading } = useActiveFund();
  const access = useQuery({
    queryKey: myAccessQueryKey(fundId),
    queryFn: () => getMyAccess({ data: { fundId: fundId! } }),
    enabled: Boolean(fundId),
  });
  return (
    <AppShell title="Brain · Kilder" redesigned>
      {fundsLoading || access.isLoading ? (
        <LoadingState />
      ) : access.isError || !fundId ? (
        <ErrorState onRetry={() => void access.refetch()} />
      ) : !isAdminRole(access.data?.roles) ? (
        <NoAccess body="Denne side er kun for admins." />
      ) : (
        <div className="flex max-w-[960px] flex-col gap-8 px-4 pt-6 pb-20 md:px-10 md:pt-[30px]">
          <div className="flex flex-col gap-1.5">
            <h1 className="m-0 text-[30px] leading-[1.05] font-semibold tracking-display md:text-[40px]">
              Brain · Kilder
            </h1>
            <p className="m-0 max-w-[640px] text-[15px] text-ink-3">
              Giv Brain materiale at lære af for {fund?.name ?? "fonden"}: rapporter, breve, memoer
              og tekst. Prisen vises, før noget læses, og kilden kan glemmes igen.
            </p>
            <p className="m-0 text-meta text-ink-4">
              Intern side, indtil den rigtige Kilder-side er designet.
            </p>
          </div>
          <BrainSources fundId={fundId} />
        </div>
      )}
    </AppShell>
  );
}
