import { test } from "node:test";
import assert from "node:assert/strict";
import { reasonLabel } from "./reason-label.ts";

test("a seeded reason with its Danish seed text is shown in the team's language", () => {
  assert.equal(reasonLabel("outside_sector", "Uden for sektor", "en"), "Outside the sector");
  assert.equal(reasonLabel("outside_sector", "Uden for sektor", "da"), "Uden for sektor");
});

test("a seeded reason the team renamed keeps the team's text", () => {
  assert.equal(reasonLabel("outside_sector", "Ikke vores sektor", "en"), "Ikke vores sektor");
});

test("a reason the team added keeps its own text", () => {
  assert.equal(reasonLabel("custom_board_fit", "Board fit", "da"), "Board fit");
  assert.equal(reasonLabel("custom_board_fit", "Bestyrelse passer", "en"), "Bestyrelse passer");
});
