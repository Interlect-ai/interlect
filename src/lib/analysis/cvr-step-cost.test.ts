import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sumCompleteCosts } from "./gateway-response.ts";

/**
 * The free CVR step must carry a price of 0, or a finished deep analysis gets no total
 * (sumCompleteCosts) and the credits are settled at the whole reservation (0071).
 */
test("the CVR step is stored as free, so the run's total stays known", () => {
  const source = readFileSync(new URL("./public-research.ts", import.meta.url), "utf8");
  const body = source.split("export async function recordCvrLookupStep(")[1]!.split("\n}\n")[0]!;
  assert.match(body, /actual_cost: 0,/);
  assert.equal(sumCompleteCosts([0.067, 0, 0.232, 0.31]), 0.067 + 0 + 0.232 + 0.31);
  assert.equal(sumCompleteCosts([0.067, null, 0.232]), null);
});
