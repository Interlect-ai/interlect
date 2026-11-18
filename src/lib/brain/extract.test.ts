import assert from "node:assert/strict";
import { test } from "node:test";
import { createRedactor } from "../ai/redact.ts";
import {
  parseExtraction,
  parseMaskedExtraction,
  STRUCTURAL_FACT_REJECTIONS,
  parseInstructionEpisodes,
} from "./contracts/extract.ts";
import {
  batchEpisodes,
  decideEntity,
  entityKey,
  extractPartKey,
  L1_BATCH_CAP_USD,
  nameLabels,
  normalizeDomain,
  parseExtractPartKey,
  quoteInEpisode,
  trustRank,
} from "./extract.ts";
import { parseBrainQueueMessage } from "./jobs.ts";

const EPISODE_ID = "a1000000-0000-4000-8000-0000000000e1";
const EPISODE = "Nordlys ApS oplyser, at ARR i Q2 2026 var 1,5 mio. kr. – op fra 1,2 mio. kr.";
const context = {
  episodes: new Map([["E1", { id: EPISODE_ID, content: EPISODE }]]),
  known: new Map([["K1", "a1000000-0000-4000-8000-0000000000c1"]]),
};
const fact = (quote: string, extra: Record<string, unknown> = {}) => ({
  episode: "E1",
  subject: "K1",
  predicate: "metric",
  object: "new:1",
  valueText: null,
  valueNum: 1500000,
  unit: "DKK",
  validFrom: "2026-04-01",
  validTo: "2026-06-30",
  statement: "Nordlys oplyser, at ARR i Q2 2026 var 1,5 mio. kr.",
  quote,
  confidence: 0.8,
  ...extra,
});
const metricEntity = {
  ref: "new:1",
  type: "metric",
  name: "ARR",
  cvr: null,
  domain: null,
  linkedin: null,
};

test("et opdigtet citat kasseres (06 L1 test 1)", () => {
  const parsed = parseExtraction(
    { entities: [metricEntity], facts: [fact("ARR i Q2 2026 var 2,5 mio. kr.")] },
    context,
  );
  assert.equal(parsed.facts.length, 0);
  assert.equal(parsed.rejected.quote_not_in_episode, 1);
});

test("maskering (T-209): citatet tjekkes mod den maskerede episode, først derefter kommer navnet tilbage", () => {
  const masked = {
    episodes: new Map([
      [
        "E1",
        { id: EPISODE_ID, content: "Nordlys ApS oplyser via Peter Holm, at ARR var 1,5 mio. kr." },
      ],
    ]),
    known: context.known,
  };
  const redactor = () => createRedactor({ mask: [{ name: "Peter Holm" }], keep: ["Nordlys ApS"] });
  const answer = (quote: string) => ({
    entities: [metricEntity],
    facts: [fact(quote, { statement: "Nordlys oplyser via [Person 1], at ARR var 1,5 mio. kr." })],
  });
  // The model read "[Person 1]" and quotes it: accepted, and the real name comes back.
  const kept = parseMaskedExtraction(
    answer("via [Person 1], at ARR var 1,5 mio. kr."),
    masked,
    redactor(),
  );
  assert.equal(kept.facts.length, 1);
  assert.equal(kept.facts[0]?.quote, "via Peter Holm, at ARR var 1,5 mio. kr.");
  assert.equal(kept.facts[0]?.statement, "Nordlys oplyser via Peter Holm, at ARR var 1,5 mio. kr.");
  // A name the model never saw is a guess, even when it happens to be right: rejected.
  const guessed = parseMaskedExtraction(
    answer("via Peter Holm, at ARR var 1,5 mio. kr."),
    masked,
    redactor(),
  );
  assert.equal(guessed.facts.length, 0);
  assert.equal(guessed.rejected.quote_not_in_episode, 1);
});

test("maskering (T-209): citatet gemmes med episodens egne ord, ikke med navnet fra en anden", () => {
  const E2 = "a1000000-0000-4000-8000-0000000000e2";
  const twoEpisodes = {
    episodes: new Map([
      ["E1", { id: EPISODE_ID, content: "Peter Holm ejer 12 % privat, tlf. 12 34 56 78." }],
      ["E2", { id: E2, content: "Holm, Peter oplyste på +45 12345678, at ARR var 1,5 mio. kr." }],
    ]),
    known: context.known,
  };
  const parsed = parseMaskedExtraction(
    {
      entities: [metricEntity],
      facts: [
        fact("[Person 1] oplyste på [Telefon 1], at ARR var 1,5 mio. kr.", { episode: "E2" }),
      ],
    },
    twoEpisodes,
    createRedactor({ mask: [{ name: "Peter Holm" }], keep: [] }),
  );
  assert.equal(parsed.facts.length, 1);
  assert.equal(
    parsed.facts[0]?.quote,
    "Holm, Peter oplyste på +45 12345678, at ARR var 1,5 mio. kr.",
  );
});

test("maskering (T-209): en pladsholder, modellen selv har fundet på, bliver aldrig en entitet", () => {
  const parsed = parseMaskedExtraction(
    {
      entities: [
        metricEntity,
        { ...metricEntity, ref: "new:2", type: "person", name: "[Person 9]" },
      ],
      facts: [fact("ARR i Q2 2026 var 1,5 mio. kr.", { object: "new:2" })],
    },
    context,
    createRedactor(),
  );
  assert.deepEqual(
    parsed.entities.map((entity) => entity.name),
    ["ARR"],
  );
  assert.equal(parsed.facts.length, 0);
  assert.equal(parsed.rejected.unknown_ref, 1);
});

test("et ordret citat godtages, også med andre anførselstegn, bindestreger og mellemrum", () => {
  const parsed = parseExtraction(
    { entities: [metricEntity], facts: [fact("ARR  i Q2 2026 var 1,5 mio. kr. - op fra")] },
    context,
  );
  assert.equal(parsed.facts.length, 1);
  assert.equal(parsed.facts[0]?.episodeId, EPISODE_ID);
  assert.ok(quoteInEpisode("“nordlys aps oplyser”", '"Nordlys ApS oplyser"'));
  assert.equal(quoteInEpisode("ARR", EPISODE), false, "too short to carry a fact");
});

test("ukendte episoder, refs og omvendte perioder kasseres", () => {
  const parsed = parseExtraction(
    {
      entities: [metricEntity, { ...metricEntity, ref: "K9" }],
      facts: [
        fact("oplyser, at ARR", { episode: "E7" }),
        fact("oplyser, at ARR", { subject: "K5" }),
        fact("oplyser, at ARR", { validFrom: "2026-06-30", validTo: "2026-04-01" }),
        fact("oplyser, at ARR", { predicate: "similar_to" }),
      ],
    },
    context,
  );
  assert.equal(parsed.facts.length, 0);
  assert.equal(parsed.entities.length, 1, "only new:<n> declares an entity");
  assert.deepEqual(parsed.rejected, {
    entity_invalid: 1,
    fact_invalid: 1,
    unknown_episode: 1,
    unknown_ref: 1,
    period_reversed: 1,
  });
  assert.deepEqual(parseExtraction("nonsense", context).rejected, { invalid_shape: 1 });
});

test("en gentaget kendt entitet er ingen afvisning, og små formfejl repareres", () => {
  const parsed = parseExtraction(
    {
      entities: [
        { ...metricEntity, ref: "K1", type: "company", name: "Nordlys ApS" },
        metricEntity,
      ],
      facts: [
        fact("oplyser, at ARR", { confidence: 80, validFrom: "2026", validTo: "2026-02" }),
        fact("oplyser, at ARR", { statement: "x".repeat(350) }),
      ],
    },
    context,
  );
  assert.equal(parsed.knownRepeated, 1);
  assert.deepEqual(parsed.rejected, {});
  assert.equal(parsed.facts.length, 2);
  assert.equal(parsed.facts[0]?.confidence, 0.8);
  assert.equal(parsed.facts[0]?.validFrom, "2026-01-01");
  assert.equal(parsed.facts[0]?.validTo, "2026-02-28");
  assert.equal(parsed.facts[1]?.statement.length, 300);
  assert.ok(parsed.facts[1]?.statement.endsWith("…"));
  assert.equal(parsed.repaired, 2);
});

test("et for langt citat afvises og forkortes aldrig (et opdigtet slutstykke kan ikke skæres væk)", () => {
  const padded = `${EPISODE} `.repeat(6).trim();
  const long = `${padded.slice(0, 390)} Selskabet har en ARR på 12 mio. kr. og vokser 300 %.`;
  const parsed = parseExtraction(
    {
      entities: [metricEntity],
      facts: [fact(long)],
    },
    { ...context, episodes: new Map([["E1", { id: EPISODE_ID, content: padded }]]) },
  );
  assert.equal(parsed.facts.length, 0);
  assert.deepEqual(parsed.rejected, { quote_too_long: 1 });
  // A form violation, so an answer made only of such facts counts as unusable (not "done").
  assert.ok(STRUCTURAL_FACT_REJECTIONS.includes("quote_too_long"));
});

test('"Nordlys ApS" og "Nordlys" med samme domæne får samme nøgle (06 L1 test 2)', () => {
  const companyKey = "domain:nordlys.dk";
  const a = entityKey(
    { type: "company", name: "Nordlys ApS", identifiers: { domain: "https://www.Nordlys.dk/om" } },
    companyKey,
  );
  const b = entityKey(
    { type: "company", name: "Nordlys", identifiers: { domain: "nordlys.dk" } },
    companyKey,
  );
  assert.equal(a, "domain:nordlys.dk");
  assert.equal(a, b);
  assert.equal(entityKey({ type: "company", name: "Nordlys A/S" }, companyKey), "name:nordlys");
  assert.equal(
    entityKey(
      { type: "company", name: "X", identifiers: { cvr: "12345678", domain: "x.dk" } },
      companyKey,
    ),
    "cvr:12345678",
  );
  assert.equal(
    entityKey({ type: "person", name: "Mette  Holm" }, companyKey),
    "name:mette holm@domain:nordlys.dk",
  );
  assert.equal(entityKey({ type: "stage", name: "Series A" }, companyKey), "stage:series_a");
  assert.equal(entityKey({ type: "metric", name: "ARR" }, companyKey), "metric:arr");
  assert.equal(entityKey({ type: "market", name: "  " }, companyKey), null);
  assert.equal(normalizeDomain("mailto"), null);
});

test("entitetsopløsning stopper ved første regel, der passer", () => {
  const base = { type: "company" as const, companyKey: "domain:nordlys.dk" };
  const candidate = (
    id: string,
    trigram: number | null,
    cosine: number | null,
    key = `name:${id}`,
  ) => ({
    id,
    name: id,
    normalizedKey: key,
    trigram,
    cosine,
  });
  assert.deepEqual(
    decideEntity({ ...base, exactId: "k", candidates: [candidate("t", 0.99, null)] }),
    {
      kind: "match",
      id: "k",
      rule: 1,
    },
  );
  assert.deepEqual(
    decideEntity({ ...base, exactId: null, candidates: [candidate("t", 0.9, null)] }),
    {
      kind: "match",
      id: "t",
      rule: 2,
    },
  );
  assert.deepEqual(
    decideEntity({ ...base, exactId: null, candidates: [candidate("v", 0.3, 0.95)] }),
    {
      kind: "match",
      id: "v",
      rule: 3,
    },
  );
  const unclear = decideEntity({
    ...base,
    exactId: null,
    candidates: [candidate("a", 0.7, null), candidate("b", null, 0.85), candidate("c", 0.4, 0.5)],
  });
  assert.equal(unclear.kind, "ambiguous");
  assert.deepEqual(unclear.kind === "ambiguous" ? unclear.candidates.map((item) => item.id) : [], [
    "b",
    "a",
  ]);
  assert.deepEqual(
    decideEntity({ ...base, exactId: null, candidates: [candidate("c", 0.4, 0.5)] }),
    {
      kind: "new",
    },
  );
  // A person with the same name at another company is not a candidate (rule 2 needs context).
  assert.deepEqual(
    decideEntity({
      type: "person",
      companyKey: "domain:nordlys.dk",
      exactId: null,
      candidates: [candidate("p", 0.95, null, "name:mette holm@domain:other.dk")],
    }),
    { kind: "new" },
  );
});

test("bidder: højst 12 enheder, en lang episode tæller dobbelt, og tegnloftet holdes", () => {
  const make = (n: number, size: number, prefix: string) =>
    Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, content: "x".repeat(size) }));
  assert.deepEqual(
    batchEpisodes(make(25, 200, "s")).map((batch) => batch.length),
    [12, 12, 1],
  );
  // 1,500 characters is long (2 units): 6 per batch, 9,000 characters.
  assert.deepEqual(
    batchEpisodes(make(7, 1500, "l")).map((batch) => batch.length),
    [6, 1],
  );
  // 3,000 characters: the 12,000-character cap takes over at 4.
  assert.deepEqual(
    batchEpisodes(make(7, 3000, "m")).map((batch) => batch.length),
    [4, 3],
  );
  // An episode is never split, even at the 8,000-character maximum.
  assert.deepEqual(
    batchEpisodes(make(3, 8000, "h")).map((batch) => batch.length),
    [1, 1, 1],
  );
  assert.deepEqual(batchEpisodes([]), []);
});

test("tillidsrang, loft pr. bid og fortsættelsesnøgler", () => {
  assert.ok(trustRank("official") > trustRank("analysis"));
  assert.ok(trustRank("company_claim") > trustRank("public_web"));
  assert.equal(trustRank("unknown"), -1);
  assert.ok(L1_BATCH_CAP_USD > 0.03 && L1_BATCH_CAP_USD < 0.032);
  const base = "full:a1000000-0000-4000-8000-0000000000c2:2026-09-30T09:30:00.000Z";
  const next = extractPartKey(base, 2);
  assert.ok(
    parseBrainQueueMessage({
      fundId: "b1000000-0000-4000-8000-00000000000b",
      loop: "L1_extract",
      key: next,
    }),
  );
  assert.deepEqual(parseExtractPartKey(next), { baseKey: base, part: 2 });
  assert.deepEqual(parseExtractPartKey(base), { baseKey: base, part: 0 });
});

test("etiketter i en sætning erstattes af navne", () => {
  const names = new Map([
    ["K1", "Nordlys ApS"],
    ["new:2", "ARR"],
  ]);
  assert.equal(
    nameLabels("K1 oplyser, at new:2 var 1,5 mio. kr. (se K9).", names),
    "Nordlys ApS oplyser, at ARR var 1,5 mio. kr. (se K9).",
  );
  assert.equal(nameLabels("Ingen etiketter her.", names), "Ingen etiketter her.");
});

test("the extractor's aiInstructions keep known episode labels only, each once (T-703 b)", () => {
  const labels = new Set(["E1", "E2"]);
  assert.deepEqual(parseInstructionEpisodes({ aiInstructions: ["E2", "E2", "E9", 3] }, labels), [
    "E2",
  ]);
  assert.deepEqual(parseInstructionEpisodes({ entities: [], facts: [] }, labels), []);
  assert.deepEqual(parseInstructionEpisodes(null, labels), []);
});
