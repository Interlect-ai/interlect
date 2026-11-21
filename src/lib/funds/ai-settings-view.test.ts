/**
 * (beslutningslog 15. og 20. okt): the AI level call sends the same thing to Admin, Lead,
 * Medlem and Læser, and it holds no model name and no price, where they could be read in the
 * developer tools. The prices only decide the warning on the server. This test fails if a field,
 * a number or a model comes back.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { aiKindSettings, fundAiSettingsView, type RunCostRow } from "./ai-settings-view.ts";

const MEDIUM_SCREENINGS: RunCostRow[] = [
  { kind: "screening", ai_tier: "medium", actual_cost: 0.42 },
  { kind: "screening", ai_tier: "medium", actual_cost: "0.58" },
];
const SETTINGS = {
  screeningTier: "heavy",
  deepTier: "medium",
  screeningCapDkk: 7,
  deepCapDkk: null,
  limitAction: "ask",
  monthlyCapDkk: 500,
} as const;
const LEVELS = [{ tier: "light" }, { tier: "medium" }, { tier: "heavy" }];

test("the whole answer is the level, the levels, the own cap and the warning, for every role", () => {
  for (const canEdit of [true, false]) {
    assert.deepEqual(
      fundAiSettingsView({ canEdit, settings: SETTINGS, rows: [], specialistCount: 4 }),
      {
        available: true,
        canEdit,
        screening: { tier: "heavy", tiers: LEVELS, hasOwnCap: true, capWarning: false },
        deep: { tier: "medium", tiers: LEVELS, hasOwnCap: false, capWarning: false },
      },
    );
  }
});

test("without the migration the old defaults apply and nothing is available", () => {
  assert.deepEqual(
    fundAiSettingsView({ canEdit: false, settings: null, rows: [], specialistCount: 4 }),
    {
      available: false,
      canEdit: false,
      screening: { tier: "light", tiers: LEVELS, hasOwnCap: false, capWarning: false },
      deep: { tier: "medium", tiers: LEVELS, hasOwnCap: false, capWarning: false },
    },
  );
});

test("the specialist count reaches the deep analysis's cap", () => {
  // Tung with one specialist has a standard cap of 32 kr, below the estimate of 36 kr; with four, 60 kr.
  const view = (specialistCount: number) =>
    fundAiSettingsView({
      canEdit: true,
      settings: { ...SETTINGS, deepTier: "heavy" },
      rows: [],
      specialistCount,
    }).deep.capWarning;
  assert.equal(view(1), true);
  assert.equal(view(4), false);
});

test("no amount and no model name leaves, in any field, whatever the fund has spent or confirmed", () => {
  for (const kind of ["screening", "deep"] as const) {
    for (const cap of [null, 7, 20, 100]) {
      const settings = aiKindSettings(kind, "heavy", cap, MEDIUM_SCREENINGS, 7);
      assert.deepEqual(Object.keys(settings).sort(), ["capWarning", "hasOwnCap", "tier", "tiers"]);
      assert.deepEqual(settings.tiers, LEVELS);
      assert.doesNotMatch(JSON.stringify(settings), /\d/);
      assert.doesNotMatch(JSON.stringify(settings), /gpt|openai|anthropic|perplexity|sonar/i);
    }
  }
});

test("no own cap is told apart from a confirmed one", () => {
  assert.equal(aiKindSettings("deep", "medium", null, []).hasOwnCap, false);
  assert.equal(aiKindSettings("deep", "medium", 20, []).hasOwnCap, true);
});

test("the warning still follows the fund's real prices, then the estimate", () => {
  // Measured: 0.50 USD on average is about 3.23 kr, above a cap of 2 kr and below one of 7 kr.
  assert.equal(aiKindSettings("screening", "medium", 2, MEDIUM_SCREENINGS).capWarning, true);
  assert.equal(aiKindSettings("screening", "medium", 7, MEDIUM_SCREENINGS).capWarning, false);
  // Nothing measured at this level: the estimate for a medium deep analysis is 18 kr.
  assert.equal(aiKindSettings("deep", "medium", 10, MEDIUM_SCREENINGS).capWarning, true);
  assert.equal(aiKindSettings("deep", "medium", 20, MEDIUM_SCREENINGS).capWarning, false);
});

test("a run from before the levels counts at the level it ran on, a bad price not at all", () => {
  const old: RunCostRow[] = [
    { kind: "screening", ai_tier: null, actual_cost: 0.5 },
    { kind: "screening", ai_tier: "light", actual_cost: 0 },
    { kind: "screening", ai_tier: "light", actual_cost: null },
  ];
  assert.equal(aiKindSettings("screening", "light", 2, old).capWarning, true);
  assert.equal(aiKindSettings("screening", "medium", 2, old).capWarning, false);
  // An old deep analysis ran on middle, so 1 USD (about 6.46 kr) is what middle costs, not 18 kr.
  const oldDeep: RunCostRow[] = [{ kind: "deep", ai_tier: null, actual_cost: 1 }];
  assert.equal(aiKindSettings("deep", "medium", 10, oldDeep).capWarning, false);
  // A run with an unknown level counts for no level.
  const unknown: RunCostRow[] = [{ kind: "screening", ai_tier: "bogus", actual_cost: 5 }];
  assert.equal(aiKindSettings("screening", "light", 2, unknown).capWarning, false);
});

test("the warning judges the cap a new run really gets, inside the installation's limit", () => {
  // The fund's runs cost 3.45 kr. on average: Middel's standard (10 kr.) covers it, 2 kr. does not.
  const rows = MEDIUM_SCREENINGS;
  assert.equal(aiKindSettings("screening", "medium", null, rows, 4, 6.9).capWarning, false);
  assert.equal(aiKindSettings("screening", "medium", null, rows, 4, 6.9, 2).capWarning, true);
});

test("the server function returns this answer as it is and adds nothing to it", () => {
  const source = readFileSync(resolve(import.meta.dirname, "ai-settings.functions.ts"), "utf8");
  const start = source.indexOf("export const getFundAiSettings");
  const end = source.indexOf("export const getFundAnalysisLimits");
  assert.ok(start >= 0 && end > start, "getFundAiSettings was not found");
  const handler = source.slice(start, end);
  assert.match(
    handler,
    /return fundAiSettingsView\(\{\s*canEdit,\s*settings,\s*rows,\s*specialistCount,\s*usdToDkk: platform\.usdToDkk,\s*platformCapsDkk: platform\.capsDkk,\s*\}\);/,
  );
  assert.equal(handler.match(/\breturn\b/g)?.length, 1);
  assert.doesNotMatch(handler, /\.\.\./);
});
