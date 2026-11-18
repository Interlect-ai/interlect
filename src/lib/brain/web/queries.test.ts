/** Web queries in the chat. Kør: npm test */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  queryWriterInput,
  sanitizeWebQueries,
  webQueryProblem,
  WEB_QUERY_MAX_CHARS,
} from "./queries.ts";

test("plain queries pass", () => {
  for (const query of [
    "Acme ApS funding 2025",
    "Nordlys Analytics konkurrenter",
    "carbon capture startups Denmark",
    "Pleo Series C 2023",
  ]) {
    assert.equal(webQueryProblem(query), null, query);
  }
});

test("long text, quotes, e-mails, links and long numbers are refused", () => {
  assert.equal(webQueryProblem("  "), "empty");
  assert.equal(webQueryProblem("a".repeat(WEB_QUERY_MAX_CHARS + 1)), "too_long");
  assert.equal(webQueryProblem('"Acme" revenue'), "quote");
  assert.equal(webQueryProblem("Acme “revenue”"), "quote");
  assert.equal(webQueryProblem("kontakt anna@acme.dk"), "email");
  assert.equal(webQueryProblem("se https://acme.dk/deck"), "url");
  assert.equal(webQueryProblem("www.acme.dk omsætning"), "url");
  assert.equal(webQueryProblem("CVR 12345678"), "long_number");
  assert.equal(webQueryProblem("telefon 12 34 56 78"), "long_number");
  assert.equal(webQueryProblem("beløb 1.234.567 kr"), "long_number");
  assert.equal(webQueryProblem("omsætning 2025 og 2026"), null);
  assert.equal(webQueryProblem("Acme ApS funding 2024-2025"), null);
  assert.equal(webQueryProblem("Acme revenue 2024 2025"), null);
  assert.equal(webQueryProblem("Acme Q1 2025"), null);
});

test("at most three distinct queries are kept, the refused ones are listed", () => {
  const { queries, rejected } = sanitizeWebQueries([
    "Acme funding",
    "acme  funding",
    "Acme team",
    'Acme "secret"',
    "Acme market",
    "Acme news",
    7,
  ]);
  assert.deepEqual(queries, ["Acme funding", "Acme team", "Acme market"]);
  assert.deepEqual(
    rejected.map((r) => r.why),
    ["quote"],
  );
});

test("the query writer reads the question and the company identities, nothing else", () => {
  const input = queryWriterInput("  Hvad ved vi om Acme?  ", [
    { name: "Acme ApS", domain: "acme.dk", cvr: "12345678" },
    { name: "Bad", domain: null, cvr: "not-a-number" },
  ]);
  assert.deepEqual(Object.keys(input).sort(), ["companies", "question"]);
  assert.equal(input.question, "Hvad ved vi om Acme?");
  assert.deepEqual(input.companies[1], { name: "Bad", domain: null, cvr: null });
  for (const company of input.companies) {
    assert.deepEqual(Object.keys(company).sort(), ["cvr", "domain", "name"]);
  }
});
