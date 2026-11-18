import assert from "node:assert/strict";
import { test } from "node:test";
import {
  autoMergePairs,
  duplicateInsight,
  duplicateResolverPrompt,
  hasNewActivity,
  pairVerdicts,
  parseActivity,
  parseDuplicatePairs,
  runNightly,
  type DuplicatePair,
  type InsightRow,
  type NightlyDeps,
  type PairVerdict,
  type ResolverAnswer,
} from "./nightly.ts";

const FUND = "f0000000-0000-4000-8000-000000000001";
const JOB = "10000000-0000-4000-8000-000000000001";

const quiet = {
  since: "2026-10-06T02:15:00Z",
  episodes: 0,
  feedback: 0,
  retrievals: 0,
  entities: 0,
  bulletEvents: 0,
};
const busy = { ...quiet, episodes: 3 };

function pair(a: string, b: string, names = ["Nordlys ApS", "Nordlys Aps"]): DuplicatePair {
  return {
    a: { id: a, name: names[0]!, type: "company", key: `name:${names[0]!.toLowerCase()}` },
    b: { id: b, name: names[1]!, type: "company", key: `name:${names[1]!.toLowerCase()}` },
    trigram: 0.95,
    cosine: null,
  };
}

function fake(options: {
  activity?: Record<string, unknown>;
  marked?: Array<{ caseId: string; changedAt: string }>;
  pairs?: unknown[];
  answer?: ResolverAnswer;
  done?: Map<string, unknown>;
  failEnqueue?: string[];
}) {
  const rpcs: string[] = [];
  const rpcCalls = new Map<string, Array<Record<string, unknown>>>();
  const steps: Array<{ step: string; output: unknown; costUsd: number }> = [];
  const enqueued: string[] = [];
  const resolved: DuplicatePair[][] = [];
  const insights: InsightRow[] = [];
  const deps: NightlyDeps = {
    fundId: FUND,
    jobId: JOB,
    attempt: 1,
    doneSteps: async () => options.done ?? new Map(),
    async rpc(name, args) {
      rpcs.push(name);
      rpcCalls.set(name, [...(rpcCalls.get(name) ?? []), args]);
      assert.equal(args["_fund_id"], FUND);
      switch (name) {
        case "brain_nightly_reconcile":
          return options.marked ?? [];
        case "brain_nightly_activity":
          return options.activity ?? quiet;
        case "brain_nightly_duplicate_pairs":
          return options.pairs ?? [];
        case "brain_nightly_usefulness":
          assert.equal(args["_attempt"], 1);
          assert.equal(args["_job_id"], JOB);
          return { events: 2, lastEventId: 9 };
        default:
          return { ok: true };
      }
    },
    async recordStep(step, output, costUsd = 0) {
      steps.push({ step, output, costUsd });
      return true;
    },
    async enqueueCapture(caseId) {
      if (options.failEnqueue?.includes(caseId)) throw new Error("queue down");
      enqueued.push(caseId);
    },
    async resolvePairs(pairs) {
      resolved.push([...pairs]);
      return options.answer ?? { decisions: new Map(), costUsd: 0.001 };
    },
    async insertInsights(rows) {
      insights.push(...rows);
      return rows.length;
    },
    async refreshPages() {
      rpcs.push("pages");
      return { output: { saved: 2 }, costUsd: 0.002 };
    },
  };
  return { deps, rpcs, rpcCalls, steps, enqueued, resolved, insights };
}

test("a fund with nothing new only reconciles: skipped, no model call, 0 kr", async () => {
  const run = fake({});
  const result = await runNightly(run.deps);
  assert.equal(result.status, "skipped");
  assert.equal(result.stats["reason"], "nothing_new");
  assert.equal(result.stats["costUsd"], 0);
  assert.deepEqual(run.rpcs, ["brain_nightly_reconcile", "brain_nightly_activity"]);
  assert.equal(run.resolved.length, 0);
  assert.deepEqual(
    run.steps.map((s) => s.step),
    ["reconcile", "activity"],
  );
});

test("reconciliation enqueues L0 for each marked case and counts a failed enqueue", async () => {
  const run = fake({
    marked: [
      { caseId: "case-1", changedAt: "2026-10-07T02:15:01Z" },
      { caseId: "case-2", changedAt: "2026-10-07T02:15:01Z" },
    ],
    failEnqueue: ["case-2"],
  });
  await runNightly(run.deps);
  assert.deepEqual(run.enqueued, ["case-1"]);
  assert.deepEqual(run.steps[0], {
    step: "reconcile",
    output: { cases: 2, enqueued: 1, failed: 1 },
    costUsd: 0,
  });
});

test("a fund with something new runs steps 1–5 and 7–9 in order", async () => {
  const run = fake({ activity: busy });
  const result = await runNightly(run.deps);
  assert.equal(result.status, "done");
  assert.deepEqual(run.rpcs, [
    "brain_nightly_reconcile",
    "brain_nightly_activity",
    "brain_nightly_identity_merges",
    "brain_nightly_duplicate_pairs",
    "brain_nightly_lint",
    "brain_nightly_settle",
    "brain_nightly_usefulness",
    "pages",
    "brain_nightly_similar",
    "brain_nightly_lessons",
    "brain_nightly_cleanup",
  ]);
  // No pairs: no model call. Usefulness stores its own step with its watermark (0063).
  assert.equal(run.resolved.length, 0);
  assert.ok(!run.steps.some((s) => s.step === "usefulness"));
  assert.deepEqual(result.stats["usefulness"], { events: 2, lastEventId: 9 });
  // The page writer's cost is part of the night's cost and stored with its step.
  assert.deepEqual(
    run.steps.find((s) => s.step === "pages"),
    {
      step: "pages",
      output: { saved: 2 },
      costUsd: 0.002,
    },
  );
  assert.equal(result.stats["costUsd"], 0.002);
});

test("name twins go to the resolver in one call and become insights with its recommendation", async () => {
  const pairs = [pair("b", "a"), pair("c", "d", ["Pleo", "Pleo Technologies"]), pair("e", "f")];
  const run = fake({
    activity: busy,
    pairs,
    answer: {
      decisions: new Map([
        ["I1", { match: "C1", confidence: 0.93 }],
        ["I2", { match: "new", confidence: 0.9 }],
        ["I3", { match: "C1", confidence: 0.5 }],
      ]),
      costUsd: 0.0012,
    },
  });
  const result = await runNightly(run.deps);
  assert.equal(run.resolved.length, 1);
  assert.equal(run.resolved[0]!.length, 3);
  assert.deepEqual(
    run.insights.map((row) => [row.dedupe_key, row.status, row.priority]),
    [
      ["merge_candidate:a:b", "new", 2],
      ["merge_candidate:c:d", "dismissed", 3],
      ["merge_candidate:e:f", "new", 3],
    ],
  );
  assert.match(run.insights[0]!.body_md, /det samme\. Læg dem sammen/);
  assert.match(run.insights[2]!.body_md, /i tvivl/);
  const duplicates = run.steps.find((s) => s.step === "duplicates")!;
  assert.deepEqual(duplicates.output, {
    pairs: 3,
    same: 1,
    different: 1,
    unsure: 1,
    inserted: 3,
    autoMerge: { ok: true },
  });
  assert.deepEqual(run.rpcCalls.get("brain_nightly_auto_merge"), [
    { _fund_id: FUND, _pairs: [{ a: "b", b: "a", confidence: 0.93 }], _job_id: JOB },
  ]);
  assert.equal(duplicates.costUsd, 0.0012);
  // Resolver 0.0012 + pages 0.002 (the fake).
  assert.equal(result.stats["costUsd"], 0.0032);
});

test("without the resolver (budget) the pairs still get insights and the free steps run", async () => {
  const run = fake({
    activity: busy,
    pairs: [pair("a", "b")],
    answer: { stopped: "budget", costUsd: 0 },
  });
  const result = await runNightly(run.deps);
  assert.equal(result.status, "done");
  assert.equal(run.insights[0]!.status, "new");
  assert.match(run.insights[0]!.body_md, /i tvivl/);
  const duplicates = run.steps.find((s) => s.step === "duplicates")!;
  assert.equal((duplicates.output as Record<string, unknown>)["resolverStopped"], "budget");
  assert.ok(run.rpcs.includes("brain_nightly_cleanup"));
});

test("a retried message skips the stored steps and reuses the stored activity", async () => {
  const run = fake({
    activity: quiet,
    pairs: [pair("a", "b")],
    done: new Map<string, unknown>([
      ["reconcile", { cases: 0, enqueued: 0, failed: 0 }],
      ["activity", busy],
      ["merge", { merged: 1, refused: 0 }],
      ["duplicates", { pairs: 1 }],
    ]),
  });
  const result = await runNightly(run.deps);
  assert.equal(result.status, "done");
  assert.deepEqual(run.rpcs, [
    "brain_nightly_lint",
    "brain_nightly_settle",
    "brain_nightly_usefulness",
    "pages",
    "brain_nightly_similar",
    "brain_nightly_lessons",
    "brain_nightly_cleanup",
  ]);
  assert.equal(run.resolved.length, 0);
  assert.deepEqual(result.stats["merge"], { merged: 1, refused: 0 });
});

test("only a pair the resolver is at least 90 % sure about is merged by Brain itself", () => {
  const pairs = [pair("a", "b"), pair("c", "d"), pair("e", "f"), pair("g", "h")];
  const verdicts: PairVerdict[] = [
    { kind: "same", confidence: 0.9 },
    { kind: "same", confidence: 0.85 },
    { kind: "different", confidence: 0.99 },
    { kind: "unsure" },
  ];
  assert.deepEqual(autoMergePairs(pairs, verdicts), [{ a: "a", b: "b", confidence: 0.9 }]);
});

test("a pair below 90 % sure makes no merge call", async () => {
  const run = fake({
    activity: busy,
    pairs: [pair("a", "b")],
    answer: { decisions: new Map([["I1", { match: "C1", confidence: 0.85 }]]), costUsd: 0 },
  });
  await runNightly(run.deps);
  assert.ok(!run.rpcs.includes("brain_nightly_auto_merge"));
});

test("activity: any new episode, feedback, question, entity or lesson count is something new", () => {
  assert.equal(hasNewActivity(parseActivity(quiet)), false);
  for (const key of ["episodes", "feedback", "retrievals", "entities", "bulletEvents"]) {
    assert.equal(hasNewActivity(parseActivity({ ...quiet, [key]: 1 })), true, key);
  }
  assert.deepEqual(parseActivity(null), { ...quiet, since: null });
});

test("verdicts below the resolver's confidence threshold, or unanswered, are unsure", () => {
  const pairs = [pair("a", "b"), pair("c", "d"), pair("e", "f"), pair("g", "h")];
  const verdicts = pairVerdicts(
    pairs,
    new Map([
      ["I1", { match: "C1", confidence: 0.8 }],
      ["I2", { match: "new", confidence: 0.79 }],
      ["I3", { match: "C7", confidence: 0.99 }],
    ]),
  );
  assert.deepEqual(verdicts, [
    { kind: "same", confidence: 0.8 },
    { kind: "unsure" },
    { kind: "unsure" },
    { kind: "unsure" },
  ]);
  assert.deepEqual(pairVerdicts(pairs.slice(0, 1), null), [{ kind: "unsure" }]);
});

test("the resolver prompt is the entities task with one candidate per pair", () => {
  assert.equal(
    duplicateResolverPrompt([pair("a", "b")]),
    'Task: entities\n\nI1: company "Nordlys ApS" (name:nordlys aps)\n  C1: Nordlys Aps (name:nordlys aps)',
  );
});

test("pairs from the database are validated", () => {
  const parsed = parseDuplicatePairs([
    {
      a: { id: "a", name: "A", type: "company", key: "name:a" },
      b: { id: "b", name: "B", type: "company", key: "name:b" },
      trigram: "0.950",
      cosine: null,
    },
    { a: { id: "a", name: "A", type: "company" }, b: { id: "a", name: "A", type: "company" } },
    { a: null, b: { id: "b", name: "B", type: "company" } },
  ]);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0]!.trigram, 0.95);
  assert.equal(parsed[0]!.cosine, null);
  assert.deepEqual(parseDuplicatePairs("nope"), []);
});

test("a merge insight's title and refs name both entities", () => {
  const row = duplicateInsight(FUND, pair("z", "y"), { kind: "unsure" });
  assert.equal(row.title, 'Er "Nordlys ApS" og "Nordlys Aps" det samme?');
  assert.deepEqual(row.refs, [
    { kind: "entity", id: "z" },
    { kind: "entity", id: "y" },
  ]);
  assert.equal(row.dedupe_key, "merge_candidate:y:z");
  assert.equal(row.created_by_loop, "L4_nightly");
});

test("facts without a vector are embedded after the pages, with their own step and cost (T-737 c)", async () => {
  const run = fake({ activity: busy });
  run.deps.embedFacts = async () => {
    run.rpcs.push("vectors");
    return { output: { found: 3, stored: 3 }, costUsd: 0.0001 };
  };
  const result = await runNightly(run.deps);
  const order = run.rpcs.filter((name) => name === "pages" || name === "vectors");
  assert.deepEqual(order, ["pages", "vectors"]);
  assert.deepEqual(
    run.steps.find((s) => s.step === "vectors"),
    { step: "vectors", output: { found: 3, stored: 3 }, costUsd: 0.0001 },
  );
  assert.equal(result.stats["costUsd"], 0.0021);
});
