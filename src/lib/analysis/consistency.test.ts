/** Test af konsistensmålingen. Kør: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeConsistency, type ScreeningRunScore } from "./consistency.ts";

const runs: ScreeningRunScore[] = [
  {
    runId: "a",
    configVersionId: "v1",
    completedAt: "2026-09-24T12:00:00Z",
    overallScore: 65.6,
    criterionScores: { team: 70, traction: 80 },
  },
  {
    runId: "b",
    configVersionId: "v1",
    completedAt: "2026-09-24T22:00:00Z",
    overallScore: 77.4,
    criterionScores: { team: 72, traction: 95 },
  },
  {
    runId: "c",
    configVersionId: "v1",
    completedAt: "2026-09-25T18:00:00Z",
    overallScore: 77.4,
    criterionScores: { team: 72, traction: 92 },
  },
  {
    runId: "d",
    configVersionId: "v2",
    completedAt: "2026-09-26T08:00:00Z",
    overallScore: 40,
    criterionScores: { team: 10 },
  },
];

test("kun kørsler med samme tese sammenlignes, ældste først", () => {
  const summary = summarizeConsistency(runs, "v1");
  assert.deepEqual(
    summary.runs.map((run) => run.runId),
    ["a", "b", "c"],
  );
  assert.equal(summary.spread, 11.8);
});

test("kriterier sorteres efter spredning, stabile udelades", () => {
  const summary = summarizeConsistency(runs, "v1");
  assert.deepEqual(summary.volatileCriteria, [
    { key: "traction", spread: 15 },
    { key: "team", spread: 2 },
  ]);
});

test("én kørsel giver ingen spredning", () => {
  const summary = summarizeConsistency(runs, "v2");
  assert.equal(summary.spread, null);
  assert.equal(summary.runs.length, 1);
});
