/**
 * (spor B4, spec B.1 punkt 4, B.4 test 3): a run that reaches its limit stops nicely, what is
 * finished stays on its steps, and the next try pays only for what is missing.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertActualSpendWithinBudget,
  assertWithinBudget,
  BudgetExceededError,
  BudgetLimitError,
  stopReasonOf,
} from "./budgets.ts";
import { ResearchFailedError } from "./gateway-response.ts";
import { reusedResearchOutput, stoppedResearchToReuse } from "./screening-phases.ts";

const read = (file: string) => readFileSync(resolve("src/lib/analysis", file), "utf8");
const ESTIMATE = { maxCostUsd: 0.2, maxInputTokens: 100, maxOutputTokens: 100 };

test("a call over its limit is a stop at the limit, also through what wraps it", () => {
  assert.throws(() => assertWithinBudget(ESTIMATE, 0.1, "kald", "da"), BudgetExceededError);
  assert.throws(() => assertActualSpendWithinBudget(0.2, 0.1, "kald", "da"), BudgetLimitError);
  const stop = new BudgetExceededError("stop");
  assert.equal(stopReasonOf(stop), "price_limit");
  assert.equal(stopReasonOf(new ResearchFailedError(stop, 0.05)), "price_limit");
  assert.equal(stopReasonOf(new Error("wrapped", { cause: stop })), "price_limit");
  // Any other failure is not a stop at the limit.
  assert.equal(stopReasonOf(new Error("timeout")), null);
  assert.equal(stopReasonOf(new ResearchFailedError(new Error("x"), 0.05)), null);
  assert.equal(stopReasonOf("text"), null);
  assert.equal(stopReasonOf(null), null);
});

const NOW = Date.parse("2026-11-02T12:00:00Z");
const STOPPED_RUN = {
  status: "failed",
  stop_reason: "price_limit",
  config_version_id: "c1",
  prompt_template_version: "p1",
  input_evidence_ids: ["e1", "e2"],
  completed_at: "2026-11-02T11:00:00Z",
};
const FINISHED_STEP = {
  status: "complete",
  output_json: { researchChargeUsd: 0.2, x: 1 },
  prompt_version: "r1",
  model_name: "m1",
};
const CURRENT = {
  configVersionId: "c1",
  promptVersion: "p1",
  researchVersion: "r1",
  researchModel: "m1",
  newerMaterial: false,
  now: NOW,
};

test("the research of a run that stopped at its limit is taken over", () => {
  assert.deepEqual(stoppedResearchToReuse(STOPPED_RUN, FINISHED_STEP, CURRENT), {
    output: FINISHED_STEP.output_json,
    evidenceIds: ["e1", "e2"],
  });
});

test("anything else runs the research again: other failures, other setups, unfinished research", () => {
  const reuse = (run: object, step: object | null = FINISHED_STEP) =>
    stoppedResearchToReuse({ ...STOPPED_RUN, ...run }, step, CURRENT);
  assert.equal(reuse({ stop_reason: null }), null);
  assert.equal(reuse({ status: "complete" }), null);
  assert.equal(reuse({ status: "cancelled" }), null);
  assert.equal(reuse({ config_version_id: "c2" }), null);
  assert.equal(reuse({ prompt_template_version: "p2" }), null);
  assert.equal(reuse({ input_evidence_ids: [] }), null);
  assert.equal(reuse({ input_evidence_ids: null }), null);
  assert.equal(reuse({ completed_at: null }), null);
  assert.equal(reuse({}, null), null);
  assert.equal(reuse({}, { ...FINISHED_STEP, status: "failed" }), null);
  assert.equal(reuse({}, { ...FINISHED_STEP, output_json: { x: 1 } }), null);
  // Another research version or model: its output would be labelled as this one.
  assert.equal(reuse({}, { ...FINISHED_STEP, prompt_version: "r0" }), null);
  assert.equal(reuse({}, { ...FINISHED_STEP, model_name: "m0" }), null);
});

test("a deck or a note added after the stop, or old research, runs the research again", () => {
  const withCurrent = (change: object) =>
    stoppedResearchToReuse(STOPPED_RUN, FINISHED_STEP, { ...CURRENT, ...change });
  assert.equal(withCurrent({ newerMaterial: true }), null);
  assert.notEqual(withCurrent({ now: NOW + 6 * 24 * 60 * 60 * 1000 }), null);
  assert.equal(withCurrent({ now: NOW + 8 * 24 * 60 * 60 * 1000 }), null);
  const loader = read("screening-analysis.server.ts");
  assert.match(loader, /\.from\("evidence_items"\)[\s\S]{0,160}\.gt\("collected_at", stoppedAt\)/);
  assert.match(loader, /\.from\("documents"\)[\s\S]{0,160}\.gt\("created_at", stoppedAt\)/);
});

test("the next try keeps the research for free, and a failed deck reading counts only once", () => {
  assert.deepEqual(reusedResearchOutput({ researchChargeUsd: 0.2, deckOcr: null, x: 1 }), {
    researchChargeUsd: 0,
    deckOcr: null,
    x: 1,
  });
  assert.deepEqual(
    reusedResearchOutput({
      researchChargeUsd: 0.2,
      deckOcr: { callFailed: true, status: "failed" },
    }),
    { researchChargeUsd: 0, deckOcr: { callFailed: false, status: "failed" } },
  );
});

test("a stop stays a stop through the screening's gateway error", () => {
  const source = read("screening.functions.ts");
  const start = source.indexOf('"Screeningens fondsfit-analyse",\n      requestLanguage(),');
  assert.ok(start >= 0);
  assert.match(source.slice(start, start + 400), /failure\.cause = cause;/);
});

test("the next try's research step costs nothing, and the analysis reads it as handed over", () => {
  const source = read("screening.functions.ts");
  const start = source.indexOf("if (stoppedResearch) {");
  const block = source.slice(start, source.indexOf("return true;", start));
  assert.ok(start >= 0);
  assert.match(block, /actual_cost: 0,/);
  assert.match(block, /charged_cost: 0,/);
  assert.match(block, /output_json: reusedResearchOutput\(stoppedResearch\.output\)/);
  assert.match(block, /input_evidence_ids: stoppedResearch\.evidenceIds/);
  assert.match(block, /dispatchScreeningAnalysis\(runId\)/);
  assert.doesNotMatch(block, /collectPublicCompanyResearch/);
  // It comes before any research is paid, and only after the run is marked as running.
  assert.ok(start < source.indexOf("await collectPublicCompanyResearch("));
  assert.ok(source.indexOf('.update({ status: "running", started_at: startedAt })') < start);
});

test("both paths mark the stop on the run; only a stop, never a real error beside it", () => {
  const screening = read("screening-analysis.server.ts");
  assert.match(screening, /stop_reason: stopReasonOf\(input\.cause\),/);
  const worker = read("deep-worker.server.ts");
  assert.match(worker, /stop_reason: stopReason,/);
  assert.match(worker, /failedStepChargeUsd\(cause, completion\),\s*stopReasonOf\(cause\),/);
  // The specialists' rule is in specialist-steps.ts and tested with a stub gateway (F2).
  assert.match(
    read("specialist-steps.ts"),
    /results\.every\(\(result\) => result\.error === null \|\| result\.stopped\)/,
  );
  const research = read("public-research.ts");
  assert.match(
    research,
    /rejected\.every\(\(attempt\) => stopReasonOf\(attempt\.reason\) !== null\)/,
  );
});

test("a deep analysis's next try reuses the finished steps from the stopped run for free", () => {
  const worker = read("deep-worker.server.ts");
  // The run before it is found by its status, so a stopped run counts like any failed one.
  assert.match(worker, /\.eq\("status", "failed"\)\s*\.eq\("config_version_id", configVersionId\)/);
  assert.match(worker, /loadReusablePublicResearch\(service, context\.priorFailedRunId,/);
  assert.match(worker, /loadReusableSpecialists/);
  const deep = read("deep.functions.ts");
  assert.match(deep, /export async function loadReusableSpecialists/);
  // It continues on what it finished, also when the limit was raised.
  assert.match(worker, /priorFailed\["stop_reason"\] === "price_limit" \|\|/);
  assert.match(deep, /latestFailedDeep\["stop_reason"\] === "price_limit" \|\|/);
});

test("the customer's case page gets the state, and never an amount", () => {
  const payload = readFileSync(resolve("src/lib/cases/cases.functions.ts"), "utf8");
  assert.match(payload, /stoppedAtLimit: row\["stop_reason"\] === "price_limit",/);
  const start = payload.indexOf("const CASE_RUN_COLUMNS =");
  const columns = payload.slice(start, payload.indexOf(";", start));
  assert.match(columns, /stop_reason/);
  assert.doesNotMatch(columns, /cost|usd_to_dkk|cap/);
});
