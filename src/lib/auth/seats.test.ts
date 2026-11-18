import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSeatLimit, seatLimitMessage, usesSeat } from "./seats.ts";

const none = { seat: false, reader: false };

test("parseSeatLimit: only positive whole numbers, otherwise no limit", () => {
  assert.equal(parseSeatLimit(undefined), null);
  assert.equal(parseSeatLimit(""), null);
  assert.equal(parseSeatLimit(" 5 "), 5);
  assert.equal(parseSeatLimit("0"), null);
  assert.equal(parseSeatLimit("-2"), null);
  assert.equal(parseSeatLimit("2.5"), null);
  assert.equal(parseSeatLimit("fem"), null);
});

test("usesSeat: Admin, Lead and Medlem use a seat; only-Læser does not", () => {
  assert.equal(usesSeat(["reader"]), false);
  assert.equal(usesSeat(["member"]), true);
  assert.equal(usesSeat(["reader", "lead"]), true);
});

test("no limit (pilot): never refuses", () => {
  const usage = { seatsUsed: 99, seatLimit: null, readersUsed: 99, readerLimit: null };
  assert.equal(seatLimitMessage(usage, ["member"], none), null);
  assert.equal(seatLimitMessage(usage, ["reader"], none), null);
});

test("refuses a new seat only when the limit is reached", () => {
  const usage = { seatsUsed: 3, seatLimit: 3, readersUsed: 0, readerLimit: null };
  assert.match(seatLimitMessage(usage, ["member"], none) ?? "", /Alle 3 pladser er brugt/);
  assert.equal(seatLimitMessage({ ...usage, seatsUsed: 2 }, ["member"], none), null);
  // A reader invitation does not need a seat.
  assert.equal(seatLimitMessage(usage, ["reader"], none), null);
});

test("a person who already holds a seat is not counted twice", () => {
  const usage = { seatsUsed: 3, seatLimit: 3, readersUsed: 2, readerLimit: 2 };
  assert.equal(seatLimitMessage(usage, ["lead"], { seat: true, reader: false }), null);
  assert.equal(seatLimitMessage(usage, ["reader"], { seat: true, reader: false }), null);
  assert.equal(seatLimitMessage(usage, ["reader"], { seat: false, reader: true }), null);
});

test("reader quota is separate", () => {
  const usage = { seatsUsed: 0, seatLimit: 3, readersUsed: 2, readerLimit: 2 };
  assert.match(seatLimitMessage(usage, ["reader"], none) ?? "", /læserpladser/);
});
