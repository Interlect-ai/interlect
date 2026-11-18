import { test } from "node:test";
import assert from "node:assert/strict";
import { isStandingMove, movementKind, undoneMoveIds } from "./movement.ts";

// Brain §2.2; the full parity with SQL brain_movement_kind runs in npm run test:rls.
test("status movements", () => {
  assert.equal(movementKind("status", "active", "on_hold", "screening"), "hold");
  assert.equal(movementKind("status", "active", "closed", "committee"), "decline_ic");
  assert.equal(movementKind("status", "active", "closed", "screening"), "reject");
  assert.equal(movementKind("status", "active", "invested", "committee"), "invest");
  assert.equal(movementKind("status", "closed", "active", "decided"), "reopen");
  assert.equal(movementKind("status", "on_hold", "active", "screening"), "reopen");
});

test("phase movements: forward is advance, backward is system", () => {
  assert.equal(movementKind("phase", "screening", "deep_analysis"), "advance");
  assert.equal(movementKind("phase", "deep_analysis", "committee"), "advance");
  assert.equal(movementKind("phase", "deep_analysis", "screening"), "system");
});

test("legacy fields keep their meaning (Brain §2.2)", () => {
  assert.equal(
    movementKind("process_stage", "investment_committee", "closed_without_investment"),
    "decline_ic",
  );
  assert.equal(movementKind("process_stage", "new_case", "closed_without_investment"), "reject");
  assert.equal(movementKind("process_stage", "investment_committee", "invested"), "invest");
  assert.equal(
    movementKind("process_stage", "closed_without_investment", "partner_review"),
    "reopen",
  );
  assert.equal(movementKind("process_stage", "further_evaluation", "partner_review"), "advance");
  assert.equal(movementKind("workspace_status", "screening", "deep_analysis"), "advance");
  assert.equal(movementKind("workspace_status", "deep_analysis", "on_hold"), "hold");
  assert.equal(movementKind("workspace_status", "on_hold", "screening"), "reopen");
  assert.equal(movementKind("workspace_status", "screening", "archived"), "system");
  assert.equal(movementKind("execution_status", "queued", "complete"), "system");
});

test("an undone move and the undo itself do not count (T-113)", () => {
  const moves = [
    { id: "reject", undo_of: null },
    { id: "undo-of-reject", undo_of: "reject" },
    { id: "hold", undo_of: null },
  ];
  const undone = undoneMoveIds(moves);
  assert.deepEqual([...undone], ["reject"]);
  assert.deepEqual(
    moves.filter((move) => isStandingMove(move, undone)).map((move) => move.id),
    ["hold"],
  );
  // The undo rows can come from a separate query (get_case only reads non-system moves).
  assert.equal(isStandingMove({ id: "reject", undo_of: null }, undoneMoveIds([])), true);
  assert.equal(
    isStandingMove({ id: "reject", undo_of: null }, undoneMoveIds([{ undo_of: "reject" }])),
    false,
  );
});
