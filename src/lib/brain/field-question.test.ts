import { test } from "node:test";
import assert from "node:assert/strict";
import { fieldsAskedFor } from "./field-question.ts";

test("a question about a figure on the case names the figure and the year", () => {
  assert.deepEqual(fieldsAskedFor("Hvad var omsætningen i 2023?"), {
    metrics: ["revenue"],
    fiscalYear: 2023,
  });
  assert.deepEqual(fieldsAskedFor("What was the revenue last year?"), {
    metrics: ["revenue"],
    fiscalYear: null,
  });
  assert.deepEqual(fieldsAskedFor("Hvad er bruttofortjenesten og omsætningen for 2024?"), {
    metrics: ["gross_profit", "revenue"],
    fiscalYear: 2024,
  });
  assert.deepEqual(fieldsAskedFor("How much cash did they have at the end of 2022?"), {
    metrics: ["cash"],
    fiscalYear: 2022,
  });
  assert.deepEqual(fieldsAskedFor("Hvor store er de likvide beholdninger?"), {
    metrics: ["cash"],
    fiscalYear: null,
  });
});

test("cash flow from operations is never read as cash", () => {
  assert.deepEqual(fieldsAskedFor("What was the operating cash flow in 2023?")?.metrics, [
    "cash_flow_operating",
  ]);
  assert.deepEqual(fieldsAskedFor("Cash flow from operations 2021")?.metrics, [
    "cash_flow_operating",
  ]);
  assert.deepEqual(fieldsAskedFor("Hvad var pengestrømmen fra driften i 2023?")?.metrics, [
    "cash_flow_operating",
  ]);
  assert.equal(fieldsAskedFor("How fast is the cash burn?"), null);
});

test("a question about anything else gets no button", () => {
  assert.equal(fieldsAskedFor("Hvem er grundlæggerne?"), null);
  assert.equal(fieldsAskedFor("What is the market size in 2030?"), null);
  assert.equal(fieldsAskedFor(""), null);
});
