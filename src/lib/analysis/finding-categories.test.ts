import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ANALYSIS_CATEGORIES,
  categoryFallbackWarning,
  unknownFindingFor,
  withCategoryFallbacks,
} from "./finding-categories.ts";

const finding = (category: string) => ({
  category,
  findingType: "strength",
  statement: "x",
  confidence: 0.8,
  nature: "fact",
  evidenceIds: ["e1"],
});

test("a skipped category gets an honest unknown finding, nothing else changes", () => {
  const given = ANALYSIS_CATEGORIES.filter((category) => category !== "financial_strength").map(
    finding,
  );
  const result = withCategoryFallbacks(given);
  assert.deepEqual(result.added, ["financial_strength"]);
  assert.equal(result.findings.length, given.length + 1);
  const added = result.findings.at(-1)!;
  assert.equal(added.category, "financial_strength");
  assert.equal(added.findingType, "unknown");
  assert.equal(added.confidence, 0);
  assert.equal(added.nature, "judgement");
  assert.deepEqual(added.evidenceIds, []);
  assert.match(added.statement, /^Ingen data fundet for finansiel styrke\./);
  assert.match(categoryFallbackWarning(result.added)[0]!, /financial_strength/);
});

test("nothing is added when every category has a finding", () => {
  const result = withCategoryFallbacks(ANALYSIS_CATEGORIES.map(finding));
  assert.deepEqual(result.added, []);
  assert.deepEqual(categoryFallbackWarning(result.added), []);
});

test("a specialist only needs its own categories", () => {
  const result = withCategoryFallbacks(
    [finding("founder_market_fit")],
    ["founder_market_fit", "team_market_fit"],
  );
  assert.deepEqual(result.added, ["team_market_fit"]);
  assert.equal(unknownFindingFor("unknown_cat").statement.includes("unknown_cat"), true);
});

test("a skipped category takes the specialists' real findings first; only then the unknown (#7)", () => {
  const given = ANALYSIS_CATEGORIES.filter(
    (category) => category !== "financial_strength" && category !== "market_timing",
  ).map(finding);
  const donors = [
    { ...finding("financial_strength"), statement: "Specialistens fund om økonomi" },
    { ...finding("financial_strength"), statement: "Endnu et økonomi-fund" },
  ];
  const result = withCategoryFallbacks(given, ANALYSIS_CATEGORIES, donors);
  assert.deepEqual(result.copied, ["financial_strength"]);
  assert.deepEqual(result.added, ["market_timing"]);
  const money = result.findings.filter((item) => item.category === "financial_strength");
  assert.equal(money.length, 2);
  assert.equal(money[0]!.nature, "fact");
  const unknown = result.findings.find((item) => item.category === "market_timing") as {
    origin?: string;
    findingType: string;
  };
  assert.equal(unknown.findingType, "unknown");
  assert.equal(unknown.origin, "deterministic");
  assert.equal(categoryFallbackWarning(result.added, result.copied).length, 2);
});

test("one list of categories is used everywhere (#7)", async () => {
  const { DEEP_FINDING_CATEGORIES } = await import("./deep.contracts.ts");
  assert.equal(ANALYSIS_CATEGORIES, DEEP_FINDING_CATEGORIES);
});

test("an empty investment condition or summary is read as none (#4)", async () => {
  const { deepAnalysisOutputSchema } = await import("./deep.contracts.ts");
  const { specialistOutputSchema } = await import("./specialist.contracts.ts");
  const criterion = {
    criterionKey: "team",
    proposedScore: 70,
    confidence: 0.6,
    rationale: "x",
    citations: [],
    unknowns: [],
  };
  const specialist = specialistOutputSchema.parse({
    schemaVersion: "interlect-specialist-v1",
    moduleId: "people_team",
    caseId: "c",
    summary: "",
    assessments: [criterion],
    findings: [],
    risks: [],
    strengths: [],
    weaknesses: [],
    unknowns: [],
    questions: [],
    financialInputs: [],
  });
  assert.equal(specialist.summary, null);
  const deep = deepAnalysisOutputSchema.parse({
    schemaVersion: "interlect-deep-v1",
    fundProfileId: "p",
    fundProfileVersion: "1",
    caseId: "c",
    assessments: [criterion],
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
    overallAssessment: "Samlet.",
    contraryCase: "Modfortolkning.",
    proposedRecommendation: "follow",
    findings: [],
    financialInputs: [],
    investmentCondition: "",
  });
  assert.equal(deep.investmentCondition, null);
});
