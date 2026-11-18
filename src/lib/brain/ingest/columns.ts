/**
 * The brain_sources columns behind the fields the upload flow and the pipeline update. One place,
 * so a field that is added in one cannot silently be left out of the other (tested in columns.test.ts).
 */
import type { IngestSourcePatch } from "./pipeline.ts";
import type { SourceUpdate } from "./uploads.ts";

/** The upload flow's updates (sha256, estimate, approval ...). */
export function updateToColumns(update: SourceUpdate): Record<string, unknown> {
  const columns: Record<string, unknown> = {};
  const set = (column: string, value: unknown) => {
    if (value !== undefined) columns[column] = value;
  };
  set("sha256", update.sha256);
  set("size_bytes", update.sizeBytes);
  set("page_count", update.pageCount);
  set("chunk_count", update.chunkCount);
  set("estimated_cost_usd", update.estimatedCostUsd);
  set("max_cost_usd", update.maxCostUsd);
  set("page_limit", update.pageLimit);
  set("warnings", update.warnings);
  set("upload_completed_at", update.uploadCompletedAt);
  set("approved_by", update.approvedBy);
  set("approved_at", update.approvedAt);
  set("status", update.status);
  set("error_message", update.errorMessage);
  return columns;
}

/** The pipeline's updates (status, step, classification ...). */
export function patchToColumns(patch: IngestSourcePatch): Record<string, unknown> {
  const columns: Record<string, unknown> = {};
  const set = (column: string, value: unknown) => {
    if (value !== undefined) columns[column] = value;
  };
  set("status", patch.status);
  set("step", patch.step);
  set("failed_step", patch.failedStep);
  set("error_message", patch.errorMessage);
  set("title", patch.title);
  set("doc_type", patch.docType);
  set("period_start", patch.periodStart);
  set("period_end", patch.periodEnd);
  set("language", patch.language);
  set("summary_md", patch.summaryMd);
  set("warnings", patch.warnings);
  set("page_count", patch.pageCount);
  set("chunk_count", patch.chunkCount);
  set("chunk_signature", patch.chunkSignature);
  set("classification", patch.classification);
  set("company_entity_id", patch.companyEntityId);
  set("cost_usd", patch.costUsd);
  return columns;
}
