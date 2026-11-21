/**
 * A continuation after a stop at the price limit reserves only what is missing, and
 * each part may use only its own share, so it never spends more than it reserved.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildRunPlan, planReserve, storedReserve } from "./model-tiers.ts";
import {
  continuationReserve,
  deepRunShares,
  specialistsTakenOver,
  type StoppedRunProgress,
} from "./run-continuation.ts";
import { EVIDENCE_SHEET_BUDGET_USD } from "./evidence-sheet.ts";

const IDS = ["people_team", "product_market_gtm", "technology_risk", "fund_finance_deal"];
// Middel, the level's standard 35 kr. at the table's rate: research 1.9, specialists 2.75, synthesis 0.75.
const PLAN = buildRunPlan("deep", "medium", null, IDS.length);
const SHARE = PLAN.budget.specialistsUsd / IDS.length;
const SHEET = EVIDENCE_SHEET_BUDGET_USD.deep;

const ONLY_SYNTHESIS: StoppedRunProgress = {
  researchDone: true,
  evidenceSheetDone: true,
  specialistsDone: IDS,
};

test("a deep continuation where only the synthesis is missing reserves and may use the synthesis' part", () => {
  assert.equal(PLAN.scope.status, "full");
  const shares = deepRunShares(PLAN, IDS, ONLY_SYNTHESIS);
  assert.equal(shares.researchUsd, 0);
  assert.equal(shares.evidenceSheetUsd, 0);
  for (const id of IDS) assert.equal(shares.specialistUsd(id), 0);
  assert.equal(shares.specialistsUsd, 0);
  assert.equal(shares.synthesisUsd, PLAN.budget.synthesisUsd);
  assert.equal(shares.totalUsd, PLAN.budget.synthesisUsd);
  const reserve = continuationReserve(PLAN, IDS, ONLY_SYNTHESIS);
  assert.deepEqual(reserve, {
    usd: PLAN.budget.synthesisUsd,
    // Kroner rounded up to whole øre, so the month always has room for the dollars.
    dkk: Math.ceil(PLAN.budget.synthesisUsd * PLAN.usdToDkk * 100) / 100,
  });
  assert.deepEqual(planReserve({ ...PLAN, reserve }), reserve);
});

test("a continuation where the research is missing reserves the whole run", () => {
  for (const progress of [
    { researchDone: false, evidenceSheetDone: false, specialistsDone: [] },
    // Specialists can only be taken over after the research; without it the run starts over.
    { researchDone: false, evidenceSheetDone: true, specialistsDone: IDS },
  ]) {
    const shares = deepRunShares(PLAN, IDS, progress);
    assert.equal(shares.totalUsd, PLAN.budget.usd);
    assert.equal(shares.researchUsd, PLAN.budget.researchUsd - SHEET);
    assert.equal(continuationReserve(PLAN, IDS, progress), undefined);
  }
  assert.deepEqual(planReserve(PLAN), { usd: PLAN.budget.usd, dkk: PLAN.budget.dkk });
});

test("a run that is not a continuation keeps the plan's shares unchanged", () => {
  const shares = deepRunShares(PLAN, IDS, null);
  assert.equal(shares.researchUsd, PLAN.budget.researchUsd - SHEET);
  assert.equal(shares.evidenceSheetUsd, SHEET);
  for (const id of IDS) assert.equal(shares.specialistUsd(id), SHARE);
  assert.equal(shares.specialistsUsd, PLAN.budget.specialistsUsd);
  assert.equal(shares.synthesisUsd, PLAN.budget.synthesisUsd);
  assert.equal(shares.totalUsd, PLAN.budget.usd);
  // A plan the planner gave no evidence sheet keeps the whole research share for the research.
  const small = buildRunPlan("deep", "medium", 12, IDS.length);
  if (!small.scope.evidenceSheet) {
    assert.equal(deepRunShares(small, IDS, null).researchUsd, small.budget.researchUsd);
    assert.equal(deepRunShares(small, IDS, null).evidenceSheetUsd, 0);
  }
});

test("each missing specialist keeps its share; the finished ones get nothing", () => {
  const progress = {
    researchDone: true,
    evidenceSheetDone: false,
    specialistsDone: ["people_team", "technology_risk", "fund_finance_deal", "not_in_this_set"],
  };
  const shares = deepRunShares(PLAN, IDS, progress);
  assert.equal(shares.specialistUsd("product_market_gtm"), SHARE);
  assert.equal(shares.specialistUsd("people_team"), 0);
  // A key that is not one of the run's specialists does not count as finished.
  assert.equal(shares.specialistsUsd, SHARE);
  assert.equal(shares.evidenceSheetUsd, SHEET);
  const expected = Math.ceil((SHEET + SHARE + PLAN.budget.synthesisUsd) * 10_000 - 1e-9) / 10_000;
  assert.equal(shares.totalUsd, expected);
  assert.ok(shares.totalUsd >= SHEET + SHARE + PLAN.budget.synthesisUsd);
  assert.ok(shares.totalUsd < PLAN.budget.usd);
  assert.equal(continuationReserve(PLAN, IDS, progress)?.usd, expected);
});

test("a reservation never passes the plan, also in kroner", () => {
  const tiny = buildRunPlan("deep", "light", 5, 1);
  const reserve = continuationReserve(tiny, ["people_team"], {
    researchDone: true,
    evidenceSheetDone: false,
    specialistsDone: [],
  });
  const usd = reserve?.usd ?? tiny.budget.usd;
  assert.ok(usd <= tiny.budget.usd);
  assert.ok((reserve?.dkk ?? tiny.budget.dkk) <= tiny.budget.dkk);
});

test("only a finished specialist step on the same model and prompt with a whole packet is taken over", () => {
  const packet = { not: "a specialist packet" };
  const steps = [
    { step_key: "people_team", status: "complete", model_name: "m", prompt_version: "v", ok: true },
    { step_key: "product_market_gtm", status: "failed", model_name: "m", prompt_version: "v" },
    { step_key: "technology_risk", status: "complete", model_name: "other", prompt_version: "v" },
    { step_key: "fund_finance_deal", status: "complete", model_name: "m", prompt_version: "old" },
    { step_key: "custom_x", status: "complete", model_name: "m", prompt_version: "v", ok: true },
  ].map((step) => ({ ...step, output_json: step.ok ? "valid" : packet }));
  const done = specialistsTakenOver(steps, {
    specialistIds: IDS,
    model: "m",
    promptVersion: "v",
    isPacket: (output) => output === "valid",
  });
  assert.deepEqual(done, ["people_team"]);
});

test("the worker reads a continuation's reservation back from the run; a whole run has none", () => {
  assert.equal(storedReserve(PLAN, PLAN.budget.usd).reserve, undefined);
  assert.equal(storedReserve(PLAN, null).reserve, undefined);
  assert.equal(storedReserve(PLAN, "not a number").reserve, undefined);
  // A value above the plan (an older run) never raises what the run may use.
  assert.equal(storedReserve(PLAN, PLAN.budget.usd + 1).reserve, undefined);
  const stored = storedReserve(PLAN, "0.75");
  assert.deepEqual(stored.reserve, {
    usd: 0.75,
    dkk: Math.ceil(0.75 * PLAN.usdToDkk * 100) / 100,
  });
  assert.equal(stored.budget.usd, PLAN.budget.usd);
});

test("the start reserves only the missing parts, and every worker phase uses only its share", async () => {
  const { readFileSync } = await import("node:fs");
  const read = (file: string) => readFileSync(`src/lib/analysis/${file}`, "utf8");
  const start = read("deep.functions.ts");
  // The stopped run is found before the plan, so the month only has to hold what is missing.
  assert.ok(start.indexOf("const stopped: StoppedRun") < start.indexOf("await planNewRun("));
  assert.match(start, /stopped,\n\s+runId: reservedRunId/);
  assert.match(start, /estimated_cost: planReserve\(plan\)\.usd/);
  const worker = read("deep-worker.server.ts");
  for (const share of [
    /researchBudgetUsd: context\.shares\.researchUsd/,
    /availableUsd: context\.shares\.evidenceSheetUsd/,
    /context\.shares\.specialistUsd\(module\.id\)/,
    /specialistsUsd: context\.shares\.specialistsUsd/,
    /context\.shares\.synthesisUsd,\n\s+DEEP_CALL_TIMEOUT_MS/,
    /chargedSynthesis,\n\s+context\.shares\.synthesisUsd/,
    /knownCostUsd,\n\s+context\.shares\.totalUsd/,
  ]) {
    assert.match(worker, share);
  }
  // No phase reads the plan's own shares any more (they are in `deepRunShares`).
  assert.doesNotMatch(
    worker,
    /plan\.budget\.(specialistsUsd|synthesisUsd) \/|EVIDENCE_SHEET_BUDGET_USD/,
  );
  // A share the start did not reserve stops the run at its limit before any call.
  assert.match(worker, /shares\.totalUsd > plan\.reserve\.usd \+ 0\.000001/);
  assert.match(read("run-plan.server.ts"), /storedReserve\(planFromStoredRun/);
  // A failed read of what the stopped run finished is an error, never a false stop at the limit.
  assert.match(
    read("run-continuation.server.ts"),
    /loadReusablePublicResearch\(service, stoppedRunId, true\)/,
  );
  assert.match(start, /if \(error && strict\) throw new Error/);
  assert.match(
    worker,
    /loadReusablePublicResearch\(service, context\.priorFailedRunId, context\.stoppedAtLimit\)/,
  );
  assert.match(worker, /strict: context\.stoppedAtLimit/);
});
