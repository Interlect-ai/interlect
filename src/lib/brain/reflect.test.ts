import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checkEvidence,
  curatorPrompt,
  lessonId,
  parseCuratorOps,
  parseNeighbors,
  parseReflectKey,
  parseReflection,
  parseReflectionInput,
  planReflectionOps,
  reflectionCapUsd,
  reflectionRefs,
  reflectKey,
  reflectorPrompt,
  tagsFromFeedback,
  type CandidateLesson,
  type Neighbor,
} from "./reflect.ts";

const EVENT = "c7000000-0000-4000-8000-000000000001";
const SIMILAR = "c7000000-0000-4000-8000-000000000002";
const SIMILAR_AUTO = "c7000000-0000-4000-8000-000000000003";
const SUMMARY = "e7000000-0000-4000-8000-000000000001";
const FINDING = "e7000000-0000-4000-8000-000000000002";
const DECK = "e7000000-0000-4000-8000-000000000003";
const RISK = "e7000000-0000-4000-8000-000000000004";
const LESSON_CTX = "b7000000-0000-4000-8000-000000000001";
const LESSON_REL = "b7000000-0000-4000-8000-000000000002";
const LESSON_NEAR = "b7000000-0000-4000-8000-000000000003";
const USER = "a7000000-0000-4000-8000-000000000001";

function rawInput(overrides: Record<string, unknown> = {}) {
  const { decision: decisionOverrides, ...rest } = overrides;
  return {
    decision: {
      id: EVENT,
      caseId: "d7000000-0000-4000-8000-000000000001",
      kind: "reject",
      fromPhase: "screening",
      occurredAt: "2026-10-05T10:00:00Z",
      actorType: "user",
      actorId: USER,
      standing: true,
      reasonCodes: ["valuation_too_high"],
      reasons: ["Værdiansættelse for høj"],
      reasonText: "For dyr i forhold til traction",
      ...((decisionOverrides as object | undefined) ?? {}),
    },
    company: { name: "Refleks ApS", sector: "fintech", stage: "seed", geography: "DK" },
    analysis: {
      runId: "f7000000-0000-4000-8000-000000000001",
      kind: "screening",
      episodeId: SUMMARY,
      content: "Screening: samlet score 3,1, anbefaling følg udviklingen.",
      trust: "analysis",
    },
    findings: [
      { episodeId: FINDING, content: "[economics · svaghed] Lav bruttomargin", trust: "analysis" },
      { episodeId: DECK, content: "[traction · styrke] 300 % vækst", trust: "company_claim" },
    ],
    risks: [{ episodeId: RISK, content: "[economics · høj] Høj pris", trust: "analysis" }],
    contextLessons: [
      {
        id: LESSON_CTX,
        shortId: "pb-00001",
        section: "red_flags",
        text: "Høj pris uden traction",
        status: "active",
        helpful: 2,
        harmful: 0,
      },
    ],
    relevantLessons: [
      {
        id: LESSON_REL,
        shortId: "pb-00002",
        section: "green_flags",
        text: "Stærkt team i fintech",
        status: "active",
        helpful: 1,
        harmful: 1,
      },
    ],
    similarDecisions: [
      {
        id: SIMILAR,
        caseId: "d7000000-0000-4000-8000-000000000002",
        company: "Spejl ApS",
        kind: "reject",
        decidedAt: "2026-09-30T10:00:00Z",
        actorType: "user",
        actorId: USER,
        reasonCodes: ["valuation_too_high"],
        reasons: ["Værdiansættelse for høj"],
        reasonText: null,
        cosine: 0.95,
      },
      {
        id: SIMILAR_AUTO,
        caseId: "d7000000-0000-4000-8000-000000000003",
        company: "Ekko ApS",
        kind: "reject",
        decidedAt: "2026-09-29T10:00:00Z",
        actorType: "system",
        actorId: null,
        reasonCodes: ["valuation_too_high"],
        reasons: ["Værdiansættelse for høj"],
        reasonText: null,
        cosine: 0.9,
      },
    ],
    ...rest,
  };
}

function input(overrides: Record<string, unknown> = {}) {
  const parsed = parseReflectionInput(rawInput(overrides));
  assert.ok(parsed);
  return parsed;
}

test("the job key is the decision event id", () => {
  assert.equal(reflectKey(EVENT.toUpperCase()), `decision:${EVENT}`);
  assert.equal(parseReflectKey(`decision:${EVENT}`), EVENT);
  assert.equal(parseReflectKey(EVENT), null);
  assert.equal(parseReflectKey("decision:42"), null);
  assert.throws(() => reflectKey("nope"));
});

test("the cap per decision comes from the installation's rate (0,50 kr.)", () => {
  assert.ok(Math.abs(reflectionCapUsd(null) - 0.5 / 6.9) < 1e-9);
  assert.ok(Math.abs(reflectionCapUsd({ dkkPerDecision: 1, usdToDkk: 7 }) - 1 / 7) < 1e-9);
  assert.equal(reflectionCapUsd({ dkkPerDecision: 0, usdToDkk: 7 }), 0);
  assert.ok(reflectionCapUsd({ dkkPerDecision: null, usdToDkk: null }) > 0);
});

test("the input is parsed; malformed rows are dropped", () => {
  assert.equal(parseReflectionInput(null), null);
  assert.equal(parseReflectionInput({ decision: { id: EVENT } }), null);
  const parsed = input({ findings: [{ content: "uden id" }, ...rawInput().findings] });
  assert.equal(parsed.findings.length, 2);
  assert.equal(parsed.decision.standing, true);
  assert.equal(parsed.similarDecisions[0]?.occurredAt, "2026-09-30T10:00:00Z");
});

test("the models see labels, never ids, and low-trust text is marked", () => {
  const data = input();
  const refs = reflectionRefs(data);
  const prompt = reflectorPrompt(data, refs);
  for (const id of [EVENT, SIMILAR, SUMMARY, FINDING, LESSON_CTX, USER]) {
    assert.ok(!prompt.includes(id), `prompt leaks ${id}`);
  }
  assert.match(prompt, /Beslutning D1 i screening: Kasseret 2026-10-05/);
  assert.match(prompt, /Årsager: Værdiansættelse for høj\./);
  assert.match(prompt, /E3 \[selskabets påstand\]: \[traction · styrke\] 300 % vækst/);
  assert.match(prompt, /pb-00001 \(aktiv, rødt flag/);
  assert.match(prompt, /D2 Spejl ApS: Kasseret 2026-09-30/);
  assert.match(prompt, /D3 Ekko ApS: Kasseret 2026-09-29 \(automatisk flytning\)/);
  assert.equal(refs.refs.get("E1")?.id, SUMMARY);
  assert.equal(refs.refs.get("D1")?.anchor, true);
  assert.equal(refs.refs.get("D3")?.anchor, false);
});

test("evidence rule: unknown refs are dropped, D1 must anchor the lesson", () => {
  const refs = reflectionRefs(input());
  const ok = checkEvidence(["[D1]", "e1", "D2", "D9", "x7000000-0000"], refs);
  assert.ok(ok.ok);
  assert.deepEqual(ok.evidence, [
    { kind: "decision", id: EVENT },
    { kind: "episode", id: SUMMARY },
    { kind: "decision", id: SIMILAR },
  ]);
  assert.deepEqual(ok.dropped, ["D9", "x7000000-0000"]);

  // An evidence ref that was not in the input cannot carry a lesson on its own.
  const invented = checkEvidence([EVENT, "D9"], refs);
  assert.deepEqual(invented, { ok: false, reason: "no_anchor", dropped: [EVENT, "D9"] });

  // A lesson from a deck alone (company claim) is rejected.
  const deck = checkEvidence(["E3"], refs);
  assert.equal(deck.ok, false);
  assert.deepEqual(deck.dropped, ["E3"]);

  // A similar decision is support, never the anchor: the confirmation counts for D1's user/case.
  assert.equal(checkEvidence(["D2", "E2"], refs).ok, false);
});

test("evidence rule: a decision without reason codes or by the system anchors nothing", () => {
  const noReasons = reflectionRefs(input({ decision: { reasonCodes: [], reasons: [] } }));
  assert.equal(checkEvidence(["D1", "E1"], noReasons).ok, false);
  const automatic = reflectionRefs(input({ decision: { actorType: "system", actorId: null } }));
  assert.equal(checkEvidence(["D1"], automatic).ok, false);
});

test("the reflector's answer is checked, clipped and capped", () => {
  assert.equal(
    parseReflection({
      agreement: "maybe",
      keyInsight: "",
      bulletFeedback: [],
      candidateLessons: [],
    }),
    null,
  );
  const candidate = (text: string, section = "red_flags") => ({
    section,
    text,
    sectors: ["fintech", "fintech", ""],
    stages: [],
    geographies: [],
    evidence: ["D1"],
  });
  const parsed = parseReflection({
    agreement: "team_stricter",
    keyInsight: "x".repeat(900),
    bulletFeedback: [
      { lesson: "PB-00001", tag: "helpful", why: "Prisen" },
      { lesson: "pb-00002", tag: "maybe", why: "" },
    ],
    candidateLessons: [
      candidate("Værdiansættelse over 20x ARR i seed er et afslag"),
      candidate("kort"),
      candidate("Ukendt sektion her", "nonsense"),
      candidate("Nummer to lektion om pris"),
      candidate("Nummer tre lektion om pris"),
      candidate("Nummer fire lektion om pris"),
    ],
  });
  assert.ok(parsed);
  assert.equal(parsed.keyInsight.length, 600);
  assert.deepEqual(parsed.bulletFeedback, [{ lesson: "pb-00001", tag: "helpful", why: "Prisen" }]);
  assert.equal(parsed.candidateLessons.length, 3);
  assert.deepEqual(parsed.candidateLessons[0]?.scope, { sectors: ["fintech"] });
});

test("a parsed reflection read back from its job step keeps its scope", () => {
  const raw = {
    agreement: "aligned",
    keyInsight: "Prisen afgjorde det.",
    bulletFeedback: [],
    candidateLessons: [
      {
        section: "red_flags",
        text: "Over 20x ARR i seed er et afslag for fonden",
        sectors: ["fintech"],
        stages: ["seed"],
        geographies: [],
        evidence: ["D1"],
      },
    ],
  };
  const first = parseReflection(raw);
  assert.ok(first);
  const again = parseReflection(JSON.parse(JSON.stringify(first)));
  assert.deepEqual(again, first);
  assert.deepEqual(again?.candidateLessons[0]?.scope, { sectors: ["fintech"], stages: ["seed"] });
});

test("lesson ids are stable per decision and text", () => {
  const a = lessonId(EVENT, "Høj pris  uden traction");
  assert.equal(a, lessonId(EVENT.toUpperCase(), "høj pris uden traction"));
  assert.notEqual(a, lessonId(SIMILAR, "høj pris uden traction"));
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

const candidates: CandidateLesson[] = [
  {
    section: "red_flags",
    text: "Værdiansættelse over 20x ARR i seed er et afslag",
    scope: { sectors: ["fintech"] },
    evidence: ["D1", "E2"],
  },
  {
    section: "process",
    text: "Spørg altid til bruttomargin før dyb analyse",
    scope: {},
    evidence: ["D1"],
  },
  {
    section: "green_flags",
    text: "Selskabet vokser 300 % om året og er en god case",
    scope: {},
    evidence: ["E3"],
  },
];
const neighbors: Neighbor[][] = [
  [
    {
      id: LESSON_NEAR,
      shortId: "pb-00007",
      section: "red_flags",
      text: "Høj pris i seed",
      status: "candidate",
      cosine: 0.91,
    },
  ],
  [
    {
      id: LESSON_CTX,
      shortId: "pb-00001",
      section: "red_flags",
      text: "Høj pris uden traction",
      status: "active",
      cosine: 0.8,
    },
  ],
  [],
];

test("plan: the curator's operations become checked delta operations", () => {
  const refs = reflectionRefs(input());
  const { ops: curatorOps } = parseCuratorOps({
    ops: [
      { op: "CORROBORATE", candidate: "C1", lesson: "PB-00007", tag: "", text: "", why: "" },
      { op: "ADD", candidate: "C2", lesson: "", tag: "", text: "", why: "" },
      { op: "ADD", candidate: "C2", lesson: "", tag: "", text: "", why: "" },
      { op: "ADD", candidate: "C3", lesson: "", tag: "", text: "", why: "" },
      { op: "TAG", candidate: "", lesson: "pb-00001", tag: "helpful", text: "", why: "Prisen" },
      { op: "TAG", candidate: "", lesson: "pb-00001", tag: "harmful", text: "", why: "Igen" },
      { op: "TAG", candidate: "", lesson: "pb-00099", tag: "harmful", text: "", why: "Opdigtet" },
      { op: "ADD", candidate: "C9", lesson: "", tag: "", text: "", why: "" },
    ],
  });
  const embedding = [0.1, 0.2];
  const { ops, rejected } = planReflectionOps({
    eventId: EVENT,
    candidates,
    embeddings: [null, embedding, null],
    neighbors,
    curatorOps,
    refs,
  });
  assert.deepEqual(ops, [
    {
      op: "CORROBORATE",
      bulletId: LESSON_NEAR,
      evidence: [
        { kind: "decision", id: EVENT },
        { kind: "episode", id: FINDING },
      ],
    },
    {
      op: "ADD",
      id: lessonId(EVENT, candidates[1]!.text),
      section: "process",
      text: candidates[1]!.text,
      scope: {},
      evidence: [{ kind: "decision", id: EVENT }],
      embedding,
    },
    { op: "TAG", bulletId: LESSON_CTX, tag: "helpful", why: "Prisen" },
  ]);
  assert.deepEqual(
    rejected.map((r) => `${r.op}:${r.ref}:${r.reason}`),
    [
      "ADD:C2:repeated",
      "ADD:C3:no_anchor",
      "TAG:pb-00001:repeated",
      "TAG:pb-00099:unknown_lesson",
      "ADD:C9:unknown_candidate",
    ],
  );
});

test("plan: CORROBORATE only with a shown lesson that is similar enough", () => {
  const refs = reflectionRefs(input());
  const { ops: curatorOps } = parseCuratorOps({
    ops: [
      { op: "CORROBORATE", candidate: "C2", lesson: "pb-00001", tag: "", text: "", why: "" },
      { op: "CORROBORATE", candidate: "C1", lesson: "pb-00002", tag: "", text: "", why: "" },
    ],
  });
  const { ops, rejected } = planReflectionOps({
    eventId: EVENT,
    candidates,
    embeddings: [],
    neighbors,
    curatorOps,
    refs,
  });
  assert.deepEqual(ops, []);
  assert.deepEqual(
    rejected.map((r) => r.reason),
    ["not_a_neighbor", "not_a_neighbor"],
  );
});

test("plan: a sharpened text keeps the candidate's evidence; a too short one is ignored", () => {
  const refs = reflectionRefs(input());
  const { ops: curatorOps } = parseCuratorOps({
    ops: [
      {
        op: "ADD",
        candidate: "C1",
        lesson: "",
        tag: "",
        text: "Over 20x ARR i seed: sig nej",
        why: "",
      },
      { op: "ADD", candidate: "C2", lesson: "", tag: "", text: "kort", why: "" },
    ],
  });
  const { ops } = planReflectionOps({
    eventId: EVENT,
    candidates,
    embeddings: [],
    neighbors,
    curatorOps,
    refs,
  });
  assert.equal(ops[0]?.op === "ADD" && ops[0].text, "Over 20x ARR i seed: sig nej");
  assert.equal(ops[1]?.op === "ADD" && ops[1].text, candidates[1]!.text);
  assert.deepEqual(ops[0]?.op === "ADD" && ops[0].evidence.map((e) => e.id), [EVENT, FINDING]);
});

test("without a curator answer only the reflector's verdicts on shown lessons are tagged", () => {
  const refs = reflectionRefs(input());
  const tags = tagsFromFeedback(
    [
      { lesson: "pb-00001", tag: "harmful", why: "Teamet gik videre" },
      { lesson: "pb-00001", tag: "helpful", why: "Igen" },
      { lesson: "pb-00002", tag: "neutral", why: "" },
      { lesson: "pb-00042", tag: "helpful", why: "Ukendt" },
    ],
    refs.lessons,
  );
  assert.deepEqual(tags, [
    { op: "TAG", bulletId: LESSON_CTX, tag: "harmful", why: "Teamet gik videre" },
  ]);
});

test("the curator sees candidates, their neighbors and the verdicts, never ids", () => {
  const data = input();
  const refs = reflectionRefs(data);
  const prompt = curatorPrompt({
    decision: data.decision,
    candidates,
    neighbors,
    feedback: [
      { lesson: "pb-00001", tag: "helpful", why: "Prisen" },
      { lesson: "pb-00002", tag: "neutral", why: "" },
    ],
    lessons: refs.lessons,
  });
  assert.match(prompt, /C1 \(rødt flag; sektor fintech\): Værdiansættelse over 20x ARR/);
  assert.match(prompt, /Ligner pb-00007 \(kandidat, lighed 0,91\)/);
  assert.match(prompt, /C3 .*\n {2}Ingen eksisterende lektion ligner\./);
  assert.match(prompt, /pb-00001 pegede mod beslutningen/);
  assert.ok(!prompt.includes("pb-00002"));
  assert.ok(!prompt.includes(LESSON_NEAR) && !prompt.includes(EVENT));
});

test("neighbors are parsed per candidate", () => {
  const parsed = parseNeighbors(
    [
      [
        {
          id: LESSON_NEAR,
          shortId: "pb-00007",
          section: "red_flags",
          text: "x",
          status: "active",
          cosine: "0.912",
        },
      ],
      "junk",
    ],
    3,
  );
  assert.equal(parsed.length, 3);
  assert.equal(parsed[0]?.[0]?.cosine, 0.912);
  assert.deepEqual(parsed[1], []);
  assert.deepEqual(parsed[2], []);
});
