import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getCreditMeter } from "@/lib/ai/credit-meter.functions";

/** The meter's numbers (Admin and Lead only); shared with the "Fyld op" next to a stopped action. */
export function useCreditMeterQuery(fundId: string, allowed: boolean) {
  const load = useServerFn(getCreditMeter);
  return useQuery({
    queryKey: ["credit-meter", fundId],
    queryFn: () => load({ data: { fundId } }),
    enabled: allowed,
    retry: false,
    // A payment opens in another tab: the numbers are fetched again when the reader returns.
    staleTime: 5_000,
  });
}
