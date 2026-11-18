/**
 * Real addresses for the cards on the Dyb analyse, so "Åbn i ny fane" and a right click work
 * (batch 3). The cards stay in the app on a plain click; a click with Cmd, Ctrl, Shift or
 * the middle button is left to the browser. `DeepCaseView` provides the builder; a card outside
 * it (a gallery) simply has no address.
 */
import { createContext, useContext, type MouseEvent } from "react";

/** `tab`: a specialist key, "okonomi" or "risici"; `null` is Konklusion; left out = this tab. */
export type DeepHrefTarget = { tab?: string | null; fokus?: string };
export type DeepHref = (target: DeepHrefTarget) => string;

export const DeepLinks = createContext<DeepHref | null>(null);

export function useDeepHref(): DeepHref | null {
  return useContext(DeepLinks);
}

/** The address of a tab or sub-page on one case's deep analysis. */
export function deepHref(
  caseId: string,
  current: string | undefined,
  target: DeepHrefTarget,
): string {
  const tab = target.tab === undefined ? current : (target.tab ?? undefined);
  const query = new URLSearchParams({ view: "deep" });
  if (tab) query.set("spor", tab);
  if (target.fokus) query.set("fokus", target.fokus);
  return `/cases/${caseId}?${query.toString()}`;
}

/** A plain left click goes the app's own way; modified and middle clicks stay the browser's. */
export function plainClick(event: MouseEvent, go: () => void): void {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return;
  }
  event.preventDefault();
  go();
}
