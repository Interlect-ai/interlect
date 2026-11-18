/** Brain budget maths (migration 0040). Kør: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  budgetLevel,
  budgetMonthKey,
  canReserve,
  monthSpendUsd,
  settleUsage,
  simulateSerialReservations,
} from "./budget.ts";

const now = new Date("2026-09-30T12:00:00Z");

test("reservations that race never exceed the limit together", () => {
  const { granted, spentUsd } = simulateSerialReservations(1, 0.7, [0.2, 0.2, 0.1, 0.05]);
  assert.deepEqual(granted, [true, false, true, false]);
  assert.equal(spentUsd, 1);
});

test("exactly the limit is allowed; invalid amounts never are", () => {
  assert.equal(canReserve({ limitUsd: 30, spentUsd: 29.9, requestUsd: 0.1 }), true);
  assert.equal(canReserve({ limitUsd: 30, spentUsd: 29.9, requestUsd: 0.11 }), false);
  assert.equal(canReserve({ limitUsd: 30, spentUsd: 0, requestUsd: 0 }), false);
  assert.equal(canReserve({ limitUsd: 30, spentUsd: 0, requestUsd: 26 }), false);
  assert.equal(canReserve({ limitUsd: 30, spentUsd: 0, requestUsd: Number.NaN }), false);
});

test("month spend counts open reservations and final costs from this month only", () => {
  const spent = monthSpendUsd(
    [
      { costUsd: 1.5, status: "final", createdAt: new Date("2026-09-02T00:00:00Z") },
      { costUsd: 0.5, status: "reserved", createdAt: new Date("2026-09-29T00:00:00Z") },
      { costUsd: 9, status: "released", createdAt: new Date("2026-09-29T00:00:00Z") },
      { costUsd: 7, status: "final", createdAt: new Date("2026-08-31T23:59:59Z") },
    ],
    now,
  );
  assert.equal(spent, 2);
});

test("settling records the real price and any overrun", () => {
  assert.deepEqual(settleUsage({ reservedUsd: 0.1, actualUsd: 0.13 }), {
    costUsd: 0.13,
    overrunUsd: 0.03,
  });
  assert.deepEqual(settleUsage({ reservedUsd: 0.1, actualUsd: -1 }), { costUsd: 0, overrunUsd: 0 });
});

test("budget level warns at 80 % and stops at the limit; the month key is UTC", () => {
  assert.equal(budgetLevel(10, 72), "ok");
  assert.equal(budgetLevel(57.6, 72), "warning");
  assert.equal(budgetLevel(72, 72), "reached");
  assert.equal(budgetLevel(0, 0), "reached");
  assert.equal(budgetMonthKey(new Date("2026-09-30T23:30:00-02:00")), "2026-10");
});
