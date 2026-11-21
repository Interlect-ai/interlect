/**
 * Fondsopsætningens faste regler for scoringen: manglende data er usikkerhed, aldrig 0.
 * (beslutningsloggen 15. nov 2026, afløser's "en bindende gate kan ikke opvejes"): et
 * brud på en bindende regel vises, men stopper intet; et ukendt bindende krav giver "mangler
 * information". Kør: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { FundProfile } from "@/lib/funds/profiles";
import type { ScreeningOutput } from "./contracts";
import { scoreScreening, stagePriorScore } from "./scoring.ts";

const profile = {
  id: "fund-test",
  version: "1",
  analysisThreshold: 60,
  criteria: [
    { key: "team", label: "Team", weight: 60, category: "team" },
    { key: "market", label: "Marked", weight: 40, category: "market_timing" },
  ],
  gates: [
    { key: "geo", label: "Geografi", treatment: "hard" },
    { key: "ticket", label: "Ticket", treatment: "review" },
  ],
} as unknown as FundProfile;

function output(options: {
  scores?: Record<string, number | null>;
  gates?: Record<string, boolean | null>;
}): ScreeningOutput {
  const citation = [{ evidenceId: "e1" }];
  const scores = options.scores ?? { team: 100, market: 100 };
  const gates = options.gates ?? { geo: true, ticket: true };
  return {
    fundProfileId: "fund-test",
    fundProfileVersion: "1",
    proposedRecommendation: "go_forward",
    assessments: Object.entries(scores).map(([criterionKey, proposedScore]) => ({
      criterionKey,
      proposedScore,
      confidence: 0.9,
      citations: proposedScore === null ? [] : citation,
    })),
    gates: Object.entries(gates).map(([gateKey, passed]) => ({ gateKey, passed })),
    risks: [],
  } as unknown as ScreeningOutput;
}

test("a failed binding gate is shown but never stops the case (T-1092)", () => {
  const result = scoreScreening(profile, output({ gates: { geo: false, ticket: true } }), "seed");
  assert.equal(result.overallScore, 100, "the rule alone does not change the score");
  assert.equal(result.outcome, "awaiting_approval");
  assert.equal(result.eligibleForDeepAnalysis, true);
  assert.deepEqual(result.failedHardGateKeys, ["geo"]);
  assert.deepEqual(result.blockers, ["Mandatbrud: geo"]);
  assert.equal(result.recommendation, "go_forward", "never turned into a rejection");
});

test("a failed binding gate below the threshold is below the threshold, not blocked", () => {
  const result = scoreScreening(
    profile,
    output({ scores: { team: 30, market: 30 }, gates: { geo: false, ticket: true } }),
    "seed",
  );
  assert.equal(result.outcome, "below_threshold");
  assert.equal(result.recommendation, "follow");
  assert.equal(result.eligibleForDeepAnalysis, true);
});

test("a critical risk is shown but never stops the case (T-1092)", () => {
  const risky = {
    ...output({}),
    risks: [{ riskKey: "fraud", level: "critical", likelihood: 5, impact: 5 }],
  } as unknown as ScreeningOutput;
  const result = scoreScreening(profile, risky, "seed");
  assert.equal(result.highestRisk, "critical");
  assert.deepEqual(result.blockers, ["Mindst én kritisk risiko"]);
  assert.equal(result.outcome, "awaiting_approval");
  assert.equal(result.recommendation, "go_forward");
});

test("a failed review rule is a question for a human, not a block", () => {
  const result = scoreScreening(profile, output({ gates: { geo: true, ticket: false } }), "seed");
  assert.deepEqual(result.failedHardGateKeys, []);
  assert.equal(result.outcome, "awaiting_approval");
});

test("an unknown binding gate holds the case back instead of passing or failing it", () => {
  const result = scoreScreening(profile, output({ gates: { geo: null, ticket: true } }), "seed");
  assert.deepEqual(result.failedHardGateKeys, []);
  assert.deepEqual(result.unresolvedGateKeys, ["geo"]);
  assert.equal(result.outcome, "needs_information");
  assert.equal(result.recommendation, "follow");
  assert.equal(result.eligibleForDeepAnalysis, true, "a deep analysis is always possible");
});

test("missing evidence is a marked neutral prior, never a zero", () => {
  const result = scoreScreening(profile, output({ scores: { team: 80, market: null } }), "seed");
  const market = result.criteria.find((criterion) => criterion.criterionKey === "market");
  assert.equal(market?.isStagePrior, true);
  assert.equal(market?.score, stagePriorScore("seed"));
  assert.ok((market?.score ?? 0) > 0);
  assert.equal(market?.confidence, 0);
  assert.deepEqual(result.missingCriterionKeys, ["market"]);
  assert.ok(result.evidenceCoverage < 1);
});

test("a score without a single citation counts as missing, not as evidence", () => {
  const citationless = {
    ...output({}),
    assessments: [
      { criterionKey: "team", proposedScore: 95, confidence: 0.9, citations: [] },
      {
        criterionKey: "market",
        proposedScore: 95,
        confidence: 0.9,
        citations: [{ evidenceId: "e1" }],
      },
    ],
  } as unknown as ScreeningOutput;
  const result = scoreScreening(profile, citationless, "seed");
  assert.deepEqual(result.missingCriterionKeys, ["team"]);
});

test("weights that do not add up to 100 are refused instead of scored", () => {
  const broken = { ...profile, criteria: profile.criteria.slice(0, 1) } as unknown as FundProfile;
  assert.throws(() => scoreScreening(broken, output({}), "seed"), /summere til 100/);
});
