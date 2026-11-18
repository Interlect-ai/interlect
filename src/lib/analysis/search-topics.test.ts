/** Neutral search topics. Kør: npm test */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  fundFieldsForSearch,
  neutralQuestions,
  sanitizeTopics,
  searchTopicsKey,
  topicsPrompt,
  type TopicsBrief,
} from "./search-topics.ts";

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

test("with ZDR on, a search carries topics and never the thesis, weights, risk posture or ticket (T-509)", () => {
  const full = {
    ...brief,
    criteria: [{ label: "Traction", description: "Vægt 40 procent", weight: 40 }],
  };
  const sent = JSON.stringify({
    company: "Eksempel ApS",
    ...fundFieldsForSearch(full, ["recurring revenue", "kunder i offentlig sektor"], true),
  });
  assert.ok(sent.includes("recurring revenue"));
  for (const secret of [
    "nordiske B2B-softwareselskaber",
    "teknologirisiko",
    "Billetter",
    "sanktionsliste",
    "Vægt 40",
    "domæneerfaring",
  ]) {
    assert.ok(!sent.includes(secret), secret);
  }
  assert.match(sent, /"fundResearchBrief":null/);
});

test("with ZDR on and no topics nothing about the fund is sent; with ZDR off the brief goes as before", () => {
  const none = fundFieldsForSearch(brief, [], true);
  assert.equal(none.fundResearchBrief, null);
  assert.equal(none.searchTopics, undefined);
  assert.match(none.searchTopicsNote ?? "", /not available/);
  assert.equal(fundFieldsForSearch(brief, null, true).searchTopics, undefined);
  assert.equal(fundFieldsForSearch(brief, ["x"], false).fundResearchBrief, brief);
  assert.equal("searchTopics" in fundFieldsForSearch(brief, ["x"], false), false);
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
