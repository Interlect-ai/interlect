/** Test af versionssammenligningen for fondsopsætningen (E6). Kør: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { diffFundConfigs, type DiffableConfig } from "./config-diff.ts";

const base: DiffableConfig = {
  thesis: "Vi investerer i nordisk B2B-software.",
  stages: ["Seed"],
  geographies: ["Danmark"],
  sectors: ["Software"],
  analysisThreshold: 70,
  riskPosture: "Moderat",
  ticketMinEur: 500_000,
  ticketMaxEur: 2_000_000,
  gates: [{ key: "stage_fit", label: "Stadie passer", treatment: "review" }],
  criteria: [
    { key: "team", label: "Team", weight: 60 },
    { key: "market", label: "Marked", weight: 40 },
  ],
};

test("ingen ændringer giver en tom liste", () => {
  assert.deepEqual(diffFundConfigs(base, structuredClone(base)), []);
});

test("vægte, tærskel, lister og regler beskrives kort", () => {
  const after: DiffableConfig = {
    ...structuredClone(base),
    stages: ["Seed", "Series A"],
    analysisThreshold: 68,
    gates: [{ key: "stage_fit", label: "Stadie passer", treatment: "hard" }],
    criteria: [
      { key: "team", label: "Team", weight: 50 },
      { key: "market", label: "Marked", weight: 40 },
      { key: "timing", label: "Timing", weight: 10 },
    ],
  };
  assert.deepEqual(diffFundConfigs(base, after), [
    "Stadier: + Series A",
    "Tærskel: 70 → 68",
    "Stadie passer: nu bindende",
    "Team: 60 % → 50 %",
    "Nyt kriterium: Timing (10 %)",
  ]);
});

test("tekst, der når prompterne, tælles også som ændring", () => {
  const after: DiffableConfig = {
    ...structuredClone(base),
    dealbreakers: ["Våben"],
    stageExpectations: { Seed: "Forvent betalende kunder" },
    gates: [
      {
        key: "stage_fit",
        label: "Stadie passer",
        treatment: "review",
        description: "Nyt spørgsmål",
      },
    ],
  };
  assert.deepEqual(diffFundConfigs(base, after), [
    "Forventningerne pr. stadie er ændret",
    "Dealbreakers: + Våben",
    "Stadie passer: spørgsmålet er omskrevet",
  ]);
});

test("fondsstørrelse tæller som en ændring, også når den fjernes", () => {
  assert.deepEqual(diffFundConfigs(base, { ...base, fundSizeEur: 60_000_000 }), [
    "Investeringskapitalen er ændret",
  ]);
  assert.deepEqual(
    diffFundConfigs({ ...base, fundSizeEur: 60_000_000 }, { ...base, fundSizeEur: null }),
    ["Investeringskapitalen er ændret"],
  );
  // En ældre version uden feltet er det samme som "ikke angivet".
  assert.deepEqual(diffFundConfigs(base, { ...base, fundSizeEur: null }), []);
});

test("et økonomi-kriterium, der ikke længere scores fra regnskaberne, tæller som en ændring", () => {
  const financeBase: DiffableConfig = {
    ...base,
    criteria: [
      { key: "team", label: "Team", weight: 60 },
      { key: "money", label: "Monetisering", weight: 40, category: "financial_strength" },
    ],
  };
  const optedOut = structuredClone(financeBase);
  optedOut.criteria[1]!.codeAnchor = false;
  assert.deepEqual(diffFundConfigs(financeBase, optedOut), [
    "Monetisering: scores nu af AI'en fra evidens",
  ]);
  // Ældre version uden valget er det samme som forankret.
  const explicit = structuredClone(financeBase);
  explicit.criteria[1]!.codeAnchor = true;
  assert.deepEqual(diffFundConfigs(financeBase, explicit), []);
});

test("en ren omdøbning af et kriterium er synlig i diffen", () => {
  const after = structuredClone(base);
  after.criteria[0]!.label = "Founder-team";
  assert.deepEqual(diffFundConfigs(base, after), ["Kriterium omdøbt: Team → Founder-team"]);
});

test("gamle navne og deres nøgler er ikke en ændring, og nye vises på teamets sprog (T-964)", () => {
  const before: DiffableConfig = {
    ...structuredClone(base),
    stages: ["Seed", "Serie A"],
    geographies: ["Danmark", "Norden"],
    stageExpectations: { "Serie A": "PMF" },
  };
  const keyed: DiffableConfig = {
    ...structuredClone(base),
    stages: ["seed", "series_a"],
    geographies: ["DK", "nordics"],
    stageExpectations: { series_a: "PMF" },
  };
  assert.deepEqual(diffFundConfigs(before, keyed), []);
  assert.deepEqual(
    diffFundConfigs(before, { ...keyed, geographies: ["DK", "nordics", "europe"] }, "en"),
    ["Countries: + Europe"],
  );
});
