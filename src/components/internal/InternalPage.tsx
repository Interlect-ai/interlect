/**
 * Frame for the internal admin pages (/intern/komponenter, /intern/grafer, /intern/orbs):
 * the new shell, a 40 px title, the three pages as a pill group and a note that the content
 * is the design system's example data. Only admins see the pages; they hold no fund data,
 * so the check is a UI gate (every server function checks roles itself).
 */
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/ds/AppShell";
import { ErrorState, LoadingState, NoAccess } from "@/components/ds/States";
import { getMyAccess, myAccessQueryKey } from "@/lib/auth/access.functions";
import { isAdminRole } from "@/lib/auth/is-admin";
import { useActiveFund } from "@/lib/funds/useActiveFund";
import {
  InternalPageBody,
  INTERNAL_TITLES,
  type InternalSection,
} from "@/components/internal/InternalPageBody";

export function InternalPage({
  section,
  children,
}: {
  section: InternalSection;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const { fundId, isLoading: fundsLoading } = useActiveFund();
  const access = useQuery({
    queryKey: myAccessQueryKey(fundId),
    queryFn: () => getMyAccess({ data: { fundId: fundId! } }),
    enabled: Boolean(fundId),
  });
  const copy = INTERNAL_TITLES[section];

  return (
    <AppShell title={copy.title} redesigned>
      {fundsLoading || access.isLoading ? (
        <LoadingState />
      ) : access.isError ? (
        <ErrorState onRetry={() => void access.refetch()} />
      ) : !isAdminRole(access.data?.roles) ? (
        <NoAccess body="De interne sider er kun for admins." />
      ) : (
        <InternalPageBody
          section={section}
          onSection={(value) => void navigate({ to: `/intern/${value}` })}
        >
          {children}
        </InternalPageBody>
      )}
    </AppShell>
  );
}
