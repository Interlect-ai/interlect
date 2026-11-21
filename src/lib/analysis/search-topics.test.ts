/** Neutral search topics. Kør: npm test */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import {
  fundFieldsForSearch,
  neutralQuestions,
  sanitizeTopics,
  searchTopicsKey,
  topicsPrompt,
  type TopicsBrief,
} from "./search-topics.ts";
import { neutralResearchModules } from "./question-neutralizer.ts";

const brief: TopicsBrief = {
  thesis:
    "Vi investerer i nordiske B2B-softwareselskaber med tilbagevendende omsætning, hvor grundlæggerne har domæneerfaring og kunderne er offentlige myndigheder.",
  stages: ["pre_seed", "seed"],
  geographies: ["Danmark", "Sverige"],
  sectors: ["b2b_saas"],
  ticket: { note: "Billetter fra 1 til 3 mio. EUR i første runde" },
  riskPosture: "Vi accepterer teknologirisiko, men aldrig regulatorisk uklarhed",
  gates: [
    { label: "Ingen sanktioner", description: "Selskabet må ikke være på en sanktionsliste" },
  ],
  criteria: [
    {
      label: "Traction",
      description: "Mindst 1 mio. kr. i tilbagevendende omsætning efter 18 måneder",
    },
  ],
  distinctiveLens: ["Grundlæggere med erfaring fra den offentlige sektor"],
};

test("neutral topics are kept", () => {
  const { topics, dropped } = sanitizeTopics(
    ["recurring revenue", "kunder i offentlig sektor", "CO2-reduktion", "regulatory approval"],
    brief,
  );
  assert.deepEqual(topics, [
    "recurring revenue",
    "kunder i offentlig sektor",
    "CO2-reduktion",
    "regulatory approval",
  ]);
  assert.deepEqual(dropped, []);
});

test("a topic that copies the thesis, carries a number or names the fund's wishes is dropped", () => {
  const { topics, dropped } = sanitizeTopics(
    [
      "tilbagevendende omsætning, hvor grundlæggerne har domæneerfaring",
      "omsætning over 1 mio",
      "fondens tese om software",
      "dealbreakers",
      "Ticket size",
      "accepterer teknologirisiko, men aldrig",
      "Selskabet må ikke være på en sanktionsliste",
      "et meget langt emne der har alt for mange ord i sig",
      "",
      42,
      "tilbagevendende omsætning",
    ],
    brief,
  );
  assert.deepEqual(topics, ["tilbagevendende omsætning"]);
  assert.ok(dropped.length >= 7);
});

test("a digit inside a word is fine, a standalone number is not", () => {
  const { topics } = sanitizeTopics(
    ["5G network", "3D printing", "ticketing platform", "1 mio kr"],
    brief,
  );
  assert.deepEqual(topics, ["5G network", "3D printing", "ticketing platform"]);
});

test("duplicates are removed and at most ten topics are kept", () => {
  const many = Array.from({ length: 14 }, (_, i) => `emne ${String.fromCharCode(97 + i)}x`);
  const { topics } = sanitizeTopics(["Recurring revenue", "recurring  revenue.", ...many], brief);
  assert.equal(topics.length, 10);
  assert.equal(topics[0], "Recurring revenue");
});

test("the fund's own research questions lose every question that copies the confidential text", () => {
  const questions = [
    "Find kunder, der er offentlige myndigheder, og hvor grundlæggerne har domæneerfaring",
    "Kortlæg konkurrenter og substitutter",
    "Scor selskabet mod vores kriterier",
  ];
  assert.deepEqual(neutralQuestions(questions, brief), ["Kortlæg konkurrenter og substitutter"]);
});

test("the prompt for the topics step carries the criteria, never the ticket or the risk posture", () => {
  const prompt = topicsPrompt(brief);
  assert.ok(prompt.includes("tilbagevendende omsætning"));
  assert.ok(!prompt.includes("Billetter"));
  assert.ok(!prompt.includes("teknologirisiko"));
});

/** Everything confidential about the fund: thesis, weights, gates, ticket, risk, dealbreakers. */
const SECRETS = [
  "nordiske B2B-softwareselskaber",
  "teknologirisiko",
  "Billetter",
  "sanktionsliste",
  "Ingen sanktioner",
  "Vægt 40",
  '"weight"',
  "domæneerfaring",
  "dealbreaker",
  "Ingen kryptovaluta",
];

/** A brief as the run builds it (buildFundResearchBrief): weights, ticket amounts and gate treatment. */
const fullBrief = {
  ...brief,
  ticket: { minEur: 1_000_000, maxEur: 3_000_000, note: brief.ticket.note },
  gates: [
    {
      key: "sanctions",
      label: "Ingen sanktioner",
      description: "Selskabet må ikke være på en sanktionsliste",
      treatment: "dealbreaker",
    },
    {
      key: "crypto",
      label: "Ingen kryptovaluta",
      description: "Ingen kryptovaluta",
      treatment: "dealbreaker",
    },
  ],
  criteria: [{ key: "traction", label: "Traction", description: "Vægt 40 procent", weight: 40 }],
};

for (const flag of ["false", "true", undefined]) {
  test(`T-1021: with AI_GATEWAY_ENFORCE_ZDR=${flag ?? "(unset)"} a search never carries the thesis, weights, gates, ticket, risk posture or dealbreakers`, () => {
    const before = process.env["AI_GATEWAY_ENFORCE_ZDR"];
    if (flag === undefined) delete process.env["AI_GATEWAY_ENFORCE_ZDR"];
    else process.env["AI_GATEWAY_ENFORCE_ZDR"] = flag;
    try {
      // The pure part of a run's search, end to end, with the full brief in scope: the team's own
      // questions go through the code filter, the ZDR step either fails (nothing of the team's is
      // searched) or keeps them, and the message carries the topics only.
      const tracks = [{ id: "market_competition", questions: ["Default market question"] }];
      const teamQuestions = [
        "Find evidence for: Vi investerer i nordiske B2B-softwareselskaber med tilbagevendende omsætning",
        "Who are the main competitors?",
      ];
      const own = neutralQuestions(teamQuestions, fullBrief).map((question) => ({
        module: "market_competition",
        question,
      }));
      assert.deepEqual(
        own.map((item) => item.question),
        ["Who are the main competitors?"],
      );
      for (const neutral of [[], own.map((item) => item.question)]) {
        const modules = neutralResearchModules({
          baseModules: tracks,
          ownQuestions: own,
          specialistCandidates: [],
          planCandidates: [],
          neutral,
        });
        for (const topics of [["recurring revenue", "kunder i offentlig sektor"], [], null]) {
          const sent = JSON.stringify({
            company: "Eksempel ApS",
            requiredResearch: modules[0]!.questions,
            ...fundFieldsForSearch(topics),
          });
          for (const secret of SECRETS) assert.ok(!sent.includes(secret), `${secret} in ${sent}`);
          assert.match(sent, /"fundResearchBrief":null/);
          if (topics?.length) assert.ok(sent.includes("recurring revenue"));
          else assert.match(sent, /not available/);
        }
      }
    } finally {
      if (before === undefined) delete process.env["AI_GATEWAY_ENFORCE_ZDR"];
      else process.env["AI_GATEWAY_ENFORCE_ZDR"] = before;
    }
  });
}

test("T-1021: the research never decides on the ZDR flag what a public search gets (fail-closed)", () => {
  const source = readFileSync(new URL("./public-research.ts", import.meta.url), "utf8");
  // No branch on the flag anywhere in the research: the neutral path is the only path.
  assert.doesNotMatch(source, /shouldEnforceZdr|AI_GATEWAY_ENFORCE_ZDR/);
  // The search message gets the topics only, never the brief.
  const start = source.indexOf("export function buildResearchMessages(");
  const end = source.indexOf("export class ResearchCallError");
  assert.ok(start > 0 && end > start);
  const messages = source.slice(start, end);
  assert.match(messages, /\.\.\.fundFieldsForSearch\(input\.searchTopics\)/);
  assert.doesNotMatch(messages, /fundResearchBrief/);
  // Every track searches the default questions plus what the ZDR step let through.
  assert.match(source, /const modules: readonly ResearchModule\[\] = neutralResearchModules\(/);
  // The card question stays on a track the fund rewrote.
  assert.match(
    source,
    /neutralResearchModules\(\{[\s\S]{0,400}\}\)\.map\(\(module\) => \{\s*const cardQuestion = cardDataResearchQuestion\(module\.id\)/,
  );
  // Follow-up questions always pass the ZDR step before they are searched.
  const followUp = source.slice(
    source.indexOf("let roundQuestions = outcome.reflection.questions"),
  );
  assert.ok(
    followUp.indexOf("neutralizeSearchQuestions(") < followUp.indexOf("callResearchGateway("),
  );
});

test("T-704: the stored topics' key follows the setup, not the order of a run", async () => {
  const setup: TopicsBrief = {
    thesis: "Vi investerer i klimateknologi i Norden.",
    stages: ["Seed"],
    geographies: ["Danmark"],
    sectors: ["Klima"],
    ticket: { note: "" },
    riskPosture: "",
    gates: [],
    criteria: [{ label: "Klimaeffekt", description: "Målt CO2-reduktion" }],
    distinctiveLens: [],
  };
  const key = await searchTopicsKey(setup);
  assert.match(key, /^[0-9a-f]{64}$/);
  assert.equal(await searchTopicsKey({ ...setup }), key, "same setup, same key");
  assert.notEqual(
    await searchTopicsKey({ ...setup, thesis: "Vi investerer i fintech i Norden." }),
    key,
    "a new thesis gives new topics",
  );
  assert.notEqual(
    await searchTopicsKey({
      ...brief,
      criteria: [{ label: "Klimaeffekt", description: "Dokumenteret CO2-reduktion" }],
    }),
    key,
    "a changed criterion gives new topics",
  );
});
