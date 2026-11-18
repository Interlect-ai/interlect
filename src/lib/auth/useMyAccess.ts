import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMyAccess, MY_ACCESS_STALE_MS, myAccessQueryKey } from "@/lib/auth/access.functions";
import { useSession } from "@/lib/auth/useSession";
import type { CasePermissions } from "@/lib/cases/case-actions";

/**
 * The user's access in the active fund, for hiding and disabling controls (the server
 * re-checks every action). Shares its cache with the menu rail.
 */
export function useMyAccess(fundId: string | null) {
  const { status } = useSession();
  const load = useServerFn(getMyAccess);
  return useQuery({
    queryKey: myAccessQueryKey(fundId),
    queryFn: () => load({ data: { fundId: fundId! } }),
    staleTime: MY_ACCESS_STALE_MS,
    enabled: status === "signed_in" && Boolean(fundId),
  });
}

/** Case permissions from the access payload; nothing is allowed until it has loaded. */
export function casePermissions(
  capabilities: readonly string[] | undefined,
): CasePermissions & { canAct: boolean } {
  const has = (capability: string) => capabilities?.includes(capability) ?? false;
  const canMove = has("move_process_stage");
  const canDecide = has("decide_case");
  const canRun = has("start_analysis") && has("approve_deep_analysis");
  return { canMove, canDecide, canRun, canAct: canMove || canDecide || canRun };
}
