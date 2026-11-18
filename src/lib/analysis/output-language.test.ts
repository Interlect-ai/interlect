/** Screening og dyb analyse skrives på fondens sprog. Kør: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { FundProfile } from "@/lib/funds/profiles";
import { buildScreeningPrompt, type ScreeningCaseInput } from "./prompt.ts";
import {
  buildInvestmentCommitteeSynthesisPrompt,
  buildSpecialistPrompt,
  globalDeepInstruction,
  specialistModules,
} from "./specialist-prompts.ts";

const profile = {
  id: "fund-test",
  name: "Testfond",
  shortThesis: "B2B-software",
  thesis: "B2B-software i Norden",
  stages: ["seed"],
  geographies: ["DK"],
  sectors: ["software"],
  ticket: { minEur: 500_000, maxEur: 2_000_000, note: "" },
  fundSizeEur: null,
  analysisThreshold: 60,
  approvalMode: "partner_approval",
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
  sources: [],
  version: "config-v3",
  researchedAt: "2026-10-07",
} as FundProfile;
const english = { ...profile, language: "en" } as FundProfile;
const danish = { ...profile, language: "da" } as FundProfile;

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

test("screening: a Danish fund's prompt is the same as a fund without a language", () => {
  assert.deepEqual(
    buildScreeningPrompt(danish, caseInput),
    buildScreeningPrompt(profile, caseInput),
  );
  const { system } = buildScreeningPrompt(danish, caseInput);
  assert.match(system, /skal skrives på dansk i hele sætninger\. Svar aldrig på engelsk\./);
  assert.doesNotMatch(system, /OUTPUT LANGUAGE/);
});

test("screening: an English fund is told to write English, last in the prompt", () => {
  const { system } = buildScreeningPrompt(english, caseInput);
  assert.match(system, /skal skrives på engelsk i hele sætninger\. Svar aldrig på dansk\./);
  assert.match(system, /2-4 korte, sammenhængende sætninger på engelsk/);
  assert.match(system, /companyLabel er den korte etiket ved siden af selskabets navn, på engelsk/);
  assert.match(system, /OUTPUT LANGUAGE: ENGLISH\.[^]*$/);
  assert.ok(system.trimEnd().endsWith("exactly as given."));
});

test("deep analysis: Danish unchanged, English in every specialist and the synthesis", () => {
  for (const module of specialistModules) {
    assert.deepEqual(
      buildSpecialistPrompt(danish, deepInput, module),
      buildSpecialistPrompt(profile, deepInput, module),
    );
    const { system, user } = buildSpecialistPrompt(english, deepInput, module);
    assert.match(system, /OUTPUT LANGUAGE: ENGLISH/, module.id);
    assert.equal(JSON.parse(user).outputLanguage, "en-GB");
    assert.equal(
      JSON.parse(buildSpecialistPrompt(danish, deepInput, module).user).outputLanguage,
      "da-DK",
    );
  }
  const synthesis = buildInvestmentCommitteeSynthesisPrompt(english, deepInput, []);
  assert.match(synthesis.system, /OUTPUT LANGUAGE: ENGLISH/);
  assert.match(synthesis.system, /en kort, professionel engelsk titel/);
  assert.match(synthesis.system, /title = et kort navn på opgaven på højst 6 ord på engelsk/);
  assert.match(
    synthesis.system,
    /question = selve spørgsmålet eller handlingen i én hel sætning på engelsk/,
  );
  assert.equal(JSON.parse(synthesis.user).outputLanguage, "en-GB");
  assert.deepEqual(
    buildInvestmentCommitteeSynthesisPrompt(danish, deepInput, []),
    buildInvestmentCommitteeSynthesisPrompt(profile, deepInput, []),
  );
});

test("deep analysis: the shared rules name the fund's language and the other one", () => {
  const en = globalDeepInstruction(english);
  assert.match(en, /på flydende, nøgternt engelsk/);
  assert.match(en, /Oversæt danske kilders indhold til engelsk/);
  assert.match(
    en,
    /Et svar med danske afsnit opfylder ikke kontrakten, selv når kilderne er danske\./,
  );
  const da = globalDeepInstruction(danish);
  assert.match(da, /Oversæt engelske kilders indhold til dansk/);
  assert.match(
    da,
    /Et svar med engelske afsnit opfylder ikke kontrakten, selv når kilderne er engelske\./,
  );
});
