import assert from "node:assert/strict";
import { test } from "node:test";
import { createLeakFilter } from "./leak-filter.ts";

/** Feeds the text in pieces of the given size, as the model's deltas would arrive. */
function feed(text: string, size: number): { out: string; leaks: number } {
  const filter = createLeakFilter();
  let out = "";
  for (let i = 0; i < text.length; i += size) out += filter.push(text.slice(i, i + size));
  out += filter.flush();
  return { out, leaks: filter.leaks };
}

// Shortened from the live test of 4 Oct 2026 (gpt-5.4, deep mode).
const LEAKED =
  ' to=functions.search_brain  天天中彩票提现json മറുപടിക്കില്ല? Let\'s format.to=functions.search_brain  天天中彩票官方 code  彩神争霸快 strict  tamakkerjson\n{"query":"\\"Bølge Labs (demo 21)\\" sektor {stadie} beslutning"}Jeg kan ikke se en beregnet rangliste [1].\n\n- Nordlys Analytics og Nordlys Labs er begge b2b_saas [2].';

test("et lækket værktøjskald i starten fjernes, svaret efter det bevares", () => {
  for (const size of [1, 3, 7, 40, 10_000]) {
    const { out, leaks } = feed(LEAKED, size);
    assert.equal(
      out,
      "Jeg kan ikke se en beregnet rangliste [1].\n\n- Nordlys Analytics og Nordlys Labs er begge b2b_saas [2].",
      `size ${size}`,
    );
    assert.equal(leaks, 1);
  }
});

test("et læk midt i svaret fjernes, teksten før og efter bevares", () => {
  const text =
    'Først en sætning [1]. to=functions.get_case 彩神争霸 {"caseId":"c1"} Og så resten [2].';
  for (const size of [1, 5, 1000]) {
    assert.equal(feed(text, size).out, "Først en sætning [1]. Og så resten [2].", `size ${size}`);
  }
});

test("almindelig tekst går uændret igennem, også med klammer og ord som 'functions'", () => {
  const text =
    'Brain udleder: {"a": 1} er et eksempel, og "functions" er et ord. Ingen læk her [3].';
  for (const size of [1, 4, 64]) {
    const { out, leaks } = feed(text, size);
    assert.equal(out, text);
    assert.equal(leaks, 0);
  }
});

test("et læk uden JSON bagefter dropper resten af blokken, ikke de næste trin", () => {
  const filter = createLeakFilter();
  let out = filter.push("Svar [1]. to=functions.search_brain 天天中彩票");
  out += filter.flush();
  assert.equal(out, "Svar [1].");
  // The next step starts clean.
  assert.equal(
    filter.push("Næste trin har tekst, der er lang nok.") + filter.flush(),
    "Næste trin har tekst, der er lang nok.",
  );
});

test("en kort tekst holdes kun tilbage, til trinnet slutter", () => {
  const filter = createLeakFilter();
  assert.equal(filter.push("Kort."), "");
  assert.equal(filter.flush(), "Kort.");
});

test("et svar, der åbner med rå værktøjsargumenter og et rodord, renses", () => {
  const text =
    '{"caseId":"4fa31dde-baac-5ae7-9991-5a8e3b643f9a"} RTLU {"query":"meget svagt dokumenteret","limit":10} Det ved Brain ikke sikkert endnu [1].';
  for (const size of [1, 6, 33, 1000]) {
    const { out, leaks } = feed(text, size);
    assert.equal(out, "Det ved Brain ikke sikkert endnu [1].", `size ${size}`);
    assert.equal(leaks, 1);
  }
});

test("et svar, der starter med et ord og senere har klammer, røres ikke", () => {
  const text = 'Nej {ikke JSON} og "citat" [2] er bare tekst i et langt nok svar.';
  assert.equal(feed(text, 3).out, text);
});
