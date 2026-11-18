/** Fondens egen screening (instruktion og ekstra kort). Kør: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readScreeningCards,
  readScreeningInstruction,
  screeningSetupSchema,
} from "./screening-setup.ts";
import { diffFundConfigs, type DiffableConfig } from "./config-diff.ts";

test("kortene læses i fast rækkefølge uden ukendte og gentagne", () => {
  assert.deepEqual(readScreeningCards(["market", "esg", "team", "market"]), ["team", "market"]);
  assert.deepEqual(readScreeningCards([]), []);
  // En række læst uden kolonnen (før 0078) viser Finanser som i dag.
  assert.deepEqual(readScreeningCards(undefined), ["finance"]);
  assert.deepEqual(readScreeningCards(null), ["finance"]);
});

test("instruktionen læses trimmet, og alt andet end tekst er ingen", () => {
  assert.equal(readScreeningInstruction("  Founders først.  "), "Founders først.");
  assert.equal(readScreeningInstruction(null), "");
  assert.equal(readScreeningInstruction(42), "");
});

test("gemning afviser for lang tekst, ukendte og gentagne kort", () => {
  assert.equal(screeningSetupSchema.safeParse({ instruction: "x", cards: ["team"] }).success, true);
  assert.equal(
    screeningSetupSchema.safeParse({ instruction: "x".repeat(3001), cards: [] }).success,
    false,
  );
  assert.equal(screeningSetupSchema.safeParse({ instruction: "", cards: ["esg"] }).success, false);
  assert.equal(
    screeningSetupSchema.safeParse({ instruction: "", cards: ["team", "team"] }).success,
    false,
  );
  // Mellemrum rundt om teksten tæller ikke med i grænsen.
  const padded = screeningSetupSchema.safeParse({
    instruction: ` ${"x".repeat(3000)} `,
    cards: [],
  });
  assert.equal(padded.success, true);
});

const base: DiffableConfig = {
  thesis: "Tese",
  stages: ["seed"],
  geographies: ["DK"],
  sectors: ["software"],
  analysisThreshold: 60,
  riskPosture: "Moderat",
  ticketMinEur: null,
  ticketMaxEur: null,
  gates: [],
  criteria: [],
};

test("versionssammenligningen viser instruktionen, ikke kortene (T-914)", () => {
  const before = { ...base, screeningInstruction: "", screeningCards: ["finance" as const] };
  const after = {
    ...base,
    screeningInstruction: "Founders først.",
    screeningCards: ["finance" as const, "team" as const],
  };
  assert.deepEqual(diffFundConfigs(before, after), ["Screeningsinstruktionen er omskrevet"]);
  assert.deepEqual(diffFundConfigs(after, before), ["Screeningsinstruktionen er fjernet"]);
});

test("en side uden felterne (editorens kladde) giver ingen falsk ændring", () => {
  const active = { ...base, screeningInstruction: "Founders først.", screeningCards: [] };
  assert.deepEqual(diffFundConfigs(active, base), []);
  assert.deepEqual(diffFundConfigs(base, active), []);
});
