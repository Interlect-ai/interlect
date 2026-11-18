/**
 * What a case's split button, its menu and the bulk bar offer ("Handlinger v2", Cases v4 and
 * CaseStatus). Pure: the list, the case top and tests share one rule set, so a
 * case offers the same next step everywhere. The server re-checks every action.
 */
// Type-only and relative imports: this file runs under `node --test` without a bundler.
import type { CasePhase, CaseStatus, CaseTransitionAction } from "./lifecycle";
import { translate } from "../i18n/translate.ts";
import type { Language } from "../i18n/language.ts";

/** "Afventer beslutning" (same rule as lifecycle.isAwaitingDecision). */
const isAwaitingDecision = (phase: CasePhase, status: CaseStatus) =>
  phase === "committee" && status === "active";

/** The confirmation dialogs with reason chips and a note (luk, hold, komité, beslutning). */
export type ReasonDialogKind = "hold" | "close" | "invest" | "committee" | "resume" | "reopen";

export type CaseCommand =
  | { kind: "transition"; action: CaseTransitionAction; dialog: ReasonDialogKind | null }
  | { kind: "run"; run: "screening" | "deep" }
  /** The left half of the split button opens the menu (decided cases: "Genåbn"). */
  | { kind: "menu" };

export type CaseActionId =
  | "runScreening"
  | "rerunScreening"
  | "backToScreening"
  | "reopenInScreening"
  | "runDeepAnalysis"
  | "rerunDeepAnalysis"
  | "reopenInDeepAnalysis"
  | "sendToCommittee"
  | "inCommittee"
  | "hold"
  | "resume"
  | "reopen"
  | "markInvested"
  | "close";

export interface CaseActionState {
  phase: CasePhase;
  status: CaseStatus;
  /** A finished screening exists (labels "Kør screening igen"). */
  hasScreening: boolean;
  /** The latest screening can be sent to a deep analysis (the server's rule). */
  canRunDeep: boolean;
  /** A deep analysis exists (Genåbn i dyb analyse has something to reopen). */
  hasDeep: boolean;
  /** A screening or deep analysis is queued or running. */
  running: boolean;
}

export interface CasePermissions {
  /** move_process_stage: hold, committee, back to screening. */
  canMove: boolean;
  /** decide_case: invest, close and anything leaving Besluttet. */
  canDecide: boolean;
  /** start_analysis + approve_deep_analysis: paid runs. */
  canRun: boolean;
}

export interface CaseMenuItem {
  id: CaseActionId;
  command: CaseCommand;
  recommended: boolean;
  /** The state the case is in now (dimmed with a check). */
  current: boolean;
  /** Why the item cannot be used now; null when it can. */
  blocked: string | null;
}

export interface CaseMenuGroup {
  heading: "phase" | "reopen" | "status" | "decision";
  items: CaseMenuItem[];
}

const decided = (state: CaseActionState) => state.phase === "decided";

/** The recommended next step (Cases v4 recOf, CaseStatus recK). */
export function recommendedAction(state: CaseActionState): CaseActionId | null {
  if (state.status === "on_hold") return "resume";
  if (decided(state)) return "reopen";
  if (state.phase === "screening") {
    if (state.canRunDeep) return "runDeepAnalysis";
    return state.hasScreening ? "rerunScreening" : "runScreening";
  }
  if (state.phase === "deep_analysis") return "sendToCommittee";
  return "markInvested";
}

export function commandFor(id: CaseActionId, surface: "list" | "top"): CaseCommand {
  switch (id) {
    case "runScreening":
    case "rerunScreening":
      return { kind: "run", run: "screening" };
    case "runDeepAnalysis":
    case "rerunDeepAnalysis":
      return { kind: "run", run: "deep" };
    case "backToScreening":
    case "reopenInScreening":
      return { kind: "transition", action: "back_to_screening", dialog: null };
    case "reopenInDeepAnalysis":
      return { kind: "transition", action: "reopen_in_deep_analysis", dialog: null };
    case "sendToCommittee":
      return { kind: "transition", action: "send_to_committee", dialog: "committee" };
    case "inCommittee":
      return { kind: "menu" };
    case "hold":
      return { kind: "transition", action: "hold", dialog: "hold" };
    // The list resumes and reopens directly with Fortryd (Cases v4); the case top asks why
    // (CaseStatus).
    case "resume":
      return { kind: "transition", action: "reopen", dialog: surface === "top" ? "resume" : null };
    case "reopen":
      return surface === "list"
        ? { kind: "menu" }
        : { kind: "transition", action: "reopen", dialog: "reopen" };
    case "markInvested":
      return { kind: "transition", action: "invest", dialog: "invest" };
    case "close":
      return { kind: "transition", action: "close", dialog: "close" };
  }
}

/** The left half of the split button; null while a run is going (the row shows the orb). */
export function primaryAction(
  state: CaseActionState,
  surface: "list" | "top",
): { id: CaseActionId; command: CaseCommand } | null {
  if (state.running && surface === "list") return null;
  const id = recommendedAction(state);
  if (!id) return null;
  // A decided case: "Genåbn" opens the menu, where the phase to reopen in is chosen.
  if (id === "reopen") return { id, command: { kind: "menu" } };
  return { id, command: commandFor(id, surface) };
}

/** The moves out of Besluttet in the Genåbn group (Cases v4, CaseStatus). */
const REOPEN_IDS: readonly CaseActionId[] = [
  "reopenInScreening",
  "reopenInDeepAnalysis",
  "sendToCommittee",
];

/**
 * Leaving Besluttet: the case top asks why (Case-status "Hver handling kræver en årsag", harden
 * G2); the list reopens at once with Fortryd, as it resumes (Cases v4), except
 * Send til komité, which always asks.
 */
function reopenCommand(id: CaseActionId, surface: "list" | "top"): CaseCommand {
  const command = commandFor(id, surface);
  if (surface === "top" && command.kind === "transition") return { ...command, dialog: "reopen" };
  return command;
}

function blockedReason(
  id: CaseActionId,
  state: CaseActionState,
  permissions: CasePermissions,
  language: Language,
): string | null {
  const t = (key: Parameters<typeof translate>[1]) => translate(language, key);
  const decision =
    id === "markInvested" ||
    id === "close" ||
    ((REOPEN_IDS.includes(id) || id === "reopen") && decided(state));
  if (decision && !permissions.canDecide) return t("cases.blocked.needsLeadOrAdmin");
  const run =
    id === "runScreening" ||
    id === "rerunScreening" ||
    id === "runDeepAnalysis" ||
    id === "rerunDeepAnalysis";
  if (run && !permissions.canRun) return t("cases.blocked.roleCannotRun");
  if (!run && !decision && !permissions.canMove) return t("cases.blocked.roleCannotMove");
  if (run && state.running) return t("cases.blocked.alreadyRunning");
  if ((id === "runDeepAnalysis" || id === "rerunDeepAnalysis") && !state.canRunDeep) {
    return state.hasScreening
      ? t("cases.blocked.rerunScreeningFirst")
      : t("cases.blocked.needsScreening");
  }
  if (id === "reopenInDeepAnalysis" && !state.hasDeep) return t("cases.blocked.noDeepYet");
  return null;
}

/** All actions, grouped as in the prototypes (Fase/Genåbn, Status, Beslutning). */
export function menuGroups(
  state: CaseActionState,
  permissions: CasePermissions,
  surface: "list" | "top",
  language: Language = "da",
): CaseMenuGroup[] {
  const recommended = recommendedAction(state);
  const isDecided = decided(state);
  const item = (id: CaseActionId, current = false): CaseMenuItem => ({
    id,
    command:
      isDecided && REOPEN_IDS.includes(id) ? reopenCommand(id, surface) : commandFor(id, surface),
    recommended: id === recommended && !current,
    current,
    blocked: current ? null : blockedReason(id, state, permissions, language),
  });
  // A decided case can go back to any phase, Komité included (both prototypes, harden G1).
  const phaseItems: CaseMenuItem[] = isDecided
    ? REOPEN_IDS.map((id) => item(id))
    : [
        state.phase === "screening"
          ? item(state.hasScreening ? "rerunScreening" : "runScreening")
          : item("backToScreening"),
        item(state.phase === "deep_analysis" ? "rerunDeepAnalysis" : "runDeepAnalysis"),
        state.phase === "committee" ? item("inCommittee", true) : item("sendToCommittee"),
      ];
  const groups: CaseMenuGroup[] = [{ heading: isDecided ? "reopen" : "phase", items: phaseItems }];
  if (!isDecided) {
    groups.push({
      heading: "status",
      items: [state.status === "on_hold" ? item("resume") : item("hold")],
    });
  }
  const decision: CaseMenuGroup = {
    heading: "decision",
    items: [
      item("markInvested", state.status === "invested"),
      item("close", state.status === "closed"),
    ],
  };
  // In Komité the status menu leads with the decision, "Marker som investeret" first (Status v2).
  if (surface === "top" && isAwaitingDecision(state.phase, state.status)) {
    return [decision, ...groups];
  }
  return [...groups, decision];
}

/** The status chip: "Afventer beslutning" is derived for an active case in Komité. */
export function statusChipKey(
  phase: CasePhase,
  status: CaseStatus,
): "active" | "on_hold" | "closed" | "invested" | "awaiting_decision" {
  return isAwaitingDecision(phase, status) ? "awaiting_decision" : status;
}

/** Bulk bar: which actions fit all selected cases (highlighted in coral). */
export function bulkHighlight(states: CaseActionState[]): {
  deep: boolean;
  committee: boolean;
} {
  const all = (phase: CasePhase) =>
    states.length > 0 && states.every((s) => s.phase === phase && s.status !== "on_hold");
  return {
    // A deep analysis needs a screening that can still be analysed on every selected case.
    deep: all("screening") && states.every((s) => s.canRunDeep && !s.running),
    committee: all("deep_analysis"),
  };
}

/** undo_case_transitions takes a Fortryd for 7 s after the batch's last write (0039). */
export const SERVER_UNDO_WINDOW_MS = 7_000;
/** The toast offers Fortryd for 5 s, and never for less than this. */
export const UNDO_TOAST_MS = 5_000;
export const MIN_UNDO_TOAST_MS = 1_500;

/**
 * How long the toast may offer Fortryd after a move whose request took `roundTripMs`: the
 * write happened before the answer came, and the undo itself needs time to reach the server,
 * so a slow answer shortens the toast instead of showing a Fortryd the server will refuse
 * (harden E1). null: too late to offer it at all.
 */
export function undoToastDuration(roundTripMs: number): number | null {
  const margin = Math.max(500, roundTripMs / 2);
  const left = Math.min(UNDO_TOAST_MS, SERVER_UNDO_WINDOW_MS - roundTripMs - margin);
  return left >= MIN_UNDO_TOAST_MS ? Math.round(left) : null;
}
