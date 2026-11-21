import { test } from "node:test";
import assert from "node:assert/strict";
import { SECTOR_AGNOSTIC, sharedBasisGate, suggestBasisGates } from "./gate-suggestions.ts";

const basis = {
  stages: ["Seed", "Series A"],
  geographies: ["Danmark", "Sverige", "Norge"],
  sectors: ["Software", "Klima"],
  ticketMinEur: 500_000,
  ticketMaxEur: 2_000_000,
};

test("suggests one review rule per filled basis field, worded relative to the basis", () => {
  const suggestions = suggestBasisGates(basis, []);
  assert.deepEqual(
    suggestions.map((item) => [item.key, item.treatment]),
    [
      ["geography_fit", "review"],
      ["stage_fit", "review"],
      ["sector_fit", "review"],
      ["ticket_fit", "review"],
    ],
  );
  assert.equal(suggestions[0]!.basis, "Danmark, Sverige, Norge");
  for (const item of suggestions) {
    assert.match(item.description, /ukendt, ikke brudt/);
    // The rule must not copy today's values, so it cannot go stale when the basis changes.
    assert.doesNotMatch(item.description, /Danmark|Seed|Software|€/);
  }
});

test("skips rules that already exist and empty or sector-agnostic fields", () => {
  const suggestions = suggestBasisGates(
    {
      stages: [],
      geographies: ["Danmark"],
      sectors: [SECTOR_AGNOSTIC],
      ticketMinEur: null,
      ticketMaxEur: null,
    },
    ["geography_fit"],
  );
  assert.deepEqual(suggestions, []);
});

test("a fund built from a template is not offered its own basis rules again", () => {
  // Basis-regler i skabelonerne (config-templates.ts, som ikke kan importeres uden @-alias).
  const templateGateKeys = {
    venture: ["stage_fit", "geography_fit", "ticket_fit"],
    growth: ["ticket_fit"],
    financial: ["ticket_fit"],
    thematic: ["liquidity_ticket"],
  };
  for (const [template, keys] of Object.entries(templateGateKeys)) {
    const suggested = suggestBasisGates(basis, keys).map((item) => item.key);
    for (const key of ["geography_fit", "stage_fit", "ticket_fit"]) {
      const covered =
        keys.includes(key) || (key === "ticket_fit" && keys.includes("liquidity_ticket"));
      if (covered) assert.ok(!suggested.includes(key), `${template} got ${key} twice`);
    }
  }
});

test("a one-sided ticket reads as a minimum or a maximum", () => {
  const [ticket] = suggestBasisGates(
    { stages: [], geographies: [], sectors: [], ticketMinEur: null, ticketMaxEur: 1_000_000 },
    [],
  );
  assert.equal(ticket?.key, "ticket_fit");
  assert.match(ticket!.basis, /^højst /);
});

test("suggestions are written in the page's language (T-622)", () => {
  const [geography] = suggestBasisGates(
    { stages: [], geographies: ["DK"], sectors: [], ticketMinEur: null, ticketMaxEur: null },
    [],
    "en",
  );
  assert.equal(geography?.label, "Geography fits the mandate");
  assert.match(geography!.description, /not breached\.$/);
});

test("T-1096: a shared rule for a list is worded as its suggestion, with the chosen weight", () => {
  const suggested = suggestBasisGates(
    { stages: ["seed"], geographies: [], sectors: [], ticketMinEur: null, ticketMaxEur: null },
    [],
    "en",
  )[0]!;
  const shared = sharedBasisGate("stage_fit", "hard", "en");
  assert.deepEqual(shared, {
    key: "stage_fit",
    label: suggested.label,
    description: suggested.description,
    treatment: "hard",
  });
});
