/**
 * Corner cases from /harden (run 20260929-2217-4e3c4eb, findings S4-5 and S4-9).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { effectiveGateAnswers, type StoredGateAnswer } from "./gate-answers.ts";

const screenedAt = "2026-09-29T10:00:00.000Z";

// S4-5: a Lead overrides a failed binding gate (after the screening), then a Medlem answers
// "Opfyldt" on a second task for the same gate. The Medlem's answer is saved as a plain answer
// (currentGateVerdict is true because of the override), becomes "latest", is then filtered out
// (not an override, AI said false) - and the Lead's override disappears with it.
test("S4-5: a later plain 'Opfyldt' must not cancel an earlier Lead override", () => {
  const answers: StoredGateAnswer[] = [
    {
      gateKey: "ownership",
      passed: true,
      override: true,
      rationale: "Teamets svar: Bekræftet af partner efter møde",
      evidenceId: "ev-override",
      resolvedAt: "2026-09-29T10:05:00.000Z",
    },
    {
      gateKey: "ownership",
      passed: true,
      override: false,
      rationale: "Teamets svar: Opfyldt",
      evidenceId: "ev-member",
      resolvedAt: "2026-09-29T10:10:00.000Z",
    },
  ];
  const counted = effectiveGateAnswers(answers, {
    completedAt: screenedAt,
    verdicts: new Map([["ownership", false]]),
  });
  // Expected: the gate still counts as met (the override is still valid for this screening).
  // Actual on 4e3c4eb: [] -> the gate falls back to the AI's "false" and the case is blocked again.
  assert.equal(counted.length, 1);
  assert.equal(counted[0]?.passed, true);
});

// S4-9: an answer given under config v1 ("Ticket 1-5 mio.") is reused for a screening under
// config v2 where the same gate key now means "Ticket 0,5-2 mio." and the AI says unknown.
// The fixture carries configVersionId on both sides; the current function ignores it.
test("S4-9: an 'Opfyldt' given under another config version must not fill an unknown gate", () => {
  const answers = [
    {
      gateKey: "ticket_size",
      passed: true,
      override: false,
      rationale: "Teamets svar: Opfyldt",
      evidenceId: "ev-old",
      resolvedAt: "2026-09-01T09:00:00.000Z",
      configVersionId: "config-v1",
    },
  ] as unknown as StoredGateAnswer[];
  const counted = effectiveGateAnswers(answers, {
    completedAt: screenedAt,
    verdicts: new Map([["ticket_size", null]]),
    configVersionId: "config-v2",
  } as unknown as Parameters<typeof effectiveGateAnswers>[1]);
  // Expected: nothing counts until someone answers against the v2 definition.
  // Actual on 4e3c4eb: the v1 answer counts and the unknown gate is treated as met.
  assert.deepEqual(counted, []);
});

// Guard that must stay green after the fix (binding stop cannot be bought back).
test("guard: an override given before a newer screening does not count", () => {
  const counted = effectiveGateAnswers(
    [
      {
        gateKey: "ownership",
        passed: true,
        override: true,
        rationale: "x",
        evidenceId: null,
        resolvedAt: "2026-09-29T09:00:00.000Z",
      },
    ],
    { completedAt: screenedAt, verdicts: new Map([["ownership", false]]) },
  );
  assert.deepEqual(counted, []);
});
