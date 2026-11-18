import { test } from "node:test";
import assert from "node:assert/strict";
import {
  authorizeProcessStageChange,
  capabilitiesFor,
  hasCapability,
  type Capability,
} from "./workflow.ts";
import type { FundRole } from "./types.ts";

// Rettighedsmatrixen fra prototypen "Brugere og adgang".
// 1 = kan, 0 = kan ikke, 2 = Medlem kun når fonden har slået indstillingen til.
const matrix: Array<[string, Capability[], [number, number, number, number]]> = [
  ["Se cases og analyser", ["view_case"], [1, 1, 1, 1]],
  ["Skrive i Beskeder og noter", ["write_messages", "write_notes"], [1, 1, 1, 1]],
  ["Oprette cases og køre screening", ["create_case", "start_analysis"], [1, 1, 1, 0]],
  ["Løse og tildele tasks", ["manage_tasks"], [1, 1, 1, 0]],
  [
    "Køre dyb analyse og sende til komité",
    ["approve_deep_analysis", "move_process_stage"],
    [1, 1, 1, 0],
  ],
  ["Sætte på hold", ["move_process_stage"], [1, 1, 1, 0]],
  ["Beslutte: investeret eller luk", ["decide_case"], [1, 1, 2, 0]],
  ["Foreslå ændringer med Ret med AI", ["propose_fund_change"], [1, 1, 1, 0]],
  ["Redigere kladde", ["configure_fund"], [1, 1, 0, 0]],
  // Prototypen viser 0 for Medlem; indstillingen findes, standard fra.
  ["Udgive en ny version", ["publish_fund_config"], [1, 1, 2, 0]],
  ["Invitere og ændre roller", ["manage_users"], [1, 0, 0, 0]],
];

const roles: FundRole[] = ["admin", "lead", "member", "reader"];
const off = { memberCanDecide: false, memberCanPublish: false };
const on = { memberCanDecide: true, memberCanPublish: true };

for (const [label, capabilities, expected] of matrix) {
  test(`matrix: ${label}`, () => {
    roles.forEach((role, index) => {
      for (const capability of capabilities) {
        const cell = expected[index];
        assert.equal(
          hasCapability([role], capability, off),
          cell === 1,
          `${role} · ${capability} (indstilling fra)`,
        );
        assert.equal(
          hasCapability([role], capability, on),
          cell === 1 || cell === 2,
          `${role} · ${capability} (indstilling til)`,
        );
      }
    });
  });
}

test("settings default to off when omitted", () => {
  assert.equal(hasCapability(["member"], "decide_case"), false);
  assert.equal(hasCapability(["member"], "publish_fund_config"), false);
});

test("a setting never lifts Læser", () => {
  assert.equal(hasCapability(["reader"], "decide_case", on), false);
  assert.equal(hasCapability(["reader"], "publish_fund_config", on), false);
});

test("an unknown (old) role name grants nothing and does not throw", () => {
  const legacy = ["administrator"] as unknown as FundRole[];
  assert.equal(hasCapability(legacy, "view_case"), false);
  assert.deepEqual(capabilitiesFor(legacy), []);
});

test("several roles combine", () => {
  assert.equal(hasCapability(["reader", "lead"], "decide_case"), true);
});

test("capabilitiesFor lists exactly what hasCapability allows", () => {
  const member = capabilitiesFor(["member"], off);
  assert.ok(member.includes("manage_tasks"));
  assert.ok(!member.includes("decide_case"));
  assert.ok(capabilitiesFor(["member"], on).includes("decide_case"));
  assert.deepEqual(capabilitiesFor(["reader"]).sort(), [
    "view_case",
    "write_messages",
    "write_notes",
  ]);
});

test("a final decision needs decide_case, not just move_process_stage", () => {
  const request = {
    from: "investment_committee" as const,
    to: "invested" as const,
    actorType: "user" as const,
    reason: "Stærkt team",
  };
  assert.equal(authorizeProcessStageChange({ ...request, actorRoles: ["member"] }).allowed, false);
  assert.equal(
    authorizeProcessStageChange({ ...request, actorRoles: ["member"], fundSettings: on }).allowed,
    true,
  );
  assert.equal(authorizeProcessStageChange({ ...request, actorRoles: ["lead"] }).allowed, true);
});
