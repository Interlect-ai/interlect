import assert from "node:assert/strict";
import { test } from "node:test";
import { cachedFor, withTimeout } from "./health-cache.ts";

test("withTimeout: a call that hangs is cut off, a quick one passes", async () => {
  await assert.rejects(() => withTimeout(new Promise(() => {}), 20, "slow"), /slow/);
  assert.equal(await withTimeout(Promise.resolve(7), 1000, "slow"), 7);
});

test("cachedFor: one load per window, shared while loading, retried after a failure", async () => {
  let clock = 0;
  let loads = 0;
  const get = cachedFor(
    async () => {
      loads += 1;
      return loads;
    },
    30_000,
    () => clock,
  );
  const [a, b] = await Promise.all([get(), get()]);
  assert.deepEqual([a, b, loads], [1, 1, 1]);
  clock = 29_999;
  assert.equal(await get(), 1);
  clock = 30_000;
  assert.equal(await get(), 2);

  let fail = true;
  const flaky = cachedFor(
    async () => {
      if (fail) throw new Error("down");
      return "up";
    },
    30_000,
    () => clock,
  );
  await assert.rejects(flaky, /down/);
  fail = false;
  assert.equal(await flaky(), "up");
});
