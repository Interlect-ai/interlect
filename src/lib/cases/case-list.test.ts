import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCaseList,
  isCaseListPayload,
  type CaseListPayload,
  type CaseListPayloadCase,
  type CaseListProfile,
} from "./case-list.ts";

const profile: CaseListProfile = {
  threshold: 60,
  gates: [
    { key: "geo", treatment: "hard" },
    { key: "size", treatment: "review" },
  ],
  criteria: [
    { key: "team", label: "Team", category: "team", weight: 50 },
    { key: "market", label: "Marked", category: "market", weight: 50 },
  ],
};

function caseRow(overrides: Partial<CaseListPayloadCase>): CaseListPayloadCase {
  return {
    id: "case",
    primary_origin: "manual",
    process_stage: "initial_screening",
    workspace_status: "active",
    workspace_reason: null,
    phase: "screening",
    status: "active",
    last_action_at: "2026-10-18T10:00:00+00:00",
    updated_at: "2026-10-18T10:00:00+00:00",
    assignee_id: "ada",
    company_name: "Alfa ApS",
    website: null,
    stage: "seed",
    sector: null,
    geography: null,
    latest_run_id: null,
    screening_run_id: null,
    deep_run_id: null,
    screening_gates: null,
    screening_team_gate_answers: null,
    top_risk_level: null,
    source_count: 0,
    open_tasks: 0,
    ...overrides,
  } as CaseListPayloadCase;
}

function payload(overrides: Partial<CaseListPayload>): CaseListPayload {
  return {
    cases: [],
    runs: [],
    scores: [],
    trust: [],
    recalcs: [],
    steps: [],
    assignees: [],
    ...overrides,
  };
}

const run = (
  id: string,
  kind: string,
  status: string,
  score: number | null,
  previous: string | null = null,
) => ({
  id,
  case_id: "a",
  kind,
  status,
  previous_run_id: previous,
  recommendation: score === null ? null : "go_forward",
  overall_score: score,
  evidence_confidence: score === null ? null : 0.8,
});

// Newest first, as case_list_payload sends them.
const caseA = payload({
  cases: [
    caseRow({
      id: "a",
      latest_run_id: "running",
      screening_run_id: "screening",
      deep_run_id: "deep",
      screening_gates: [
        { gateKey: "geo", passed: false },
        { gateKey: "size", passed: true },
      ],
      screening_team_gate_answers: [{ gateKey: "geo", passed: true, rationale: "Teamet" }],
      top_risk_level: "critical",
      source_count: 3,
      open_tasks: 1,
    }),
  ],
  runs: [
    run("running", "screening", "running", null),
    run("deep", "deep", "complete", 80, "screening"),
    run("screening", "screening", "complete", 72),
    run("old", "screening", "complete", 70),
  ],
  scores: [
    { run_id: "screening", category: "market", validated_score: 40, weight: 50 },
    { run_id: "screening", category: "team", validated_score: 60, weight: 50 },
    { run_id: "deep", category: "team", validated_score: null, weight: 100 },
  ],
  trust: [
    {
      run_id: "screening",
      verified: 1,
      corroborated: 0,
      company_stated: 0,
      contradictory: 0,
      unknown: 1,
    },
  ],
  recalcs: [{ run_id: "screening", overall_score: 65, failed_gate_keys: [] }],
  steps: [
    { run_id: "running", step_key: "cvr_financials", status: "complete" },
    { run_id: "running", step_key: "research", status: "running" },
    { run_id: "running", step_key: "score", status: "queued" },
  ],
  assignees: [{ id: "ada", full_name: "Ada Admin" }],
});

test("a case with a running screening, a finished screening and a deep analysis", () => {
  const [item] = buildCaseList(caseA, profile);
  assert.ok(item);
  assert.equal(item.executionStatus, "screening_in_progress");
  assert.equal(item.activeRunKind, "screening");
  assert.equal(item.activeStepKey, "research");
  assert.equal(item.activeStepsCompleted, 1);
  assert.equal(item.activeStepsTotal, 3);
  assert.deepEqual(item.fitHistory, [70, 72, 80]);
  // The running screening has no score yet, so the deep analysis' specialists give the fit; an
  // unscored specialist counts with the stage's prior (seed = 45).
  assert.equal(item.fitScore, 45);
  assert.equal(item.hasDeepAnalysis, true);
  assert.equal(item.topRiskLevel, "critical");
  assert.equal(item.sourceCount, 3);
  assert.equal(item.openTasks, 1);
  assert.equal(item.assigneeName, "Ada Admin");
});

test("the screening's scores follow the profile's order and its recalculation", () => {
  const [item] = buildCaseList(caseA, profile);
  assert.deepEqual(
    item?.screeningScores.map((score) => [score.label, score.score]),
    [
      ["Team", 60],
      ["Marked", 40],
    ],
  );
  assert.equal(item?.screeningScore, 65);
  assert.equal(item?.screeningConfidence, 0.8);
  assert.equal(item?.screeningRecommendation, "go_forward");
});

test("the team's answer overrides the AI's gate assessment", () => {
  const [item] = buildCaseList(caseA, profile);
  assert.equal(item?.gatePassed, 2);
  assert.equal(item?.gateTotal, 2);
  assert.deepEqual(item?.gateMarks, ["passed", "passed"]);
  assert.equal(item?.mandateBreach, false);
});

test("a screening already sent to deep analysis cannot be sent again", () => {
  const [item] = buildCaseList(caseA, profile);
  assert.equal(item?.canRunDeep, false);
});

test("a finished screening with a breached binding gate and no deep analysis", () => {
  const [item] = buildCaseList(
    payload({
      cases: [
        caseRow({
          id: "a",
          latest_run_id: "screening",
          screening_run_id: "screening",
          screening_gates: [
            { gateKey: "geo", passed: false },
            { gateKey: "size", passed: "yes" },
            { passed: true },
          ],
        }),
      ],
      runs: [run("screening", "screening", "complete", 50)],
    }),
    profile,
  );
  assert.equal(item?.executionStatus, "screening_complete");
  assert.equal(item?.fitScore, 50);
  // A gate without a key still counts; a non-boolean answer is not a breach but unknown.
  assert.equal(item?.gateTotal, 3);
  assert.equal(item?.gatePassed, 1);
  assert.deepEqual(item?.gateMarks, ["hard_breach", "unknown"]);
  assert.equal(item?.mandateBreach, true);
  assert.equal(item?.canRunDeep, true);
});

test("a recalculation that clears the gates lifts the breach", () => {
  const [item] = buildCaseList(
    payload({
      cases: [
        caseRow({
          id: "a",
          latest_run_id: "screening",
          screening_run_id: "screening",
          screening_gates: [{ gateKey: "geo", passed: false }],
        }),
      ],
      runs: [run("screening", "screening", "complete", 50)],
      recalcs: [{ run_id: "screening", overall_score: null, failed_gate_keys: null }],
    }),
    profile,
  );
  assert.equal(item?.mandateBreach, false);
  assert.equal(item?.screeningScore, null);
});

test("a deep analysis in progress has no fit yet", () => {
  const [item] = buildCaseList(
    payload({
      cases: [caseRow({ id: "a", latest_run_id: "deep", screening_run_id: "screening" })],
      runs: [
        run("deep", "deep", "running", null, "screening"),
        run("screening", "screening", "complete", 70),
      ],
    }),
    profile,
  );
  assert.equal(item?.executionStatus, "deep_analysis_in_progress");
  assert.equal(item?.fitScore, null);
  assert.equal(item?.activeRunKind, "deep");
  assert.equal(item?.canRunDeep, false);
});

test("a case without runs and without a company name", () => {
  const [item] = buildCaseList(
    payload({ cases: [caseRow({ id: "b", company_name: null, stage: null })] }),
    profile,
  );
  assert.equal(item?.companyName, "Ukendt selskab");
  assert.equal(item?.stage, "unknown");
  assert.equal(item?.executionStatus, "needs_information");
  assert.equal(item?.fitScore, null);
  assert.deepEqual(item?.fitHistory, []);
  assert.equal(item?.gateMarks, null);
  assert.equal(item?.canRunDeep, false);
  assert.equal(item?.mandateBreach, false);
  assert.equal(item?.assigneeName, null);
  assert.equal(item?.phaseIndex, 2);
});

test("the cases keep the database's order", () => {
  const list = buildCaseList(
    payload({ cases: [caseRow({ id: "newest" }), caseRow({ id: "older" })] }),
    profile,
  );
  assert.deepEqual(
    list.map((item) => item.id),
    ["newest", "older"],
  );
});

test("only a whole payload is accepted", () => {
  assert.equal(isCaseListPayload(payload({})), true);
  assert.equal(isCaseListPayload(null), false);
  assert.equal(isCaseListPayload("[]"), false);
  const withoutSteps: Record<string, unknown> = { ...payload({}) };
  delete withoutSteps["steps"];
  assert.equal(isCaseListPayload(withoutSteps), false);
});

test("a screening made with an older setup version is shown and marked (T-957)", () => {
  const older = {
    ...run("s-old", "screening", "complete", 58),
    config_version_id: "v1",
    setup_version: 1,
  };
  const [item] = buildCaseList(
    payload({
      cases: [caseRow({ id: "a", latest_run_id: "s-old", screening_run_id: "s-old" })],
      runs: [older],
      scores: [
        { run_id: "s-old", category: "team", label: "Team (v1)", validated_score: 58, weight: 100 },
      ],
    }),
    { ...profile, configId: "v2" },
  );
  assert.equal(item!.screeningScore, 58);
  assert.equal(item!.olderSetup, true);
  assert.equal(item!.olderSetupVersion, 1);
  assert.equal(item!.screeningScores[0]!.label, "Team (v1)");
  assert.equal(item!.gateMarks, null);
  assert.equal(item!.mandateBreach, false);
  assert.deepEqual(item!.fitHistory, []);
  // The server only sends a screening of the active setup on to a deep analysis.
  assert.equal(item!.canRunDeep, false);

  const [current] = buildCaseList(
    payload({
      cases: [caseRow({ id: "a", latest_run_id: "s-old", screening_run_id: "s-old" })],
      runs: [{ ...older, config_version_id: "v2", setup_version: 2 }],
    }),
    { ...profile, configId: "v2" },
  );
  assert.equal(current!.olderSetup, false);
  assert.equal(current!.olderSetupVersion, null);
  assert.equal(current!.canRunDeep, true);
});

test("T-1094: a setup per stage marks each case with its own stage's gates and threshold", () => {
  const calls: Array<[string | null | undefined, string | null]> = [];
  const staged: CaseListProfile = {
    ...profile,
    forStage: (caseStage, runChoice) => {
      calls.push([caseStage, runChoice?.stage ?? null]);
      // The seed stage has its own binding rule "seed_rev"; every other stage reads the shared.
      return (runChoice?.stage ?? caseStage) === "seed"
        ? {
            threshold: 55,
            gates: [
              { key: "geo", treatment: "review" },
              { key: "seed_rev", treatment: "hard" },
            ],
            criteria: profile.criteria,
          }
        : { threshold: 60, gates: profile.gates, criteria: profile.criteria };
    },
  };
  const [seedCase, laterCase] = buildCaseList(
    payload({
      cases: [
        caseRow({
          id: "seed",
          stage: "unknown",
          screening_run_id: "s1",
          screening_gates: [
            { gateKey: "geo", passed: false },
            { gateKey: "seed_rev", passed: false },
          ],
          // The screening assumed seed (the case's stage was unknown).
          screening_setup_stage: {
            stage: "seed",
            caseStage: null,
            reason: "unknown",
            assumed: true,
          },
        }),
        caseRow({
          id: "later",
          stage: "series_a",
          screening_run_id: "s2",
          screening_gates: [{ gateKey: "geo", passed: false }],
        }),
      ],
      runs: [
        { ...run("s1", "screening", "complete", 70), case_id: "seed" },
        { ...run("s2", "screening", "complete", 70), case_id: "later" },
      ],
    }),
    staged,
  );
  assert.deepEqual(calls, [
    ["unknown", "seed"],
    ["series_a", null],
  ]);
  assert.equal(seedCase?.threshold, 55);
  assert.deepEqual(seedCase?.gateMarks, ["review_breach", "hard_breach"]);
  assert.equal(seedCase?.mandateBreach, true);
  assert.equal(laterCase?.threshold, 60);
  assert.deepEqual(laterCase?.gateMarks, ["hard_breach", "unknown"]);
});
