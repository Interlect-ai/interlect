import assert from "node:assert/strict";
import { test } from "node:test";
import {
  backfillKey,
  backfillRunId,
  backfillStartedAt,
  backfillStopKey,
  estimateBackfill,
  parseBackfillKey,
} from "./backfill.ts";
import { parseBrainQueueMessage } from "./jobs.ts";

const FUND = "b1000000-0000-4000-8000-00000000000b";

test("a run id round-trips to its start time (whole seconds)", () => {
  const at = new Date("2026-09-30T09:30:12.456Z");
  const runId = backfillRunId(at);
  assert.equal(runId, "20260930T093012Z");
  assert.equal(backfillStartedAt(runId)?.toISOString(), "2026-09-30T09:30:12.000Z");
  assert.equal(backfillStartedAt("20260931T093012Z"), null);
  assert.equal(backfillStartedAt("2026-09-30"), null);
});

test("page keys are valid queue keys and parse back", () => {
  const key = backfillKey("full", "20260930T093012Z", 3);
  assert.equal(key, "full:20260930T093012Z:3");
  assert.ok(parseBrainQueueMessage({ fundId: FUND, loop: "BACKFILL", key }));
  const parsed = parseBackfillKey(key);
  assert.equal(parsed?.level, "full");
  assert.equal(parsed?.page, 3);
  assert.equal(parsed?.startedAt.toISOString(), "2026-09-30T09:30:12.000Z");
  assert.throws(() => backfillKey("search", "20260930T093012Z", -1));
  assert.throws(() => backfillKey("search", "bad", 0));
});

test("the stop key and malformed keys are not pages", () => {
  const stop = backfillStopKey("search", "20260930T093012Z");
  assert.equal(stop, "search:20260930T093012Z:stop");
  assert.ok(parseBrainQueueMessage({ fundId: FUND, loop: "BACKFILL", key: stop }));
  assert.equal(parseBackfillKey(stop), null);
  assert.equal(parseBackfillKey("other:20260930T093012Z:0"), null);
  assert.equal(parseBackfillKey("search:20260930T093012Z:01"), null);
  assert.equal(parseBackfillKey("search:20260930T093012Z:0:x"), null);
});

test("the estimate is shown per level and never 0 kr. for a fund with cases", () => {
  const empty = estimateBackfill(0);
  assert.deepEqual(empty, { cases: 0, search: { usd: 0, dkk: 0 }, full: { usd: 0, dkk: 0 } });
  const demo = estimateBackfill(60);
  assert.equal(demo.cases, 60);
  assert.equal(demo.search.usd, 0.03);
  assert.ok(demo.search.dkk > 0 && demo.search.dkk < 1);
  assert.equal(demo.full.usd, 6.03);
  assert.ok(demo.full.dkk > 38 && demo.full.dkk < 40);
  assert.ok(estimateBackfill(1).search.dkk >= 0.01);
  assert.equal(estimateBackfill(Number.NaN).cases, 0);
});
