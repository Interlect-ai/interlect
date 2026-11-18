import type { SupabaseClient } from "@supabase/supabase-js";
import { EMBEDDING_MODEL, estimateEmbeddingUsd } from "../capture";
import { embedWithGateway } from "../embeddings.server";
import { BRAIN_SOURCES_BUCKET } from "../forget.server";
import type { Chunk } from "../ingest/chunk";
import { patchToColumns } from "../ingest/columns";
import { failIngestSourceOfDeadJob } from "../ingest/dead-job";
import { ingestContinuationKey, parseIngestKey } from "../ingest/keys";
import { parseClassification, type ClassifyOutput } from "../contracts/classify";
import { enqueueBrain } from "../queue.server";
import { extractSourceFacts } from "./extract";
import {
  CLASSIFIER_PROMPT_KEY,
  CLASSIFIER_PROMPT_V1,
  runIngestPipeline,
  type IngestSource,
  type IngestSourcePatch,
  type IngestStore,
} from "../ingest/pipeline";
import { brainModel, brainPrompt } from "../models.server";
import { outputLanguageDirective } from "../../i18n/ai-language";
import { loadFundLanguage } from "../../i18n/fund-language.server";
import type { LoopHandler } from "../worker.server";
import {
  callWithGateway,
  embedWithBudget,
  structuredCallMaximumUsd,
  structuredWithBudget,
} from "./shared";
import { readForgetGeneration, storeVectorsChecked } from "./forget-guard";

const SOURCE_COLUMNS =
  "id, kind, title, file_name, storage_path, sha256, trust_tier, status, approved_at, page_limit, max_cost_usd, cost_usd, doc_type, summary_md, period_start, period_end, chunk_signature, classification";

/** The columns of brain_sources behind each field of a patch. */

/** The stored classifier answer, or null when it is missing or not in the current shape. */
function parseStoredClassification(value: unknown): ClassifyOutput | null {
  if (value == null) return null;
  return parseClassification(value);
}

function toSource(row: Record<string, unknown>): IngestSource {
  return {
    id: row["id"] as string,
    kind: row["kind"] as IngestSource["kind"],
    title: row["title"] as string,
    fileName: (row["file_name"] as string | null) ?? null,
    storagePath: (row["storage_path"] as string | null) ?? null,
    sha256: (row["sha256"] as string | null) ?? null,
    trustTier: row["trust_tier"] as string,
    status: row["status"] as string,
    approvedAt: (row["approved_at"] as string | null) ?? null,
    pageLimit: (row["page_limit"] as number | null) ?? null,
    maxCostUsd: row["max_cost_usd"] == null ? null : Number(row["max_cost_usd"]),
    costUsd: Number(row["cost_usd"] ?? 0),
    docType: (row["doc_type"] as string | null) ?? null,
    summaryMd: (row["summary_md"] as string | null) ?? null,
    periodStart: (row["period_start"] as string | null) ?? null,
    periodEnd: (row["period_end"] as string | null) ?? null,
    chunkSignature: (row["chunk_signature"] as string | null) ?? null,
    classification: parseStoredClassification(row["classification"]),
  };
}

/** The pipeline's database and Storage access (brain_sources, the chunk functions of 0053). */
export function supabaseIngestStore(
  service: SupabaseClient,
  fundId: string,
  sourceId: string,
  jobId: string,
): IngestStore {
  let generation: number | null = null;
  // Read before the file is: the chunks hold text from the file, which a "Glem person" since may
  // have masked or deleted.
  let fileGeneration: number | null = null;
  return {
    async claim() {
      const { data, error } = await service.rpc("brain_source_claim", {
        _fund_id: fundId,
        _source_id: sourceId,
        _job_id: jobId,
      });
      if (error) throw new Error(`brain_source_claim: ${error.message}`);
      return data === true;
    },
    async release() {
      const { error } = await service.rpc("brain_source_release", {
        _fund_id: fundId,
        _source_id: sourceId,
        _job_id: jobId,
      });
      if (error) throw new Error(`brain_source_release: ${error.message}`);
    },
    async loadSource() {
      const { data, error } = await service
        .from("brain_sources")
        .select(SOURCE_COLUMNS)
        .eq("id", sourceId)
        .eq("fund_id", fundId)
        .maybeSingle();
      if (error) throw new Error(`brain_sources: ${error.message}`);
      return data ? toSource(data as Record<string, unknown>) : null;
    },
    async update(patch) {
      const columns = patchToColumns(patch);
      if (Object.keys(columns).length === 0) return;
      // The classifier's text comes from the file: not saved when something was forgotten since
      // the file was read. The retry reads the file as the forgetting left it.
      if (
        fileGeneration !== null &&
        (patch.summaryMd !== undefined ||
          patch.title !== undefined ||
          patch.classification !== undefined) &&
        (await readForgetGeneration(service, fundId)) !== fileGeneration
      ) {
        throw new Error("INGEST: something was forgotten while the file was classified");
      }
      const { error } = await service
        .from("brain_sources")
        .update(columns)
        .eq("id", sourceId)
        .eq("fund_id", fundId);
      if (error) throw new Error(`brain_sources update: ${error.message}`);
    },
    async download(path) {
      fileGeneration = await readForgetGeneration(service, fundId);
      const { data, error } = await service.storage.from(BRAIN_SOURCES_BUCKET).download(path);
      if (error || !data) return null;
      return new Uint8Array(await data.arrayBuffer());
    },
    async clearChunks() {
      const { data, error } = await service.rpc("brain_ingest_clear_chunks", {
        _fund_id: fundId,
        _source_id: sourceId,
      });
      if (error) throw new Error(`brain_ingest_clear_chunks: ${error.message}`);
      return Number(data ?? 0);
    },
    async storeChunks(chunks: readonly Chunk[]) {
      if (fileGeneration === null) throw new Error("INGEST: chunks without reading the file first");
      const { data, error } = await service.rpc("brain_ingest_store_chunks_checked", {
        _fund_id: fundId,
        _source_id: sourceId,
        _forget_generation: fileGeneration,
        _chunks: chunks.map((chunk) => ({
          ordinal: chunk.ordinal,
          heading: chunk.heading,
          pageFrom: chunk.pageFrom,
          pageTo: chunk.pageTo,
          content: chunk.content,
          tokenCount: chunk.tokenCount,
        })),
      });
      if (error) throw new Error(`brain_ingest_store_chunks_checked: ${error.message}`);
      const result = (data ?? {}) as { stored?: unknown; skipped?: unknown };
      // Forgotten since the file was read: nothing is stored. The run is retried and reads the
      // file as the forgetting left it (or finds it gone).
      if (result.skipped === "forgotten") {
        throw new Error("INGEST: something was forgotten while the file was read");
      }
      return Number(result.stored ?? 0);
    },
    async pendingChunks(limit) {
      // Before the texts: setEmbeddings stores nothing after a "Glem" since.
      generation = await readForgetGeneration(service, fundId);
      const { data, error } = await service.rpc("brain_source_pending_chunks", {
        _fund_id: fundId,
        _source_id: sourceId,
        _limit: limit,
      });
      if (error) throw new Error(`brain_source_pending_chunks: ${error.message}`);
      return ((data ?? []) as Array<{ chunk_id: string; content: string }>).map((row) => ({
        id: row.chunk_id,
        content: row.content,
      }));
    },
    async findCompanyEntity(keys) {
      const { data, error } = await service
        .from("brain_entities")
        .select("id, normalized_key")
        .eq("fund_id", fundId)
        .eq("type", "company")
        .eq("status", "active")
        .in("normalized_key", [...keys]);
      if (error) throw new Error(`brain_entities company: ${error.message}`);
      const byKey = new Map(
        (data ?? []).map((row) => [row["normalized_key"] as string, row["id"] as string]),
      );
      for (const key of keys) {
        const id = byKey.get(key);
        if (id) return id;
      }
      return null;
    },
    async setEmbeddings(rows) {
      if (generation === null) throw new Error("INGEST: vectors without reading the chunks first");
      // Forgotten meanwhile: the chunks stay pending, and the next round embeds the masked text.
      await storeVectorsChecked(
        service,
        fundId,
        generation,
        rows.map((row) => ({
          table: "chunk" as const,
          id: row.id,
          embedding: row.embedding,
          model: EMBEDDING_MODEL,
        })),
      );
    },
  };
}

/**
 * INGEST: one uploaded source, once a human has approved its price. All model calls
 * reserve the fund's "ingest" budget first.
 */
export const ingestLoop: LoopHandler = async (ctx) => {
  const key = parseIngestKey(ctx.key);
  if (!key) return { status: "skipped", stats: { reason: "invalid_key" } };
  const [model, prompt, language] = await Promise.all([
    brainModel(ctx.service, ctx.fundId, "extractor"),
    brainPrompt(ctx.service, ctx.fundId, CLASSIFIER_PROMPT_KEY, CLASSIFIER_PROMPT_V1),
    loadFundLanguage(ctx.service, ctx.fundId),
  ]);
  return runIngestPipeline(
    ctx,
    supabaseIngestStore(ctx.service, ctx.fundId, key.sourceId, ctx.jobId),
    {
      // The summary is shown to the team, so it follows the fund's language.
      classifier: { model, prompt: `${prompt.body}${outputLanguageDirective(language)}` },
      classify: (call, refId) => structuredWithBudget(ctx, callWithGateway, call, refId, "ingest"),
      classifyMaxUsd: structuredCallMaximumUsd,
      embed: (texts, refId) => embedWithBudget(ctx, texts, refId, embedWithGateway, "ingest"),
      embedMaxUsd: estimateEmbeddingUsd,
      extractFacts: (options) =>
        extractSourceFacts(ctx, { embed: embedWithGateway, call: callWithGateway }, key.sourceId, {
          maxCostUsd: options.maxCostUsd,
          onBatchCost: options.onBatchCost,
        }),
      continueLater: async () => {
        const result = await enqueueBrain({
          fundId: ctx.fundId,
          loop: "INGEST",
          key: ingestContinuationKey(key.sourceId, key.part + 1),
        });
        if (result === "disabled") throw new Error("INGEST: Brain is switched off");
      },
    },
  );
};

export { failIngestSourceOfDeadJob };
