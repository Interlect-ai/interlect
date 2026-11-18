import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useSession } from "@/lib/auth/useSession";
import { getDemoDataStatus } from "@/lib/demo/demo-data.functions";
import { useActiveFund } from "@/lib/funds/useActiveFund";

export const demoDataQueryKey = (fundId: string | null) => ["demo-data", fundId] as const;

/** Whether the active fund has demo cases, and how many (0 while loading or on an error). */
export function useDemoData() {
  const { status } = useSession();
  const { fundId } = useActiveFund();
  const load = useServerFn(getDemoDataStatus);
  const query = useQuery({
    queryKey: demoDataQueryKey(fundId),
    queryFn: () => load({ data: { fundId: fundId! } }),
    enabled: status === "signed_in" && Boolean(fundId),
    staleTime: 60_000,
    retry: false,
  });
  useEffect(() => {
    // Advisory only: without the status the banner stays hidden, but the cause is not lost.
    if (query.error) console.warn("[demo-data] status not read", query.error);
  }, [query.error]);
  const cases = query.data?.cases ?? 0;
  const leftover = query.data?.leftover ?? 0;
  return { fundId, cases, leftover, visible: cases > 0 || leftover > 0 };
}
