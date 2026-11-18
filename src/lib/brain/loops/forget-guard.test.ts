import assert from "node:assert/strict";
import { test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readForgetGeneration, storeVectorsChecked, type VectorRow } from "./forget-guard.ts";

function fake(replies: Array<{ data: unknown; error?: { message: string } | null }>) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const service = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      const reply = replies.shift() ?? { data: { stored: 0 } };
      return { data: reply.data, error: reply.error ?? null };
    },
  } as unknown as SupabaseClient;
  return { service, calls };
}

const rows = (count: number): VectorRow[] =>
  Array.from({ length: count }, (_, index) => ({
    table: "chunk",
    id: `c${index}`,
    embedding: [0.1, 0.2],
  }));

test("the counter must be a whole number", async () => {
  assert.equal(await readForgetGeneration(fake([{ data: 3 }]).service, "f"), 3);
  await assert.rejects(readForgetGeneration(fake([{ data: "3" }]).service, "f"), /unexpected/);
  await assert.rejects(
    readForgetGeneration(fake([{ data: null, error: { message: "down" } }]).service, "f"),
    /down/,
  );
});

test("vectors go in calls of 25 with the counter and as text", async () => {
  const { service, calls } = fake([{ data: { stored: 25 } }, { data: { stored: 5 } }]);
  const result = await storeVectorsChecked(service, "f", 7, rows(30));
  assert.deepEqual(result, { stored: 30, forgotten: false });
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.args["_forget_generation"], 7);
  const first = (calls[0]?.args["_rows"] as Array<Record<string, unknown>>)[0];
  assert.equal(first?.["embedding"], "[0.1,0.2]");
});

test("a forgetting since the read stops the rest", async () => {
  const { service, calls } = fake([{ data: { stored: 25 } }, { data: { skipped: "forgotten" } }]);
  const result = await storeVectorsChecked(service, "f", 7, rows(60));
  assert.deepEqual(result, { stored: 25, forgotten: true });
  assert.equal(calls.length, 2);
});

test("a failed call is an error, never a silent gap", async () => {
  const { service } = fake([{ data: null, error: { message: "boom" } }]);
  await assert.rejects(storeVectorsChecked(service, "f", 7, rows(1)), /boom/);
});
