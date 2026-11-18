import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getFundSpecialists } from "@/lib/funds/specialists.functions";

/** Under the fund config's key, so publishing or reloading the setup refreshes it too. */
export const fundSpecialistsKey = (fundId: string, configId: string) =>
  ["fund-config", fundId, "specialists", configId] as const;

/** The set of specialists of one version: the editor, the overview and the publish step. */
export function useFundSpecialists(fundId: string, configId: string | null | undefined) {
  const read = useServerFn(getFundSpecialists);
  return useQuery({
    queryKey: fundSpecialistsKey(fundId, configId ?? "none"),
    queryFn: () => read({ data: { fundId, configId: configId! } }),
    enabled: Boolean(configId),
    staleTime: 10_000,
  });
}
