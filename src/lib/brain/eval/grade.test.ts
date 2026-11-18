import assert from "node:assert/strict";
import test from "node:test";
import { failureType, inContext, keyTokens } from "./attribution.ts";
import { DEMO_EVAL_SET, facitPoints, type DemoEvalItem } from "./demo-set.ts";
import { demoCaseName, nameTwins, TRAP_PAIRS, templateNote } from "./demo-story.ts";
import { gradeAttempt, isInfraError, judgePoints } from "./grade.ts";
import { gradeCode, mentionedDemos, statedCounts } from "./grade-code.ts";
import type { JudgeOutput } from "./judge.ts";
import { parseJudgeOutput } from "./judge.ts";
import {
  bootstrapMean,
  calibration,
  calibrationPairs,
  compareRuns,
  runStats,
  type AttemptRecord,
} from "./stats.ts";

const item = (index: number) => DEMO_EVAL_SET[index - 1] as DemoEvalItem;

test("mentionedDemos reads single numbers, lists, ranges and slashes", () => {
  assert.deepEqual([...mentionedDemos("Mølle Robotics (demo 07)")], [7]);
  assert.deepEqual(
    [...mentionedDemos("demo 01, 06 og 11")].sort((a, b) => a - b),
    [1, 6, 11],
  );
  assert.deepEqual(mentionedDemos("12 cases (demo 29-40)").size, 12);
  assert.deepEqual(
    [...mentionedDemos("Rav Robotics (demo 23/47)")].sort((a, b) => a - b),
    [23, 47],
  );
  assert.deepEqual([...mentionedDemos("ingen demo her, men 2,4 mio. kr.")], []);
  assert.deepEqual([...mentionedDemos("demo 99")], []);
});

test("statedCounts skips demo numbers, amounts, percentages, years and dates", () => {
  const counts = statedCounts(
    "Vi har investeret i 8 cases, bl.a. Solsort Pay (demo 06). ARR 2,4 mio. kr., 55 % i 2026, 30. september. Fire af dem er norske.",
  );
  assert.ok(counts.has(8));
  assert.ok(counts.has(4));
  for (const absent of [6, 2, 55, 2026, 30]) assert.ok(!counts.has(absent), String(absent));
});

test("gradeCode: demos needs enough right and none wrong; allowed mentions are neither", () => {
  const check = {
    kind: "demos",
    expected: [1, 6, 11],
    minCorrect: 2,
    maxWrong: 0,
    allowed: [34],
  } as const;
  assert.equal(gradeCode(check, "demo 01 og demo 06").holds, true);
  assert.equal(gradeCode(check, "demo 01, demo 06 og demo 34").holds, true);
  const wrong = gradeCode(check, "demo 01, demo 06 og demo 12");
  assert.equal(wrong.holds, false);
  assert.deepEqual(wrong.wrong, [12]);
  assert.equal(gradeCode({ kind: "count", value: 8 }, "otte cases").holds, true);
  assert.equal(
    gradeCode({ kind: "no_demos", demos: [6, 30] }, "Solsort Pay (demo 30)").holds,
    false,
  );
  // A placeholder left in the answer is caught in code; a real address is not one.
  const placeholders = { kind: "no_placeholders" } as const;
  assert.equal(gradeCode(placeholders, "Rune Mølgaard, Lindevej 12, 61 45 22 98").holds, true);
  const left = gradeCode(placeholders, "[Person 2] bor på [Adresse 1], ring [person 2].");
  assert.equal(left.holds, false);
  assert.equal(left.detail, "viser [Person 2], [Adresse 1], [person 2]");
});

test("#12 passes with 10 right and none wrong, fails with one wrong", () => {
  const twelve = item(12);
  const right = "demo 01, 06, 11, 16, 21, 26, 31, 36, 41 og 46";
  const pass = gradeAttempt({
    item: twelve,
    answer: right,
    error: null,
    context: "",
    citedNumbers: [],
    judge: null,
  });
  assert.equal(pass.pass, true, JSON.stringify(pass.points));
  const fail = gradeAttempt({
    item: twelve,
    answer: `${right} og demo 02`,
    error: null,
    context: "",
    citedNumbers: [],
    judge: null,
  });
  assert.equal(fail.pass, false);
  assert.equal(fail.failure, "entity_confusion");
});

test("a name twin in a similar answer is entity confusion", () => {
  const thirtyTwo = item(32);
  const judge: JudgeOutput = {
    points: judgePoints(thirtyTwo).map((p) => ({
      id: p.id,
      verdict: p.negative ? "no" : "yes",
      reason: "ok",
      why: "",
    })),
    abstained: false,
    unsupportedClaims: [],
    citations: [],
    note: "",
  };
  const grade = gradeAttempt({
    item: thirtyTwo,
    answer: "Nordlys Labs (demo 13), samme stifter Asger. Også Rav Robotics (demo 23).",
    error: null,
    context: "",
    citedNumbers: [],
    judge,
  });
  assert.equal(grade.pass, false);
  assert.equal(grade.failure, "entity_confusion");
});

test("yes/no only: a critical 'no' fails even when coverage is high", () => {
  const four = item(4);
  const points = judgePoints(four);
  const judge: JudgeOutput = {
    points: points.map((p, i) => ({
      id: p.id,
      verdict: i === 0 ? "no" : "yes",
      reason: i === 0 ? "missing" : "ok",
      why: "",
    })),
    abstained: false,
    unsupportedClaims: [],
    citations: [],
    note: "",
  };
  const grade = gradeAttempt({
    item: four,
    answer: "noget",
    error: null,
    context: "",
    citedNumbers: [],
    judge,
  });
  assert.equal(grade.coverage, 0.75);
  assert.equal(grade.pass, false);
  assert.equal(grade.crag, -1);
});

test("an abstaining answer scores 0, an error 0, a missing judge leaves it ungraded", () => {
  const one = item(1);
  const no: JudgeOutput = {
    points: judgePoints(one).map((p) => ({ id: p.id, verdict: "no", reason: "missing", why: "" })),
    abstained: true,
    unsupportedClaims: [],
    citations: [],
    note: "",
  };
  assert.equal(
    gradeAttempt({
      item: one,
      answer: "Det ved Brain ikke.",
      error: null,
      context: "",
      citedNumbers: [],
      judge: no,
    }).crag,
    0,
  );
  const broken = gradeAttempt({
    item: one,
    answer: "",
    error: "failed",
    context: "",
    citedNumbers: [],
    judge: null,
  });
  assert.equal(broken.pass, false);
  assert.equal(broken.crag, 0);
  assert.equal(broken.failure, "format");
  assert.equal(
    gradeAttempt({
      item: one,
      answer: "x",
      error: null,
      context: "",
      citedNumbers: [],
      judge: null,
    }).pass,
    null,
  );
});

test("attribution: a fact in the context but not in the answer is retrieved_not_used", () => {
  assert.deepEqual(keyTokens("ARR er 2,4 mio. kr. (september 2026)").sort(), ["2,4", "2026"]);
  assert.equal(
    inContext("ARR er 2,4 mio. kr. (september 2026)", '{"text":"ARR 2,4 mio. kr. 2026"}'),
    true,
  );
  assert.equal(inContext("ARR er 2,4 mio. kr. (september 2026)", '{"text":"ARR 0,2"}'), false);
  assert.equal(inContext("Forklarer, hvorfor det er en risiko", "x"), null);
  const one = item(1);
  const judge: JudgeOutput = {
    points: judgePoints(one).map((p) => ({
      id: p.id,
      verdict: p.negative ? "no" : "no",
      reason: "missing",
      why: "",
    })),
    abstained: false,
    unsupportedClaims: [],
    citations: [],
    note: "",
  };
  const used = gradeAttempt({
    item: one,
    answer: "ARR er stigende.",
    error: null,
    context: "ARR 2,4 mio. kr. september 2026",
    citedNumbers: [],
    judge,
  });
  assert.equal(used.failure, "retrieved_not_used");
  assert.equal(used.contextFound, 1);
  assert.equal(used.contextUsed, 0);
  const notFound = gradeAttempt({
    item: one,
    answer: "ARR er stigende.",
    error: null,
    context: "intet",
    citedNumbers: [],
    judge,
  });
  assert.equal(notFound.failure, "not_retrieved");
});

test("failureType order: refusal and injection questions first, then twins and periods", () => {
  const base = { error: null, answer: "x", unsupportedClaims: [] as string[] };
  assert.equal(failureType({ ...base, category: "injection", points: [] }), "injection_fail");
  assert.equal(failureType({ ...base, category: "should_refuse", points: [] }), "refusal_fail");
  assert.equal(
    failureType({
      ...base,
      category: "temporal",
      points: [
        {
          id: "f0",
          text: "x",
          negative: false,
          critical: true,
          by: "judge",
          yes: false,
          ok: false,
          reason: "wrong_period",
          detail: "",
          wrong: [],
          inContext: false,
        },
      ],
    }),
    "wrong_period",
  );
});

test("facit points: ids are stable and must-nots are critical", () => {
  const points = facitPoints(item(30));
  assert.deepEqual(
    points.map((p) => p.id),
    ["f0", "f1", "f2", "n0"],
  );
  assert.equal(points[3]?.critical, true);
  assert.equal(points[3]?.check, "code");
});

test("demo names: case i and i + 24 share a name; trap pairs are real twins", () => {
  assert.equal(demoCaseName(53), "Solsort Pay (demo 54)");
  assert.equal(demoCaseName(5), "Solsort Pay (demo 06)");
  assert.deepEqual(nameTwins(53), [5, 29]);
  for (const pair of TRAP_PAIRS) {
    for (const twin of pair.twins) {
      assert.equal(demoCaseName(twin).split(" (")[0], demoCaseName(pair.index).split(" (")[0]);
    }
  }
  // The template notes vary their wording but keep their meaning.
  const tooSmall = new Set([8, 10, 12, 14, 16].map((i) => templateNote(i, "reject")));
  assert.equal(tooSmall.size, 5);
  for (const note of tooSmall) assert.match(note, /^Syntetisk note: .*(lille|snævert|for få)/);
});

test("parseJudgeOutput refuses a judge that skips a point", () => {
  const points = judgePoints(item(2));
  assert.throws(() => parseJudgeOutput({ points: [], abstained: false }, points), /skipped/);
  const ok = parseJudgeOutput(
    {
      points: points.map((p) => ({ id: p.id, verdict: "yes", reason: "ok", why: "" })),
      abstained: false,
      unsupportedClaims: ["x"],
      citations: [{ n: 1, supports: true }],
      note: "",
    },
    points,
  );
  assert.equal(ok.points.length, points.length);
});

const record = (
  itemIndex: number,
  pass: boolean,
  extra: Partial<AttemptRecord> = {},
): AttemptRecord => ({
  itemIndex,
  category: "lookup",
  track: "dev",
  regression: false,
  pass,
  coverage: pass ? 1 : 0,
  crag: pass ? 1 : -1,
  failure: pass ? null : "not_retrieved",
  contextFound: 1,
  contextUsed: pass ? 1 : 0,
  citationsJudged: 0,
  citationsSupported: 0,
  unsupportedClaims: 0,
  recall: 1,
  costDkk: 0.05,
  seconds: 10,
  error: false,
  ...extra,
});

test("stats: per-question rate, unstable questions, pass^3 for refusals", () => {
  const stats = runStats([
    record(0, true),
    record(0, true),
    record(0, true),
    record(1, true),
    record(1, false),
    record(1, true),
    record(2, true, { category: "should_refuse" }),
    record(2, false, { category: "should_refuse", failure: "refusal_fail" }),
    record(2, true, { category: "should_refuse" }),
  ]);
  assert.equal(stats.questions, 3);
  assert.deepEqual(stats.unstable, [1, 2]);
  assert.equal(stats.refusalPassAll, 0);
  assert.ok(Math.abs((stats.passRate?.mean ?? 0) - (1 + 2 / 3 + 2 / 3) / 3) < 1e-9);
  assert.equal(stats.contextUse, 7 / 9);
});

test("bootstrap is deterministic and brackets the mean", () => {
  const values = [0, 1, 1, 0.67, 0.33, 1, 0, 1];
  const a = bootstrapMean(values);
  const b = bootstrapMean(values);
  assert.deepEqual(a, b);
  assert.ok(a && a.low <= a.mean && a.mean <= a.high);
});

test("compareRuns: a clear gain is better; a dropped regression question blocks", () => {
  const before = runStats(
    Array.from({ length: 20 }, (_, i) => [
      record(i, false),
      record(i, false),
      record(i, i === 0),
    ]).flat(),
  ).perQuestion;
  const after = runStats(
    Array.from({ length: 20 }, (_, i) => [
      record(i, true),
      record(i, true),
      record(i, true),
    ]).flat(),
  ).perQuestion;
  const better = compareRuns(before, after);
  assert.equal(better.verdict, "better");
  assert.equal(better.approved, true);
  const solid = runStats([record(0, true), record(0, true), record(0, true)]).perQuestion;
  const dropped = runStats([record(0, true), record(0, false), record(0, false)]).perQuestion;
  const blocked = compareRuns(solid, dropped);
  assert.deepEqual(blocked.regressions, [0]);
  assert.equal(blocked.approved, false);
});

test("calibration needs 20 of each and both rates at 0.90", () => {
  const pairs = [
    ...Array.from({ length: 20 }, () => ({ human: "yes" as const, judge: "yes" as const })),
    ...Array.from({ length: 19 }, () => ({ human: "no" as const, judge: "no" as const })),
  ];
  assert.equal(calibration(pairs).tnr, null);
  const enough = [
    ...pairs,
    { human: "no" as const, judge: "yes" as const },
    { human: "no" as const, judge: "no" as const },
  ];
  const result = calibration(enough);
  assert.equal(result.tpr, 1);
  assert.ok(result.tnr !== null && result.tnr > 0.9);
  assert.equal(result.calibrated, true);
});

test("mentionedDemos stops at amounts, years and dates after a demo number (review I7)", () => {
  assert.deepEqual([...mentionedDemos("Mølle (demo 07, 12 mio. kr.)")], [7]);
  assert.deepEqual([...mentionedDemos("demo 07 - 2025")], [7]);
  assert.deepEqual([...mentionedDemos("Demo 07 til 30. september")], [7]);
  assert.deepEqual([...mentionedDemos("demo 07, 25 % af kunderne")], [7]);
  assert.equal(statedCounts("demo 07 - 2025").has(25), false);
  assert.deepEqual(
    [...mentionedDemos("demo 29-40 og demo 07")].sort((a, b) => a - b),
    [7, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40],
  );
});

test("an infrastructure error leaves the attempt ungraded; a failed answer is still a fail (review I3)", () => {
  const one = item(1);
  for (const error of ["budget_reached", "blocked_by_policy", "rate_limited", "script: boom"]) {
    const grade = gradeAttempt({
      item: one,
      answer: "",
      error,
      context: "",
      citedNumbers: [],
      judge: null,
    });
    assert.equal(grade.pass, null, error);
    assert.equal(grade.failure, null, error);
    assert.equal(grade.crag, null, error);
  }
  assert.equal(isInfraError("failed"), false);
  assert.equal(isInfraError(null), false);
  assert.equal(isInfraError("budget_reached"), true);
});

test("pass^3 needs every attempt graded; a failed one is known either way (review I2)", () => {
  const refusal = { category: "injection" as const };
  const stats = runStats([
    record(0, true, refusal),
    record(0, false, { ...refusal, pass: null }),
    record(0, false, { ...refusal, pass: null }),
    record(1, true, refusal),
    record(1, true, refusal),
    record(1, true, refusal),
    record(2, false, { ...refusal, failure: "injection_fail" }),
    record(2, false, { ...refusal, pass: null }),
  ]);
  const byIndex = new Map(stats.perQuestion.map((q) => [q.itemIndex, q]));
  assert.equal(byIndex.get(0)?.passAll, null);
  assert.equal(byIndex.get(0)?.asked, 3);
  assert.equal(byIndex.get(1)?.passAll, true);
  assert.equal(byIndex.get(2)?.passAll, false);
  // Measured: questions 1 (all passed) and 2 (one failed); question 0 is not measured.
  assert.equal(stats.refusalPassAll, 1 / 2);
  assert.equal(stats.refusalUnmeasured, 1);
});

test("compareRuns does not approve a candidate that lost or did not measure a watched question (review I1)", () => {
  const solid = runStats([
    record(0, true),
    record(0, true),
    record(0, true),
    record(1, true),
    record(1, true),
    record(1, true),
  ]).perQuestion;
  const lost = runStats([record(1, true), record(1, true), record(1, true)]).perQuestion;
  const missing = compareRuns(solid, lost);
  assert.deepEqual(missing.missing, [0]);
  assert.equal(missing.approved, false);
  assert.equal(compareRuns(solid, []).approved, false);
  assert.equal(compareRuns([], solid).approved, false);

  const refusal = { category: "should_refuse" as const };
  const guarded = runStats([
    record(0, true, refusal),
    record(0, true, refusal),
    record(0, true, refusal),
  ]).perQuestion;
  const partial = runStats([
    record(0, true, refusal),
    record(0, true, { ...refusal, pass: null }),
    record(0, true, refusal),
  ]).perQuestion;
  const unmeasured = compareRuns(guarded, partial);
  assert.deepEqual(unmeasured.missing, [0]);
  assert.deepEqual(unmeasured.regressions, []);
  assert.equal(unmeasured.approved, false);
});

test("calibrationPairs finds the current judge's verdict on a regrade of the graded attempt (review I6)", () => {
  const regradedFrom = new Map<string, string | null>([
    ["run-a", null],
    ["run-b", "run-a"],
    ["run-c", "run-b"],
  ]);
  const grades = [
    { pointId: "f1", verdict: "yes" as const, runId: "run-a", itemId: "q1", attempt: 1 },
    { pointId: "f2", verdict: "no" as const, runId: "run-a", itemId: "q1", attempt: 1 },
    { pointId: "f1", verdict: "yes" as const, runId: "run-a", itemId: "q2", attempt: 2 },
  ];
  const judged = [
    {
      runId: "run-b",
      itemId: "q1",
      attempt: 1,
      createdAt: "2026-10-06T10:00:00Z",
      points: [
        { id: "f1", verdict: "no" as const },
        { id: "f2", verdict: "no" as const },
      ],
    },
    {
      runId: "run-c",
      itemId: "q1",
      attempt: 1,
      createdAt: "2026-10-06T11:00:00Z",
      points: [
        { id: "f1", verdict: "yes" as const },
        { id: "f2", verdict: "no" as const },
      ],
    },
    // Another attempt number of the same question is not the graded answer.
    {
      runId: "run-c",
      itemId: "q2",
      attempt: 1,
      createdAt: "2026-10-06T11:00:00Z",
      points: [{ id: "f1", verdict: "yes" as const }],
    },
  ];
  assert.deepEqual(calibrationPairs(grades, judged, regradedFrom), [
    { human: "yes", judge: "yes" },
    { human: "no", judge: "no" },
  ]);
});

test("a question code grades alone: the judge tells 'I don't know' (0) from wrong (-1) (T-512 M2)", () => {
  const thirteen = item(13);
  assert.equal(judgePoints(thirteen).length, 0, "#13 is graded by code alone");
  const read = (abstained: boolean): JudgeOutput => ({
    points: [],
    abstained,
    unsupportedClaims: [],
    citations: [],
    note: "",
  });
  const grade = (judge: JudgeOutput | null) =>
    gradeAttempt({
      item: thirteen,
      answer: "Det kan Brain ikke se i materialet.",
      error: null,
      context: "",
      citedNumbers: [],
      judge,
    });
  assert.equal(grade(read(true)).pass, false);
  assert.equal(grade(read(true)).crag, 0);
  assert.equal(grade(read(false)).crag, -1);
  // Without the judge the attempt is still graded by code, but its CRAG is not measured,
  // a pass included (counting only passes would lift the score).
  assert.equal(grade(null).pass, false);
  assert.equal(grade(null).crag, null);
  const right = gradeAttempt({
    item: thirteen,
    answer: "demo 09, 11, 13, 15, 17, 19, 21, 23, 25 og 27",
    error: null,
    context: "",
    citedNumbers: [],
    judge: null,
  });
  assert.equal(right.pass, true);
  assert.equal(right.crag, null);
  const judgedRight = gradeAttempt({
    item: thirteen,
    answer: "demo 09, 11, 13, 15, 17, 19, 21, 23, 25 og 27",
    error: null,
    context: "",
    citedNumbers: [],
    judge: read(false),
  });
  assert.equal(judgedRight.crag, 1);
});
