import assert from "node:assert/strict";
import { test } from "node:test";
import { patchToColumns, updateToColumns } from "./columns.ts";

test("only the fields that are set become columns, and null is a value", () => {
  assert.deepEqual(updateToColumns({}), {});
  assert.deepEqual(
    updateToColumns({ approvedAt: null, approvedBy: null, status: "queued", errorMessage: null }),
    {
      approved_at: null,
      approved_by: null,
      status: "queued",
      error_message: null,
    },
  );
  assert.deepEqual(
    patchToColumns({ step: null, failedStep: "embed", costUsd: 0.12, chunkCount: 7 }),
    {
      step: null,
      failed_step: "embed",
      cost_usd: 0.12,
      chunk_count: 7,
    },
  );
});

test("every field of both shapes has a column (a new field cannot be dropped silently)", () => {
  const update = {
    sha256: "a",
    sizeBytes: 1,
    pageCount: 1,
    chunkCount: 1,
    estimatedCostUsd: 1,
    maxCostUsd: 1,
    pageLimit: 1,
    warnings: ["a"],
    uploadCompletedAt: "x",
    approvedBy: "u",
    approvedAt: "x",
    status: "queued" as const,
    errorMessage: "e",
  };
  assert.equal(Object.keys(updateToColumns(update)).length, Object.keys(update).length);
  const patch = {
    status: "ready" as const,
    step: "embed" as const,
    failedStep: "embed" as const,
    errorMessage: "e",
    title: "t",
    docType: "other",
    periodStart: "2026-01-01",
    periodEnd: "2026-12-31",
    language: "da",
    summaryMd: "s",
    warnings: ["a"],
    pageCount: 1,
    chunkCount: 1,
    chunkSignature: "abcdefabcdefabcdef",
    costUsd: 1,
  };
  assert.equal(Object.keys(patchToColumns(patch)).length, Object.keys(patch).length);
});
