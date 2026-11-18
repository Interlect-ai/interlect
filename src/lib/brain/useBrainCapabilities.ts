import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useSession } from "@/lib/auth/useSession";
import { useActiveFund } from "@/lib/funds/useActiveFund";
import type { BrainCapabilities } from "./capabilities";
import { getBrainCapabilities } from "./capabilities.functions";

export const brainCapabilitiesQueryKey = (fundId: string | null) =>
  ["brain-capabilities", fundId] as const;

/**
 * What Brain can do for me in the active fund (the menu item, `/brain`, the Spørg Interlect
 * pill). While loading or if the question fails, `data` is undefined and `showBrain` is false:
 * Brain stays hidden in the menu and no other page is affected. A failure is a real error (not
 * "Brain is off"): it is logged, `/brain` shows it with "Prøv igen", and it is not cached as an
 * answer. A short stale time matches the server's 20 s / 5 min probe cache.
 */
export function useBrainCapabilities() {
  const { status } = useSession();
  const { fundId } = useActiveFund();
  const fetchCapabilities = useServerFn(getBrainCapabilities);
  const query = useQuery<BrainCapabilities>({
    queryKey: brainCapabilitiesQueryKey(fundId),
    queryFn: async () => {
      try {
        return await fetchCapabilities({ data: { fundId: fundId! } });
      } catch (cause) {
        console.error("[brain] capabilities", cause instanceof Error ? cause.message : cause);
        throw cause;
      }
    },
    enabled: status === "signed_in" && Boolean(fundId),
    staleTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
  return query;
}
