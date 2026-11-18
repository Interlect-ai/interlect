/** Prompterne kalder kunden "teamet"/"investeringstesen", aldrig "fonden"/"the fund". Kør: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { FundProfile } from "@/lib/funds/profiles";
import { buildScreeningPrompt, screeningInstructionSection } from "./prompt.ts";
import type { ScreeningCaseInput } from "./prompt.ts";
import {
  buildInvestmentCommitteeSynthesisPrompt,
  buildSpecialistPrompt,
  deepInstructionSection,
  globalDeepInstruction,
  specialistModules,
  type DeepSpecialist,
} from "./specialist-prompts.ts";
import { fundSizePromptLine } from "../funds/fund-size.ts";
import { THESIS_STEPS, thesisStepSystemPrompt } from "../funds/thesis-steps.ts";
import {
  outputLanguageDirective,
  TEAM_WORD_RULE_DA,
  TEAM_WORD_RULE_EN,
} from "../i18n/ai-language.ts";
import { buildSystemPrompt } from "../brain/chat/prompt.ts";
import { REFLECTOR_PROMPT_V1 } from "../brain/prompts/reflector.ts";
import { CURATOR_PROMPT_V1 } from "../brain/prompts/curator.ts";
import { PAGE_WRITER_PROMPT_V1 } from "../brain/prompts/page-writer.ts";

/** Dansk "fond…" (ikke "fund", som på dansk betyder fundne ting) og engelsk "the fund"-varianter. */
const FUND_WORD =
  /\b(fond\w*|venturefond\w*|investeringsfond\w*)\b|\b(the|this|a|venture|investment) funds?\b|\bfund's\b/i;

const profile = {
  id: "team-test",
  name: "Testteam",
  shortThesis: "B2B-software",
  thesis: "B2B-software i Norden",
  stages: ["seed"],
  geographies: ["DK"],
  sectors: ["software"],
  ticket: { minEur: 500_000, maxEur: 2_000_000, note: "" },
  fundSizeEur: 50_000_000,
  analysisThreshold: 60,
  approvalMode: "partner_approval",
  riskPosture: "Moderat",
  distinctiveLens: [],
  gates: [{ key: "geo", label: "Norden", description: "Selskabet er nordisk.", treatment: "hard" }],
  criteria: [
    {
      key: "team",
      label: "Team",
      description: "Teamets erfaring.",
      weight: 100,
      category: "team_market_fit",
    },
  ],
  sources: [],
  version: "config-v3",
  researchedAt: "2026-10-12",
  screeningInstruction: "Vi vægter betalingsvillighed over brugervækst.",
} as FundProfile;

const caseInput: ScreeningCaseInput = {
  caseId: "00000000-0000-4000-8000-000000000001",
  companyName: "Selskab",
  website: null,
  stage: "seed",
  intakeSources: ["manual"],
  evidence: [],
  relatedPastCases: [],
};
const deepInput = {
  caseInput: { ...caseInput, founders: [] },
  screening: { runId: "s" },
  computedFinancials: null,
} as unknown as Parameters<typeof buildSpecialistPrompt>[1];

const custom: DeepSpecialist = {
  id: "custom_impact",
  kind: "custom",
  title: "Impact og klima",
  categories: ["product_technology"],
  mandate: ["Vurder selskabets klimaeffekt."],
  evidenceTests: ["Dokumenteret CO2-reduktion hos kunderne"],
  riskAreas: ["greenwashing"],
  purpose: "Målbar klimaeffekt",
  questions: ["Hvilke certificeringer har produktet?"],
};

function assertNoFundWord(label: string, raw: string) {
  // The rule that forbids the word is the only place it may stand.
  const text = raw.split(TEAM_WORD_RULE_DA).join("").split(TEAM_WORD_RULE_EN).join("");
  const hit = FUND_WORD.exec(text);
  assert.equal(
    hit,
    null,
    `${label}: "${hit?.[0]}" i "${text.slice(Math.max(0, (hit?.index ?? 0) - 60), (hit?.index ?? 0) + 40)}"`,
  );
}

test("screeningens og den dybe analyses prompter siger ikke fonden", () => {
  const screening = buildScreeningPrompt(profile, caseInput);
  assertNoFundWord("screening", screening.system + screening.user);
  assertNoFundWord("screeningsinstruktion", screeningInstructionSection("Vi vægter X."));
  assertNoFundWord("dyb instruktion", deepInstructionSection("Vi vægter X."));
  assertNoFundWord("fælles ramme", globalDeepInstruction(profile));
  for (const specialist of [...specialistModules, custom]) {
    assertNoFundWord(specialist.id, buildSpecialistPrompt(profile, deepInput, specialist).system);
  }
  assertNoFundWord(
    "syntese",
    buildInvestmentCommitteeSynthesisPrompt(profile, deepInput, []).system,
  );
  assertNoFundWord("kapitallinje", fundSizePromptLine(50_000_000, 500_000, 2_000_000));
  assertNoFundWord("engelsk sprogregel", outputLanguageDirective("en"));
});

test("Ny tese, Brain-chatten og Brains egne prompter siger ikke fonden", () => {
  for (const step of THESIS_STEPS) assertNoFundWord(step, thesisStepSystemPrompt(step));
  for (const thesis of ["B2B-software i Norden", null]) {
    assertNoFundWord(
      "chat",
      buildSystemPrompt({
        fundName: "Testteam",
        thesis,
        scope: "cases",
        focusCase: null,
        entities: [],
        today: "2026-10-12",
        web: true,
      }),
    );
  }
  assertNoFundWord("reflector", REFLECTOR_PROMPT_V1);
  assertNoFundWord("curator", CURATOR_PROMPT_V1);
  assertNoFundWord("page_writer", PAGE_WRITER_PROMPT_V1);
});

test("reglen om teamet står i screeningen, den dybe analyse, den engelske sprogregel og Brain", () => {
  assert.ok(buildScreeningPrompt(profile, caseInput).system.includes(TEAM_WORD_RULE_DA));
  assert.ok(globalDeepInstruction(profile).includes(TEAM_WORD_RULE_DA));
  assert.ok(outputLanguageDirective("en").includes(TEAM_WORD_RULE_EN));
  for (const prompt of [REFLECTOR_PROMPT_V1, CURATOR_PROMPT_V1, PAGE_WRITER_PROMPT_V1]) {
    assert.ok(prompt.includes(TEAM_WORD_RULE_EN));
  }
});

test("researchens opfølgning og bevisarket siger teamet, ikke fonden (T-736)", async () => {
  const { reflectionSystemPrompt } = await import("./research-followup.ts");
  const { evidenceSheetSystemPrompt } = await import("./evidence-sheet.ts");
  for (const [label, prompt] of [
    ["opfølgning", reflectionSystemPrompt()],
    ["bevisark", evidenceSheetSystemPrompt()],
  ] as const) {
    assert.ok(prompt.includes(TEAM_WORD_RULE_EN), label);
    assertNoFundWord(label, prompt);
  }
});

test("the identity's one-liner follows the team's language (T-747 a)", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("./identity-extraction.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /neutral Danish sentence/);
  assert.match(source, /neutral \$\{englishPromptLanguageName\(language\)\} sentence/);
});
