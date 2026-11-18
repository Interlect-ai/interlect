import { test } from "node:test";
import assert from "node:assert/strict";
import { redactOverrides } from "./override-redaction.ts";
import { hasCapability } from "../domain/workflow.ts";

const config = {
  id: "c1",
  moduleOverrides: {
    people_team: { mandate: ["hemmelig"], evidenceTests: ["test"], riskAreas: ["risiko"] },
  },
  researchModuleOverrides: { "deep:team": { questions: ["Hvem er founders?"] } },
};

test("only Admin and Lead (configure_fund) keep the override texts", () => {
  for (const [roles, expected] of [
    [["admin"], true],
    [["lead"], true],
    [["member"], false],
    [["reader"], false],
  ] as const) {
    const can = hasCapability([...roles], "configure_fund", {
      memberCanDecide: false,
      memberCanPublish: false,
    });
    assert.equal(can, expected, roles.join());
    const out = redactOverrides(config, can);
    const json = JSON.stringify(out);
    assert.equal(json.includes("hemmelig") || json.includes("Hvem er founders"), expected);
  }
});

test("redaction keeps the keys so counts and badges still work", () => {
  const out = redactOverrides(config, false);
  assert.deepEqual(Object.keys(out.moduleOverrides), ["people_team"]);
  assert.deepEqual(Object.keys(out.researchModuleOverrides), ["deep:team"]);
  assert.equal(out.id, "c1");
  assert.equal(config.moduleOverrides.people_team.mandate[0], "hemmelig");
});

test("the fund's screening instruction is emptied like the overrides (T-861a)", () => {
  const withInstruction = { ...config, screeningInstruction: "Founders først." };
  assert.equal(redactOverrides(withInstruction, true).screeningInstruction, "Founders først.");
  assert.equal(redactOverrides(withInstruction, false).screeningInstruction, "");
  // A shape without the field gets none added.
  assert.equal("screeningInstruction" in redactOverrides(config, false), false);
});
