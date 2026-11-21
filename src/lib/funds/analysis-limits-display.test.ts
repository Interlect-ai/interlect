/**
 * (spec B6): the states of the section Analysegrænser.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatDkk,
  formatDkkRange,
  limitIsTight,
  monthState,
  nextMonthStart,
  parseCapInput,
} from "./analysis-limits-display.ts";

const KIND = {
  tier: "medium",
  ownCapDkk: null,
  standardCapDkk: 10,
  capDkk: 10,
  minDkk: 2,
  maxDkk: 100,
} as const;

test("kroner in both languages, whole for limits and with øre for averages", () => {
  assert.equal(formatDkk(10, "da").replace(/\u00a0/g, " "), "10 kr.");
  assert.equal(formatDkk(10, "en").replace(/\u00a0/g, " "), "DKK 10");
  assert.equal(formatDkk(3.4, "da", true).replace(/\u00a0/g, " "), "3,40 kr.");
  assert.equal(formatDkk(3.4, "en", true).replace(/\u00a0/g, " "), "DKK 3.40");
  assert.equal(formatDkk(1250, "da").replace(/\u00a0/g, " "), "1.250 kr.");
  assert.equal(formatDkk(35, "da", true).replace(/\u00a0/g, " "), "35 kr.");
});

test("a limit is only tight on real runs whose average is above it", () => {
  assert.equal(limitIsTight({ ...KIND, costs: null }), false);
  const costs = { runs: 4, averageDkk: 6, lowestDkk: 3, highestDkk: 9 };
  assert.equal(limitIsTight({ ...KIND, costs }), false);
  assert.equal(limitIsTight({ ...KIND, capDkk: 5, costs }), true);
});

test("the month: no limit, room left, and reached", () => {
  assert.deepEqual(monthState({ monthlyCapDkk: null, monthUsedDkk: 40 }), {
    capDkk: null,
    usedDkk: 40,
    pct: null,
    reached: false,
  });
  const room = monthState({ monthlyCapDkk: 200, monthUsedDkk: 50 });
  assert.equal(room.pct, 25);
  assert.equal(room.reached, false);
  // Less than the smallest run left: the server starts nothing (run-plan.server.ts).
  assert.equal(monthState({ monthlyCapDkk: 200, monthUsedDkk: 199.5 }).reached, true);
  assert.equal(monthState({ monthlyCapDkk: 200, monthUsedDkk: 230 }).pct, 100);
  assert.deepEqual(monthState({ monthlyCapDkk: 0, monthUsedDkk: 0 }).reached, true);
});

test("the month starts over on the first of next month, also in December", () => {
  assert.equal(
    nextMonthStart(new Date(Date.UTC(2026, 10, 3, 12))).toISOString(),
    "2026-12-01T00:00:00.000Z",
  );
  assert.equal(
    nextMonthStart(new Date(Date.UTC(2026, 11, 31, 12))).toISOString(),
    "2027-01-01T00:00:00.000Z",
  );
});

test("the page's month is the database's: UTC, also just after midnight on the first (C4-6)", () => {
  // 30 UTC is 1 Dec 00:30 in Copenhagen. The database (0125, 0131) still counts November,
  // so the limit starts over at 1 Dec 00:00 UTC, not a month later.
  assert.equal(
    nextMonthStart(new Date("2026-11-30T23:30:00Z")).toISOString(),
    "2026-12-01T00:00:00.000Z",
  );
  assert.equal(
    nextMonthStart(new Date("2026-12-01T00:00:00Z")).toISOString(),
    "2027-01-01T00:00:00.000Z",
  );
});

test("a typed limit: empty is the standard, comma or point, inside the range", () => {
  assert.deepEqual(parseCapInput("", 2, 100), { ok: true, value: null });
  assert.deepEqual(parseCapInput(" 12 ", 2, 100), { ok: true, value: 12 });
  assert.deepEqual(parseCapInput("12,5", 2, 100), { ok: true, value: 12.5 });
  assert.deepEqual(parseCapInput("1", 2, 100), { ok: false, reason: "range" });
  assert.deepEqual(parseCapInput("101", 2, 100), { ok: false, reason: "range" });
  assert.deepEqual(parseCapInput("ti", 2, 100), { ok: false, reason: "number" });
  assert.deepEqual(parseCapInput("-3", 2, 100), { ok: false, reason: "number" });
  assert.deepEqual(parseCapInput("1.000", 0, 10_000), { ok: false, reason: "number" });
});

test("the range carries one currency mark and never breaks before it", () => {
  assert.equal(formatDkkRange(1.64, 2.11, "da"), "1,64–2,11\u00a0kr.");
  assert.equal(formatDkkRange(1.64, 2.11, "en"), "DKK\u00a01.64–2.11");
});
