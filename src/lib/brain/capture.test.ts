import assert from "node:assert/strict";
import { test } from "node:test";
import {
  captureExtracts,
  captureKey,
  embeddingCostUsd,
  estimateEmbeddingUsd,
  parseCaptureKey,
  profileNeedsUpdate,
  sha256Hex,
} from "./capture.ts";
import { parseBrainQueueMessage } from "./jobs.ts";

const CASE = "a1000000-0000-4000-8000-0000000000d2";
const FUND = "b1000000-0000-4000-8000-00000000000b";

test("captureKey round-trips and is a valid queue key", () => {
  const at = new Date("2026-09-30T08:12:33.123Z");
  const key = captureKey(CASE, at);
  assert.equal(key, `${CASE}:2026-09-30T08:12:33.123Z`);
  assert.deepEqual(parseCaptureKey(key), { caseId: CASE, changedAt: at, origin: "change" });
  assert.ok(parseBrainQueueMessage({ fundId: FUND, loop: "L0_capture", key }));
});

test("backfill keys keep their origin; only Søgbar skips L1", () => {
  const at = new Date("2026-09-30T09:30:00.000Z");
  const search = captureKey(CASE, at, "search");
  const full = captureKey(CASE, at, "full");
  assert.equal(search, `search:${CASE}:2026-09-30T09:30:00.000Z`);
  assert.equal(full, `full:${CASE}:2026-09-30T09:30:00.000Z`);
  assert.deepEqual(parseCaptureKey(search), { caseId: CASE, changedAt: at, origin: "search" });
  assert.deepEqual(parseCaptureKey(full), { caseId: CASE, changedAt: at, origin: "full" });
  for (const key of [search, full]) {
    assert.ok(parseBrainQueueMessage({ fundId: FUND, loop: "L0_capture", key }));
  }
  assert.equal(captureExtracts("search"), false);
  assert.equal(captureExtracts("full"), true);
  assert.equal(captureExtracts("change"), true);
  assert.equal(parseCaptureKey(`search:full:${CASE}:2026-09-30T09:30:00.000Z`), null);
});

test("parseCaptureKey refuses other keys", () => {
  assert.equal(parseCaptureKey("2026-09-30"), null);
  assert.equal(parseCaptureKey(`${CASE}:not-a-date`), null);
  assert.equal(parseCaptureKey(`not-a-uuid-not-a-uuid-not-a-uuid-123:2026-09-30T08:00:00Z`), null);
  assert.equal(parseCaptureKey(`upload:${CASE}`), null);
  assert.throws(() => captureKey("case-1", new Date()));
});

test("the reservation covers the actual price", () => {
  const texts = ["Stærkt team i et voksende marked.", "x".repeat(4000)];
  const reserved = estimateEmbeddingUsd(texts);
  // Worst case one token per 3 characters; the real rate is about 1 per 4.
  const worst = embeddingCostUsd(Math.ceil(texts.join("").length / 3));
  assert.ok(reserved >= worst, `${reserved} < ${worst}`);
  assert.ok(reserved > 0);
  assert.equal(estimateEmbeddingUsd([]), 0.0001);
  assert.equal(embeddingCostUsd(1_000_000), 0.02);
  assert.equal(embeddingCostUsd(0), 0);
  assert.equal(embeddingCostUsd(Number.NaN), 0);
});

test("the profile vector is recomputed only when the text changed", () => {
  const text = "Case: Lærke Robotics ApS · Sektor: Deeptech";
  assert.equal(profileNeedsUpdate(text, null), true);
  assert.equal(profileNeedsUpdate(text, sha256Hex(text)), false);
  assert.equal(profileNeedsUpdate(`${text} ·`, sha256Hex(text)), true);
  assert.equal(profileNeedsUpdate(null, null), false);
  assert.equal(profileNeedsUpdate("   ", null), false);
});
