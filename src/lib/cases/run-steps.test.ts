import { test } from "node:test";
import assert from "node:assert/strict";
import { runStepName, runStepOrb, runStepTitle } from "./run-steps.ts";

test("a step of the fund's own specialist gets a Danish name, not its key (T-860)", () => {
  assert.equal(runStepName("custom_impact00001"), "Jeres egen specialist");
  assert.equal(runStepTitle("custom_impact00001"), "Analyse fra jeres egen specialist");
  assert.equal(runStepOrb("custom_impact00001"), "working");
  assert.equal(runStepName("people_team"), "Founders og team");
  assert.equal(runStepName("unknown_step"), "unknown step");
});
