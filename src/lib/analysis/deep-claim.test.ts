import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decideStepClaim, MAX_STEP_ATTEMPTS } from "./deep-claim.ts";
import { PARTIAL_TEXT_MAX_CHARS, STEP_STALE_AFTER_MS } from "./deep-text-rules.ts";
import { SYNTHESIS_NEXT_STEPS } from "./deep-text-rules.ts";

const now = Date.parse("2026-10-01T12:00:00Z");
const ago = (ms: number) => new Date(now - ms).toISOString();

test("a queued step is claimed; a fresh running step is busy (#13)", () => {
  assert.equal(
    decideStepClaim(
      { status: "queued", attempt_count: 0, started_at: null },
      now,
      STEP_STALE_AFTER_MS,
    ),
    "claim",
  );
  assert.equal(
    decideStepClaim(
      { status: "running", attempt_count: 1, started_at: ago(60_000) },
      now,
      STEP_STALE_AFTER_MS,
    ),
    "busy",
  );
  assert.equal(
    decideStepClaim(
      { status: "complete", attempt_count: 1, started_at: ago(1e9) },
      now,
      STEP_STALE_AFTER_MS,
    ),
    "busy",
  );
});

test("a stale step is taken over once; after that the run fails instead of paying again (#13)", () => {
  const stale = (attempts: number) => ({
    status: "running",
    attempt_count: attempts,
    started_at: ago(STEP_STALE_AFTER_MS + 1_000),
  });
  assert.equal(decideStepClaim(stale(1), now, STEP_STALE_AFTER_MS), "claim");
  assert.equal(
    decideStepClaim(stale(MAX_STEP_ATTEMPTS), now, STEP_STALE_AFTER_MS),
    "attempts_exhausted",
  );
  assert.ok(MAX_STEP_ATTEMPTS <= 2);
});

test("member-readable step rows hold no raw model text beyond a short start (#12)", () => {
  assert.ok(PARTIAL_TEXT_MAX_CHARS <= 2_000);
  const worker = readFileSync(new URL("./deep-worker.server.ts", import.meta.url), "utf8");
  const block = /qualityRejected: true,[\s\S]*?\.eq\("run_id"/.exec(worker)?.[0] ?? "";
  assert.ok(block.includes("outputSha256") && block.includes("outputLength"));
  assert.doesNotMatch(block, /\n\s+output,\n/);
  const deep = readFileSync(new URL("./deep.functions.ts", import.meta.url), "utf8");
  assert.match(deep, /partialText: completion\.content\.slice\(0, PARTIAL_TEXT_MAX_CHARS\)/);
});

test("the contract limit for next steps equals the JSON schema limit (#14)", async () => {
  const { deepAnalysisOutputSchema } = await import("./deep.contracts.ts");
  const step = { title: "t", kind: "task", priority: 1 };
  const base = {
    schemaVersion: "interlect-deep-v1",
    fundProfileId: "p",
    fundProfileVersion: "1",
    caseId: "c",
    assessments: [],
    gates: [],
    risks: [
      {
        riskKey: "r",
        label: "R",
        level: "high",
        likelihood: 3,
        impact: 3,
        rationale: "x".repeat(700),
        evidenceIds: [],
        mitigation: "y".repeat(200),
      },
    ],
    strengths: [],
    weaknesses: [],
    openQuestions: [],
    overallAssessment: "S",
    contraryCase: "M",
    proposedRecommendation: "follow",
    findings: [],
    financialInputs: [],
  };
  const many = (n: number) => Array.from({ length: n }, () => step);
  assert.ok(
    deepAnalysisOutputSchema.safeParse({ ...base, nextSteps: many(SYNTHESIS_NEXT_STEPS.maxItems) })
      .success,
  );
  assert.equal(
    deepAnalysisOutputSchema.safeParse({
      ...base,
      nextSteps: many(SYNTHESIS_NEXT_STEPS.maxItems + 1),
    }).success,
    false,
  );
});

test("a failed step fails the run, never answered busy and never paid again (T-741 a)", () => {
  for (const attempts of [1, MAX_STEP_ATTEMPTS]) {
    assert.equal(
      decideStepClaim(
        { status: "failed", attempt_count: attempts, started_at: ago(60_000) },
        now,
        STEP_STALE_AFTER_MS,
      ),
      "step_failed",
    );
  }
});

test("the deep worker cannot hang or revive a finished run (T-741 a-d)", () => {
  const worker = readFileSync(new URL("./deep-worker.server.ts", import.meta.url), "utf8");
  // a: a failed specialist is seen before "busy".
  const phaseEnd = worker.slice(worker.indexOf("A failure is looked at before"));
  assert.ok(phaseEnd.indexOf("if (failed) throw") < phaseEnd.indexOf("result.busy"));
  // c: only a queued or running run is marked active; otherwise the delivery is ignored.
  const active = worker.slice(worker.indexOf("async function markRunActive"));
  assert.match(active.slice(0, 900), /\.in\("status", \["queued", "running"\]\)/);
  assert.match(worker, /if \(!\(await markRunActive\(context\)\)\) return "ignored";/);
  // d: a second attempt clears the run's earlier rows before it saves.
  const persist = worker.slice(worker.indexOf("async function persistDeepAnalysis"));
  assert.ok(persist.indexOf("clearPersistedDeepRows") < persist.indexOf('from("category_scores")'));
  // A late delivery never fails a run that already failed or was released (review).
  const fail = worker.slice(worker.indexOf("async function failDeepRun"));
  assert.ok(fail.indexOf("if (!failed) return;") < fail.indexOf("returnFailedDeepCaseToScreening"));
  // b: the completion is checked.
  assert.match(worker, /runWrite\.error \|\| !runWrite\.data\?\.length/);
});
