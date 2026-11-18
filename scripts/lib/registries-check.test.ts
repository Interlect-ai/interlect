import assert from "node:assert/strict";
import { test } from "node:test";
import { failures, judge, PROBES, renderTable, type ProbeResult } from "./registries-check.ts";

const probe = (country: string) => {
  const found = PROBES.find((p) => p.country === country);
  assert.ok(found, country);
  return found;
};

test("hvert land har præcis én prøve, og tallene forventes som i D19, D21 og D24", () => {
  const countries = PROBES.map((p) => p.country);
  assert.equal(new Set(countries).size, countries.length);
  assert.deepEqual([...countries].sort(), [
    "DE",
    "DK",
    "EE",
    "ES",
    "FI",
    "FR",
    "IT",
    "LT",
    "LV",
    "NL",
    "NO",
    "PL",
    "SE",
  ]);
  const withNumbers = PROBES.filter((p) => p.financials === "yes").map((p) => p.country);
  assert.deepEqual(withNumbers, ["DK", "NO", "SE", "FI", "LV", "LT", "FR", "NL"]);
  assert.ok(PROBES.every((p) => p.identity === "yes"));
});

test("kun et forventet felt, der ikke kom, er en fejl", () => {
  assert.equal(judge("yes", { kind: "found", detail: "x" }), "ok");
  assert.equal(judge("yes", { kind: "empty" }), "fail");
  assert.equal(judge("yes", { kind: "error", message: "500" }), "fail");
  assert.equal(judge("no", { kind: "empty" }), "not-expected");
  assert.equal(judge("no", { kind: "error", message: "500" }), "not-expected");
  assert.equal(judge("yes", { kind: "skipped", reason: "nøgle mangler" }), "skipped");
  // Et land, der kun skal give identitet, men pludselig giver tal, er ikke rødt.
  assert.equal(judge("no", { kind: "found", detail: "3 poster" }), "ok");
  // En kendt fejl med ticket er ⚠️, ikke rød; et svar slår stadig igennem som ✅.
  assert.equal(judge("yes", { kind: "error", message: "500" }, "T-885"), "known");
  assert.equal(judge("yes", { kind: "found", detail: "x" }, "T-885"), "ok");
});

test("failures nævner land, felt og registrets besked; tabellen har én række pr. land", () => {
  const results: ProbeResult[] = [
    {
      probe: probe("NO"),
      identity: { kind: "found", detail: "SPOND AS" },
      financials: { kind: "found", detail: "16 poster, NOK" },
      latestYear: 2025,
      ms: 1300,
    },
    {
      probe: probe("FI"),
      identity: { kind: "error", message: "PRH svarede med status 500." },
      financials: { kind: "empty" },
      latestYear: null,
      ms: 3500,
    },
    {
      probe: probe("SE"),
      identity: { kind: "skipped", reason: "nøgle mangler" },
      financials: { kind: "skipped", reason: "nøgle mangler" },
      latestYear: null,
      ms: 0,
    },
    {
      probe: probe("LT"),
      identity: { kind: "error", message: "data.gov.lt svarede med status 500." },
      financials: { kind: "error", message: "data.gov.lt svarede med status 500." },
      latestYear: null,
      ms: 4300,
    },
    {
      probe: probe("PL"),
      identity: { kind: "found", detail: "A | B" },
      financials: { kind: "empty" },
      latestYear: null,
      ms: 1800,
    },
  ];
  assert.deepEqual(failures(results), [
    { country: "FI", field: "identitet", message: "PRH svarede med status 500." },
    { country: "FI", field: "regnskabstal", message: "0133265-6 gav intet svar fra registret" },
  ]);
  const table = renderTable(results).split("\n");
  assert.equal(table.length, 2 + results.length);
  assert.match(table[2]!, /^\| NO \| ✅ SPOND AS \| ✅ 16 poster, NOK \| 2025 \| 1\.3 s \|/);
  assert.match(table[3]!, /^\| FI \| ❌ \| ❌ \| – \|/);
  assert.match(table[4]!, /⏭️ nøgle mangler/);
  // Den kendte fejl nævner sin ticket, og samme besked står kun én gang.
  assert.match(
    table[5]!,
    /^\| LT \| ⚠️ \| ⚠️ \| – \|.*T-885; data\.gov\.lt svarede med status 500\. \|$/,
  );
  // En lodret streg i et selskabsnavn bryder ikke tabellen.
  assert.match(table[6]!, /✅ A \\\| B/);
});
