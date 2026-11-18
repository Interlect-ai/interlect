import assert from "node:assert/strict";
import { test } from "node:test";
import type { FundProfile } from "@/lib/funds/profiles";
import { AI_BUDGETS } from "./budgets.ts";
import {
  AI_TIERS,
  planFromStoredRun,
  resolveRunBudget,
  STANDARD_SPECIALIST_COUNT,
} from "./model-tiers.ts";
import {
  buildInvestmentCommitteeSynthesisPrompt,
  buildSpecialistPrompt,
  specialistModules,
} from "./specialist-prompts.ts";
import {
  activeSpecialistCount,
  MAX_SPECIALISTS,
  newCustomSpecialistKey,
  CUSTOM_SPECIALIST_KEY,
  resolveSpecialistSet,
  SCORE_CATEGORIES,
  specialistSetProblems,
  specialistSetSummary,
  specialistSetWarnings,
  type FundSpecialistRow,
} from "./specialist-set.ts";
import { specialistOutputSchema } from "./specialist.contracts.ts";

function standardOff(key: string): FundSpecialistRow {
  return {
    specialist_key: key,
    kind: "standard",
    enabled: false,
    sort_order: 0,
    name: null,
    purpose: null,
    mandate: null,
    evidence_tests: null,
    risk_areas: null,
    research_questions: [],
    output_focus: [],
    categories: [],
  };
}

function own(key: string, overrides: Partial<FundSpecialistRow> = {}): FundSpecialistRow {
  return {
    specialist_key: key,
    kind: "custom",
    enabled: true,
    sort_order: 1,
    name: "Impact og klima",
    purpose: "Vurderer selskabets dokumenterede klimaeffekt.",
    mandate: ["Vurder CO2-effekten"],
    evidence_tests: ["Målte tal"],
    risk_areas: ["greenwashing"],
    research_questions: ["Hvilke målte klimatal findes?"],
    output_focus: ["Klimaeffekt pr. kunde"],
    categories: [],
    ...overrides,
  };
}

const IMPACT = "custom_impact00001";
const ESG = "custom_esgcheck0001";

const profile = {
  id: "p",
  name: "Testfond",
  shortThesis: "t",
  thesis: "Klimateknologi i Norden",
  stages: ["seed"],
  geographies: ["DK"],
  sectors: ["Climate"],
  ticket: { minEur: 1, maxEur: 2, note: "" },
  fundSizeEur: null,
  analysisThreshold: 60,
  approvalMode: "partner_approval",
  riskPosture: "Moderat",
  distinctiveLens: ["Målt effekt"],
  gates: [{ key: "g", label: "G", description: "d", treatment: "hard" }],
  criteria: SCORE_CATEGORIES.map((category, index) => ({
    key: `k${index}`,
    label: category,
    description: "d",
    weight: 11,
    category,
  })),
  sources: [],
  version: "1",
  researchedAt: "2026-10-07",
} as unknown as FundProfile;

const input = {
  caseInput: { caseId: "c", companyName: "X", evidence: [], founders: [] },
  screening: { runId: "s" },
  computedFinancials: null,
} as unknown as Parameters<typeof buildSpecialistPrompt>[1];

test("without rows the set is the four standard modules with their own areas", () => {
  const set = resolveSpecialistSet([]);
  assert.deepEqual(
    set.map((specialist) => specialist.id),
    specialistModules.map((module) => module.id),
  );
  assert.equal(activeSpecialistCount([]), STANDARD_SPECIALIST_COUNT);
  assert.equal(specialistModules.length, STANDARD_SPECIALIST_COUNT);
});

test("every score area is assessed by exactly one specialist", () => {
  const cases: FundSpecialistRow[][] = [
    [],
    [standardOff("technology_risk")],
    [standardOff("technology_risk"), own(IMPACT)],
    [standardOff("people_team"), own(IMPACT, { categories: ["team_market_fit"] })],
    [
      standardOff("people_team"),
      standardOff("product_market_gtm"),
      standardOff("technology_risk"),
      own(IMPACT),
      own(ESG, { sort_order: 2 }),
    ],
    [
      standardOff("people_team"),
      standardOff("product_market_gtm"),
      standardOff("technology_risk"),
      standardOff("fund_finance_deal"),
      own(IMPACT),
    ],
  ];
  for (const rows of cases) {
    const owners = resolveSpecialistSet(rows).flatMap((specialist) => specialist.categories);
    assert.deepEqual([...owners].sort(), [...SCORE_CATEGORIES].sort(), JSON.stringify(rows));
  }
});

test("an active standard module keeps its areas even when an own specialist names them", () => {
  const set = resolveSpecialistSet([own(IMPACT, { categories: ["product_technology"] })]);
  assert.deepEqual(set.find((s) => s.id === "technology_risk")?.categories, [
    "product_technology",
    "evidence_quality",
  ]);
  assert.deepEqual(set.find((s) => s.id === IMPACT)?.categories, []);
});

test("a switched-off module's areas go to the own specialist that names them, then the first own", () => {
  const set = resolveSpecialistSet([
    standardOff("technology_risk"),
    own(ESG, { sort_order: 1 }),
    own(IMPACT, { sort_order: 2, categories: ["evidence_quality"] }),
  ]);
  assert.deepEqual(set.find((s) => s.id === IMPACT)?.categories, ["evidence_quality"]);
  assert.deepEqual(set.find((s) => s.id === ESG)?.categories, ["product_technology"]);
});

test("without own specialists the first active standard module inherits the areas", () => {
  const set = resolveSpecialistSet([standardOff("people_team")]);
  assert.equal(set[0]?.id, "product_market_gtm");
  assert.deepEqual(set[0]?.categories, [
    "founder_market_fit",
    "team_market_fit",
    "product_market_fit",
    "market_timing",
    "traction_gtm",
  ]);
});

test("switched-off and unusable own specialists are left out, the rest in sort order", () => {
  const set = resolveSpecialistSet([
    own(ESG, { sort_order: 5 }),
    own(IMPACT, { sort_order: 2 }),
    own("custom_offline0001", { enabled: false }),
    own("not-a-key"),
    own("custom_nomandate01", { mandate: [] }),
  ]);
  assert.deepEqual(
    set.map((s) => s.id),
    [...specialistModules.map((m) => m.id), IMPACT, ESG],
  );
  const impact = set.find((s) => s.id === IMPACT)!;
  assert.equal(impact.kind, "custom");
  assert.equal(impact.title, "Impact og klima");
  assert.deepEqual(impact.questions, ["Hvilke målte klimatal findes?"]);
  assert.deepEqual(impact.deliverables, ["Klimaeffekt pr. kunde"]);
});

test("the fund's module text is used for a standard specialist", () => {
  const set = resolveSpecialistSet(
    [],
    new Map([
      [
        "people_team",
        { module_id: "people_team", mandate: ["Eget"], evidence_tests: ["E"], risk_areas: ["R"] },
      ],
    ]),
  );
  assert.deepEqual(set[0]?.mandate, ["Eget"]);
  assert.deepEqual(set[1]?.mandate, specialistModules[1]?.mandate);
});

test("the publish rules match the database: at least one active, at most N own", () => {
  const allOff = specialistModules.map((module) => standardOff(module.id));
  assert.deepEqual(specialistSetProblems(allOff, 3), [
    "Mindst én specialist skal være aktiv i den dybe analyse.",
  ]);
  assert.deepEqual(specialistSetProblems([...allOff, own(IMPACT)], 3), []);
  const four = [1, 2, 3, 4].map((n) => own(`custom_impact0000${n}`));
  assert.equal(specialistSetProblems(four, 3).length, 1);
  assert.deepEqual(specialistSetProblems(four, 4), []);
  assert.equal(activeSpecialistCount([standardOff("people_team"), ...four]), 7);
  assert.ok(
    activeSpecialistCount([...four, own("custom_impact00005"), own("custom_x0000006")]) <=
      MAX_SPECIALISTS,
  );
});

test("a new key fits the database's format", () => {
  for (let index = 0; index < 50; index += 1) {
    assert.match(newCustomSpecialistKey(), CUSTOM_SPECIALIST_KEY);
  }
  assert.equal(
    newCustomSpecialistKey(() => 0),
    "custom_aaaaaaaaaaaa",
  );
});

test("a packet from an own specialist parses, a made-up id does not", () => {
  const packet = {
    schemaVersion: "interlect-specialist-v1",
    moduleId: IMPACT,
    caseId: "c",
    assessments: [],
    summary: null,
    findings: [],
    risks: [],
    strengths: [],
    weaknesses: [],
    unknowns: [],
    questions: [],
    financialInputs: [],
  };
  assert.equal(specialistOutputSchema.safeParse(packet).success, true);
  assert.equal(specialistOutputSchema.safeParse({ ...packet, moduleId: "esg" }).success, false);
});

test("the deep cap follows the number of specialists; four keeps the table's caps", () => {
  for (const tier of AI_TIERS) {
    const four = resolveRunBudget("deep", tier, null).budget;
    assert.deepEqual(resolveRunBudget("deep", tier, null, 4).budget, four);
    for (const count of [1, 2, 3, 5, 6, 7, MAX_SPECIALISTS]) {
      const { budget, customCap } = resolveRunBudget("deep", tier, null, count);
      assert.equal(customCap, false);
      // Every specialist call keeps the same share as with four.
      assert.ok(
        Math.abs(budget.specialistsUsd / count - four.specialistsUsd / 4) < 0.0001,
        `${tier}/${count}`,
      );
      assert.equal(budget.researchUsd, four.researchUsd);
      assert.equal(budget.synthesisUsd, four.synthesisUsd);
      assert.ok(
        Math.abs(budget.researchUsd + budget.specialistsUsd + budget.synthesisUsd - budget.usd) <
          0.0001,
      );
      assert.ok(budget.usd * AI_BUDGETS.exchangeRateDkkPerUsd <= budget.dkk + 1e-9);
      assert.equal(budget.dkk > four.dkk, count > 4);
    }
  }
  // Screening has no specialists.
  assert.deepEqual(
    resolveRunBudget("screening", "medium", null, 7),
    resolveRunBudget("screening", "medium", null),
  );
});

test("a stored run with seven specialists reads back as a standard cap, not a custom one", () => {
  const seven = resolveRunBudget("deep", "medium", null, 7).budget;
  const plan = planFromStoredRun("deep", { ai_tier: "medium", cost_cap_dkk: seven.dkk }, 7);
  assert.equal(plan.customCap, false);
  assert.deepEqual(plan.budget, seven);
  // A fund's own cap stays its real limit and is shared by all seven.
  const capped = resolveRunBudget("deep", "medium", 35, 7);
  assert.equal(capped.customCap, true);
  assert.ok(
    capped.budget.researchUsd + capped.budget.specialistsUsd + capped.budget.synthesisUsd <=
      capped.budget.usd + 1e-9,
  );
});

test("a standard module's prompt is the same with and without kind 'standard'", () => {
  for (const module of specialistModules) {
    const plain = buildSpecialistPrompt(profile, input, module);
    const resolved = buildSpecialistPrompt(
      profile,
      input,
      resolveSpecialistSet([]).find((specialist) => specialist.id === module.id)!,
    );
    assert.deepEqual(resolved, plain);
    assert.doesNotMatch(plain.system, /investeringsteamets egen specialist/);
  }
});

test("an own specialist's prompt carries its purpose, questions and deliverables", () => {
  const set = resolveSpecialistSet([standardOff("technology_risk"), own(IMPACT)]);
  const impact = set.find((specialist) => specialist.id === IMPACT)!;
  const { system, user } = buildSpecialistPrompt(profile, input, impact);
  assert.match(system, /SPECIALISTOPGAVE: Impact og klima/);
  assert.match(system, /Formål: Vurderer selskabets dokumenterede klimaeffekt\./);
  assert.match(system, /- Hvilke målte klimatal findes\?/);
  assert.match(system, /- Klimaeffekt pr\. kunde/);
  // It took over the switched-off module's areas, so it scores their criteria.
  assert.match(system, /- k5: product_technology/);
  assert.doesNotMatch(system, /assessments skal være den tomme liste/);
  assert.equal(JSON.parse(user).moduleId, IMPACT);

  const extra = resolveSpecialistSet([own(IMPACT)]).find((s) => s.id === IMPACT)!;
  assert.match(
    buildSpecialistPrompt(profile, input, extra).system,
    /assessments skal være den tomme liste \[\]/,
  );
});

test("the synthesis names the fund's set only when it differs from the standard four", () => {
  const standard = buildInvestmentCommitteeSynthesisPrompt(profile, input, [], [], undefined);
  assert.deepEqual(
    buildInvestmentCommitteeSynthesisPrompt(profile, input, [], [], resolveSpecialistSet([])),
    standard,
  );
  const own_ = buildInvestmentCommitteeSynthesisPrompt(
    profile,
    input,
    [],
    [],
    resolveSpecialistSet([standardOff("technology_risk"), own(IMPACT)]),
  ).system;
  assert.match(own_, /Investeringsteamets specialister i denne analyse/);
  assert.match(own_, /custom_impact00001: Impact og klima \(investeringsteamets egen specialist\)/);
  assert.match(
    own_,
    /Investeringsteamet har fravalgt: Produktteknologi, data, IP og tværgående risici\./,
  );
});

test("the run stores a short summary of its set", () => {
  const summary = specialistSetSummary(resolveSpecialistSet([own(IMPACT)]));
  assert.deepEqual(summary.at(-1), {
    id: IMPACT,
    kind: "custom",
    title: "Impact og klima",
    categories: [],
  });
  assert.equal(summary[0]?.kind, "standard");
});

test("the areas of several switched-off modules are shared out among the own specialists", () => {
  const set = resolveSpecialistSet([
    standardOff("people_team"),
    standardOff("product_market_gtm"),
    standardOff("technology_risk"),
    own(IMPACT, { sort_order: 1 }),
    own(ESG, { sort_order: 2 }),
  ]);
  assert.deepEqual(set.find((s) => s.id === IMPACT)?.categories, [
    "founder_market_fit",
    "team_market_fit",
    "product_technology",
    "evidence_quality",
  ]);
  assert.deepEqual(set.find((s) => s.id === ESG)?.categories, [
    "product_market_fit",
    "market_timing",
    "traction_gtm",
  ]);
  assert.deepEqual(specialistSetWarnings(set), []);
});

test("one specialist with most areas gets a warning, not a refusal", () => {
  const alone = resolveSpecialistSet([
    ...specialistModules.map((module) => standardOff(module.id)),
    own(IMPACT),
  ]);
  assert.equal(alone[0]?.categories.length, 9);
  assert.equal(specialistSetWarnings(alone).length, 1);
  assert.match(specialistSetWarnings(alone)[0]!, /Impact og klima vurderer 9 af de ni områder/);
});

test("financial strength and the finance duties move together", () => {
  const set = resolveSpecialistSet([standardOff("fund_finance_deal"), own(IMPACT)]);
  const impact = set.find((s) => s.id === IMPACT)!;
  assert.ok(impact.categories.includes("financial_strength"));
  const { system, user } = buildSpecialistPrompt(
    profile,
    { ...input, computedFinancials: { metrics: [] } } as unknown as typeof input,
    impact,
  );
  assert.match(system, /Du er finansspecialisten/);
  assert.ok("computedFinancials" in JSON.parse(user));
  const people = set.find((s) => s.id === "people_team")!;
  assert.match(
    buildSpecialistPrompt(profile, input, people).system,
    /Du er ikke finansspecialisten/,
  );
});
