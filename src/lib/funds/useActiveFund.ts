import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listMemberFunds, type MemberFund } from "@/lib/funds/funds.functions";
import { useSession } from "@/lib/auth/useSession";

const STORAGE_KEY = "interlect.activeFundId";
const EVENT_NAME = "interlect:active-fund-changed";

function readStoredFundId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(STORAGE_KEY);
}

/**
 * Aktiv fond for hele workspace'et. Fondene kommer fra brugerens medlemskaber
 * i databasen — der findes ingen hardkodet liste af gyldige fonde.
 */
export function useActiveFund() {
  const { status } = useSession();
  const queryClient = useQueryClient();
  const fetchFunds = useServerFn(listMemberFunds);
  const [storedId, setStoredId] = useState<string | null>(null);

  useEffect(() => {
    const sync = () => setStoredId(readStoredFundId());
    sync();
    window.addEventListener(EVENT_NAME, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT_NAME, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const fundsQuery = useQuery({
    queryKey: ["member-funds"],
    // Before the two-step code (/mfa) the server answers 401, and the call resolves with that
    // answer instead of a list: an error, so the next page asks again.
    queryFn: async () => {
      const funds: unknown = await fetchFunds();
      if (!Array.isArray(funds)) throw new Error("member-funds: not signed in yet");
      return funds as MemberFund[];
    },
    // Every page asks for the teams; within 30 s the answer is reused. Joining, leaving
    // or creating a team invalidates it (refreshFunds).
    staleTime: 30_000,
    enabled: status === "signed_in",
    retry: false,
  });

  const funds: MemberFund[] = fundsQuery.data ?? [];
  const active = funds.find((fund) => fund.id === storedId) ?? funds[0] ?? null;

  const selectFund = useCallback((fundId: string) => {
    window.localStorage.setItem(STORAGE_KEY, fundId);
    setStoredId(fundId);
    window.dispatchEvent(new Event(EVENT_NAME));
  }, []);

  const refreshFunds = useCallback(
    async () => queryClient.invalidateQueries({ queryKey: ["member-funds"] }),
    [queryClient],
  );

  return {
    fundId: active?.id ?? null,
    /**
     * The team the page will most likely use, before the list of teams has arrived: the one
     * chosen last time in this browser. Only for fetching ahead; the server checks access.
     */
    likelyFundId: active?.id ?? (fundsQuery.isSuccess ? null : storedId),
    fund: active,
    funds,
    isLoading: fundsQuery.isLoading,
    isError: fundsQuery.isError,
    selectFund,
    refreshFunds,
  };
}
