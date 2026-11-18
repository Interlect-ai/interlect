import { test } from "node:test";
import assert from "node:assert/strict";
import { stageColor } from "./stage-color.ts";

test("a stage has one fixed colour, and the known stages differ", () => {
  const known = ["pre_seed", "seed", "series_a", "series_b", "later", "growth", "buyout"];
  assert.equal(new Set(known.map(stageColor)).size, known.length);
  assert.equal(stageColor("seed"), stageColor("seed"));
  assert.equal(stageColor("unknown"), "var(--hairline-strong)");
});

test("a stage the fund wrote itself keeps its colour", () => {
  assert.equal(stageColor("Pre-IPO"), stageColor("Pre-IPO"));
});
