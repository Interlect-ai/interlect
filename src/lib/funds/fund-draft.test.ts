import assert from "node:assert/strict";
import { test } from "node:test";
import type { FundConfigTemplate } from "./config-templates.ts";
import { fundDraftRows } from "./fund-draft.ts";

const template: FundConfigTemplate = {
  key: "venture",
  label: "Venture",
  description: "",
  strategyType: "venture",
  stages: ["Seed"],
  analysisThreshold: 70,
  riskPosture: "Høj risiko",
  stageExpectations: { Seed: "Tidlig traction" },
  gates: [{ key: "geo", label: "Geografi", description: "Norden", treatment: "review" }],
  criteria: [
    { key: "team", label: "Team", description: "", category: "team_market_fit", weight: 60 },
    { key: "market", label: "Marked", description: "", category: "market_timing", weight: 40 },
  ],
};

test("a new fund starts as an unpublished draft (version 1) of its template", () => {
  const rows = fundDraftRows(template, "ugly-duckling");
  assert.deepEqual(rows.config, {
    version: 1,
    profile_key: "ugly-duckling",
    status: "draft",
    source_basis:
      "Venture-skabelon oprettet i Interlect.ai. Kræver menneskelig gennemgang og publicering.",
  });
  assert.equal(rows.mandate.thesis, "");
  assert.deepEqual(rows.mandate.sectors, []);
  assert.equal(rows.mandate.analysis_threshold, 70);
  assert.equal(rows.mandate.approval_mode, "partner_approval");
  assert.deepEqual(rows.mandate.stages, ["seed"]);
  assert.deepEqual(rows.mandate.stage_expectations, { seed: "Tidlig traction" });
});

test("gates and criteria keep the template's order and weights", () => {
  const rows = fundDraftRows(template, "x");
  assert.deepEqual(rows.gates, [
    {
      gate_key: "geo",
      label: "Geografi",
      description: "Norden",
      treatment: "review",
      sort_order: 1,
    },
  ]);
  assert.deepEqual(
    rows.criteria.map((row) => [row.criterion_key, row.score_category, row.weight, row.sort_order]),
    [
      ["team", "team_market_fit", 60, 1],
      ["market", "market_timing", 40, 2],
    ],
  );
});
