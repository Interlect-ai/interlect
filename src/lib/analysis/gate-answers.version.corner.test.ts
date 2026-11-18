/**
 * Corner cases from /harden round 2 (run 20260929-2347-6b208a8, finding S4R2-1):
 * gate answers across fund setup versions.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { effectiveGateAnswers, type StoredGateAnswer } from "./gate-answers.ts";
import { buildAiTasks } from "../cases/tasks.ts";

// The same binding gate in v1 and v2: the Admin only changed weights when publishing v2.
const GATE = { key: "stage_fit", label: "Stadie passer til fonden" };
const aiTaskSource = (unresolvedGateKeys: string[]) => ({
  gates: [GATE],
  criteria: [],
  unresolvedGateKeys,
  missingCriterionKeys: [],
  assessments: [],
  openQuestions: [],
});

// A Lead answered the AI task "Afklar: ..." from the v1 screening with "Ikke opfyldt".
const leadBreachV1: StoredGateAnswer = {
  gateKey: GATE.key,
  passed: false,
  override: false,
  rationale: "Teamets svar: Ikke opfyldt · Selskabet er i growth, fonden investerer kun pre-seed",
  evidenceId: "ev-lead",
  resolvedAt: "2026-09-29T10:05:00.000Z",
  configVersionId: "v1",
};

const rescreenUnderV2 = (aiVerdict: boolean | null) => ({
  completedAt: "2026-09-30T09:00:00.000Z",
  verdicts: new Map<string, boolean | null>([[GATE.key, aiVerdict]]),
  configVersionId: "v2",
});

// S4R2-1a. The rescreen the product offers after every publish (RescreenPanel) drops the team's
// breach (answer tied to v1), and the AI task that would ask again has the same dedupe key as
// the v1 task, so upsert(ignoreDuplicates) writes nothing. The breach disappears without a trace.
test("S4R2-1a: a team breach survives publish v2 + rescreen, or the team is asked again", () => {
  const v1TaskKeys = new Set(buildAiTasks(aiTaskSource([GATE.key])).map((task) => task.dedupeKey));

  const counted = effectiveGateAnswers([leadBreachV1], rescreenUnderV2(null));
  const breachStillCounts = counted.some((a) => a.gateKey === GATE.key && a.passed === false);

  const v2Tasks = buildAiTasks(aiTaskSource(breachStillCounts ? [] : [GATE.key]));
  const askedAgain = v2Tasks.some(
    (task) => task.linkedKey === GATE.key && !v1TaskKeys.has(task.dedupeKey),
  );

  // Actual on 6b208a8: counted = [] and the v2 task key equals the v1 key -> both false.
  assert.ok(
    breachStillCounts || askedAgain,
    "the Lead's 'Ikke opfyldt' neither counts under v2 nor produces a new task for the gate",
  );
});

// S4R2-1a (variant). The v2 AI now says "passed": the team's recorded breach is replaced by
// the AI verdict and no task is created at all (the gate is not unresolved). Principle 4/5.
test("S4R2-1a': a new AI 'passed' under v2 does not silently replace the team's breach", () => {
  const counted = effectiveGateAnswers([leadBreachV1], rescreenUnderV2(true));
  assert.ok(
    counted.some((a) => a.gateKey === GATE.key && a.passed === false),
    "the binding breach recorded by the team is hidden behind the new AI verdict",
  );
});

// S4R2-1b. answerCaseTask asks currentGateVerdict (= effectiveGateAnswers against the latest
// finished screening, else the AI verdict) and only demands override_mandate_gate when the
// verdict is false. After v2, the v1 breach no longer counts, the verdict is the AI's "unknown",
// and a Medlem's plain "Opfyldt" (on a new task linked to the gate) is accepted: no override
// right, no audit event, and the case is unblocked.
test("S4R2-1b: after a publish, the team's breach still makes the gate 'not met' for the next answer", () => {
  const aiVerdictV2: boolean | null = null;
  const verdict =
    effectiveGateAnswers([leadBreachV1], rescreenUnderV2(aiVerdictV2))[0]?.passed ?? aiVerdictV2;
  // Actual on 6b208a8: null -> a Medlem can answer "Opfyldt" without the override right.
  assert.equal(verdict, false);
});

// S4R2-1c. Answers saved before 0039 carry no configVersionId and 0039 does not backfill it,
// so every existing team gate answer on staging stops counting the day 0039 runs.
test("S4R2-1c: a gate answer saved before 0039 (no version) still counts for its own screening", () => {
  const legacy = { ...leadBreachV1, configVersionId: null };
  const counted = effectiveGateAnswers([legacy], {
    completedAt: "2026-09-29T10:00:00.000Z",
    verdicts: new Map([[GATE.key, null]]),
    configVersionId: "v1",
  });
  // Actual on 6b208a8: [] (needs a backfill in 0039 or "null counts for the version active then").
  assert.equal(counted.length, 1);
});
