import assert from "node:assert/strict";
import { test } from "node:test";
import { DOC_TYPE_LABELS, formatBytes, formatKroner, formatPeriod } from "./labels.ts";
import { DOC_TYPES } from "../contracts/classify.ts";

test("every document type the classifier can name has a Danish label", () => {
  for (const type of DOC_TYPES) assert.ok(DOC_TYPE_LABELS[type], type);
});

test("sizes and prices are shown with a decimal comma", () => {
  assert.equal(formatBytes(null), "");
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(1536), "1,5 kB");
  assert.equal(formatBytes(20 * 1024), "20 kB");
  assert.equal(formatBytes(3 * 1024 * 1024), "3,0 MB");
  assert.equal(formatKroner(0.7), "0,70 kr.");
  assert.equal(formatKroner(2.1), "2,10 kr.");
  assert.equal(formatKroner(0.01), "under 0,05 kr.");
  assert.equal(formatKroner(0), "0,00 kr.");
});

test("a period reads day.month.year", () => {
  assert.equal(formatPeriod(null, null), null);
  assert.equal(formatPeriod("2026-04-01", "2026-06-30"), "01.04.2026 – 30.06.2026");
  assert.equal(formatPeriod(null, "2026-06-30"), "30.06.2026");
});
