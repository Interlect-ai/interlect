/** The research eval's pure part (judge prompt, parsing, scores, statistics). Kør: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { FundProfile } from "../funds/profiles.ts";
import type { EvidenceSheet } from "./evidence-sheet.ts";
import {
  coverageKeys,
  decide,
  JUDGE_EVIDENCE_MAX,
  parseResearchJudgeOutput,
  preferredVariant,
  RESEARCH_EVAL_CASES,
  researchJudgePrompt,
  researchJudgeSchema,
  scoresFromJudge,
  summarize,
  variantOrder,
  variantShownAsA,
  type CaseOutcome,
  type EvalEvidence,
  type ResearchJudgeOutput,
  type VariantScores,
} from "./research-eval.ts";

const profile: Pick<
  FundProfile,
  "thesis" | "stages" | "geographies" | "sectors" | "criteria" | "gates"
> = {
  thesis: "Nordiske B2B-softwareselskaber i tidlig fase.",
  stages: ["Seed"],
  geographies: ["Danmark"],
  sectors: ["B2B-software"],
  criteria: [
    {
      key: "team",
      label: "Team",
      description: "Holdet",
      category: "team_market_fit",
      weight: 50,
      codeAnchor: false,
    },
    {
      key: "traction",
      label: "Traction",
      description: "Salg",
      category: "traction_gtm",
      weight: 50,
      codeAnchor: false,
    },
  ],
  gates: [{ key: "stage_fit", label: "Stadie", description: "Seed", treatment: "review" }],
};

const evidence = (id: string, claim: string): EvalEvidence => ({
  id,
  claim,
  excerpt: "uddrag",
  sourceTitle: "Børsen",
  sourceUrl: "https://www.borsen.dk/artikel",
  sourceType: "public_research:press",
  entityMatch: "matched",
  date: "2026-01-01",
});

const sheet: EvidenceSheet = {
  version: "v1",
  model: "openai/gpt-5.4-mini",
  items: [
    {
      kind: "criterion",
      key: "team",
      label: "Team",
      summary: "To founders",
      facts: [{ statement: "Grundlagt af to", evidenceIds: ["b1", "r1", "gone"], date: "2024" }],
      conflicts: [],
      unknowns: ["CTO ukendt"],
    },
  ],
  citedEvidenceIds: ["b1", "r1"],
  droppedFacts: 0,
  brainText: "",
};

test("the case set has twenty cases with unique keys, two of them made up", () => {
  assert.equal(RESEARCH_EVAL_CASES.length, 20);
  assert.equal(new Set(RESEARCH_EVAL_CASES.map((c) => c.key)).size, 20);
  assert.deepEqual(
    RESEARCH_EVAL_CASES.filter((c) => c.fictional).map((c) => c.key),
    ["nordlys", "fjordvind"],
  );
  for (const c of RESEARCH_EVAL_CASES) {
    if (c.website) assert.doesNotThrow(() => new URL(c.website!), c.key);
  }
});

test("the prompt labels both materials, maps sheet citations and caps the list", () => {
  const many = Array.from({ length: JUDGE_EVIDENCE_MAX + 5 }, (_, i) =>
    evidence(`a${i}`, `Påstand ${i}`),
  );
  const prompt = researchJudgePrompt({
    kind: "screening",
    profile,
    company: { name: "Acme", website: "https://acme.dk", fictional: false },
    reference: [evidence("r1", "Virksomhedens hjemmeside: Acme")],
    variants: [
      { evidence: many, sheet: null },
      { evidence: [evidence("b1", "Grundlagt 2024")], sheet },
    ],
  });
  assert.match(prompt, /<material_A>/);
  assert.match(prompt, /<material_B>/);
  assert.match(prompt, new RegExp(`the newest ${JUDGE_EVIDENCE_MAX} shown`));
  assert.ok(prompt.includes(`[A${JUDGE_EVIDENCE_MAX}]`));
  assert.ok(!prompt.includes(`[A${JUDGE_EVIDENCE_MAX + 1}]`));
  // B's sheet cites its own item, the shared reference and an id that is not shown.
  assert.match(prompt, /fact: Grundlagt af to \[B1, R1, not shown\] \(2024\)/);
  assert.match(prompt, /criterion:team Team/);
  assert.match(prompt, /gate:stage_fit Stadie/);
  assert.doesNotMatch(prompt, /made up for the test/);
});

test("a made-up company is named as such to the judge", () => {
  const prompt = researchJudgePrompt({
    kind: "screening",
    profile,
    company: { name: "Fjordvind Ledger", website: null, fictional: true },
    reference: [],
    variants: [
      { evidence: [], sheet: null },
      { evidence: [], sheet: null },
    ],
  });
  assert.match(prompt, /made up for the test/);
  assert.match(prompt, /no website given/);
});

const keys = coverageKeys(profile);
const judged = (over: Partial<ResearchJudgeOutput> = {}): ResearchJudgeOutput => ({
  A: { factual: 4, sourceCorrectness: 3, sourceQuality: 2, wrongEntityClaims: 0, problems: [] },
  B: { factual: 2, sourceCorrectness: 2, sourceQuality: 2, wrongEntityClaims: 1, problems: ["B3"] },
  coverage: [
    { key: "criterion:team", A: "yes", B: "partial" },
    { key: "criterion:traction", A: "partial", B: "no" },
    { key: "gate:stage_fit", A: "yes", B: "yes" },
  ],
  preferred: "A",
  note: "A er bedre",
  ...over,
});

test("the schema asks for every coverage key and both labels", () => {
  const schema = researchJudgeSchema(keys);
  assert.deepEqual(schema.required, ["A", "B", "coverage", "preferred", "note"]);
  assert.deepEqual(schema.properties.coverage.items.properties.key.enum, keys);
});

test("parsing keeps a full answer and refuses a partial one", () => {
  assert.deepEqual(parseResearchJudgeOutput(judged(), keys), judged());
  assert.throws(
    () => parseResearchJudgeOutput(judged({ coverage: judged().coverage.slice(1) }), keys),
    /skipped coverage for criterion:team/,
  );
  assert.throws(
    () => parseResearchJudgeOutput({ ...judged(), A: { ...judged().A, factual: 5 } }, keys),
    /no valid factual for A/,
  );
  assert.throws(
    () => parseResearchJudgeOutput({ ...judged(), preferred: "C" }, keys),
    /preference/,
  );
  const { wrongEntityClaims: _dropped, ...withoutCount } = judged().B;
  assert.throws(
    () => parseResearchJudgeOutput({ ...judged(), B: withoutCount }, keys),
    /no valid wrongEntityClaims for B/,
  );
  // An unknown or repeated key is ignored, not counted twice.
  const extra = judged({
    coverage: [
      ...judged().coverage,
      { key: "criterion:team", A: "no", B: "no" },
      { key: "x", A: "no", B: "no" },
    ],
  });
  assert.deepEqual(parseResearchJudgeOutput(extra, keys).coverage, judged().coverage);
});

test("scores are mapped back from the blind labels, coverage and overall in code", () => {
  const asBefore = scoresFromJudge(judged(), "before");
  assert.equal(asBefore.before.factual, 1);
  assert.equal(asBefore.before.coverage, (1 + 0.5 + 1) / 3);
  assert.equal(asBefore.after.coverage, (0.5 + 0 + 1) / 3);
  assert.equal(asBefore.after.wrongEntityClaims, 1);
  assert.equal(asBefore.before.overall, (1 + 0.75 + 0.5 + asBefore.before.coverage) / 4);
  const asAfter = scoresFromJudge(judged(), "after");
  assert.deepEqual(asAfter.after, asBefore.before);
  assert.equal(preferredVariant(judged(), "after"), "after");
  assert.equal(preferredVariant(judged(), "before"), "before");
  assert.equal(preferredVariant(judged({ preferred: "B" }), "before"), "after");
  assert.equal(preferredVariant(judged({ preferred: "tie" }), "before"), "tie");
});

test("the blind labels are stable and not all the same; the run order alternates", () => {
  const labels = RESEARCH_EVAL_CASES.map((c) => variantShownAsA(c.key));
  assert.deepEqual(
    labels,
    RESEARCH_EVAL_CASES.map((c) => variantShownAsA(c.key)),
  );
  assert.ok(labels.includes("before") && labels.includes("after"));
  assert.deepEqual(variantOrder(0), ["before", "after"]);
  assert.deepEqual(variantOrder(1), ["after", "before"]);
});

const scores = (value: number): VariantScores => ({
  factual: value,
  sourceCorrectness: value,
  sourceQuality: value,
  coverage: value,
  overall: value,
  wrongEntityClaims: 0,
});
const outcome = (
  key: string,
  before: number,
  after: number,
  over: Partial<CaseOutcome> = {},
): CaseOutcome => ({
  key,
  fictional: false,
  scores: { before: scores(before), after: scores(after) },
  preferred: after > before ? "after" : after < before ? "before" : "tie",
  costDkk: { before: 0.3, after: 0.6 },
  seconds: { before: 40, after: 70 },
  failed: { before: false, after: false },
  ...over,
});

test("the summary pairs the cases and the decision needs a clear, cheap gain", () => {
  const better = Array.from({ length: 12 }, (_, i) => outcome(`c${i}`, 0.5, 0.6 + (i % 3) * 0.01));
  const summary = summarize(better);
  assert.equal(summary.graded, 12);
  assert.ok(summary.dimensions!.overall.diff.mean > 0.1);
  assert.ok(summary.dimensions!.overall.diff.low > 0);
  assert.equal(summary.dimensions!.overall.wins, 12);
  assert.deepEqual(summary.preferred, { before: 0, after: 12, tie: 0 });
  assert.ok(Math.abs(summary.meanCostDkk.after! - 0.6) < 1e-9);
  assert.deepEqual(decide(summary, { maxResearchDkk: 2 }), { standard: true, reasons: [] });

  const tooExpensive = decide(summary, { maxResearchDkk: 0.5 });
  assert.equal(tooExpensive.standard, false);
  assert.match(tooExpensive.reasons.join(" "), /over rammen/);

  const flat = summarize(
    Array.from({ length: 12 }, (_, i) => outcome(`f${i}`, 0.5, i % 2 ? 0.52 : 0.49)),
  );
  assert.equal(decide(flat, { maxResearchDkk: 2 }).standard, false);

  const failing = summarize([
    ...better,
    outcome("x", 0.5, 0.5, {
      scores: null,
      preferred: null,
      failed: { before: false, after: true },
    }),
  ]);
  assert.equal(failing.graded, 12);
  assert.match(decide(failing, { maxResearchDkk: 2 }).reasons.join(" "), /fejlede oftere/);

  assert.match(decide(summarize(better.slice(0, 3)), { maxResearchDkk: 2 }).reasons[0]!, /For få/);
});
