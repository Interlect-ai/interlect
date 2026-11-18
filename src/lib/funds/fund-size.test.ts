import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fundSizePromptLine,
  ticketExceedsFund,
  ticketShareOfFund,
  ticketShareText,
} from "./fund-size.ts";

test("ticket share of the fund is computed in code", () => {
  const share = ticketShareOfFund(60_000_000, 500_000, 4_000_000);
  assert.ok(share);
  assert.equal(Math.round(share.minPct! * 100) / 100, 0.83);
  assert.equal(Math.round(share.maxPct! * 100) / 100, 6.67);
  assert.equal(ticketShareText(share), "0,83 %–6,67 % af kapitalen");
});

test("no fund size or no ticket gives no share", () => {
  assert.equal(ticketShareOfFund(null, 500_000, 4_000_000), null);
  assert.equal(ticketShareOfFund(60_000_000, null, null), null);
  assert.equal(ticketShareOfFund(0, 500_000, null), null);
  assert.equal(
    ticketShareText(ticketShareOfFund(10_000_000, null, 1_000_000)),
    "højst 10 % af kapitalen",
  );
});

test("a ticket larger than the fund is caught like the database does", () => {
  assert.equal(ticketExceedsFund(20_000_000, 1_000_000, 24_000_000), true);
  assert.equal(ticketExceedsFund(20_000_000, 25_000_000, null), true);
  assert.equal(ticketExceedsFund(20_000_000, 1_000_000, 20_000_000), false);
  assert.equal(ticketExceedsFund(null, 1_000_000, 24_000_000), false);
});

test("the prompt line is empty without a fund size", () => {
  assert.equal(fundSizePromptLine(null, 500_000, 4_000_000), "");
  assert.equal(
    fundSizePromptLine(50_000_000, 1_000_000, 2_500_000),
    "Investeringskapital: 50000000 EUR; en ticket er 2 %–5 % af investeringskapitalen (regnet i kode).",
  );
  assert.equal(fundSizePromptLine(50_000_000, null, null), "Investeringskapital: 50000000 EUR.");
});
