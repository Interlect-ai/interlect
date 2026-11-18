/** Test af informationsmåleren på Opret case. Kør: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { countWords, intakeReadiness } from "./intake-readiness.ts";

const base = { query: "", deckCount: 0, website: "", notes: "" };
const words = (n: number) => Array.from({ length: n }, (_, i) => `ord${i}`).join(" ");

test("uden navn: niveau 0 og ingen hint, og Find er låst", () => {
  const r = intakeReadiness(base);
  assert.equal(r.level, 0);
  assert.equal(r.ok, false);
  assert.equal(r.hint, "");
});

test("hjemmeside uden navn giver hint om at skrive navnet (R7-6), ikke niveau", () => {
  const r = intakeReadiness({ ...base, website: "havbrugnord.dk" });
  assert.equal(r.level, 0);
  assert.equal(r.ok, false);
  assert.match(r.hint, /Skriv selskabets navn eller CVR/);
});

test("kun navnet: niveau 1 og kan finde", () => {
  const r = intakeReadiness({ ...base, query: "Pleo" });
  assert.equal(r.level, 1);
  assert.equal(r.label, "Kun navnet");
  assert.equal(r.ok, true);
});

test("navn plus én kilde: klar til screening", () => {
  assert.equal(intakeReadiness({ ...base, query: "Pleo", website: "pleo.io" }).level, 2);
  assert.equal(intakeReadiness({ ...base, query: "Pleo", deckCount: 1 }).level, 2);
  assert.equal(intakeReadiness({ ...base, query: "Pleo", notes: words(30) }).level, 2);
});

test("noter under 30 ord er ikke nok som 'hvad', men 10 ord tæller som kilde", () => {
  const short = intakeReadiness({ ...base, query: "Pleo", notes: words(12) });
  assert.equal(short.what, false);
  assert.equal(short.sources, 1);
  assert.equal(short.level, 1);
  assert.equal(
    intakeReadiness({ ...base, query: "Pleo", notes: words(12), website: "pleo.io" }).level,
    3,
  );
});

test("to eller flere kilder: stærkt grundlag", () => {
  const r = intakeReadiness({ ...base, query: "Pleo", deckCount: 2, website: "pleo.io" });
  assert.equal(r.level, 3);
  assert.equal(r.label, "Stærkt grundlag");
  assert.equal(r.sources, 2);
});

test("et gyldigt CVR tæller som hvem", () => {
  assert.equal(intakeReadiness({ ...base, query: "CVR 26 31 68 04" }).who, true);
});

test("ordtælling", () => {
  assert.equal(countWords("  to  ord "), 2);
  assert.equal(countWords(""), 0);
});
