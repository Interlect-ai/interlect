import { test } from "node:test";
import assert from "node:assert/strict";
import { countryFill, MAP_MIN_STRENGTH } from "./map-colors.ts";

test("O02: one case is already a clear colour, the most cases full", () => {
  assert.ok(MAP_MIN_STRENGTH >= 50);
  assert.match(countryFill(1, 11), /var\(--action\) 59%/);
  assert.match(countryFill(11, 11), /var\(--action\) 100%/);
});

test("T-653 e: a country without cases is an ink wash, visible on a dark card too", () => {
  assert.match(countryFill(null, 11), /var\(--ink-1\) 9%/);
  assert.equal(countryFill(0, 11), countryFill(null, 11));
});
