/**
 * (spec B.1 punkt 3): "Spørg mig først" asks only when the server says the full run does
 * not fit, starts again with the choice, starts nothing when cancelled, and asks once per batch.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { answer, currentLimitChoice, startWithLimitChoice } from "./limit-choice.ts";
import type { LimitChoice } from "./model-tiers.ts";

const FUND = "00000000-0000-4000-8000-000000000001";

function server(fits: boolean) {
  const calls: Array<LimitChoice | undefined> = [];
  const start = async (atLimit?: LimitChoice) => {
    calls.push(atLimit);
    return fits || atLimit
      ? { status: "started", runId: "run" }
      : { status: "limit_choice_needed" };
  };
  return { calls, start };
}

test("a run that fits starts at once, without a question", async () => {
  const { calls, start } = server(true);
  const result = await startWithLimitChoice(FUND, "screening", start);
  assert.equal(result?.status, "started");
  assert.deepEqual(calls, [undefined]);
  assert.equal(currentLimitChoice(), null);
});

test("the choice is asked, then sent with the second start", async () => {
  const { calls, start } = server(false);
  const running = startWithLimitChoice(FUND, "deep", start);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(currentLimitChoice()?.kind, "deep");
  answer("raise_once");
  const result = await running;
  assert.equal(result?.status, "started");
  assert.deepEqual(calls, [undefined, "raise_once"]);
  assert.equal(currentLimitChoice(), null);
});

test("cancel starts nothing and returns null", async () => {
  const { calls, start } = server(false);
  const running = startWithLimitChoice(FUND, "screening", start);
  await new Promise((resolve) => setImmediate(resolve));
  answer(null);
  assert.equal(await running, null);
  assert.deepEqual(calls, [undefined]);
});

test("a batch asks once and uses the answer for the rest", async () => {
  const remembered: { choice?: LimitChoice | null } = {};
  const first = server(false);
  const running = startWithLimitChoice(FUND, "screening", first.start, remembered);
  await new Promise((resolve) => setImmediate(resolve));
  answer("reduce");
  await running;
  const second = server(false);
  const result = await startWithLimitChoice(FUND, "screening", second.start, remembered);
  assert.equal(currentLimitChoice(), null, "no second question");
  assert.equal(result?.status, "started");
  assert.deepEqual(second.calls, [undefined, "reduce"]);
});

test("raise once is never reused for the next case in a batch", async () => {
  const remembered: { choice?: LimitChoice | null } = {};
  const first = server(false);
  const running = startWithLimitChoice(FUND, "screening", first.start, remembered);
  await new Promise((resolve) => setImmediate(resolve));
  answer("raise_once");
  await running;
  const second = server(false);
  const next = startWithLimitChoice(FUND, "screening", second.start, remembered);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(currentLimitChoice()?.kind, "screening", "asked again");
  answer(null);
  assert.equal(await next, null);
});

test("two questions at once wait in line instead of cancelling each other", async () => {
  const a = server(false);
  const b = server(false);
  const first = startWithLimitChoice(FUND, "screening", a.start);
  const second = startWithLimitChoice(FUND, "deep", b.start);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(currentLimitChoice()?.kind, "screening");
  answer("reduce");
  assert.equal((await first)?.status, "started");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(currentLimitChoice()?.kind, "deep");
  answer("reduce");
  assert.equal((await second)?.status, "started");
  assert.deepEqual(b.calls, [undefined, "reduce"]);
});
