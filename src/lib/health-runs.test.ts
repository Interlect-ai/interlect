import assert from "node:assert/strict";
import { test } from "node:test";
import { stalledRunIds } from "./health-runs.ts";

const start = Date.parse("2026-10-21T10:00:00Z");
const at = (minutes: number) => new Date(start + minutes * 60_000).toISOString();

test("a run with no step for 20 minutes is stalled; one with a recent step is not (T-941)", () => {
  const runs = [
    { id: "quiet", created_at: at(0) },
    { id: "alive", created_at: at(0) },
    { id: "fresh", created_at: at(25) },
  ];
  const steps = [
    { run_id: "quiet", started_at: at(1), completed_at: at(3) },
    { run_id: "alive", started_at: at(1), completed_at: at(3) },
    { run_id: "alive", started_at: at(20), completed_at: null },
  ];
  assert.deepEqual(stalledRunIds(runs, steps, start + 30 * 60_000), ["quiet"]);
  assert.deepEqual(stalledRunIds(runs, steps, start + 22 * 60_000), []);
});

test("no open runs means nothing is stalled", () => {
  assert.deepEqual(stalledRunIds([], [], start), []);
});
