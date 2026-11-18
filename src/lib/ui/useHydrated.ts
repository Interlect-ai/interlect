import { useSyncExternalStore } from "react";

const noSubscribe = () => () => {};

/**
 * False on the server and during hydration, true afterwards. A part that the browser
 * can fill from its own cache before the first paint (the fund card) renders its loading state
 * until then, so the server's HTML and the browser's first render are the same.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );
}
