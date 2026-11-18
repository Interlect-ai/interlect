import { test } from "node:test";
import assert from "node:assert/strict";
import { countFundSeats, limitReached, seatCounterText } from "./fund-seats.ts";

test("countFundSeats: unique people per e-mail, a seat beats a reader place", () => {
  const counts = countFundSeats(
    [
      { email: "A@fond.dk", roles: ["admin"] },
      { email: "b@fond.dk", roles: ["reader"] },
      { email: "c@fond.dk", roles: ["member"] },
    ],
    [
      { email: "a@fond.dk", roles: ["reader"] }, // already holds a seat: not counted twice
      { email: "b@fond.dk", roles: ["member"] }, // reader invited as member: one seat, no reader
      { email: "d@fond.dk", roles: ["reader"] },
    ],
  );
  assert.deepEqual(counts, { seatsUsed: 3, readersUsed: 1 });
});

test("countFundSeats: empty fund and blank e-mails", () => {
  assert.deepEqual(countFundSeats([], []), { seatsUsed: 0, readersUsed: 0 });
  assert.deepEqual(countFundSeats([{ email: " ", roles: ["admin"] }], []), {
    seatsUsed: 0,
    readersUsed: 0,
  });
});

test("limitReached: only with a limit", () => {
  assert.equal(limitReached(5, null), false);
  assert.equal(limitReached(7, 8), false);
  assert.equal(limitReached(8, 8), true);
});

test("seatCounterText: only the number without a limit (beslutning 7)", () => {
  const seats = { one: "plads", many: "pladser" };
  assert.equal(seatCounterText(3, null, seats), "pladser i brug");
  assert.equal(seatCounterText(1, null, seats), "plads i brug");
  assert.equal(seatCounterText(6, 8, seats), "af 8 pladser");
});
