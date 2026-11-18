/**
 * What Bekræft reads before the case exists: whether the database supports origin and owner,
 * the chosen theses' requirements, the team of the chosen funds, and an existing case of the
 * same company. All fund-scoped server functions; a failure is shown as "not available", never
 * as invented data.
 */
import { useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  findExistingCases,
  getIntakeCapabilities,
  getIntakeMandate,
  type ExistingCaseHit,
} from "@/lib/cases/intake.functions";
import { listTaskAssignees, type TaskAssignee } from "@/lib/cases/tasks.functions";
import type { MandateSnapshot } from "@/lib/cases/intake-mandate";

export function useIntakeCapabilities(fundId: string | null) {
  const probe = useServerFn(getIntakeCapabilities);
  const query = useQuery({
    queryKey: ["intake-capabilities", fundId],
    queryFn: () => probe({ data: { fundId: fundId! } }),
    enabled: Boolean(fundId),
    staleTime: 60_000,
    retry: false,
  });
  // Unknown (loading or failed) counts as "not supported": the fields stay hidden.
  return { caseOrigin: query.data?.caseOrigin === true, loading: query.isLoading };
}

export function useIntakeMandate(fundIds: string[]) {
  const load = useServerFn(getIntakeMandate);
  const key = [...fundIds].sort().join(",");
  const query = useQuery({
    queryKey: ["intake-mandate", key],
    queryFn: () => load({ data: { fundIds } }),
    enabled: fundIds.length > 0,
    staleTime: 60_000,
    retry: false,
  });
  return {
    snapshots: (query.data ?? []) as MandateSnapshot[],
    loading: query.isLoading,
    failed: query.isError,
  };
}

export function useExistingCases(
  fundIds: string[],
  companyName: string,
  website: string,
  cvrNumber: string | null,
) {
  const find = useServerFn(findExistingCases);
  const key = [...fundIds].sort().join(",");
  const name = companyName.trim();
  const query = useQuery({
    queryKey: ["intake-existing", key, name.toLowerCase(), website.trim().toLowerCase(), cvrNumber],
    queryFn: () => find({ data: { fundIds, companyName: name, website, cvrNumber } }),
    enabled: fundIds.length > 0 && name.length > 0,
    staleTime: 0, // a case made a moment ago must show up as a duplicate
    retry: false,
  });
  return { hits: (query.data ?? []) as ExistingCaseHit[] };
}

/** The people who can be "Ansvarlig" in EVERY chosen fund (the trigger needs membership). */
export function useCommonAssignees(fundIds: string[], enabled: boolean) {
  const load = useServerFn(listTaskAssignees);
  const queries = useQueries({
    queries: fundIds.map((fundId) => ({
      queryKey: ["intake-assignees", fundId],
      queryFn: () => load({ data: { fundId } }),
      enabled,
      staleTime: 60_000,
      retry: false,
    })),
  });
  const failed = queries.some((query) => query.isError);
  const loading = queries.some((query) => query.isLoading);
  const lists = queries.map((query) => query.data as TaskAssignee[] | undefined);
  const people = useMemo(() => {
    if (lists.length === 0 || lists.some((list) => !list)) return [] as TaskAssignee[];
    const [first, ...rest] = lists as TaskAssignee[][];
    return first!.filter((person) =>
      rest.every((list) => list.some((p) => p.userId === person.userId)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queries.map((query) => query.dataUpdatedAt).join(",")]);
  return { people, failed, loading };
}
