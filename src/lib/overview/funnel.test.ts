import { test } from "node:test";
import assert from "node:assert/strict";
import {
  effectiveEvents,
  funnelCounts,
  intakeBars,
  reachFromEvents,
  reachedSteps,
  type FunnelFacts,
  type TransitionEvent,
} from "./funnel.ts";

const NOW = new Date("2026-10-01T10:00:00Z");

const facts = (over: Partial<FunnelFacts> & { caseId: string }): FunnelFacts => ({
  createdAt: "2026-09-20T10:00:00Z",
  hasScreening: false,
  screeningScore: null,
  reachedDeep: false,
  reachedCommittee: false,
  reachedInvested: false,
  ...over,
});

const counts = (result: ReturnType<typeof funnelCounts>) =>
  Object.fromEntries(result.steps.map((step) => [step.key, step.count]));

test("the funnel counts the cohort created in the period, not the current phase", () => {
  const result = funnelCounts(
    [
      facts({ caseId: "a" }),
      facts({ caseId: "b", hasScreening: true, screeningScore: 55 }),
      facts({ caseId: "c", hasScreening: true, screeningScore: 74 }),
      facts({ caseId: "d", hasScreening: true, screeningScore: 81, reachedDeep: true }),
      facts({
        caseId: "e",
        hasScreening: true,
        screeningScore: 79,
        reachedDeep: true,
        reachedCommittee: true,
        reachedInvested: true,
      }),
      // Created before the period: never in the cohort.
      facts({ caseId: "old", createdAt: "2026-06-01T10:00:00Z", hasScreening: true }),
    ],
    70,
    "4w",
    NOW,
  );
  assert.deepEqual(counts(result), {
    in: 5,
    screened: 4,
    over: 3,
    deep: 2,
    committee: 1,
    invested: 1,
  });
  assert.equal(result.cohort, 5);
  assert.deepEqual(result.cohortIds, ["a", "b", "c", "d", "e"]);
  assert.deepEqual(
    result.steps.map((step) => step.percent),
    [null, 80, 60, 40, 20, 20],
  );
});

test("a case that has reached a step has reached the steps before it (phases can be skipped)", () => {
  // Moved straight to Komité without a screening or a deep analysis.
  const skipped = facts({ caseId: "x", reachedCommittee: true });
  const reached = reachedSteps(skipped, 70);
  assert.equal(reached.screened, true);
  assert.equal(reached.deep, true);
  assert.equal(reached.committee, true);
  assert.equal(reached.invested, false);
  // "Over tærsklen" needs a score; it is not implied by being further on.
  assert.equal(reached.over, false);
  const result = funnelCounts([skipped], 70, "4w", NOW);
  assert.deepEqual(counts(result), {
    in: 1,
    screened: 1,
    over: 0,
    deep: 1,
    committee: 1,
    invested: 0,
  });
});

test("the chain never rises and 'over the threshold, not forwarded' is never negative", () => {
  const result = funnelCounts(
    [
      // Deep without any score above the threshold: deep (1) > over (0).
      facts({ caseId: "a", reachedDeep: true, hasScreening: true, screeningScore: 40 }),
      facts({ caseId: "b", reachedInvested: true }),
    ],
    70,
    "4w",
    NOW,
  );
  const steps = counts(result);
  assert.ok(steps["in"]! >= steps["screened"]!);
  assert.ok(steps["screened"]! >= steps["deep"]!);
  assert.ok(steps["deep"]! >= steps["committee"]!);
  assert.ok(steps["committee"]! >= steps["invested"]!);
  assert.equal(result.overNotForwarded, 0);
});

test("over the threshold but not forwarded counts the cases, not the difference", () => {
  const result = funnelCounts(
    [
      facts({ caseId: "a", hasScreening: true, screeningScore: 72 }),
      facts({ caseId: "b", hasScreening: true, screeningScore: 90 }),
      facts({ caseId: "c", hasScreening: true, screeningScore: 88, reachedDeep: true }),
    ],
    70,
    "4w",
    NOW,
  );
  assert.equal(result.overNotForwarded, 2);
});

test("the threshold is inclusive", () => {
  const result = funnelCounts(
    [facts({ caseId: "a", hasScreening: true, screeningScore: 70 })],
    70,
    "4w",
    NOW,
  );
  assert.equal(counts(result)["over"], 1);
});

test("period filter: the same cases give a different funnel for a quarter and a year", () => {
  const all = [
    facts({ caseId: "new", createdAt: "2026-09-25T10:00:00Z" }),
    facts({ caseId: "q", createdAt: "2026-08-01T10:00:00Z", hasScreening: true }),
    facts({ caseId: "y", createdAt: "2026-02-01T10:00:00Z", hasScreening: true }),
  ];
  assert.equal(funnelCounts(all, 70, "4w", NOW).cohort, 1);
  assert.equal(funnelCounts(all, 70, "12w", NOW).cohort, 2);
  assert.equal(funnelCounts(all, 70, "52w", NOW).cohort, 3);
});

test("an empty cohort has no percentages and no negative numbers", () => {
  const result = funnelCounts([], 70, "4w", NOW);
  assert.equal(result.cohort, 0);
  assert.ok(result.steps.every((step) => step.count === 0 && step.percent === null));
});

// -- transition log --------------------------------------------------------------------------

const event = (
  over: Partial<TransitionEvent> & { id: string; caseId: string },
): TransitionEvent => ({
  field: "phase",
  toPhase: null,
  toStatus: null,
  occurredAt: "2026-09-25T10:00:00Z",
  undoOf: null,
  ...over,
});

test("an undone transition has not happened (neither the move nor its undo counts)", () => {
  const log = [
    event({ id: "1", caseId: "a", toPhase: "committee" }),
    event({ id: "2", caseId: "a", toPhase: "deep_analysis", undoOf: "1" }),
    event({ id: "3", caseId: "b", toPhase: "committee" }),
  ];
  assert.deepEqual(
    effectiveEvents(log).map((entry) => entry.id),
    ["3"],
  );
  const reach = reachFromEvents(log);
  assert.equal(reach.get("a"), undefined);
  assert.equal(reach.get("b")?.committee, true);
  assert.equal(reach.get("b")?.deep, true);
});

test("reach from the log: deep, committee (with the latest entry date) and invested", () => {
  const reach = reachFromEvents([
    event({ id: "1", caseId: "a", toPhase: "deep_analysis" }),
    event({ id: "2", caseId: "a", toPhase: "committee", occurredAt: "2026-09-26T10:00:00Z" }),
    event({ id: "3", caseId: "a", toPhase: "committee", occurredAt: "2026-09-29T10:00:00Z" }),
    event({ id: "4", caseId: "a", field: "status", toStatus: "invested" }),
    event({ id: "5", caseId: "b", field: "status", toStatus: "on_hold" }),
  ]);
  assert.deepEqual(reach.get("a"), {
    deep: true,
    committee: true,
    invested: true,
    committeeSince: "2026-09-29T10:00:00Z",
  });
  assert.deepEqual(reach.get("b"), {
    deep: false,
    committee: false,
    invested: false,
    committeeSince: null,
  });
});

// -- intake ----------------------------------------------------------------------------------

test("intake: one bar per week, oldest first, today in the last bar", () => {
  const result = intakeBars(
    [
      { createdAt: "2026-10-01T08:00:00Z", forwarded: true }, // today
      { createdAt: "2026-09-25T08:00:00Z", forwarded: false }, // 6 days ago: still the last bar
      { createdAt: "2026-09-24T08:00:00Z", forwarded: true }, // 7 days ago: one bar back
      { createdAt: "2026-09-10T08:00:00Z", forwarded: false }, // 21 days ago: the oldest bar
      { createdAt: "2026-08-01T08:00:00Z", forwarded: true }, // out of the 4 weeks
    ],
    "4w",
    NOW,
  );
  assert.equal(result.bars.length, 4);
  assert.deepEqual(
    result.bars.map((bar) => [bar.total, bar.forwarded]),
    [
      [1, 0],
      [0, 0],
      [1, 1],
      [2, 1],
    ],
  );
  assert.equal(result.total, 4);
  assert.equal(result.forwarded, 2);
  assert.equal(result.fromLabel, "4 uger siden");
});

test("intake: a year is thirteen bars of four weeks; every case in the year lands in exactly one", () => {
  const created = Array.from({ length: 60 }, (_, index) => ({
    createdAt: new Date(NOW.getTime() - index * 6 * 86_400_000).toISOString(),
    forwarded: index % 3 === 0,
  }));
  const result = intakeBars(created, "52w", NOW);
  assert.equal(result.bars.length, 13);
  assert.equal(result.weeksPerBar, 4);
  const inYear = created.filter(
    (entry) => NOW.getTime() - Date.parse(entry.createdAt) < 364 * 86_400_000,
  );
  assert.equal(result.total, inYear.length);
  assert.ok(result.bars.every((bar) => bar.forwarded <= bar.total));
});

test("intake counts Danish days: a case at 23:30 UTC the night before belongs to today", () => {
  const now = new Date("2026-10-01T10:00:00Z");
  const result = intakeBars([{ createdAt: "2026-09-30T23:30:00Z", forwarded: false }], "4w", now);
  assert.equal(result.bars[3]!.total, 1);
  const week = intakeBars([{ createdAt: "2026-09-24T21:59:00Z", forwarded: false }], "4w", now);
  // 21:59 UTC on 24 Sept is 23:59 on the 24th in Denmark: 7 days ago, the second-to-last bar.
  assert.equal(week.bars[2]!.total, 1);
});
