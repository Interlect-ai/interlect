import { test } from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import {
  auditDeepTextLengths,
  auditRiskRationale,
  countSentences,
  CRITERION_RATIONALE,
  FUNCTION_MAX_DURATION_SECONDS,
  OVERALL_ASSESSMENT,
  SAVE_MARGIN_MS,
  MAX_CALL_TIMEOUT_MS,
  STEP_STALE_AFTER_MS,
  SPECIALIST_SUMMARY,
  SYNTHESIS_RISK,
} from "./deep-text-rules.ts";
import { specialistOutputSchema } from "./specialist.contracts.ts";
import { deepAnalysisOutputSchema } from "./deep.contracts.ts";

const text = (length: number) => "a".repeat(length);

test("the schema floors are above the quality control's blocking floors", () => {
  assert.ok(CRITERION_RATIONALE.schemaMin > CRITERION_RATIONALE.warnBelow - 300);
  assert.ok(CRITERION_RATIONALE.blockingMin < CRITERION_RATIONALE.warnBelow);
  assert.ok(OVERALL_ASSESSMENT.blockingMin < OVERALL_ASSESSMENT.warnBelow);
  assert.ok(SPECIALIST_SUMMARY.schemaMin < SPECIALIST_SUMMARY.schemaMax);
});

test("a criterion text that is clearly too thin blocks, one a little short only warns", () => {
  const audit = auditDeepTextLengths({
    assessments: [
      { criterionKey: "thin", rationale: text(120) },
      { criterionKey: "short", rationale: text(450) },
      { criterionKey: "good", rationale: text(1_400) },
    ],
    overallAssessment: text(1_500),
  });
  assert.equal(audit.blockingErrors.length, 1);
  assert.match(audit.blockingErrors[0]!, /thin/);
  assert.equal(audit.warnings.length, 1);
  assert.match(audit.warnings[0]!, /short/);
});

test("the overall assessment has its own floors", () => {
  const thin = auditDeepTextLengths({ assessments: [], overallAssessment: text(100) });
  assert.equal(thin.blockingErrors.length, 1);
  const short = auditDeepTextLengths({ assessments: [], overallAssessment: text(400) });
  assert.deepEqual([short.blockingErrors.length, short.warnings.length], [0, 1]);
});

/** A risk text of `count` Danish sentences of about `each` characters. */
const sentences = (count: number, each = 115) =>
  Array.from(
    { length: count },
    (_, index) =>
      `Sætning ${index + 1} om risikoen ${"og dens betydning ".repeat(6)}`.slice(0, each - 1) + ".",
  ).join(" ");

test("the risk floors sit below the prompt's target, and the parse floor is the blocking floor", () => {
  assert.ok(SYNTHESIS_RISK.rationaleBlockingMin < SYNTHESIS_RISK.rationaleSchemaMin);
  assert.ok(SYNTHESIS_RISK.rationaleBlockingSentences < SYNTHESIS_RISK.rationaleTargetSentences);
  assert.ok(SYNTHESIS_RISK.rationaleSchemaMin < SYNTHESIS_RISK.rationaleMax);
});

test("T-715: a risk of 6 sentences and 650+ characters only warns (run 82707b57 was rejected)", () => {
  const rationale = sentences(6);
  assert.equal(countSentences(rationale), 6);
  assert.ok(rationale.length >= 650);
  const check = auditRiskRationale("Regulatorisk kompleksitet", rationale);
  assert.equal(check.blockingError, null);
  assert.match(check.warning ?? "", /Regulatorisk kompleksitet .*6 sætninger.*mindst 8/);
});

test("a two- or three-sentence summary of a risk still blocks", () => {
  const check = auditRiskRationale("Afhængighed af tredjepart", sentences(3, 250));
  assert.match(check.blockingError ?? "", /Afhængighed af tredjepart .*3 sætninger/);
  assert.equal(check.warning, null);
});

test("a risk text under the character floor blocks, whatever its sentence count", () => {
  const check = auditRiskRationale("Kort", sentences(6, 60));
  assert.ok(check.blockingError);
});

test("a risk at the target passes without a note, in either language", () => {
  assert.deepEqual(auditRiskRationale("Fuld", sentences(9)), {
    blockingError: null,
    warning: null,
  });
  assert.match(auditRiskRationale("Short", sentences(5), "en").warning ?? "", /5 sentences/);
});

const criterion = {
  criterionKey: "team",
  proposedScore: 70,
  confidence: 0.6,
  rationale: "Begrundelse.",
  citations: [],
  unknowns: [],
};

test("an old stored specialist output (no summary) still parses; a new one keeps its summary", () => {
  const old = {
    schemaVersion: "interlect-specialist-v1",
    moduleId: "people_team",
    caseId: "c",
    assessments: [criterion],
    findings: [],
    risks: [],
    strengths: [],
    weaknesses: [],
    unknowns: [],
    questions: [],
    financialInputs: [],
  };
  assert.equal(specialistOutputSchema.parse(old).summary, undefined);
  assert.equal(
    specialistOutputSchema.parse({ ...old, summary: "Teamet er stærkt." }).summary,
    "Teamet er stærkt.",
  );
  assert.equal(specialistOutputSchema.parse({ ...old, summary: null }).summary, null);
});

test("an old deep synthesis (no investment condition) still parses; a new one keeps it", () => {
  const risk = {
    riskKey: "r",
    label: "Risiko",
    level: "high",
    likelihood: 3,
    impact: 3,
    rationale: "x".repeat(700),
    evidenceIds: [],
    mitigation: "y".repeat(200),
  };
  const old = {
    schemaVersion: "interlect-deep-v1",
    fundProfileId: "p",
    fundProfileVersion: "1",
    caseId: "c",
    assessments: [criterion],
    gates: [],
    risks: [risk],
    strengths: [],
    weaknesses: [],
    openQuestions: [],
    overallAssessment: "Samlet.",
    contraryCase: "Modfortolkning.",
    proposedRecommendation: "follow",
    findings: [],
    financialInputs: [],
  };
  assert.equal(deepAnalysisOutputSchema.parse(old).investmentCondition, undefined);
  // A paid synthesis with a risk a little under the JSON schema's 650 still parses.
  const shortRisk = { ...risk, rationale: "x".repeat(SYNTHESIS_RISK.rationaleBlockingMin + 50) };
  assert.doesNotThrow(() => deepAnalysisOutputSchema.parse({ ...old, risks: [shortRisk] }));
  assert.equal(
    deepAnalysisOutputSchema.parse({ ...old, investmentCondition: "Sikr vesting." })
      .investmentCondition,
    "Sikr vesting.",
  );
});

test("timeouts, save margin, function limit and step lease are consistent (ceiling: 300 s)", () => {
  assert.ok(FUNCTION_MAX_DURATION_SECONDS <= 300, "the chosen ceiling is 300 s");
  const longest = MAX_CALL_TIMEOUT_MS;
  // One call plus the saving must fit in the invocation (calls inside a phase run in parallel).
  assert.ok(longest + SAVE_MARGIN_MS <= FUNCTION_MAX_DURATION_SECONDS * 1000);
  // A running step is taken over only after the function can no longer be running.
  assert.ok(STEP_STALE_AFTER_MS > FUNCTION_MAX_DURATION_SECONDS * 1000);
  const nitro = readFileSync(new URL("../../../nitro.config.ts", import.meta.url), "utf8");
  assert.match(nitro, new RegExp(`maxDuration: ${FUNCTION_MAX_DURATION_SECONDS}\\b`));
});
