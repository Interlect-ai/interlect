/** Test af kontrollen af finansspecialistens tal. Kør: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkFinancialInputs,
  financialInputCheckWarnings,
  textStatesAmount,
  unitCurrency,
  unitScale,
  type CheckedFinancialInput,
  type RegistryAnchor,
} from "./financial-input-check.ts";

function input(overrides: Partial<CheckedFinancialInput>): CheckedFinancialInput {
  return {
    metric: "annual_revenue",
    value: 12_300_000,
    unit: "DKK",
    periodStart: "2024-01-01",
    periodEnd: "2024-12-31",
    evidenceId: "e1",
    ...overrides,
  };
}

const anchor: RegistryAnchor = {
  periodStart: "2024-01-01",
  periodEnd: "2024-12-31",
  currency: "DKK",
  revenue: 12_300_000,
  cash: 2_000_000,
};

function evidence(text: string) {
  return new Map([["e1", { claim: text, excerpt: null }]]);
}

test("enhedens skala læses, og en ukendt skala er aldrig 'ingen skala'", () => {
  assert.equal(unitScale("DKK"), 1);
  assert.equal(unitScale("mio. EUR"), 1e6);
  assert.equal(unitScale("t.kr."), 1e3);
  assert.equal(unitScale("mia. DKK"), 1e9);
  assert.equal(unitScale("100 DKK"), null);
  assert.equal(unitScale("mio. t. DKK"), null);
  assert.equal(unitCurrency("kr."), "DKK");
  assert.equal(unitCurrency("mio. EUR"), "EUR");
  assert.equal(unitCurrency("amount"), null);
});

test("tal findes uanset dansk eller engelsk skrivemåde", () => {
  for (const text of [
    "Omsætningen var 12.300.000 kr. i 2024",
    "Revenue was DKK 12,300,000",
    "Omsætning 12 300 000 DKK",
    "omsætning på 12,3 mio. kr.",
    "revenue of 12.3 million",
    "revenue of 12.3M",
  ]) {
    assert.equal(textStatesAmount(text, [12_300_000]), true, text);
  }
});

test("afrundede tal i teksten accepteres inden for deres egen afrunding, men ikke langt fra", () => {
  assert.equal(textStatesAmount("omsætning på 12,3 mio. kr.", [12_340_000]), true);
  assert.equal(textStatesAmount("omsætning på 12,3 mio. kr.", [12_500_000]), false);
  assert.equal(textStatesAmount("omsætning på 12,3 mio. kr.", [1_230_000]), false);
});

test("et tal, der ikke står i teksten, findes ikke (heller ikke som et andet årstal eller en anden skala)", () => {
  assert.equal(textStatesAmount("Vi har 45 ansatte og blev stiftet i 2019", [12_300_000]), false);
  assert.equal(textStatesAmount("omsætning 1,2 mio. kr.", [12_000_000]), false);
});

test("beløb i regnskabets t.kr.-tabel kan læses som hele kroner", () => {
  assert.equal(textStatesAmount("Beløb i t.kr.\nNettoomsætning 12.300", [12_300_000]), true);
  assert.equal(textStatesAmount("Nettoomsætning 12.300", [12_300_000]), false);
});

test("et input beholdes, når tallet står i evidensen", () => {
  const result = checkFinancialInputs([input({})], evidence("Omsætning 2024: 12.300.000 kr."), []);
  assert.equal(result.kept.length, 1);
  assert.equal(result.dropped.length, 0);
});

test("et input droppes, når tallet ikke står i den citerede evidens", () => {
  const result = checkFinancialInputs(
    [input({ value: 99_000_000 })],
    evidence("Omsætning 2024: 12.300.000 kr."),
    [],
  );
  assert.equal(result.kept.length, 0);
  assert.equal(result.dropped[0]?.reason, "not_in_evidence");
});

test("et input uden læsbar evidens droppes, aldrig tavst beholdes", () => {
  const result = checkFinancialInputs(
    [input({ evidenceId: "ukendt" })],
    evidence("12.300.000"),
    [],
  );
  assert.equal(result.dropped[0]?.reason, "evidence_missing");
});

test("enhed med skala: 12,3 mio. EUR passer til '12,3 million'", () => {
  const result = checkFinancialInputs(
    [input({ value: 12.3, unit: "mio. EUR" })],
    evidence("Revenue 2024: 12.3 million euro"),
    [],
  );
  assert.equal(result.kept.length, 1);
});

test("en rate kan stå som procent i teksten", () => {
  const result = checkFinancialInputs(
    [input({ metric: "monthly_churn_rate", value: 0.05, unit: "ratio", periodStart: null })],
    evidence("Monthly churn is 5 % across all plans"),
    [],
  );
  assert.equal(result.kept.length, 1);
});

test("et input, der afviger fra registrets årsregnskab, droppes", () => {
  const result = checkFinancialInputs(
    [input({ value: 20_000_000 })],
    evidence("Omsætning 2024: 20.000.000 kr."),
    [anchor],
  );
  assert.equal(result.dropped[0]?.reason, "registry_mismatch");
  assert.equal(result.dropped[0]?.registryValue, 12_300_000);
});

test("et input, der stemmer med registret inden for 5 %, beholdes", () => {
  const result = checkFinancialInputs(
    [input({ value: 12_000_000 })],
    evidence("Omsætning 2024: 12.000.000 kr."),
    [anchor],
  );
  assert.equal(result.kept.length, 1);
});

test("registret sammenlignes kun for samme valuta og samme periode", () => {
  const eur = checkFinancialInputs(
    [input({ value: 20_000_000, unit: "EUR" })],
    evidence("Revenue 20.000.000"),
    [anchor],
  );
  assert.equal(eur.kept.length, 1);
  const otherYear = checkFinancialInputs(
    [input({ value: 20_000_000, periodStart: "2023-01-01", periodEnd: "2023-12-31" })],
    evidence("Omsætning 20.000.000"),
    [anchor],
  );
  assert.equal(otherYear.kept.length, 1);
  const partYear = checkFinancialInputs(
    [input({ value: 3_000_000, periodStart: "2024-01-01", periodEnd: "2024-03-31" })],
    evidence("Omsætning 3.000.000"),
    [anchor],
  );
  assert.equal(partYear.kept.length, 1);
});

test("likvider sammenlignes med registrets likvider ved årets udgang", () => {
  const result = checkFinancialInputs(
    [input({ metric: "cash", value: 9_000_000, periodStart: null })],
    evidence("Kassebeholdning 9.000.000 kr."),
    [anchor],
  );
  assert.equal(result.dropped[0]?.reason, "registry_mismatch");
});

test("uden ankre (selskabet ikke bekræftet) kontrolleres kun mod evidensen", () => {
  const result = checkFinancialInputs(
    [input({ value: 20_000_000 })],
    evidence("Omsætning 2024: 20.000.000 kr."),
    [],
  );
  assert.equal(result.kept.length, 1);
});

test("advarslerne nævner tal, periode og registertal i fondens sprog", () => {
  const dropped = checkFinancialInputs(
    [input({ value: 20_000_000 })],
    evidence("Omsætning 2024: 20.000.000 kr."),
    [anchor],
  ).dropped;
  const [da] = financialInputCheckWarnings(dropped, "da");
  const [en] = financialInputCheckWarnings(dropped, "en");
  assert.match(da!, /annual_revenue/);
  assert.match(da!, /12300000 DKK/);
  assert.match(en!, /differs by more than 5%/);
});

test("et ensomt '000' eller 'mio' i en anden tal må ikke ændre skalaen på bare tal", () => {
  const a = [input({ value: 45, unit: "mio. DKK", metric: "cash", periodStart: null })];
  assert.equal(
    checkFinancialInputs(a, evidence("Omsætning på 45.000 kr. i 2023"), []).kept.length,
    0,
  );
  assert.equal(
    checkFinancialInputs(a, evidence("har 45 ansatte og omsætning 12 mio."), []).kept.length,
    0,
  );
  const b = [input({ value: 1_500_000, metric: "cash", periodStart: null })];
  assert.equal(
    checkFinancialInputs(b, evidence("Omsætning 1.500 kr; rejst 2 mio. kr."), []).kept.length,
    0,
  );
});

test("kompakte skalaer og sammenskrevne enheder læses ens", () => {
  assert.equal(unitScale("mio.kr."), 1e6);
  assert.equal(unitScale("TDKK"), 1e3);
  assert.equal(unitScale("MDKK"), 1e6);
  assert.equal(unitCurrency("MDKK"), "DKK");
  assert.equal(unitCurrency("mEUR"), "EUR");
  assert.equal(textStatesAmount("omsætning 45 MDKK", [45e6]), true);
  assert.equal(textStatesAmount("Nettoomsætning 4.500 TDKK", [4_500_000]), true);
  assert.equal(textStatesAmount("revenue 45 mln EUR", [45e6]), true);
});

test("beløb i regnskabets overskrift gælder stadig bare tal", () => {
  assert.equal(textStatesAmount("(000 DKK)\nOmsætning 12.300", [12_300_000]), true);
  assert.equal(textStatesAmount("Amounts in millions\nRevenue 12", [12_000_000]), true);
});

test("omsætning og likvider med uklar enhed i en periode registret dækker droppes", () => {
  const result = checkFinancialInputs(
    [input({ value: 4.5, unit: "amount" })],
    evidence("Omsætning 4,5"),
    [anchor],
  );
  assert.equal(result.dropped[0]?.reason, "registry_unit");
  const noAnchors = checkFinancialInputs(
    [input({ value: 4.5, unit: "amount" })],
    evidence("Omsætning 4,5"),
    [],
  );
  assert.equal(noAnchors.kept.length, 1);
});
