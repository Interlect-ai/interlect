/**
 * Mirror of the SQL function public.brain_movement_kind (migration 0033, Brain §2.2).
 * npm run test:rls calls both with the same inputs and requires the same answer.
 * Pure file, so it can be tested with node --test.
 */

export type MovementKind =
  "advance" | "hold" | "reject" | "decline_ic" | "invest" | "reopen" | "system";

const PHASE_ORDER = ["screening", "deep_analysis", "committee", "decided"];

const LEGACY_STAGE_ORDER = [
  "new_case",
  "initial_screening",
  "preliminary_analysis",
  "partner_review",
  "ready_for_contact",
  "contacted",
  "first_meeting",
  "further_evaluation",
  "due_diligence",
  "investment_memo",
  "investment_committee",
];

/** Position like SQL array_position: null when missing (a comparison with null is false). */
function position(list: readonly string[], value: string | null): number | null {
  if (value === null) return null;
  const index = list.indexOf(value);
  return index === -1 ? null : index + 1;
}

function isForward(list: readonly string[], previous: string | null, next: string | null) {
  const from = position(list, previous);
  const to = position(list, next);
  return from !== null && to !== null && to > from;
}

export function movementKind(
  field: string,
  previous: string | null,
  next: string | null,
  fromPhase: string | null = null,
): MovementKind {
  if (field === "status") {
    if (next === "on_hold") return "hold";
    if (next === "closed") return fromPhase === "committee" ? "decline_ic" : "reject";
    if (next === "invested") return "invest";
    if (next === "active" && ["closed", "invested", "on_hold"].includes(previous ?? ""))
      return "reopen";
    return "system";
  }
  if (field === "phase") {
    return isForward(PHASE_ORDER, previous, next) ? "advance" : "system";
  }
  if (field === "process_stage") {
    if (next === "closed_without_investment")
      return previous === "investment_committee" ? "decline_ic" : "reject";
    if (next === "invested") return "invest";
    if (previous === "closed_without_investment") return "reopen";
    if (isForward(LEGACY_STAGE_ORDER, previous, next)) return "advance";
    if (previous === "further_evaluation" && next === "partner_review") return "advance";
    return "system";
  }
  if (field === "workspace_status") {
    if (next === "on_hold") return "hold";
    if (previous === "on_hold" && (next === "screening" || next === "deep_analysis"))
      return "reopen";
    if (previous === "screening" && next === "deep_analysis") return "advance";
    return "system";
  }
  return "system";
}

/** Every combination the parity check runs through both implementations. */
export function movementKindCases(): Array<[string, string | null, string | null, string | null]> {
  const statuses = ["active", "on_hold", "closed", "invested"];
  const phases = [...PHASE_ORDER];
  const workspace = ["screening", "deep_analysis", "on_hold", "archived"];
  const stages = [...LEGACY_STAGE_ORDER, "invested", "closed_without_investment"];
  const cases: Array<[string, string | null, string | null, string | null]> = [];
  for (const previous of statuses)
    for (const next of statuses)
      for (const fromPhase of [null, ...phases]) cases.push(["status", previous, next, fromPhase]);
  for (const previous of phases)
    for (const next of phases) cases.push(["phase", previous, next, null]);
  for (const previous of stages)
    for (const next of stages) cases.push(["process_stage", previous, next, null]);
  for (const previous of workspace)
    for (const next of workspace) cases.push(["workspace_status", previous, next, null]);
  cases.push(["execution_status", "queued", "complete", null]);
  cases.push(["process_stage", null, "new_case", null]);
  return cases;
}

/** Ids of the moves a later "Fortryd" cancelled: each undo row names its move in undo_of. */
export function undoneMoveIds(rows: readonly { undo_of: string | null }[]): Set<string> {
  return new Set(rows.map((row) => row.undo_of).filter((id): id is string => Boolean(id)));
}

/**
 * A move counts in Brain only when it is not an undo row and no undo cancelled it: an undone
 * move is no decision (same rule as brain_case_decisions and 0060 in SQL).
 */
export function isStandingMove(
  move: { id: string; undo_of: string | null },
  undone: ReadonlySet<string>,
): boolean {
  return !move.undo_of && !undone.has(move.id);
}
