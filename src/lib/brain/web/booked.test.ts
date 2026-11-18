/** One paid call in the fund's chat budget. Kør: npm test */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { bookedCall } from "./booked.server.ts";

const FUND = "11111111-1111-4111-8111-111111111111";

function fakeService(calls: Array<{ fn: string; args: Record<string, unknown> }>) {
  return {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return { data: fn === "brain_reserve_budget" ? "usage-1" : null, error: null };
    },
  } as unknown as SupabaseClient;
}

const INPUT = { fundId: FUND, maxUsd: 0.02, model: "openai/gpt-5.4-mini", userId: "u" };

test("a call that times out after it was sent costs its maximum (T-793)", async () => {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  await assert.rejects(
    bookedCall(fakeService(calls), INPUT, async () => {
      throw new DOMException("The operation timed out.", "TimeoutError");
    }),
    { name: "TimeoutError" },
  );
  assert.deepEqual(
    calls.map((call) => call.fn),
    ["brain_reserve_budget", "brain_finalize_usage"],
  );
  assert.equal(calls[1]?.args["_cost_usd"], 0.02);
});

test("any other failure gives the reservation back", async () => {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  await assert.rejects(
    bookedCall(fakeService(calls), INPUT, async () => {
      throw new Error("masking refused");
    }),
    /masking refused/,
  );
  assert.deepEqual(
    calls.map((call) => call.fn),
    ["brain_reserve_budget", "brain_release_usage"],
  );
});

test("an answer without a price is booked at its maximum, a priced one at its price", async () => {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const service = fakeService(calls);
  await bookedCall(service, INPUT, async () => ({ value: 1, costUsd: null }));
  await bookedCall(service, INPUT, async () => ({ value: 2, costUsd: 0.004 }));
  const settled = calls.filter((call) => call.fn === "brain_finalize_usage");
  assert.deepEqual(
    settled.map((call) => call.args["_cost_usd"]),
    [0.02, 0.004],
  );
});
