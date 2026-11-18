import assert from "node:assert/strict";
import { test } from "node:test";
import { screeningOutputSchema } from "../../../src/lib/analysis/contracts.ts";
import { deepAnalysisOutputSchema } from "../../../src/lib/analysis/deep.contracts.ts";
import { specialistOutputSchema } from "../../../src/lib/analysis/specialist.contracts.ts";
import { cardDataSchema } from "../../../src/lib/analysis/card-data.ts";
import type { FundProfile } from "../../../src/lib/funds/profiles.ts";
import {
  auditDeepOutput,
  validateReferences,
  validateSpecialistPacket,
} from "../../../src/lib/analysis/deep-checks.ts";
import {
  validateConfiguredCoverage,
  validateEvidenceReferences,
} from "../../../src/lib/analysis/screening-checks.ts";
import { scoreScreening } from "../../../src/lib/analysis/scoring.ts";
import { specialistModules } from "../../../src/lib/analysis/specialist-prompts.ts";
import { RESEARCH_EVAL_CASES } from "../../../src/lib/analysis/research-eval.ts";
import { fundConfigTemplateIn } from "../../../src/lib/funds/config-templates.ts";
import type { Language } from "../../../src/lib/i18n/language.ts";
import { buildTerms, createScanner } from "../../../tests/e2e/demo-proof-scan.ts";
import {
  buildDeepOutput,
  buildScreeningOutput,
  buildSpecialistPackets,
  demoCompanyName,
  demoId,
  demoIds,
} from "./demo-build.ts";
import { DEMO_CASES, DEMO_PATH_MOVES, hasDeepAnalysis, type DemoCase } from "./demo-cases.ts";

const FUND = "00000000-0000-4000-8000-000000000001";

/** The Venture template as setup's first fund has it (the shape mapProfile gives). */
function ventureProfile(language: Language): FundProfile {
  const template = fundConfigTemplateIn("venture", language);
  return {
    id: "selfhost-test",
    name: "Test fund",
    shortThesis: "Nordic B2B software and climate companies.",
    thesis: "Nordic B2B software and climate companies from pre-seed to Series A.",
    stages: template.stages,
    geographies: ["DK", "SE", "NO", "FI"],
    sectors: [],
    ticket: { minEur: 250000, maxEur: 1500000, note: "" },
    fundSizeEur: null,
    analysisThreshold: template.analysisThreshold,
    approvalMode: "partner_approval",
    riskPosture: template.riskPosture,
    language,
    distinctiveLens: [],
    gates: template.gates.map((gate) => ({ ...gate })),
    criteria: template.criteria.map((criterion) => ({ ...criterion, codeAnchor: true })),
    sources: [],
    version: "config-v1",
    researchedAt: "2026-11-17",
  };
}

function build(item: DemoCase, language: Language = "en") {
  const profile = ventureProfile(language);
  const ids = demoIds(FUND, item);
  const ctx = { caseId: ids.case, profile, ids };
  const allowed = new Set(item.evidence.map((row) => ids.evidence(row.key)));
  return { profile, ids, ctx, allowed };
}

for (const item of DEMO_CASES) {
  test(`${item.key}: the screening parses, covers the setup and cites only the case's evidence`, () => {
    for (const language of ["en", "da"] as const) {
      const { profile, ctx, allowed } = build(item, language);
      const output = screeningOutputSchema.parse(buildScreeningOutput(item, ctx));
      validateConfiguredCoverage(output, profile);
      validateEvidenceReferences(output, allowed);
      assert.equal(output.caseId, ctx.caseId);
      for (const step of output.nextSteps ?? []) {
        assert.ok(step.title.split(/\s+/).length <= 6, `${item.key}: "${step.title}" is too long`);
      }
    }
  });

  test(`${item.key}: the score lands where the case's story says`, () => {
    const { profile, ctx } = build(item);
    const output = screeningOutputSchema.parse(buildScreeningOutput(item, ctx));
    const result = scoreScreening(profile, output, item.stage);
    assert.ok(result.overallScore !== null, `${item.key} has no score`);
    if (item.recommendation === "go_forward") {
      assert.ok(
        result.overallScore! >= profile.analysisThreshold,
        `${item.key}: ${result.overallScore} is below the threshold`,
      );
    }
    if (item.recommendation === "reject") {
      assert.ok(
        result.overallScore! < profile.analysisThreshold,
        `${item.key}: ${result.overallScore} is above the threshold`,
      );
    }
  });

  if (hasDeepAnalysis(item)) {
    test(`${item.key}: specialists and synthesis parse and pass the deep analysis's checks`, () => {
      const { profile, ctx, allowed } = build(item);
      const packets = buildSpecialistPackets(item, ctx, specialistModules);
      assert.equal(packets.length, specialistModules.length);
      for (const [index, packet] of packets.entries()) {
        const parsed = specialistOutputSchema.parse(packet);
        validateSpecialistPacket(parsed, specialistModules[index]!, profile, ctx.caseId, allowed);
        assert.ok(parsed.cardData, `${item.key}/${packet.moduleId} has no card data`);
        cardDataSchema.parse(parsed.cardData);
        assert.ok(parsed.summary && parsed.headline, `${packet.moduleId} needs words`);
      }
      const deep = deepAnalysisOutputSchema.parse(buildDeepOutput(item, ctx, packets));
      validateReferences(deep, allowed);
      const audit = auditDeepOutput(deep, profile);
      assert.deepEqual(audit.blockingErrors, [], `${item.key}: ${audit.blockingErrors.join(" ")}`);
      assert.ok(deep.financialInputs.length >= 4, `${item.key} needs figures for the charts`);
      // The specialists' long texts are what the case page shows per criterion.
      for (const assessment of deep.assessments) {
        if (assessment.proposedScore === null) continue;
        assert.ok(assessment.rationale.length >= 150, `${assessment.criterionKey} too short`);
      }
    });
  }
}

test("ten cases spread over every path, six sectors and five countries", () => {
  assert.equal(DEMO_CASES.length, 10);
  assert.deepEqual(
    [...new Set(DEMO_CASES.map((item) => item.path))].sort(),
    Object.keys(DEMO_PATH_MOVES).sort(),
  );
  assert.ok(new Set(DEMO_CASES.map((item) => item.sector)).size >= 6);
  assert.ok(new Set(DEMO_CASES.map((item) => item.geography)).size >= 5);
  assert.equal(new Set(DEMO_CASES.map((item) => item.key)).size, DEMO_CASES.length);
});

test("every case is plainly fictional", () => {
  for (const item of DEMO_CASES) {
    assert.match(demoCompanyName(item), / \(demo\)$/);
    assert.match(item.website, /^https:\/\/[a-z0-9-]+\.example$/);
    assert.match(item.description, /^Fictional demo company\./);
    assert.match(item.profile.business, /\(fictional\)/);
    for (const row of item.evidence) assert.match(row.statedBy, /^Fictional /);
  }
});

test("no real company from the product's research set appears in the texts", () => {
  const real = RESEARCH_EVAL_CASES.filter((item) => !item.fictional);
  const scanner = createScanner(
    buildTerms({
      companies: real.map((item) => ({
        name: item.name,
        legal_name: null,
        website: item.website,
        domain: null,
        domains: null,
        cvr_number: null,
        registry_number: null,
      })),
      people: [],
      brainNames: [],
      decisionNames: [],
      aliasReals: [],
    }),
  );
  const hits = DEMO_CASES.flatMap((item) =>
    scanner.scan(JSON.stringify(item)).map((hit) => `${item.key}: ${hit.term.value}`),
  );
  assert.deepEqual(hits, []);
});

test("ids are stable per fund and differ between funds", () => {
  const item = DEMO_CASES[0]!;
  assert.equal(demoIds(FUND, item).case, demoIds(FUND, item).case);
  assert.notEqual(demoIds(FUND, item).case, demoIds(demoId(FUND, "other"), item).case);
  assert.match(
    demoIds(FUND, item).case,
    /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
});
