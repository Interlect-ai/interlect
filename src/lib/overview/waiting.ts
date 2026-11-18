/**
 * "Venter på jer" (Overblik v2, rule): which cases need a person now, and why. The
 * reason is worked out here, in code, from the case's real state (never written by an AI):
 *
 * - Komité, active: "Afventer komitéens beslutning i N dage" (since it entered Komité);
 * - Dyb analyse, finished: "Dyb analyse færdig, klar til vurdering";
 * - Screening, finished, at or over the threshold and not yet sent to a deep analysis:
 *   "Over tærsklen, klar til dyb analyse";
 * - any other active case with no action for 7 days or more: "Ingen handling i N dage".
 *
 * A case on hold, a decided case and a case with a run going do not wait for anyone. The split
 * button turns into the "nudge" variant when the case has been idle for 7 days or more,
 * whichever reason it has (the same rule as the Cases list).
 */
import {
  daysWithoutAction,
  needsNudge,
  type CasePhase,
  type CaseStatus,
} from "../cases/lifecycle.ts";
import { DEFAULT_LANGUAGE, type Language } from "../i18n/language.ts";
import { translate } from "../i18n/translate.ts";

export type WaitingKind = "committee" | "deep_ready" | "over_threshold" | "idle";
export type WaitingTone = "warning" | "ai" | "positive";

export interface WaitingFacts {
  phase: CasePhase;
  status: CaseStatus;
  lastActionAt: string;
  /** A screening or deep analysis is queued or running. */
  running: boolean;
  hasScreening: boolean;
  screeningScore: number | null;
  /** The latest screening can still be sent to a deep analysis. */
  canRunDeep: boolean;
  hasDeep: boolean;
  /** When the case last entered Komité (from the transition log), if known. */
  committeeSince: string | null;
}

export interface WaitingReason {
  kind: WaitingKind;
  text: string;
  tone: WaitingTone;
  /** Days the case has waited for this reason (committee) or been idle. */
  days: number;
  /** Lower is more serious; the list sorts by this, then by score. */
  rank: number;
  /** The split button's nudge variant: no action for 7 days or more. */
  nudge: boolean;
  idleDays: number;
}

/** "1 dag", "3 dage" in the language. */
export const dayWord = (days: number, language: Language = DEFAULT_LANGUAGE) =>
  translate(language, days === 1 ? "overview.days.one" : "overview.days.many", { count: days });

/**
 * The reason as text in the language. The snapshot carries it in Danish (built on the server);
 * the page writes it again from `kind` and `days` in the fund's language.
 */
export function waitingReasonText(
  reason: Pick<WaitingReason, "kind" | "days">,
  language: Language = DEFAULT_LANGUAGE,
): string {
  switch (reason.kind) {
    case "committee":
      return translate(language, "overview.waiting.committee", {
        days: dayWord(reason.days, language),
      });
    case "deep_ready":
      return translate(language, "overview.waiting.deepReady");
    case "over_threshold":
      return translate(language, "overview.waiting.overThreshold");
    case "idle":
      return translate(language, "overview.waiting.idle", {
        days: dayWord(reason.days, language),
      });
  }
}

export function waitingReason(
  facts: WaitingFacts,
  threshold: number,
  now: Date,
): WaitingReason | null {
  if (facts.status !== "active" || facts.phase === "decided" || facts.running) return null;
  const idleDays = daysWithoutAction(facts.lastActionAt, now);
  const nudge = needsNudge(facts.status, facts.lastActionAt, now);
  const base = { idleDays, nudge };
  if (facts.phase === "committee") {
    const days = daysWithoutAction(facts.committeeSince ?? facts.lastActionAt, now);
    return {
      kind: "committee",
      text: waitingReasonText({ kind: "committee", days }),
      tone: "warning",
      days,
      rank: 0,
      ...base,
    };
  }
  if (facts.phase === "deep_analysis" && facts.hasDeep) {
    return {
      kind: "deep_ready",
      text: waitingReasonText({ kind: "deep_ready", days: idleDays }),
      tone: "ai",
      days: idleDays,
      rank: 1,
      ...base,
    };
  }
  if (
    facts.phase === "screening" &&
    facts.hasScreening &&
    facts.canRunDeep &&
    facts.screeningScore !== null &&
    facts.screeningScore >= threshold
  ) {
    return {
      kind: "over_threshold",
      text: waitingReasonText({ kind: "over_threshold", days: idleDays }),
      tone: "positive",
      days: idleDays,
      rank: 2,
      ...base,
    };
  }
  if (nudge) {
    return {
      kind: "idle",
      text: waitingReasonText({ kind: "idle", days: idleDays }),
      tone: "warning",
      days: idleDays,
      rank: 3,
      ...base,
    };
  }
  return null;
}

/** Seriousness first, then the longest wait, then the highest score, then the name. */
export function compareWaiting(
  a: { reason: WaitingReason; score: number | null; name: string },
  b: { reason: WaitingReason; score: number | null; name: string },
): number {
  return (
    a.reason.rank - b.reason.rank ||
    b.reason.days - a.reason.days ||
    (b.score ?? -1) - (a.score ?? -1) ||
    a.name.localeCompare(b.name, "da")
  );
}
