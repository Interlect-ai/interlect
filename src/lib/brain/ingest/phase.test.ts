import assert from "node:assert/strict";
import { test } from "node:test";
import { failedStepForStatus, PHASE_LABELS, sourcePhase, sourceProgress } from "./phase.ts";

const done = "2026-10-01T10:00:00Z";

test("the phase follows the row: upload, approval, queue, work, result", () => {
  assert.equal(
    sourcePhase({ status: "queued", uploadCompletedAt: null, approvedAt: null }),
    "uploading",
  );
  assert.equal(
    sourcePhase({ status: "queued", uploadCompletedAt: done, approvedAt: null }),
    "awaiting_approval",
  );
  assert.equal(
    sourcePhase({ status: "queued", uploadCompletedAt: done, approvedAt: done }),
    "queued",
  );
  for (const status of [
    "extracting",
    "classifying",
    "chunking",
    "embedding",
    "extracting_facts",
    "linking",
  ]) {
    assert.equal(
      sourcePhase({ status, uploadCompletedAt: done, approvedAt: done }),
      "working",
      status,
    );
  }
  assert.equal(
    sourcePhase({ status: "ready", uploadCompletedAt: done, approvedAt: done }),
    "ready",
  );
  assert.equal(
    sourcePhase({ status: "failed", uploadCompletedAt: done, approvedAt: done }),
    "failed",
  );
  assert.equal(
    sourcePhase({ status: "review", uploadCompletedAt: done, approvedAt: done }),
    "review",
  );
});

test("a failed or ready state wins over a missing approval (a refused file never gets that far)", () => {
  assert.equal(
    sourcePhase({ status: "failed", uploadCompletedAt: done, approvedAt: null }),
    "failed",
  );
});

test("progress rises through the steps and every phase has a Danish label", () => {
  const order = [
    "queued",
    "extracting",
    "classifying",
    "chunking",
    "embedding",
    "extracting_facts",
    "linking",
    "ready",
  ];
  const values = order.map(sourceProgress);
  assert.deepEqual(
    [...values].sort((a, b) => a - b),
    values,
  );
  assert.equal(sourceProgress("unknown"), 0);
  assert.ok(Object.values(PHASE_LABELS).every((label) => label.length > 0));
});

test("a source that stopped mid-run is retried from the step its status names", () => {
  assert.equal(failedStepForStatus("extracting"), "extract");
  assert.equal(failedStepForStatus("embedding"), "embed");
  assert.equal(failedStepForStatus("linking"), "link");
  for (const status of ["queued", "ready", "failed", "review", "x"]) {
    assert.equal(failedStepForStatus(status), null, status);
  }
});
