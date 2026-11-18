/** Neutral search questions. Kør: npm test */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyNeutralization,
  MAX_NEUTRALIZER_QUESTIONS,
  neutralizerPrompt,
  neutralQuestionsByModule,
  neutralResearchModules,
  type NeutralCandidate,
} from "./question-neutralizer.ts";
import type { TopicsBrief } from "./search-topics.ts";

const brief: TopicsBrief = {
  thesis:
    "We back founders who rebuild legacy industries with AI-first workflows and sell to public authorities.",
  stages: ["seed"],
  geographies: ["Denmark"],
  sectors: ["b2b_saas"],
  ticket: { note: "Tickets from 1 to 3 million EUR" },
  riskPosture: "We accept technology risk but never regulatory uncertainty",
  gates: [{ label: "No sanctions", description: "The company may not be on a sanctions list" }],
  criteria: [
    { label: "Traction", description: "Paying customers in the public sector within two years" },
  ],
  distinctiveLens: [],
};
const instruction = "Weigh paying municipal customers above user growth in every assessment";

const candidates: NeutralCandidate[] = [
  { module: "traction_customers_gtm", question: "Which customers has Acme announced?" },
  {
    module: "market_competition",
    question: "Is Acme rebuilding a legacy industry the way an AI-first investor would want?",
  },
  { module: "founders_team", question: "Does Acme fit a fund like ours?" },
];

test("the prompt carries the questions with short ids and the fund's setup", () => {
  const prompt = JSON.parse(
    neutralizerPrompt({ companyName: "Acme", brief, confidential: [instruction], candidates }),
  );
  assert.equal(prompt.company, "Acme");
  assert.deepEqual(
    prompt.questions.map((q: { id: string }) => q.id),
    ["q1", "q2", "q3"],
  );
  assert.equal(prompt.fundSetup.thesis, brief.thesis);
  assert.deepEqual(prompt.fundSetup.otherConfidentialText, [instruction]);
});

test("the prompt never holds more questions than one call may read", () => {
  const many = Array.from({ length: MAX_NEUTRALIZER_QUESTIONS + 5 }, (_, i) => ({
    module: "press",
    question: `Question ${i}`,
  }));
  const prompt = JSON.parse(
    neutralizerPrompt({ companyName: "Acme", brief, confidential: [], candidates: many }),
  );
  assert.equal(prompt.questions.length, MAX_NEUTRALIZER_QUESTIONS);
});

test("keep sends the original, rewrite the model's question, drop nothing", () => {
  const result = applyNeutralization(
    {
      questions: [
        // "keep" never sends the model's text, only the question it was given.
        {
          id: "q1",
          action: "keep",
          question: "Which customers does Acme want to sell to investors?",
        },
        {
          id: "q2",
          action: "rewrite",
          question: "  Which   traditional industries does Acme sell AI software to? ",
        },
        { id: "q3", action: "drop", question: "" },
      ],
    },
    candidates,
    brief,
    [instruction],
  );
  assert.deepEqual(result.questions, [
    "Which customers has Acme announced?",
    "Which traditional industries does Acme sell AI software to?",
    null,
  ]);
  assert.deepEqual(
    { kept: result.kept, rewritten: result.rewritten, dropped: result.dropped },
    { kept: 1, rewritten: 1, dropped: 1 },
  );
});

test("a question the model leaves out or answers oddly is not sent", () => {
  const result = applyNeutralization(
    {
      questions: [
        { id: "q2", action: "maybe", question: "Which industries does Acme serve?" },
        { id: "q9", action: "keep", question: "" },
      ],
    },
    candidates,
    brief,
    [],
  );
  assert.deepEqual(result.questions, [null, null, null]);
  assert.equal(result.dropped, 3);
});

test("no answer at all sends nothing (fail closed)", () => {
  for (const raw of [null, undefined, { questions: "nope" } as never]) {
    const result = applyNeutralization(raw, candidates, brief, []);
    assert.deepEqual(result.questions, [null, null, null]);
    assert.equal(result.dropped, 3);
  }
});

test("a rewrite still passes the code filter", () => {
  const rewrite = (question: string) =>
    applyNeutralization(
      { questions: [{ id: "q1", action: "rewrite", question }] },
      [candidates[0]!],
      brief,
      [instruction],
    ).questions[0];
  // Copies four words of the thesis.
  assert.equal(rewrite("Does Acme rebuild legacy industries with AI-first tools?"), null);
  // Copies four words of the instruction (the other confidential text).
  assert.equal(rewrite("Has Acme got paying municipal customers above all?"), null);
  // A number is a threshold.
  assert.equal(rewrite("Has Acme more than 20 public customers?"), null);
  // A masked name never reaches a search.
  assert.equal(rewrite("Who is [Person 1] at Acme?"), null);
  // Words about the fund's wishes.
  assert.equal(rewrite("Does Acme match the thesis?"), null);
  assert.equal(rewrite(""), null);
  assert.equal(
    rewrite("Which public authorities buy from Acme?"),
    "Which public authorities buy from Acme?",
  );
});

test("the first answer for an id counts", () => {
  const result = applyNeutralization(
    {
      questions: [
        { id: "q1", action: "drop", question: "" },
        { id: "q1", action: "keep", question: "" },
      ],
    },
    [candidates[0]!],
    brief,
    [],
  );
  assert.deepEqual(result.questions, [null]);
});

test("questions past what one call reads are not sent", () => {
  const many = Array.from({ length: MAX_NEUTRALIZER_QUESTIONS + 2 }, (_, i) => ({
    module: "press",
    question: `Which awards has Acme won, part ${String.fromCharCode(97 + (i % 26))}?`,
  }));
  const result = applyNeutralization(
    {
      questions: many.map((_, i) => ({ id: `q${i + 1}`, action: "keep", question: "" })),
    },
    many,
    brief,
    [],
  );
  assert.equal(result.questions.at(-1), null);
  assert.equal(result.questions.at(-2), null);
  assert.equal(result.dropped, 2);
});

test("questions per track keep their order, once each, never one already asked", () => {
  const list: NeutralCandidate[] = [
    { module: "a", question: "Who are Acme's customers?" },
    { module: "a", question: "Who are  acme's customers?" },
    { module: "b", question: "Who competes with Acme?" },
    { module: "b", question: "Which patents does Acme hold?" },
    { module: "c", question: "Who funds Acme?" },
  ];
  const out = neutralQuestionsByModule(
    list,
    [list[0]!.question, list[1]!.question, "Who competes with Acme?", null, "Who funds Acme?"],
    ["who funds acme?"],
  );
  assert.deepEqual(out, { a: ["Who are Acme's customers?"], b: ["Who competes with Acme?"] });
});

const base = [
  { id: "traction", questions: ["Default traction?"], label: "Traction" },
  { id: "market", questions: ["Default market?"], label: "Market" },
];

test("without fund-derived questions the tracks are unchanged", () => {
  const out = neutralResearchModules({
    baseModules: base,
    ownQuestions: [],
    specialistCandidates: [],
    planCandidates: [],
    neutral: [],
  });
  assert.equal(out[0], base[0]);
  assert.equal(out[1], base[1]);
});

test("the fund's own questions replace the defaults only when some get through", () => {
  const own: NeutralCandidate[] = [
    { module: "traction", question: "Own traction A?" },
    { module: "traction", question: "Own traction B?" },
    { module: "market", question: "Own market?" },
  ];
  const out = neutralResearchModules({
    baseModules: base,
    ownQuestions: own,
    specialistCandidates: [],
    planCandidates: [],
    neutral: ["Own traction A, rewritten?", null, null],
  });
  assert.deepEqual(out[0]!.questions, ["Own traction A, rewritten?"]);
  assert.equal(out[0]!.label, "Traction");
  // Every own market question was dropped: the track searches its defaults.
  assert.equal(out[1], base[1]);
});

test("specialist and plan questions come after the track's questions, once", () => {
  const out = neutralResearchModules({
    baseModules: base,
    ownQuestions: [],
    specialistCandidates: [{ module: "market", question: "Specialist?" }],
    planCandidates: [
      { module: "market", question: "Plan?" },
      { module: "market", question: "Plan again?" },
      { module: "traction", question: "Plan traction?" },
    ],
    neutral: ["Specialist?", "Plan?", "Specialist?", null],
  });
  assert.deepEqual(out[1]!.questions, ["Default market?", "Specialist?", "Plan?"]);
  assert.equal(out[0], base[0]);
});

test("a failed step sends nothing written from the fund's setup", () => {
  const out = neutralResearchModules({
    baseModules: base,
    ownQuestions: [{ module: "traction", question: "Own traction?" }],
    specialistCandidates: [{ module: "market", question: "Specialist?" }],
    planCandidates: [{ module: "market", question: "Plan?" }],
    neutral: [],
  });
  assert.equal(out[0], base[0]);
  assert.equal(out[1], base[1]);
});
