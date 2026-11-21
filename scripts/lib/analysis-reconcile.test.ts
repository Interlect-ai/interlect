import assert from "node:assert/strict";
import { test } from "node:test";
import {
  chargedUsd,
  reconcile,
  reconcileReport,
  type ReconcileLedgerRow,
  type ReconcileRunRow,
} from "./analysis-reconcile.ts";
import { monthBounds } from "../analysis-reconcile.ts";

const run = (id: string, over: Partial<ReconcileRunRow> = {}): ReconcileRunRow => ({
  id,
  fund_id: "f",
  kind: "screening",
  status: "complete",
  actual_cost: null,
  usd_to_dkk: 7,
  validation_result: null,
  ...over,
});
const booked = (refId: string, dkk: number, note: string | null = null): ReconcileLedgerRow => ({
  ref_id: refId,
  kind: "usage",
  scope: "analysis",
  status: "final",
  loop: null,
  amount_dkk: dkk,
  note,
});

test("steps, run and ledger agree within a few øre at the run's own rate (T-1074, B.4 test 7)", () => {
  const result = reconcile({
    runs: [run("a", { actual_cost: 0.3 }), run("b", { actual_cost: "1", usd_to_dkk: null })],
    steps: [
      { run_id: "a", actual_cost: 0.1, charged_cost: null },
      { run_id: "a", actual_cost: "0.2", charged_cost: null },
      { run_id: "b", actual_cost: 1, charged_cost: null },
    ],
    // 0.3 USD × 7 = 2.10 kr.; b has no stored rate: the installation's 6.9.
    ledger: [booked("a", 2.1), booked("b", 6.88)],
    defaultRate: 6.9,
  });
  assert.deepEqual(
    result.runs.map((row) => row.verdict),
    ["ok", "ok"],
  );
  assert.equal(result.problems.length, 0);
  assert.ok(Math.abs(result.totals.bookedDkk - 8.98) < 1e-9);
});

test("every way it can disagree is named; capped, pending and unknown prices are not errors", () => {
  const result = reconcile({
    runs: [
      run("capped", { actual_cost: 3 }),
      run("unsettled", { actual_cost: 1 }),
      run("steps", { actual_cost: 1 }),
      run("booking", { actual_cost: 1 }),
      // Unknown price: the charged bound is the run's price (0114).
      run("bound", { validation_result: { budget: { chargedUsd: 0.5 } } }),
      // Finished after the last settlement: its row is still reserved.
      run("pending", { actual_cost: 1 }),
      // No price and no bound: booked at its reservation on purpose (0114).
      run("noPrice"),
    ],
    steps: [
      { run_id: "capped", actual_cost: 3, charged_cost: null },
      { run_id: "unsettled", actual_cost: 1, charged_cost: null },
      { run_id: "steps", actual_cost: 0.5, charged_cost: null },
      { run_id: "booking", actual_cost: 1, charged_cost: null },
      { run_id: "bound", actual_cost: null, charged_cost: 0.5 },
      { run_id: "pending", actual_cost: 1, charged_cost: null },
      { run_id: "noPrice", actual_cost: 0.2, charged_cost: null },
    ],
    ledger: [
      booked("capped", 14, "afregnet til loftet"),
      booked("steps", 7),
      booked("booking", 9),
      booked("bound", 3.5),
      { ...booked("pending", 13.8), status: "reserved" },
      booked("noPrice", 13.8),
      // A helper's row never counts as a run's booking.
      { ...booked("unsettled", 7), loop: "fund_setup:criterion" },
    ],
    defaultRate: 6.9,
  });
  assert.deepEqual(Object.fromEntries(result.runs.map((row) => [row.runId, row.verdict])), {
    capped: "capped",
    unsettled: "unsettled",
    steps: "steps_differ",
    booking: "booking_differs",
    bound: "ok",
    pending: "pending",
    noPrice: "unknown_price",
  });
  assert.deepEqual(
    result.problems.map((row) => row.runId),
    ["unsettled", "steps", "booking"],
  );
});

test("the charged bound is read like the database reads it", () => {
  assert.equal(chargedUsd({ budget: { chargedUsd: 0.25 } }), 0.25);
  assert.equal(chargedUsd({ budget: { chargedUsd: "0.25" } }), null);
  assert.equal(chargedUsd({ budget: { chargedUsd: -1 } }), null);
  assert.equal(chargedUsd(null), null);
  assert.equal(chargedUsd([]), null);
});

test("the report puts Vercel's bill beside the whole ledger and lists every run that differs", () => {
  const result = reconcile({
    runs: [run("a", { actual_cost: 1 }), run("b", { actual_cost: 1 })],
    steps: [
      { run_id: "a", actual_cost: 1, charged_cost: null },
      { run_id: "b", actual_cost: 1, charged_cost: null },
    ],
    ledger: [booked("a", 7)],
    defaultRate: 7,
  });
  const lines = reconcileReport({
    title: "Test",
    result,
    otherBookedDkk: 3,
    vercelUsd: 2,
    rate: 7,
  }).join("\n");
  assert.match(
    lines,
    /Kørsler: 2 · passer 1 · afregnet til grænsen 0 · venter på afregning 0 · ukendt pris 0 · afvigelser 1/,
  );
  assert.match(
    lines,
    /Kreditbogen i alt: 10\.00 kr\. · Vercels regning: 2\.00 USD ≈ 14\.00 kr\. · forskel 4\.00 kr\./,
  );
  assert.match(
    lines,
    /\| b \| screening \| complete \| 7\.00 kr\. \| 7\.00 kr\. \| – \| ikke i kreditbogen \|/,
  );
  const without = reconcileReport({
    title: "T",
    result,
    otherBookedDkk: 0,
    vercelUsd: null,
    rate: 7,
  });
  assert.match(without.join("\n"), /Vercels regning: ikke angivet/);
});

test("the month is UTC like the ledger, and a wrong month is refused", () => {
  const [start, end] = monthBounds("2026-12");
  assert.equal(start.toISOString(), "2026-12-01T00:00:00.000Z");
  assert.equal(end.toISOString(), "2027-01-01T00:00:00.000Z");
  const [now] = monthBounds(undefined, new Date("2026-11-30T23:30:00Z"));
  assert.equal(now.toISOString(), "2026-11-01T00:00:00.000Z");
  assert.throws(() => monthBounds("2026-13"), /YYYY-MM/);
  assert.throws(() => monthBounds("nov"), /YYYY-MM/);
});
