import assert from "node:assert/strict";
import { test } from "node:test";
import {
  deepRunReleasable,
  lastRunActivity,
  runStalled,
  screeningRetryable,
  STALE_DEEP_MS,
} from "./run-stall.ts";
import { STEP_STALE_AFTER_MS, FUNCTION_MAX_DURATION_SECONDS } from "../analysis/deep-text-rules.ts";

const start = Date.parse("2026-10-15T10:00:00Z");
const at = (minutes: number) => new Date(start + minutes * 60_000).toISOString();

test("a run is stalled after 15 min without a new step (T-652 f)", () => {
  const run = {
    startedAt: at(0),
    steps: [
      { startedAt: at(1), completedAt: at(4) },
      { startedAt: at(4), completedAt: null },
      { startedAt: null, completedAt: null },
    ],
  };
  assert.equal(lastRunActivity(run), start + 4 * 60_000);
  assert.equal(runStalled(run, start + 18 * 60_000), false);
  assert.equal(runStalled(run, start + 20 * 60_000), true);
});

test("a run without steps counts from its start; a broken date never stalls", () => {
  assert.equal(runStalled({ startedAt: at(0), steps: [] }, start + 16 * 60_000), true);
  assert.equal(runStalled({ startedAt: "", steps: [] }, start + 60 * 60_000), false);
});

test("a screening is offered again only when the server would release it", () => {
  const run = { startedAt: at(0), steps: [{ startedAt: at(1), completedAt: null }] };
  assert.equal(screeningRetryable(run, start + 17 * 60_000), false);
  assert.equal(screeningRetryable(run, start + 18.5 * 60_000), false);
  assert.equal(screeningRetryable(run, start + 20 * 60_000), true);
});

test("a deep analysis is released after 20 quiet minutes, counted from its last step (T-741 b)", () => {
  const run = {
    startedAt: at(0),
    steps: [
      { startedAt: at(1), completedAt: at(5) },
      { startedAt: at(5), completedAt: null },
    ],
  };
  assert.equal(deepRunReleasable(run, start + 24 * 60_000), false);
  assert.equal(deepRunReleasable(run, start + 26 * 60_000), true);
  assert.equal(deepRunReleasable({ startedAt: "", steps: [] }, start + 999 * 60_000), false);
  // Longer than a phase plus the take-over of a dead step, so a live run is never released.
  assert.ok(STALE_DEEP_MS > FUNCTION_MAX_DURATION_SECONDS * 1000 + STEP_STALE_AFTER_MS);
});
