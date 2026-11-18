/** Opfølgningsrunder i researchen (refleksion). Kør: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { FundProfile } from "@/lib/funds/profiles";
import type { TopicsBrief } from "./search-topics.ts";
import { SCREENING_CALL_TIMEOUT_MS } from "./model-tiers.ts";
import { FUNCTION_MAX_DURATION_SECONDS } from "./deep-text-rules.ts";
import { RESEARCH_PLAN_VERSION, type ResearchPlan } from "./research-plan.ts";
import { EVIDENCE_SHEET_TIMEOUT_MS } from "./evidence-sheet.ts";
import {
  AFTER_RESEARCH_MARGIN_MS,
  FOLLOWUP_MIN_SEARCH_MS,
  FOLLOWUP_ROUNDS,
  MAX_FOUNDER_QUESTIONS,
  REFLECTION_MIN_MS,
  REFLECTION_MODELS,
  RESEARCH_FOLLOWUP_VERSION,
  followUpStopAfterReflection,
  founderQuestions,
  readStoredResearchFollowUp,
  reflectionPrompt,
  reflectionSchema,
  researchDeadlineAt,
  sanitizeReflection,
  type FollowUpItem,
  type RawReflection,
} from "./research-followup.ts";
import { buildAiTaskDrafts, type AiTaskSource } from "../cases/tasks.ts";

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

const baseInput = {
  profile,
  brief,
  confidential: [INSTRUCTION],
  moduleIds: MODULES,
  perModule: 2,
  maxModules: 2,
  askedQuestions: ["Find the company's public customer case studies"],
};

const raw: RawReflection = {
  items: [
    {
      kind: "gate",
      key: "geo",
      status: "answered",
      note: "Registreret i Danmark (CVR, 2024).",
      // An answered item never searches again, even if the model asked.
      followUps: [{ module: "founders_team", question: "Find the company's registered office" }],
      founderQuestion: "Hvor sidder selskabet?",
    },
    {
      kind: "criterion",
      key: "traction",
      status: "conflicting",
      note: "Pressen siger 40 kunder, [Person 1] siger 12.",
      followUps: [
        // Already asked (other case and end punctuation): not new.
        {
          module: "traction_customers_gtm",
          question: "find the company's public customer case studies.",
        },
        // A number is a threshold: never searched.
        {
          module: "traction_customers_gtm",
          question: "Find customers paying more than 100 per month",
        },
        // A masked name: never searched.
        { module: "traction_customers_gtm", question: "Find contracts signed by [Person 1]" },
        // Copies the fund's instruction: never searched.
        {
          module: "traction_customers_gtm",
          question: "Find whether kunderne betaler frem for brugervækst",
        },
        { module: "traction_customers_gtm", question: "Find dated public tenders the company won" },
      ],
      founderQuestion: "Hvor mange betalende kunder har I, og hvad betaler de?",
    },
    {
      kind: "criterion",
      key: "team",
      status: "partial",
      note: "CTO kendt, CEO's baggrund uklar.",
      followUps: [
        { module: "founders_team", question: "Find the chief executive's earlier companies" },
        { module: "unknown_module", question: "Find anything" },
      ],
      founderQuestion: "",
    },
    // Not the fund's: left out.
    {
      kind: "criterion",
      key: "made_up",
      status: "unknown",
      note: "x",
      followUps: [{ module: "market_competition", question: "Find competitors" }],
      founderQuestion: "Hvem er konkurrenterne?",
    },
  ],
};

test("runder pr. niveau følger D24 (screening Let 0, Tung 2; dyb Let 1, Tung 3)", () => {
  assert.deepEqual(FOLLOWUP_ROUNDS.screening, { light: 0, medium: 1, heavy: 2 });
  assert.deepEqual(FOLLOWUP_ROUNDS.deep, { light: 1, medium: 2, heavy: 3 });
  // ZDR models only (the reflection reads the fund's setup and the plan).
  for (const kind of ["screening", "deep"] as const) {
    for (const model of Object.values(REFLECTION_MODELS[kind])) {
      assert.match(model, /^openai\//);
    }
  }
});

test("refleksionen holdes til fondens kriterier og gates i fondens rækkefølge", () => {
  const result = sanitizeReflection(raw, baseInput);
  assert.deepEqual(
    result.items.map((item) => `${item.kind}:${item.key}:${item.status}`),
    ["criterion:team:partial", "criterion:traction:conflicting", "gate:geo:answered"],
  );
  // An answered item keeps its note but asks the founders nothing.
  assert.equal(result.items.find((item) => item.key === "geo")?.founderQuestion, "");
});

test("et kriterie, modellen glemte, tæller som ukendt (aldrig som afklaret)", () => {
  const result = sanitizeReflection({ items: [] }, baseInput);
  assert.ok(result.items.every((item) => item.status === "unknown"));
  assert.deepEqual(result.questions, {});
});

test("opfølgningssøgninger går gennem det neutrale filter og gentager aldrig et spørgsmål", () => {
  const result = sanitizeReflection(raw, baseInput);
  assert.deepEqual(result.questions, {
    founders_team: ["Find the chief executive's earlier companies"],
    traction_customers_gtm: ["Find dated public tenders the company won"],
  });
  // Number, placeholder and the copied instruction (the repeat is not counted as dropped).
  assert.equal(result.dropped, 3);
  const all = Object.values(result.questions).flat().join(" ");
  assert.doesNotMatch(all, /\[Person|\d|brugervækst|registered office/);
});

test("højst maxModules spor søger igen: dem med flest opfølgninger først", () => {
  const many: RawReflection = {
    items: [
      {
        kind: "criterion",
        key: "team",
        status: "unknown",
        note: "",
        followUps: [{ module: "market_competition", question: "Find the company's competitors" }],
        founderQuestion: "",
      },
      {
        kind: "criterion",
        key: "traction",
        status: "unknown",
        note: "",
        followUps: [
          { module: "traction_customers_gtm", question: "Find the company's public customers" },
          { module: "traction_customers_gtm", question: "Find the company's pricing page" },
        ],
        founderQuestion: "",
      },
      {
        kind: "gate",
        key: "geo",
        status: "unknown",
        note: "",
        followUps: [{ module: "founders_team", question: "Find where the founders live" }],
        founderQuestion: "",
      },
    ],
  };
  const result = sanitizeReflection(many, { ...baseInput, maxModules: 2 });
  assert.deepEqual(Object.keys(result.questions), ["traction_customers_gtm", "market_competition"]);
});

test("noter og founder-spørgsmål får rigtige navne tilbage; søgninger gør ikke", () => {
  const result = sanitizeReflection(raw, {
    ...baseInput,
    restore: (text) => text.replaceAll("[Person 1]", "Anna Hansen"),
  });
  const traction = result.items.find((item) => item.key === "traction")!;
  assert.match(traction.note, /Anna Hansen/);
  assert.doesNotMatch(JSON.stringify(result.questions), /Anna Hansen/);
});

test("stopreglerne: lukket, sidste runde, intet at søge efter, ellers videre", () => {
  const open: FollowUpItem = {
    kind: "criterion",
    key: "team",
    label: "Team",
    status: "unknown",
    note: "",
    founderQuestion: "",
  };
  const closed = { ...open, status: "answered" as const };
  const questions = { founders_team: ["Find x"] };
  assert.equal(
    followUpStopAfterReflection({ round: 1, maxRounds: 2, items: [closed], questions }),
    "closed",
  );
  assert.equal(
    followUpStopAfterReflection({ round: 3, maxRounds: 2, items: [open], questions }),
    "rounds",
  );
  assert.equal(
    followUpStopAfterReflection({ round: 1, maxRounds: 2, items: [open], questions: {} }),
    "no_questions",
  );
  assert.equal(
    followUpStopAfterReflection({ round: 2, maxRounds: 2, items: [open], questions }),
    null,
  );
});

test("refleksionens input: hypoteser fra planen, aldrig URL'er, de nyeste fund", () => {
  const plan: ResearchPlan = {
    version: RESEARCH_PLAN_VERSION,
    model: "openai/gpt-5.4",
    brief: "Kort brief",
    items: [
      {
        kind: "criterion",
        key: "traction",
        label: "Traction",
        hypotheses: [{ hypothesis: "Har offentlige kunder", confirms: "Udbud", refutes: "Ingen" }],
        sourceTypes: ["press"],
      },
    ],
    questions: {},
    droppedQuestions: 0,
  };
  const prompt = JSON.parse(
    reflectionPrompt({
      kind: "screening",
      round: 1,
      maxRounds: 1,
      outputLanguage: "Danish",
      profile,
      plan,
      modules: [{ id: "founders_team", categories: ["team"] }],
      findings: Array.from({ length: 70 }, (_, index) => ({
        module: "founders_team",
        statement: `Fund ${index}`,
        confidence: 0.7,
        sources: [{ publisher: "Børsen", date: "2026-01-01", kind: "press" }],
      })),
      gaps: ["Ingen omsætning fundet"],
      askedQuestions: ["Find x"],
    }),
  );
  assert.equal(prompt.lastRound, false);
  assert.equal(prompt.fund.criteria[1].hypotheses[0].hypothesis, "Har offentlige kunder");
  assert.deepEqual(prompt.fund.criteria[0].hypotheses, []);
  assert.equal(prompt.findings.length, 60);
  assert.equal(prompt.findings.at(-1).statement, "Fund 69");
  assert.doesNotMatch(JSON.stringify(prompt), /https?:/);
});

test("skemaet kender kun kørslens spor og de fire statusser", () => {
  const schema = reflectionSchema(MODULES);
  const item = schema.properties.items.items;
  assert.deepEqual([...item.properties.followUps.items.properties.module.enum], MODULES);
  assert.deepEqual(
    [...item.properties.status.enum],
    ["answered", "partial", "unknown", "conflicting"],
  );
});

test("tidsfristen giver gemningen sin tid; analysekaldet har sin egen funktion (T-730)", () => {
  const start = 1_000_000;
  const limit = FUNCTION_MAX_DURATION_SECONDS * 1_000;
  assert.equal(
    researchDeadlineAt("screening", start),
    start + limit - AFTER_RESEARCH_MARGIN_MS.screening,
  );
  assert.equal(researchDeadlineAt("deep", start), start + limit - AFTER_RESEARCH_MARGIN_MS.deep);
  // After a first round of up to 120 s and the sheet's own timeout, a follow-up round fits.
  const followUpRoom =
    researchDeadlineAt("screening", 0) - EVIDENCE_SHEET_TIMEOUT_MS.screening - 120_000;
  assert.ok(followUpRoom >= REFLECTION_MIN_MS.screening + FOLLOWUP_MIN_SEARCH_MS.screening);
  // The analysis call no longer shares the research's function, whatever its timeout.
  for (const tier of ["light", "medium", "heavy"] as const) {
    assert.ok(SCREENING_CALL_TIMEOUT_MS[tier] <= limit - 30_000);
  }
});

test("founder-spørgsmål: kun åbne punkter, hver én gang, med loft", () => {
  const items: FollowUpItem[] = Array.from({ length: 12 }, (_, index) => ({
    kind: "criterion",
    key: `k${index}`,
    label: `K${index}`,
    status: index === 0 ? "answered" : "unknown",
    note: "",
    founderQuestion: index === 2 ? "Hvad er churn?" : index === 3 ? "hvad er churn" : `Q${index}?`,
  }));
  const questions = founderQuestions({ items });
  assert.equal(questions.length, MAX_FOUNDER_QUESTIONS);
  assert.ok(!questions.some((q) => q.key === "k0"));
  assert.equal(questions.filter((q) => /churn/i.test(q.question)).length, 1);
  assert.deepEqual(founderQuestions(null), []);
});

test("et gemt forløb læses kun i sin egen version", () => {
  const stored = {
    version: RESEARCH_FOLLOWUP_VERSION,
    model: "openai/gpt-5.4-mini",
    rounds: [],
    items: [],
    stopReason: "closed",
    reflections: 1,
  };
  assert.deepEqual(readStoredResearchFollowUp(stored), stored);
  assert.equal(readStoredResearchFollowUp({ ...stored, version: "old" }), null);
  assert.equal(readStoredResearchFollowUp(null), null);
});

test("Skal afklares: et åbent spørgsmål bliver en opgave, på en gate foldes det ind", () => {
  const source: AiTaskSource = {
    gates: profile.gates,
    criteria: profile.criteria,
    unresolvedGateKeys: ["geo"],
    missingCriterionKeys: [],
    assessments: [],
    openQuestions: [],
    researchQuestions: [
      { kind: "gate", key: "geo", question: "Hvor er selskabet registreret?", note: "" },
      {
        kind: "criterion",
        key: "traction",
        question: "Hvor mange betalende kunder har I?",
        note: "Kilderne er uenige.",
      },
      { kind: "criterion", key: "gone", question: "Et spørgsmål uden kriterie?", note: "" },
    ],
  };
  const drafts = buildAiTaskDrafts(source);
  const gate = drafts.find((draft) => draft.linkedKind === "gate");
  // Without a curated step the research's question is the gate task's question.
  assert.equal(gate?.description, "Hvor er selskabet registreret?");
  assert.match(gate?.why ?? "", /Offentlige kilder kunne ikke afklare det/);
  assert.equal(drafts.filter((draft) => draft.linkedKind === "gate").length, 1);
  const traction = drafts.find((draft) => draft.linkedKey === "traction");
  // A short title names who is asked about what; the question is the description.
  assert.equal(traction?.title, "Spørg founders om Traction");
  assert.equal(traction?.description, "Hvor mange betalende kunder har I?");
  assert.equal(traction?.kind, "question");
  assert.match(traction?.why ?? "", /Kilderne er uenige/);
  // The gap is keyed on the question, as (no duplicate of an older task).
  assert.match(traction?.dedupeKey ?? "", /hvor mange betalende kunder har i$/);
  // A criterion that is no longer the fund's: still asked, but not linked.
  const unlinked = drafts.find((draft) => draft.description === "Et spørgsmål uden kriterie?");
  assert.equal(unlinked?.title, "Et spørgsmål uden kriterie?");
  assert.equal(unlinked?.linkedKind, null);
});
