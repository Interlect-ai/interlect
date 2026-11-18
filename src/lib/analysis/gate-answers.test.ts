/** Task-svar på et krav regner scoren igen i kode (0034). Kør: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { FundProfile } from "@/lib/funds/profiles";
import type { ScreeningOutput } from "./contracts";
import {
  applyGateAnswers,
  effectiveGateAnswers,
  gateAnswerFromTask,
  storedTeamGateAnswers,
  type StoredGateAnswer,
} from "./gate-answers.ts";
import { scoreScreening } from "./scoring.ts";

const profile = {
  id: "fund-test",
  version: "1",
  analysisThreshold: 60,
  criteria: [{ key: "team", label: "Team", weight: 100, category: "team" }],
  gates: [
    { key: "ownership", label: "Ejerandel mindst 10 %", treatment: "hard" },
    { key: "nordic", label: "Nordisk selskab", treatment: "review" },
  ],
} as unknown as FundProfile;

const output = {
  fundProfileId: "fund-test",
  fundProfileVersion: "1",
  proposedRecommendation: "go_forward",
  assessments: [
    { criterionKey: "team", proposedScore: 80, confidence: 0.8, citations: [{ evidenceId: "e1" }] },
  ],
  gates: [
    { gateKey: "ownership", passed: null, confidence: 0.2, rationale: "Ukendt.", evidenceIds: [] },
    { gateKey: "nordic", passed: true, confidence: 0.9, rationale: "Dansk.", evidenceIds: ["e1"] },
  ],
  risks: [],
} as unknown as ScreeningOutput;

test("before any answer the unknown binding gate holds the case back", () => {
  const result = scoreScreening(profile, output, "seed");
  assert.deepEqual(result.unresolvedGateKeys, ["ownership"]);
  assert.equal(result.outcome, "needs_information");
});

test("'Opfyldt' resolves the gate and the code score decides", () => {
  const answered = applyGateAnswers(output, [
    { gateKey: "ownership", passed: true, rationale: "Teamets svar: 12 %", evidenceId: "t1" },
  ]);
  const result = scoreScreening(profile, answered, "seed");
  assert.deepEqual(result.unresolvedGateKeys, []);
  assert.equal(result.outcome, "awaiting_approval");
  assert.equal(result.overallScore, 80);
  const gate = answered.gates.find((item) => item.gateKey === "ownership");
  assert.equal(gate?.confidence, 1);
  assert.deepEqual(gate?.evidenceIds, ["t1"]);
});

test("'Ikke opfyldt' on a binding gate blocks the case, whatever the score", () => {
  const answered = applyGateAnswers(output, [
    { gateKey: "ownership", passed: false, rationale: "Teamets svar: 4 %", evidenceId: null },
  ]);
  const result = scoreScreening(profile, answered, "seed");
  assert.deepEqual(result.failedHardGateKeys, ["ownership"]);
  assert.equal(result.outcome, "blocked");
});

test("an answer to a gate the AI did not assess is added", () => {
  const withoutGate = { ...output, gates: output.gates.slice(1) } as ScreeningOutput;
  const answered = applyGateAnswers(withoutGate, [
    { gateKey: "ownership", passed: true, rationale: "Teamets svar", evidenceId: null },
  ]);
  assert.equal(answered.gates.length, 2);
  assert.equal(answered.gates.find((item) => item.gateKey === "ownership")?.passed, true);
});

test("the stored AI answer is never changed", () => {
  applyGateAnswers(output, [
    { gateKey: "ownership", passed: false, rationale: "x", evidenceId: null },
  ]);
  assert.equal(output.gates[0]?.passed, null);
});

const screenedAt = "2026-09-29T12:00:00.000Z";
const stored = (overrides: Partial<StoredGateAnswer>): StoredGateAnswer => ({
  gateKey: "ownership",
  passed: true,
  rationale: "Teamets svar",
  evidenceId: null,
  resolvedAt: "2026-09-29T10:00:00.000Z",
  override: false,
  ...overrides,
});

test("the latest answer per gate wins", () => {
  const answers = effectiveGateAnswers(
    [
      stored({ passed: false, resolvedAt: "2026-09-29T09:00:00.000Z" }),
      stored({ passed: true, resolvedAt: "2026-09-29T11:00:00.000Z" }),
    ],
    { completedAt: screenedAt, verdicts: new Map([["ownership", null]]) },
  );
  assert.deepEqual(
    answers.map((answer) => answer.passed),
    [true],
  );
});

test("an older 'Opfyldt' does not overturn a breach a newer screening found", () => {
  const answers = effectiveGateAnswers([stored({ passed: true })], {
    completedAt: screenedAt,
    verdicts: new Map([["ownership", false]]),
  });
  assert.deepEqual(answers, []);
});

test("an override after the screening does overturn its breach; one before it does not", () => {
  const verdicts = new Map([["ownership", false]]);
  // Postgres returns "+00:00" timestamps; the comparison is by time, not by text.
  const after = effectiveGateAnswers(
    [stored({ override: true, resolvedAt: "2026-09-29T13:00:00.12+00:00" })],
    { completedAt: screenedAt, verdicts },
  );
  assert.equal(after.length, 1);
  const before = effectiveGateAnswers([stored({ override: true })], {
    completedAt: screenedAt,
    verdicts,
  });
  assert.equal(before.length, 0);
});

test("'Ikke opfyldt' always counts, and 'Opfyldt' clarifies an unknown or met gate", () => {
  const verdicts = new Map<string, boolean | null>([
    ["ownership", true],
    ["nordic", null],
  ]);
  const answers = effectiveGateAnswers(
    [stored({ passed: false }), stored({ gateKey: "nordic", passed: true })],
    { completedAt: screenedAt, verdicts },
  );
  assert.deepEqual(
    answers.map((answer) => [answer.gateKey, answer.passed]),
    [
      ["ownership", false],
      ["nordic", true],
    ],
  );
});

test("the team answers a run was scored with are read back from validation_result (harden G2)", () => {
  const stored = storedTeamGateAnswers({
    ok: true,
    teamGateAnswers: [
      {
        gateKey: "stage_fit",
        passed: false,
        rationale: "Teamets svar: Ikke opfyldt",
        evidenceId: "e1",
      },
      { gateKey: 42, passed: true },
      { gateKey: "ticket_fit", passed: "yes" },
    ],
  });
  assert.deepEqual(stored, [
    {
      gateKey: "stage_fit",
      passed: false,
      rationale: "Teamets svar: Ikke opfyldt",
      evidenceId: "e1",
    },
  ]);
  assert.deepEqual(storedTeamGateAnswers(null), []);
  assert.deepEqual(storedTeamGateAnswers({ ok: true }), []);
});

test("a resolved gate task becomes a stored answer the same way for the rescore and the case page", () => {
  const answer = gateAnswerFromTask({
    linked_key: "ticket_fit",
    answer_value: { gatePassed: true, override: true, configVersionId: "v4" },
    answer_text: "Første ticket passer",
    answer_evidence_id: "e1",
    resolved_at: "2026-09-30T10:00:00Z",
  });
  assert.deepEqual(answer, {
    gateKey: "ticket_fit",
    passed: true,
    rationale: "Teamets svar: Første ticket passer",
    evidenceId: "e1",
    resolvedAt: "2026-09-30T10:00:00Z",
    override: true,
    configVersionId: "v4",
  });
  assert.equal(
    gateAnswerFromTask({
      linked_key: "g",
      answer_value: { gatePassed: false },
      answer_text: null,
      answer_evidence_id: null,
      resolved_at: "2026-09-30T10:00:00Z",
    })?.rationale,
    "Teamets svar: Ikke opfyldt",
  );
  // No Opfyldt/Ikke opfyldt (a text answer) or no answer time: not a gate answer.
  assert.equal(
    gateAnswerFromTask({
      linked_key: "g",
      answer_value: {},
      answer_text: "x",
      answer_evidence_id: null,
      resolved_at: "2026-09-30T10:00:00Z",
    }),
    null,
  );
  assert.equal(
    gateAnswerFromTask({
      linked_key: "g",
      answer_value: { gatePassed: true },
      answer_text: null,
      answer_evidence_id: null,
      resolved_at: null,
    }),
    null,
  );
});
