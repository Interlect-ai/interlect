import { test } from "node:test";
import assert from "node:assert/strict";
import {
  nearestThumb,
  parseTicketAmount,
  parseWholeAmount,
  snapTicket,
  ticketAtPosition,
  ticketPosition,
  withTicketMax,
  withTicketMin,
} from "./ticket-range.ts";

test("the bar is logarithmic from 10,000 to 100,000,000", () => {
  assert.equal(ticketAtPosition(0), 10_000);
  assert.equal(ticketAtPosition(250), 100_000);
  assert.equal(ticketAtPosition(500), 1_000_000);
  assert.equal(ticketAtPosition(1000), 100_000_000);
  assert.equal(ticketPosition(1_000_000), 500);
  assert.equal(ticketPosition(5_000), 0);
  assert.equal(ticketPosition(1e12), 1000);
});

test("a dragged amount snaps to a round amount", () => {
  assert.equal(snapTicket(123_456), 120_000);
  assert.equal(snapTicket(2_345_678), 2_300_000);
  assert.equal(snapTicket(23_456_789), 23_000_000);
  assert.equal(snapTicket(1_000), 10_000);
});

test("typed amounts are read as the prototype reads them", () => {
  assert.equal(parseTicketAmount("250.000"), 250_000);
  assert.equal(parseTicketAmount("250"), 250_000);
  assert.equal(parseTicketAmount("2,5 mio"), 2_500_000);
  assert.equal(parseTicketAmount("500k"), 500_000);
  assert.equal(parseTicketAmount("5m €"), 5_000_000);
  assert.equal(parseTicketAmount("1 mia"), 1_000_000_000);
  assert.equal(parseTicketAmount("1.200.000 EUR"), 1_200_000);
  assert.equal(parseTicketAmount("abc"), null);
  assert.equal(parseTicketAmount(""), null);
});

test("T-1032: a typed ticket is read in both formats in either language", () => {
  assert.equal(parseTicketAmount("1,500,000"), 1_500_000);
  assert.equal(parseTicketAmount("1.500.000"), 1_500_000);
  assert.equal(parseTicketAmount("1,250,000 €"), 1_250_000);
  assert.equal(parseTicketAmount("500,000"), 500_000);
  assert.equal(parseTicketAmount("500.000"), 500_000);
  assert.equal(parseTicketAmount("2.5m"), 2_500_000);
  assert.equal(parseTicketAmount("1.5 mio"), 1_500_000);
  assert.equal(parseTicketAmount("2,500,000.50"), 2_500_001);
  assert.equal(parseTicketAmount("1 500 000"), 1_500_000);
});

test("T-1032: the fund size is a whole amount without the ticket's shortcuts", () => {
  assert.equal(parseWholeAmount("50.000.000"), 50_000_000);
  assert.equal(parseWholeAmount("50,000,000"), 50_000_000);
  assert.equal(parseWholeAmount("2,5 mia"), 2_500_000_000);
  assert.equal(parseWholeAmount("80 mio €"), 80_000_000);
  assert.equal(parseWholeAmount("250"), 250);
  assert.equal(parseWholeAmount("0"), null);
  assert.equal(parseWholeAmount("abc"), null);
});

test("from and to never cross", () => {
  assert.deepEqual(withTicketMin({ ticketMinEur: 100_000, ticketMaxEur: 500_000 }, 900_000), {
    ticketMinEur: 900_000,
    ticketMaxEur: 900_000,
  });
  assert.deepEqual(withTicketMax({ ticketMinEur: 100_000, ticketMaxEur: 500_000 }, 50_000), {
    ticketMinEur: 50_000,
    ticketMaxEur: 50_000,
  });
  assert.deepEqual(withTicketMin({ ticketMinEur: null, ticketMaxEur: null }, 200_000), {
    ticketMinEur: 200_000,
    ticketMaxEur: null,
  });
});

test("a press on the bar moves the nearest thumb", () => {
  const range = { ticketMinEur: 100_000, ticketMaxEur: 10_000_000 };
  assert.equal(nearestThumb(200, range), 0);
  assert.equal(nearestThumb(800, range), 1);
});
