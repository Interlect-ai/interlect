import { test } from "node:test";
import assert from "node:assert/strict";
import { filingCurrency, parseXbrlFiling } from "./financial-statements.ts";

/** A minimal Danish XBRL filing with its amounts in `currency` and employees as `pure`. */
function filing(currency: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<xbrli:xbrl xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:fsa="http://xbrl.dcca.dk/fsa">
  <xbrli:context id="d"><xbrli:entity><xbrli:identifier scheme="cvr">12345678</xbrli:identifier></xbrli:entity>
    <xbrli:period><xbrli:startDate>2024-01-01</xbrli:startDate><xbrli:endDate>2024-12-31</xbrli:endDate></xbrli:period></xbrli:context>
  <xbrli:context id="i"><xbrli:entity><xbrli:identifier scheme="cvr">12345678</xbrli:identifier></xbrli:entity>
    <xbrli:period><xbrli:instant>2024-12-31</xbrli:instant></xbrli:period></xbrli:context>
  <xbrli:unit id="money"><xbrli:measure>iso4217:${currency}</xbrli:measure></xbrli:unit>
  <xbrli:unit id="pure"><xbrli:measure>xbrli:pure</xbrli:measure></xbrli:unit>
  <fsa:Revenue contextRef="d" unitRef="money" decimals="0">1000000</fsa:Revenue>
  <fsa:ProfitLoss contextRef="d" unitRef="money" decimals="0">50000</fsa:ProfitLoss>
  <fsa:Assets contextRef="i" unitRef="money" decimals="0">700000</fsa:Assets>
  <fsa:Equity contextRef="i" unitRef="money" decimals="0">300000</fsa:Equity>
  <fsa:AverageNumberOfEmployees contextRef="d" unitRef="pure" decimals="0">12</fsa:AverageNumberOfEmployees>
</xbrli:xbrl>`;
}

test("T-819: a Danish filing in EUR is stored as EUR, not DKK", () => {
  const parsed = parseXbrlFiling(filing("EUR"));
  assert.ok(parsed.periods.length > 0);
  assert.equal(filingCurrency(parsed), "EUR");
  assert.equal(filingCurrency(parseXbrlFiling(filing("DKK"))), "DKK");
});

test("T-819: a filing without currency units falls back to DKK", () => {
  assert.equal(
    filingCurrency({ reportingClassText: null, goingConcernNote: false, periods: [] }),
    "DKK",
  );
});
