import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEMO_EVAL_SET,
  demoId,
  evalFactsColumn,
  facitPoints,
  staticRef,
  trackOf,
} from "./eval/demo-set.ts";
import {
  DEFAULT_RANKING_WEIGHTS,
  ftsQuery,
  mergeScore,
  parseRankingWeights,
  questionType,
  rankCandidates,
  recallAtK,
} from "./retrieval.ts";

const NOW = new Date("2026-09-30T12:00:00Z");
const candidate = (key: string, extra: Partial<Parameters<typeof mergeScore>[0]> = {}) => ({
  key,
  ranks: {},
  trustTier: null,
  date: null,
  hops: null,
  usefulness: null,
  ...extra,
});

test("spørgsmålstypen afgøres af faste mønstre, ellers lookup", () => {
  assert.equal(questionType("Hvor mange seed-cases kasserede vi i Q2?"), "aggregate");
  assert.equal(
    questionType("Hvordan har Nordlys' ARR udviklet sig siden første case?"),
    "temporal",
  );
  assert.equal(questionType("Hvilke tidligere cases ligner Solvind?"), "similar");
  assert.equal(questionType("Hvad bør vi spørge Nordlys om på mødet?"), "case_advice");
  assert.equal(questionType("Hvad har vi lært om climate på seed?"), "global");
  assert.equal(questionType("Hvad var Nordlys' omsætning i 2025?"), "lookup");
});

test("relevans fører; tillid, friskhed, afstand og nytte afgør lige placeringer", () => {
  const top = candidate("a", { ranks: { chunk_fts: 1, chunk_vector: 1 } });
  const official = candidate("b", { ranks: { chunk_vector: 8 }, trustTier: "official" });
  assert.ok(
    mergeScore(top, DEFAULT_RANKING_WEIGHTS, NOW) >
      mergeScore(official, DEFAULT_RANKING_WEIGHTS, NOW),
  );

  const claim = candidate("c", { ranks: { fact_vector: 3 }, trustTier: "company_claim" });
  const verified = candidate("d", { ranks: { fact_vector: 3 }, trustTier: "official" });
  const onCase = candidate("e", { ranks: { fact_vector: 3 }, trustTier: "company_claim", hops: 0 });
  const ranked = rankCandidates([claim, verified, onCase], DEFAULT_RANKING_WEIGHTS, NOW).map(
    (item) => item.key,
  );
  assert.deepEqual(ranked, ["e", "d", "c"]);

  const fresh = candidate("f", { date: new Date("2026-09-01") });
  const old = candidate("g", { date: new Date("2021-09-01") });
  assert.ok(
    mergeScore(fresh, DEFAULT_RANKING_WEIGHTS, NOW) > mergeScore(old, DEFAULT_RANKING_WEIGHTS, NOW),
  );

  const useful = candidate("h", { usefulness: { alpha: 9, beta: 1 } });
  const useless = candidate("i", { usefulness: { alpha: 1, beta: 9 } });
  assert.ok(mergeScore(useful, DEFAULT_RANKING_WEIGHTS, NOW) > 0);
  assert.ok(mergeScore(useless, DEFAULT_RANKING_WEIGHTS, NOW) < 0);
});

test("fondens vægte læses feltvis; ugyldige felter beholder standarden", () => {
  assert.deepEqual(parseRankingWeights(null), DEFAULT_RANKING_WEIGHTS);
  assert.deepEqual(parseRankingWeights({ rrf: 2, trust: -1, recency: "x", distance: 99 }), {
    ...DEFAULT_RANKING_WEIGHTS,
    rrf: 2,
  });
});

test("genfinding@k tæller forventede refs i de første k, og tomme forventninger tæller ikke", () => {
  assert.equal(recallAtK(["a", "b"], ["x", "a", "y", "b"], 20), 1);
  assert.equal(recallAtK(["a", "b"], ["x", "a", "y", "b"], 2), 0.5);
  assert.equal(recallAtK(["a", "a"], ["a"], 20), 1);
  assert.equal(recallAtK([], ["a"], 20), null);
});

test("testsættet: de første 15 spørgsmål har de samme stabile id'er som demo-seeden", () => {
  assert.equal(DEMO_EVAL_SET.length, 57);
  // Pinned: demoId("case-0") in scripts/brain-seed-demo.ts gives the same uuid.
  assert.match(
    demoId("case-0"),
    /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  assert.equal(
    staticRef({ kind: "evidence", caseIndex: 0, key: "arr" }),
    `evidence_items:${demoId("evidence-0-arr")}`,
  );
  const first = DEMO_EVAL_SET.slice(0, 15);
  assert.equal(first.filter((item) => item.expected.length > 0).length, 14);
  assert.equal(first.find((item) => item.category === "multi_hop")?.expected.length, 12);
  assert.equal(first[0]?.question, "Hvad er selskabets ARR?");
  assert.equal(first[14]?.question, "Hvad synes en anden fond om Nordlys?");
});

test("testsættet: hver kategori er med, hvert spørgsmål har et facit, og beslutninger afvises", () => {
  const categories = new Set(DEMO_EVAL_SET.map((item) => item.category));
  assert.equal(categories.size, 9);
  for (const item of DEMO_EVAL_SET) assert.ok(item.facts.length > 0, item.question);
  assert.equal(new Set(DEMO_EVAL_SET.map((x) => x.question)).size, DEMO_EVAL_SET.length);
  // No fixed opening; a decision question is graded on leaving the decision to the team.
  const decisions = DEMO_EVAL_SET.filter((item) =>
    item.mustNot.includes("Svare ja eller nej, eller give sin egen anbefaling"),
  );
  assert.ok(decisions.length >= 3);
  assert.deepEqual(evalFactsColumn(decisions[1]!).slice(-1), [
    "Må ikke: Svare ja eller nej, eller give sin egen anbefaling",
  ]);
  for (const item of DEMO_EVAL_SET) {
    const points = facitPoints(item);
    assert.equal(new Set(points.map((p) => p.id)).size, points.length, item.question);
    if (item.from !== "phase4") {
      assert.ok(
        points.some((p) => !p.negative && p.critical),
        `${item.question}: needs a critical point`,
      );
    }
  }
  for (const item of DEMO_EVAL_SET.filter((x) => x.category === "global")) {
    assert.equal(item.from, "phase4");
  }
  assert.equal(DEMO_EVAL_SET.filter((_, index) => trackOf(index) === "holdout").length, 19);
  assert.equal(
    staticRef({ kind: "storyNote", caseIndex: 0, key: "board-2026-09" }),
    `case_notes:${demoId("story-note-0-board-2026-09")}`,
  );
});

test("tekstsøgningen matcher et hvilket som helst af spørgsmålets ord", () => {
  assert.equal(
    ftsQuery("Hvad siger fondsrapporten om B2B SaaS i seed-fasen?"),
    "fondsrapporten or b2b or saas or seed or fasen",
  );
  assert.equal(ftsQuery("Hvad står der om administratortilstand?"), "administratortilstand");
  assert.equal(ftsQuery("Hvad er det?"), "Hvad er det?");
});
