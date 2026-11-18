/**
 * Case-livscyklus: 4 faser + status, migration 0033.
 * Pure file (no server imports), so both UI and tests can use it.
 */
import { z } from "zod";
import type { Capability } from "@/lib/domain/workflow";
import type { MovementKind } from "@/lib/brain/movement";
import { translate, type MessageKey } from "../i18n/translate.ts";
import type { Language } from "../i18n/language.ts";

export type CasePhase = "screening" | "deep_analysis" | "committee" | "decided";
export type CaseStatus = "active" | "on_hold" | "closed" | "invested";

/** Dictionary keys for the phases and statuses; translate at render. */
export const casePhaseLabelKey: Record<CasePhase, MessageKey> = {
  screening: "cases.phase.screening",
  deep_analysis: "cases.phase.deep_analysis",
  committee: "cases.phase.committee",
  decided: "cases.phase.decided",
};

export const caseStatusLabelKey: Record<CaseStatus, MessageKey> = {
  active: "cases.status.active",
  on_hold: "cases.status.on_hold",
  closed: "cases.status.closed",
  invested: "cases.status.invested",
};

const labels = <K extends string>(keys: Record<K, MessageKey>, language: Language) =>
  Object.fromEntries(
    Object.entries(keys).map(([key, message]) => [key, translate(language, message as MessageKey)]),
  ) as Record<K, string>;

/** The phase and status words in a language (Danish by default). */
export const casePhaseLabels = (language: Language): Record<CasePhase, string> =>
  labels(casePhaseLabelKey, language);
export const caseStatusLabels = (language: Language): Record<CaseStatus, string> =>
  labels(caseStatusLabelKey, language);

/** Danish labels (kept for callers that do not know the language yet). */
export const casePhaseLabel: Record<CasePhase, string> = casePhaseLabels("da");
export const caseStatusLabel: Record<CaseStatus, string> = caseStatusLabels("da");

/**
 * The phase and status a page showed when the user acted. The server refuses to move a case that
 * has moved since, so a stale page cannot overwrite a newer state (harden F5/G3/G4).
 */
export const expectedCaseStateSchema = z.object({
  phase: z.enum(["screening", "deep_analysis", "committee", "decided"]),
  status: z.enum(["active", "on_hold", "closed", "invested"]),
});
export type ExpectedCaseState = z.infer<typeof expectedCaseStateSchema>;

/** True when the case is no longer in the state the page showed. */
export function movedSinceSeen(
  seen: ExpectedCaseState | undefined,
  current: { phase: CasePhase; status: CaseStatus },
): boolean {
  return seen !== undefined && (seen.phase !== current.phase || seen.status !== current.status);
}

/** "Afventer beslutning" is derived, never stored (01-datamodel §0033). */
export function isAwaitingDecision(phase: CasePhase, status: CaseStatus): boolean {
  return phase === "committee" && status === "active";
}

/** Nudge threshold: an active case without any action for 7 days or more. */
export const NUDGE_AFTER_DAYS = 7;

export function daysWithoutAction(lastActionAt: string, now: Date = new Date()): number {
  const elapsed = now.getTime() - new Date(lastActionAt).getTime();
  return Math.max(0, Math.floor(elapsed / 86_400_000));
}

export function needsNudge(status: CaseStatus, lastActionAt: string, now?: Date): boolean {
  return status === "active" && daysWithoutAction(lastActionAt, now) >= NUDGE_AFTER_DAYS;
}

/** What the split button, the bulk bar and the confirmation dialogs can ask for. */
export const caseTransitionActions = [
  "send_to_committee",
  "hold",
  "close",
  "invest",
  "reopen",
  "back_to_screening",
  /** "Genåbn i dyb analyse" (a decided case back into Dyb analyse, without a new run). */
  "reopen_in_deep_analysis",
] as const;
export type CaseTransitionAction = (typeof caseTransitionActions)[number];

export interface TransitionTarget {
  /** null = unchanged (reopen of a decided case returns to the phase before the decision). */
  phase: CasePhase | null;
  status: CaseStatus | null;
}

export function transitionTarget(action: CaseTransitionAction): TransitionTarget {
  switch (action) {
    case "send_to_committee":
      return { phase: "committee", status: "active" };
    case "hold":
      return { phase: null, status: "on_hold" };
    case "close":
      return { phase: "decided", status: "closed" };
    case "invest":
      return { phase: "decided", status: "invested" };
    case "reopen":
      return { phase: null, status: "active" };
    case "back_to_screening":
      return { phase: "screening", status: "active" };
    case "reopen_in_deep_analysis":
      return { phase: "deep_analysis", status: "active" };
  }
}

/**
 * The capability the server checks before the database's own check. Anything that enters or
 * leaves "Besluttet" is a decision (Medlem only with "Medlem må beslutte investeret/luk").
 */
export function requiredCapability(
  action: CaseTransitionAction,
  currentPhase: CasePhase,
): Capability {
  if (currentPhase === "decided" || transitionTarget(action).phase === "decided") {
    return "decide_case";
  }
  return "move_process_stage";
}

/** The movement the action becomes for this case (same rule as SQL brain_movement_kind). */
export function actionMovementKind(
  action: CaseTransitionAction,
  currentPhase: CasePhase,
  currentStatus: CaseStatus,
): MovementKind | null {
  switch (action) {
    case "send_to_committee":
      if (currentPhase === "committee" && currentStatus === "active") return null;
      if (currentStatus !== "active") return "reopen";
      return currentPhase === "screening" || currentPhase === "deep_analysis"
        ? "advance"
        : "system";
    case "hold":
      return currentStatus === "on_hold" ? null : "hold";
    case "close":
      if (currentStatus === "closed") return null;
      return currentPhase === "committee" ? "decline_ic" : "reject";
    case "invest":
      return currentStatus === "invested" ? null : "invest";
    case "reopen":
      return currentStatus === "active" ? null : "reopen";
    case "back_to_screening":
      // SQL logs the status change when the status changes, else the phase change.
      if (currentStatus !== "active") return "reopen";
      return currentPhase === "screening" ? null : "system";
    case "reopen_in_deep_analysis":
      if (currentStatus !== "active") return "reopen";
      if (currentPhase === "deep_analysis") return null;
      return currentPhase === "screening" ? "advance" : "system";
  }
}

/** At least one reason is required for these movements (Brain §2.3b). */
export function reasonRequired(kind: MovementKind | null): boolean {
  return kind === "hold" || kind === "reject" || kind === "decline_ic" || kind === "invest";
}

/**
 * A move the app refuses before the database is asked: holding a decided case would silently
 * undo the decision (the database allows it). Returns the reason (Danish by default), or null.
 */
export function appRefusal(
  action: CaseTransitionAction,
  currentPhase: CasePhase,
  language: Language = "da",
): string | null {
  if (action === "hold" && currentPhase === "decided") {
    return translate(language, "cases.refusal.holdDecided");
  }
  return null;
}
