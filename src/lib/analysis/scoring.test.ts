/** Test af den deterministiske screeningsscore med og uden kode-score (C8). Kør: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { FundProfile } from "@/lib/funds/profiles";
import type { ScreeningOutput } from "./contracts";
import type { FinancialScore } from "./financial-score.ts";
import { financeScoreAudit, scoreScreening } from "./scoring.ts";

const profile = {
  id: "fund-test",
  version: "1",
  analysisThreshold: 60,
  criteria: [
    { key: "team", label: "Team", weight: 60, category: "team" },
    { key: "financial_quality", label: "Økonomi", weight: 40, category: "financial_strength" },
  ],
  gates: [],
} as unknown as FundProfile;

function output(financeScore: number | null): ScreeningOutput {
  const citation = [{ evidenceId: "e1" }];
  return {
    fundProfileId: "fund-test",
    fundProfileVersion: "1",
    proposedRecommendation: "go_forward",
    assessments: [
      { criterionKey: "team", proposedScore: 70, confidence: 0.7, citations: citation },
      {
        criterionKey: "financial_quality",
        proposedScore: financeScore,
        confidence: 0.6,
        rationale: "AI-begrundelse.",
        citations: financeScore === null ? [] : citation,
      },
    ],
    gates: [],
    risks: [],
  } as unknown as ScreeningOutput;
}

const codeScore: FinancialScore = {
  version: "interlect-financial-score-v2",
  score: 60,
  coverage: 1,
  confidence: 0.8,
  components: [
    { key: "equity_ratio", label: "Soliditet", value: 40, score: 75, weight: 100 },
  ] as FinancialScore["components"],
};

test("uden kode-score er resultatet som før (AI-score med evidens)", () => {
  const result = scoreScreening(profile, output(80), "series_a");
  const finance = result.criteria.find((item) => item.criterionKey === "financial_quality")!;
  assert.equal(finance.score, 80);
  assert.equal(finance.financeCodeScore, undefined);
  assert.equal(result.overallScore, 74);
  assert.equal(financeScoreAudit(null, result), null);
});

test("kode-score + AI uden score giver kode-scoren og ingen stage-prior", () => {
  const result = scoreScreening(profile, output(null), "seed", codeScore);
  const finance = result.criteria.find((item) => item.criterionKey === "financial_quality")!;
  assert.equal(finance.score, 60);
  assert.equal(finance.isStagePrior, false);
  assert.equal(finance.confidence, 0.8);
  assert.match(finance.codeRationale!, /^Soliditet 40 % \(CVR-regnskabet\) giver 60\.$/);
  assert.equal(result.evidenceCoverage, 1);
  assert.equal(result.overallScore, 66);
});

test("en AI-score 25 point fra kode-scoren holdes inden for ±10", () => {
  const result = scoreScreening(profile, output(85), "later", codeScore);
  const finance = result.criteria.find((item) => item.criterionKey === "financial_quality")!;
  assert.equal(finance.score, 70);
  assert.match(finance.codeRationale!, /giver 60\. AI-begrundelse\.$/);
  assert.deepEqual(financeScoreAudit(codeScore, result)?.anchoredCriterionKeys, [
    "financial_quality",
  ]);
});

test("et fravalgt økonomi-kriterium scores af AI'en, ikke af kode-scoren (0028)", () => {
  const optedOut = {
    ...profile,
    criteria: profile.criteria.map((criterion) =>
      criterion.key === "financial_quality" ? { ...criterion, codeAnchor: false } : criterion,
    ),
  } as FundProfile;
  const result = scoreScreening(optedOut, output(85), "later", codeScore);
  const finance = result.criteria.find((item) => item.criterionKey === "financial_quality")!;
  assert.equal(finance.score, 85);
  assert.equal(finance.financeCodeScore, undefined);
  assert.deepEqual(financeScoreAudit(codeScore, result)?.anchoredCriterionKeys, []);
});
