import { useQueries, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import type { SetupStage } from "@/lib/analysis/setup-stage";
import { getFundSpecialists } from "@/lib/funds/specialists.functions";

/**
 * Under the fund config's key, so publishing or reloading the setup refreshes it too.: a
 * stage's set has its own key under the shared one (no stage = the shared set, as before).
 */
export const fundSpecialistsKey = (
  fundId: string,
  configId: string,
  stage: SetupStage | null = null,
) =>
  stage
    ? (["fund-config", fundId, "specialists", configId, stage] as const)
    : (["fund-config", fundId, "specialists", configId] as const);

/** The set of specialists of one version: the editor, the overview and the publish step. */
export function useFundSpecialists(
  fundId: string,
  configId: string | null | undefined,
  stage: SetupStage | null = null,
) {
  const read = useServerFn(getFundSpecialists);
  return useQuery({
    queryKey: fundSpecialistsKey(fundId, configId ?? "none", stage),
    queryFn: () => read({ data: { fundId, configId: configId!, stage } }),
    enabled: Boolean(configId),
    staleTime: 10_000,
  });
}

/**
 * How many specialists are on in each stage (the compare sheet's "Specialister" row). The
 * stages share the cache with the page, so the stage on show costs no extra call.
 */
export function useStageSpecialistCounts(
  fundId: string,
  configId: string | null | undefined,
  stages: readonly SetupStage[],
): Partial<Record<SetupStage, number>> {
  const read = useServerFn(getFundSpecialists);
  const results = useQueries({
    queries: stages.map((stage) => ({
      queryKey: fundSpecialistsKey(fundId, configId ?? "none", stage),
      queryFn: () => read({ data: { fundId, configId: configId!, stage } }),
      enabled: Boolean(configId),
      staleTime: 10_000,
    })),
  });
  const counts: Partial<Record<SetupStage, number>> = {};
  stages.forEach((stage, index) => {
    const view = results[index]?.data;
    if (view) {
      counts[stage] =
        view.standard.filter((item) => item.enabled).length +
        view.custom.filter((item) => item.enabled).length;
    }
  });
  return counts;
}
