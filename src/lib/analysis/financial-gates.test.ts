/** Test af finans-gates i kode. Kør: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeFinancialMetrics, type MetricsStatementInput } from "./financial-metrics.ts";
import { applyFinanceGates, evaluateFinanceGate } from "./financial-gates.ts";

function statement(periodEnd: string, items: Record<string, number>): MetricsStatementInput {
  return {
    periodStart: `${periodEnd.slice(0, 4)}-01-01`,
    periodEnd,
    sourceDocumentUrl: "https://regnskaber.virk.dk/test",
    reportingClassText: "Reporting class B",
    lineItems: Object.entries(items).map(([metric, value]) => ({ metric, value })),
  };
}

const negativeEquity = computeFinancialMetrics(
  [
    statement("2023-12-31", { equity: 100_000, net_result: -50_000 }),
    statement("2024-12-31", { equity: -200_000, net_result: -300_000, cash: 50_000 }),
  ],
  "2025-06-30",
);

test("negativ egenkapital er et brud, når CVR-matchet er sikkert", () => {
  const result = evaluateFinanceGate("finance_positive_equity", {
    report: negativeEquity,
    identityConfirmed: true,
    stage: "seed",
  });
  assert.equal(result.passed, false);
  assert.match(result.rationale, /−200\.000 kr\./);
});

test("usikkert CVR-match gør et bindende finanskrav ukendt, ikke brudt", () => {
  const result = evaluateFinanceGate("finance_positive_equity", {
    report: negativeEquity,
    identityConfirmed: false,
    stage: "seed",
  });
  assert.equal(result.passed, null);
});

test("en teknisk læsefejl er ærligt ukendt, ikke 'ingen regnskaber'", () => {
  const result = evaluateFinanceGate("finance_min_filings", {
    report: null,
    loadError: true,
    identityConfirmed: true,
    stage: null,
  });
  assert.equal(result.passed, null);
  assert.match(result.rationale, /teknisk fejl/);
});

test("usikkert CVR-match gør alle finans-gates ukendte", () => {
  const result = evaluateFinanceGate("finance_min_filings", {
    report: negativeEquity,
    identityConfirmed: false,
    stage: null,
  });
  assert.equal(result.passed, null);
});

test("ingen regnskaber er ukendt for alle finans-gates", () => {
  for (const key of [
    "finance_positive_equity",
    "finance_runway_12m",
    "finance_min_filings",
  ] as const) {
    const result = evaluateFinanceGate(key, { report: null, identityConfirmed: true, stage: null });
    assert.equal(result.passed, null, key);
  }
});

test("antal regnskabsår: 2 kræves normalt, 3 for senere stadier", () => {
  const context = { report: negativeEquity, identityConfirmed: true };
  assert.equal(
    evaluateFinanceGate("finance_min_filings", { ...context, stage: "seed" }).passed,
    true,
  );
  assert.equal(
    evaluateFinanceGate("finance_min_filings", { ...context, stage: "later" }).passed,
    false,
  );
});

test("runway under 12 måneder fejler; selvfinansierende består", () => {
  const short = evaluateFinanceGate("finance_runway_12m", {
    report: negativeEquity,
    identityConfirmed: true,
    stage: "seed",
  });
  assert.equal(short.passed, false);
  const profitable = computeFinancialMetrics(
    [statement("2024-12-31", { net_result: 400_000, depreciation: 10_000, cash: 10_000 })],
    "2025-06-30",
  );
  const selfFunded = evaluateFinanceGate("finance_runway_12m", {
    report: profitable,
    identityConfirmed: true,
    stage: "later",
  });
  assert.equal(selfFunded.passed, true);
});

test("gammelt regnskab fejler aldersgrænsen", () => {
  const result = evaluateFinanceGate("finance_filing_age_18m", {
    report: negativeEquity,
    identityConfirmed: true,
    stage: null,
  });
  assert.equal(result.passed, true);
  const old = evaluateFinanceGate("finance_filing_age_18m", {
    report: computeFinancialMetrics([statement("2022-12-31", { equity: 1 })], "2025-06-30"),
    identityConfirmed: true,
    stage: null,
  });
  assert.equal(old.passed, false);
});

test("nettogæld/EBITDA er altid ukendt uden opdelt gæld", () => {
  const result = evaluateFinanceGate("finance_nibd_ebitda_3x", {
    report: negativeEquity,
    identityConfirmed: true,
    stage: null,
  });
  assert.equal(result.passed, null);
});

test("applyFinanceGates overskriver kun finans-gates", () => {
  const gates = applyFinanceGates(
    [
      { gateKey: "stage_fit", passed: true, confidence: 0.9, rationale: "AI", evidenceIds: ["a"] },
      {
        gateKey: "finance_positive_equity",
        passed: true,
        confidence: 0.9,
        rationale: "AI",
        evidenceIds: [],
      },
    ],
    { report: negativeEquity, identityConfirmed: true, stage: "seed" },
  );
  assert.equal(gates[0]!.rationale, "AI");
  assert.equal(gates[1]!.passed, false);
  assert.notEqual(gates[1]!.rationale, "AI");
  assert.deepEqual(gates[1]!.evidenceIds, []);
  assert.deepEqual(gates[0]!.evidenceIds, ["a"]);
});

test("going concern-note er et brud til review; uden oplysning er den ukendt", () => {
  const base = { report: negativeEquity, identityConfirmed: true, stage: "seed" };
  assert.equal(
    evaluateFinanceGate("finance_no_going_concern", { ...base, latestGoingConcernNote: true })
      .passed,
    false,
  );
  assert.equal(
    evaluateFinanceGate("finance_no_going_concern", { ...base, latestGoingConcernNote: false })
      .passed,
    true,
  );
  const unknownNote = evaluateFinanceGate("finance_no_going_concern", base);
  assert.equal(unknownNote.passed, null);
  assert.match(unknownNote.rationale, /Ukendt, ikke et brud/);
  // Et usikkert CVR-match gør også noten ukendt.
  assert.equal(
    evaluateFinanceGate("finance_no_going_concern", {
      ...base,
      identityConfirmed: false,
      latestGoingConcernNote: true,
    }).passed,
    null,
  );
});

test("norske tal (T-851): beløb i NOK, registrets regnskab, going concern er ukendt", () => {
  const report = computeFinancialMetrics(
    [statement("2025-12-31", { equity: 37_301_607, net_result: -30_000_000 })],
    "2026-10-07",
    { currency: "NOK", registryCountry: "NO" },
  );
  const equity = evaluateFinanceGate("finance_positive_equity", {
    report,
    identityConfirmed: true,
    stage: "seed",
  });
  assert.equal(equity.passed, true);
  assert.match(equity.rationale, /37\.301\.607 NOK pr\. .* \(registrets regnskab\)\./);
  const goingConcern = evaluateFinanceGate("finance_no_going_concern", {
    report,
    identityConfirmed: true,
    stage: "seed",
    latestGoingConcernNote: null,
  });
  assert.equal(goingConcern.passed, null);
  assert.match(goingConcern.rationale, /^Registret oplyser ikke/);
  const unsure = evaluateFinanceGate("finance_positive_equity", {
    report,
    identityConfirmed: false,
    stage: "seed",
  });
  assert.match(unsure.rationale, /^Matchet i registret er ikke sikkert nok/);
});
