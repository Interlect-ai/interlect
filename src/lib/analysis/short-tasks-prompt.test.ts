/** The prompts ask for short tasks, and open questions only as tasks. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { FundProfile } from "@/lib/funds/profiles";
import { buildScreeningPrompt, type ScreeningCaseInput } from "./prompt.ts";
import { buildInvestmentCommitteeSynthesisPrompt } from "./specialist-prompts.ts";

const profile = {
  id: "fund-test",
  name: "Testteam",
  thesis: "B2B-software i Norden",
  stages: ["seed"],
  geographies: ["DK"],
  sectors: ["software"],
  ticket: { minEur: 500_000, maxEur: 2_000_000, note: "" },
  fundSizeEur: null,
  analysisThreshold: 60,
  riskPosture: "Moderat",
  distinctiveLens: [],
  gates: [{ key: "geo", label: "Norden", description: "Selskabet er nordisk.", treatment: "hard" }],
  criteria: [
    {
      key: "team",
      label: "Team",
      description: "Erfaring.",
      weight: 100,
      category: "team_market_fit",
    },
  ],
  version: "config-v3",
} as unknown as FundProfile;

const caseInput: ScreeningCaseInput = {
  caseId: "00000000-0000-4000-8000-000000000001",
  companyName: "Selskab",
  website: null,
  stage: "seed",
  intakeSources: ["manual"],
  evidence: [],
  relatedPastCases: [],
};

test("the screening asks for a curated list with a short title and the question", () => {
  const { system } = buildScreeningPrompt(profile, caseInput);
  assert.match(system, /nextSteps er listen "Skal afklares": de højst 8 vigtigste/);
  assert.match(system, /title = et kort navn på opgaven på højst 6 ord på dansk/);
  assert.match(system, /question = selve spørgsmålet eller handlingen i én hel sætning på dansk/);
  assert.match(system, /passed null, skal have præcis én opgave med linkedKind "gate"/);
  // Open questions never inside the texts on the surface.
  assert.match(
    system,
    /skriv aldrig åbne spørgsmål .* ind i overallAssessment, companyProfile, keyFindings, verdict eller rationale/,
  );
  assert.match(
    system,
    /status \(hvor selskabet står nu, og hvad der er bekræftet; det, der mangler, står i nextSteps\)/,
  );
  assert.doesNotMatch(system, /hvad der mangler før næste skridt/);
});

test("the synthesis writes the same task fields and keeps open questions out of its texts", () => {
  const { system } = buildInvestmentCommitteeSynthesisPrompt(
    profile,
    {
      caseInput: { ...caseInput, founders: [] },
      screening: { runId: "s" },
      computedFinancials: null,
    } as unknown as Parameters<typeof buildInvestmentCommitteeSynthesisPrompt>[1],
    [],
  );
  assert.match(system, /Skriv nextSteps: en kort, redigeret liste \(højst 10\)/);
  assert.match(system, /title = et kort navn på opgaven på højst 6 ord/);
  assert.match(system, /ind i overallAssessment, investmentCondition, verdict eller rationale/);
  assert.doesNotMatch(system, /maks\. 120 tegn/);
});

test("both JSON schemas require the question, and the screening requires its list", () => {
  const source = readFileSync(new URL("./screening.functions.ts", import.meta.url), "utf8");
  assert.match(source, /nextSteps: nextStepsJsonSchema\(MAX_SCREENING_NEXT_STEPS\)/);
  assert.match(source, /"proposedRecommendation",\n\s+"nextSteps",/);
  assert.match(
    source,
    /required: \["title", "question", "why", "kind", "linkedKind", "linkedKey", "priority"\]/,
  );
  assert.match(source, /PROMPT_VERSION = "interlect-screening-v13-short-texts"/);
  const deep = readFileSync(new URL("./deep.functions.ts", import.meta.url), "utf8");
  assert.match(deep, /nextSteps: nextStepsJsonSchema\(SYNTHESIS_NEXT_STEPS\.maxItems\)/);
  // The base already requires nextSteps; a JSON schema lists each key once.
  assert.doesNotMatch(deep, /"investmentCondition", "nextSteps"/);
});

test("short texts: a summary of about five lines, the label and the specialist's point (T-753b)", () => {
  const source = readFileSync(new URL("./screening.functions.ts", import.meta.url), "utf8");
  assert.match(
    source,
    /overallAssessment: \{ type: "string", minLength: 1, maxLength: SCREENING_SUMMARY\.max \}/,
  );
  assert.match(source, /\["companyProfile", "keyFindings", "companyLabel"\]/);
  const deep = readFileSync(new URL("./deep.functions.ts", import.meta.url), "utf8");
  assert.match(deep, /headline: \{ type: "string", maxLength: SPECIALIST_HEADLINE\.max \}/);
  assert.match(deep, /"summary",\n\s+"headline",/);
  // The summary points the same way as the recommendation but never states it itself.
  const prompt = readFileSync(new URL("./prompt.ts", import.meta.url), "utf8");
  assert.match(
    prompt,
    /pege samme vej som proposedRecommendation, men skriv ikke selve anbefalingen/,
  );
});
