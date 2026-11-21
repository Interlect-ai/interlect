import assert from "node:assert/strict";
import { test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { RUN_STALL_MS, STALE_DEEP_MS, STALE_SCREENING_MS } from "../cases/run-stall.ts";
import { releaseStalledFundRuns, stalledRuns, type OpenRunRow } from "./run-release.server.ts";

const NOW = Date.parse("2026-11-08T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MINUTE = 60 * 1000;

function run(id: string, kind: string, createdMsAgo: number, startedMsAgo?: number): OpenRunRow {
  return {
    id,
    kind,
    case_id: `case-${id}`,
    created_at: ago(createdMsAgo),
    started_at: startedMsAgo === undefined ? null : ago(startedMsAgo),
  };
}

test("an old screening stands still only when nothing has moved for RUN_STALL_MS (T-1072, C4-8)", () => {
  const runs = [
    run("old", "screening", STALE_SCREENING_MS + MINUTE),
    run("young", "screening", STALE_SCREENING_MS - MINUTE),
    // Started later than created: the start counts, as in screening.functions.ts.
    run("late-start", "screening", STALE_SCREENING_MS + 10 * MINUTE, STALE_SCREENING_MS - MINUTE),
    { ...run("unreadable", "screening", 0), created_at: "not a date" },
    // Old, but its analysis phase started a few minutes ago: late, not dead.
    run("late-but-alive", "screening", STALE_SCREENING_MS + 10 * MINUTE),
  ];
  const steps = [
    { run_id: "late-but-alive", started_at: ago(RUN_STALL_MS - 5 * MINUTE), completed_at: null },
  ];
  assert.deepEqual(
    stalledRuns(runs, steps, NOW).map((row) => row.id),
    ["old"],
  );
});

test("a deep analysis stands still after STALE_DEEP_MS without a new step, on any case", () => {
  const runs = [
    run("dead", "deep", 2 * 60 * MINUTE),
    run("alive", "deep", 2 * 60 * MINUTE),
    run("no-steps", "deep", STALE_DEEP_MS + MINUTE),
  ];
  const steps = [
    { run_id: "dead", started_at: ago(STALE_DEEP_MS + 5 * MINUTE), completed_at: null },
    { run_id: "alive", started_at: ago(90 * MINUTE), completed_at: ago(90 * MINUTE) },
    { run_id: "alive", started_at: ago(2 * MINUTE), completed_at: null },
  ];
  assert.deepEqual(
    stalledRuns(runs, steps, NOW).map((row) => row.id),
    ["dead", "no-steps"],
  );
  // Steps that could not be read: no run is judged, a screening neither.
  const mixed = [...runs, run("old-screening", "screening", STALE_SCREENING_MS + MINUTE)];
  assert.deepEqual(stalledRuns(mixed, null, NOW), []);
});

test("closing stalled runs never throws: a failed read leaves the month as it is", async () => {
  const errors: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => void errors.push(args);
  try {
    const failing = {
      from: () => {
        throw new Error("network down");
      },
    } as unknown as SupabaseClient;
    assert.equal(await releaseStalledFundRuns(failing, "f", NOW), 0);
    const refusing = {
      from: () => {
        const self = {
          select: () => self,
          eq: () => self,
          in: () => self,
          lt: async () => ({ data: null, error: { message: "permission denied" } }),
        };
        return self;
      },
    } as unknown as SupabaseClient;
    assert.equal(await releaseStalledFundRuns(refusing, "f", NOW), 0);
  } finally {
    console.error = original;
  }
  assert.equal(errors.length, 2);
  assert.match(String(errors[1]?.[1]), /permission denied/);
});

test("only the team's own open runs that are old enough are read", async () => {
  const calls: Array<[string, ...unknown[]]> = [];
  const client = {
    from: (table: string) => {
      calls.push(["from", table]);
      const self = {
        select: (columns: string) => (calls.push(["select", columns]), self),
        eq: (column: string, value: unknown) => (calls.push(["eq", column, value]), self),
        in: (column: string, values: unknown) => (calls.push(["in", column, values]), self),
        lt: async (column: string, value: unknown) => {
          calls.push(["lt", column, value]);
          return { data: [], error: null };
        },
      };
      return self;
    },
  } as unknown as SupabaseClient;
  assert.equal(await releaseStalledFundRuns(client, "fund-1", NOW), 0);
  assert.deepEqual(calls, [
    ["from", "analysis_runs"],
    ["select", "id, kind, case_id, created_at, started_at"],
    ["eq", "fund_id", "fund-1"],
    ["in", "kind", ["screening", "deep"]],
    ["in", "status", ["queued", "running"]],
    ["lt", "created_at", ago(Math.min(STALE_SCREENING_MS, STALE_DEEP_MS))],
  ]);
});
