/** Researchbrief og -plan pr. case (planlægger-agenten). Kør: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { FundProfile } from "@/lib/funds/profiles";
import type { TopicsBrief } from "./search-topics.ts";
import {
  PLAN_QUESTIONS_PER_MODULE,
  RESEARCH_PLAN_MODELS,
  RESEARCH_PLAN_VERSION,
  readStoredResearchPlan,
  researchPlanPrompt,
  researchPlanSchema,
  sanitizeResearchPlan,
  type RawResearchPlan,
} from "./research-plan.ts";

const profile = {
  id: "fund-test",
  name: "Testfond",
  shortThesis: "B2B-software",
  thesis: "Vi investerer i nordisk B2B-software med dokumenteret betalingsvillighed",
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
      description: "Teamets erfaring.",
      weight: 60,
      category: "team_market_fit",
    },
    {
      key: "traction",
      label: "Traction",
      description: "Betalende kunder.",
      weight: 40,
      category: "traction_gtm",
    },
  ],
  sources: [],
  version: "config-v3",
  researchedAt: "2026-10-08",
} as FundProfile;

const brief: TopicsBrief = {
  thesis: profile.thesis,
  stages: profile.stages,
  geographies: profile.geographies,
  sectors: profile.sectors,
  ticket: profile.ticket,
  riskPosture: profile.riskPosture,
  gates: profile.gates,
  criteria: profile.criteria,
  distinctiveLens: profile.distinctiveLens,
};

const INSTRUCTION = "Vi lægger mest vægt på om kunderne betaler frem for brugervækst";
const MODULES = ["founders_team", "traction_customers_gtm", "market_competition"];

const hypothesis = (text: string) => ({
  hypothesis: text,
  confirms: "Daterede kundecases",
  refutes: "Ingen betalende kunder",
});

const raw: RawResearchPlan = {
  brief: "Selskabet sælger til [Person 1] og skal vise betalende kunder.",
  items: [
    // Gaten står før kriterierne og et ukendt kriterie er med: rækkefølgen bliver fondens.
    {
      kind: "gate",
      key: "geo",
      hypotheses: [hypothesis("Selskabet har hovedsæde i Danmark")],
      sourceTypes: ["official_registry", "nonsense"],
      questions: [
        {
          module: "market_competition",
          question: "Find the company's registered headquarters country",
        },
      ],
    },
    {
      kind: "criterion",
      key: "ukendt",
      hypotheses: [hypothesis("Må ikke komme med")],
      sourceTypes: [],
      questions: [{ module: "market_competition", question: "Find the company's patents" }],
    },
    {
      kind: "criterion",
      key: "traction",
      hypotheses: Array.from({ length: 7 }, (_, i) => hypothesis(`Hypotese ${i + 1}`)),
      sourceTypes: ["customer_references", "press"],
      questions: [
        { module: "traction_customers_gtm", question: "Find dated evidence of paying customers" },
        // Et tal er en tærskel.
        { module: "traction_customers_gtm", question: "Find whether revenue exceeds 5 million" },
        // Kopierer fondens instruktion.
        { module: "traction_customers_gtm", question: "Om kunderne betaler frem for brugervækst" },
      ],
    },
    {
      kind: "criterion",
      key: "team",
      hypotheses: [hypothesis("Founderen har solgt til samme købere før")],
      sourceTypes: ["founder_profiles"],
      questions: [
        // Et maskeret navn må aldrig ud på nettet.
        { module: "founders_team", question: "Find the earlier companies of [Person 1]" },
        // Navngiver, hvad fonden vil.
        { module: "founders_team", question: "Find what makes the team fit the fund's thesis" },
        // Ukendt spor.
        { module: "not_a_track", question: "Find the founders' earlier exits" },
        { module: "founders_team", question: "Find the founders' earlier exits" },
        { module: "founders_team", question: "Find the founders' earlier exits" },
        { module: "founders_team", question: "Find the CTO's previous employers" },
        { module: "founders_team", question: "Find board members and advisors" },
      ],
    },
  ],
};

const sanitize = (perModule: number) =>
  sanitizeResearchPlan(raw, {
    profile,
    brief,
    confidential: [INSTRUCTION],
    moduleIds: MODULES,
    perModule,
    model: "openai/gpt-5.4",
    restore: (text) => text.replaceAll("[Person 1]", "Kommunerne"),
  });

test("planen følger fondens kriterier og gates i fondens rækkefølge", () => {
  const plan = sanitize(2);
  assert.deepEqual(
    plan.items.map((item) => `${item.kind}:${item.key}`),
    ["criterion:team", "criterion:traction", "gate:geo"],
  );
  assert.equal(plan.items[1]!.label, "Traction");
  assert.equal(plan.items[1]!.hypotheses.length, 5);
  assert.deepEqual(plan.items[2]!.sourceTypes, ["official_registry"]);
  assert.equal(plan.version, RESEARCH_PLAN_VERSION);
});

test("kun neutrale spørgsmål går til websøgningen, højst et loft pr. spor", () => {
  const plan = sanitize(2);
  assert.deepEqual(plan.questions, {
    founders_team: ["Find the founders' earlier exits", "Find the CTO's previous employers"],
    traction_customers_gtm: ["Find dated evidence of paying customers"],
    market_competition: ["Find the company's registered headquarters country"],
  });
  // Pladsholder, tal, kopi af instruktionen og fondens ønske er udeladt (og talt).
  assert.equal(plan.droppedQuestions, 4);
  const sent = JSON.stringify(plan.questions);
  assert.doesNotMatch(sent, /\[Person 1\]|Kommunerne|brugervækst|fund|5 million|patents/);
});

test("briefen og hypoteserne får navnene tilbage; de bliver i det fortrolige", () => {
  const plan = sanitize(2);
  assert.match(plan.brief, /sælger til Kommunerne/);
});

test("loftet pr. spor følger kørslen og niveauet", () => {
  assert.equal(sanitize(1).questions["founders_team"]?.length, 1);
  assert.ok(PLAN_QUESTIONS_PER_MODULE.screening.light < PLAN_QUESTIONS_PER_MODULE.deep.heavy);
  // Screeningen planlægger med den hurtige model; den dybe analyse på Middel med gpt-5.4.
  assert.equal(RESEARCH_PLAN_MODELS.screening.heavy, "openai/gpt-5.4-mini");
  assert.equal(RESEARCH_PLAN_MODELS.deep.medium, "openai/gpt-5.4");
});

test("et tomt eller ødelagt svar giver en tom plan, ikke en fejl", () => {
  const plan = sanitizeResearchPlan({ brief: "", items: null } as unknown as RawResearchPlan, {
    profile,
    brief,
    confidential: [],
    moduleIds: MODULES,
    perModule: 2,
    model: "m",
  });
  assert.deepEqual(plan.items, []);
  assert.deepEqual(plan.questions, {});
});

test("planlæggeren får fondens opsætning og casens materiale som data", () => {
  const prompt = JSON.parse(
    researchPlanPrompt(
      { profile, screeningInstruction: INSTRUCTION },
      {
        companyName: "Selskab",
        website: null,
        stage: "seed",
        identity: null,
        deck: "Deck",
        website_text: "",
        registry: "CVR 12345678",
      },
      [{ id: "founders_team", questions: ["Q"] }],
      "da",
    ),
  );
  assert.equal(prompt.fund.screeningInstruction, INSTRUCTION);
  assert.deepEqual(
    prompt.fund.criteria.map((c: { key: string }) => c.key),
    ["team", "traction"],
  );
  assert.equal(prompt.company.registryData, "CVR 12345678");
  const schema = researchPlanSchema(MODULES);
  assert.deepEqual(
    schema.properties.items.items.properties.questions.items.properties.module.enum,
    MODULES,
  );
});

test("en gemt plan læses kun tilbage i samme version", () => {
  const plan = sanitize(2);
  assert.deepEqual(readStoredResearchPlan(JSON.parse(JSON.stringify(plan))), plan);
  assert.equal(readStoredResearchPlan({ ...plan, version: "old" }), null);
  assert.equal(readStoredResearchPlan(null), null);
});
