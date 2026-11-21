/**
 * (spor B2): the limits in kroner belong to Admin and Lead, and a team can never pass the
 * installation's hard limit. The columns are closed for the browser's role in `scripts/test-rls.mjs`.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { hasCapability, strictFundSettings } from "../domain/workflow.ts";
import type { PlatformLimits } from "../analysis/run-plan.server.ts";
import {
  analysisLimitsView,
  belowLowestCap,
  overPlatformLimit,
  bookedRunCosts,
  runCostStats,
} from "./analysis-limits.ts";

const PLATFORM: PlatformLimits = {
  usdToDkk: 6.9,
  capsDkk: { screening: 20, deep: 80 },
  monthlyCapDkk: 2000,
};
const SETTINGS = {
  screeningTier: "medium",
  deepTier: "heavy",
  screeningCapDkk: 7,
  deepCapDkk: null,
  limitAction: "ask",
  monthlyCapDkk: 500,
} as const;
const VIEW_INPUT = { specialistCount: 4, monthUsedDkk: 12.345, costs: [] };
const source = readFileSync(resolve("src/lib/funds/ai-settings.functions.ts"), "utf8");

test("Medlem and Læser cannot read or change the limits; Admin and Lead can", () => {
  const can = (role: "admin" | "lead" | "member" | "reader") =>
    hasCapability([role], "configure_fund", strictFundSettings);
  assert.deepEqual(
    [can("admin"), can("lead"), can("member"), can("reader")],
    [true, true, false, false],
  );
  for (const name of ["getFundAnalysisLimits", "updateFundAiSettings"]) {
    const start = source.indexOf(`export const ${name}`);
    const end = source.indexOf("export const ", start + 1);
    const body = source.slice(start, end === -1 ? undefined : end);
    assert.match(body, /requireFundCapability\([\s\S]*?"configure_fund"/, name);
  }
});

test("the AI level call for every role sends no limit, no rate and no monthly amount", () => {
  const start = source.indexOf("export const getFundAiSettings");
  const body = source.slice(start, source.indexOf("export const getFundAnalysisLimits"));
  assert.match(body, /fundAiSettingsView\(/);
  assert.doesNotMatch(body, /analysisLimitsView|monthlyCap/);
});

test("the section shows the limits in kroner and what a new run gets", () => {
  const view = analysisLimitsView({ ...VIEW_INPUT, settings: SETTINGS, platform: PLATFORM });
  assert.equal(view.available, true);
  assert.equal(view.limitAction, "ask");
  assert.equal(view.monthlyCapDkk, 500);
  assert.equal(view.monthlyMaxDkk, 2000);
  assert.deepEqual(view.screening, {
    tier: "medium",
    ownCapDkk: 7,
    standardCapDkk: 10,
    capDkk: 7,
    minDkk: 3,
    maxDkk: 20,
    costs: null,
  });
  assert.equal(view.monthUsedDkk, 12.35);
  // Tung's standard (60 kr.) fits inside the 80 kr. limit.
  assert.equal(view.deep.capDkk, 60);
  assert.equal(view.deep.maxDkk, 80);
});

test("a limit from before the installation lowered its own applies only up to that", () => {
  const platform = { ...PLATFORM, capsDkk: { screening: 5, deep: 30 } };
  const view = analysisLimitsView({ ...VIEW_INPUT, settings: SETTINGS, platform });
  assert.equal(view.screening.ownCapDkk, 7);
  assert.equal(view.screening.capDkk, 5);
  assert.equal(view.deep.capDkk, 30);
});

test("a limit over the installation's own is refused, also the monthly one", () => {
  assert.deepEqual(overPlatformLimit({ screeningCapDkk: 21 }, PLATFORM), { maxDkk: 20 });
  assert.deepEqual(overPlatformLimit({ deepCapDkk: 81 }, PLATFORM), { maxDkk: 80 });
  assert.deepEqual(overPlatformLimit({ monthlyCapDkk: 2001 }, PLATFORM), { maxDkk: 2000 });
  assert.equal(
    overPlatformLimit({ screeningCapDkk: 20, deepCapDkk: 80, monthlyCapDkk: 2000 }, PLATFORM),
    null,
  );
  assert.equal(overPlatformLimit({ screeningCapDkk: null, monthlyCapDkk: null }, PLATFORM), null);
});

test("every change is logged with before and after, also the action and the monthly limit", () => {
  const start = source.indexOf("export const updateFundAiSettings");
  const body = source.slice(start);
  assert.match(body, /action: "fund_ai_settings_changed"[\s\S]*payload: \{ before, after \}/);
  // The sent fields go to saveAiSettings, which writes only those (ai-settings-save.test.ts).
  assert.match(body, /limitAction: data\.limitAction,/);
  assert.match(body, /monthlyCapDkk: data\.monthlyCapDkk,/);
  assert.match(body, /saveAiSettings\(change,/);
  // The audit row comes first: a refused audit changes nothing.
  assert.ok(body.indexOf("writeAuditWithId(") < body.indexOf(".update("));
  // Checked before the audit row, so a refused limit is neither logged nor saved.
  assert.ok(body.indexOf("overPlatformLimit(") < body.indexOf("writeAuditWithId("));
});

test("a limit under the bottom for the level cannot be chosen; a saved one blocks nothing else", () => {
  const change = (capDkk: number | null) => [
    { kind: "screening" as const, tier: "medium" as const, capDkk },
  ];
  assert.deepEqual(belowLowestCap(change(2), 4, 6.9), { minDkk: 3 });
  assert.equal(belowLowestCap(change(3), 4, 6.9), null);
  assert.equal(belowLowestCap(change(null), 4, 6.9), null);
  assert.equal(belowLowestCap([], 4, 6.9), null);
  // Checked on what is changed, before the audit row.
  const body = source.slice(source.indexOf("export const updateFundAiSettings"));
  assert.match(body, /data\.screeningCapDkk !== undefined \|\| data\.screeningTier !== undefined/);
  assert.ok(body.indexOf("belowLowestCap(") < body.indexOf("writeAuditWithId("));
});

test("the costs under the limits are what the ledger booked per run, also paid stopped runs", () => {
  const runs = [
    { id: "s1", kind: "screening", status: "complete" },
    { id: "s2", kind: "screening", status: "awaiting_approval" },
    // Stopped at its limit or failed after paying: counted (F3).
    { id: "s3", kind: "screening", status: "failed" },
    // Failed before any call: 0 kr., not a price anyone paid.
    { id: "s4", kind: "screening", status: "failed" },
    // No settled row (still reserved or from before the ledger): left out.
    { id: "s5", kind: "screening", status: "complete" },
    { id: "d1", kind: "deep", status: "cancelled" },
    { id: "d2", kind: "deep", status: "complete" },
  ];
  const booked = [
    { ref_id: "s1", amount_dkk: "0.70" },
    { ref_id: "s2", amount_dkk: 3 },
    { ref_id: "s3", amount_dkk: 5 },
    { ref_id: "s4", amount_dkk: 0 },
    { ref_id: "d1", amount_dkk: 12 },
    { ref_id: "d2", amount_dkk: 16 },
    { ref_id: null, amount_dkk: 99 },
    { ref_id: "other-team-run", amount_dkk: 40 },
  ];
  const costs = bookedRunCosts(runs, booked);
  assert.deepEqual(runCostStats("screening", costs), {
    runs: 3,
    averageDkk: 2.9,
    lowestDkk: 0.7,
    highestDkk: 5,
  });
  assert.equal(runCostStats("deep", []), null);
  // The runs × the average is what the ledger booked for them: the averages add up to the month.
  const screeningBooked = 0.7 + 3 + 5;
  assert.equal(Math.round(3 * 2.9 * 100) / 100, screeningBooked);
  const view = analysisLimitsView({ ...VIEW_INPUT, settings: SETTINGS, platform: PLATFORM, costs });
  assert.equal(view.deep.costs?.averageDkk, 14);
  assert.equal(view.deep.costs?.runs, 2);
});

test("the costs and the month are read for Admin and Lead only", () => {
  const start = source.indexOf("export const getFundAnalysisLimits");
  const body = source.slice(start, source.indexOf("async function activeSpecialistCount"));
  assert.ok(body.indexOf('"configure_fund"') < body.indexOf("loadAnalysisMonth("));
  assert.ok(body.indexOf('"configure_fund"') < body.indexOf('.from("analysis_runs")'));
  assert.ok(body.indexOf('"configure_fund"') < body.indexOf('.from("ai_credit_ledger")'));
  // Every run that has ended counts; a stopped or failed one when it was paid for.
  assert.match(
    body,
    /\.in\("status", \["complete", "awaiting_approval", "failed", "cancelled"\]\)/,
  );
  // The prices are the ledger's settled rows, read after the month has settled finished runs.
  assert.ok(body.indexOf("loadAnalysisMonth(") < body.indexOf('.from("ai_credit_ledger")'));
  assert.match(body, /\.eq\("status", "final"\)/);
  assert.match(body, /\.is\("loop", null\)/);
  // A busy team's rows are read a page at a time, never cut off at PostgREST's 1000.
  assert.equal(body.match(/\.range\(from, to\)/g)?.length, 2);
});
