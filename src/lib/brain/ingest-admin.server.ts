import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { BRAIN_SOURCES_BUCKET } from "./forget.server";
import { updateToColumns } from "./ingest/columns";
import { parseIngestKey } from "./ingest/keys";
import type { IngestAdmin, SourceRecord } from "./ingest/uploads";
import { enqueueBrain } from "./queue.server";

const OPEN_UPLOAD_HOURS = 24;

const COLUMNS =
  "id, fund_id, kind, title, file_name, storage_path, sha256, status, upload_completed_at, approved_at, page_limit, max_cost_usd, failed_step, error_message";

function toRecord(row: Record<string, unknown>): SourceRecord {
  return {
    id: row["id"] as string,
    fundId: row["fund_id"] as string,
    kind: row["kind"] as SourceRecord["kind"],
    title: row["title"] as string,
    fileName: (row["file_name"] as string | null) ?? null,
    storagePath: (row["storage_path"] as string | null) ?? null,
    sha256: (row["sha256"] as string | null) ?? null,
    status: row["status"] as string,
    uploadCompletedAt: (row["upload_completed_at"] as string | null) ?? null,
    approvedAt: (row["approved_at"] as string | null) ?? null,
    pageLimit: (row["page_limit"] as number | null) ?? null,
    maxCostUsd: row["max_cost_usd"] == null ? null : Number(row["max_cost_usd"]),
    failedStep: (row["failed_step"] as string | null) ?? null,
    errorMessage: (row["error_message"] as string | null) ?? null,
  };
}

/** The columns behind each field of a SourceUpdate. */

/** The upload flow's database, Storage, queue and audit access (the Supabase side of IngestAdmin). */
export function supabaseIngestAdmin(
  service: SupabaseClient,
  audit: IngestAdmin["audit"],
): IngestAdmin {
  const storage = () => service.storage.from(BRAIN_SOURCES_BUCKET);
  return {
    newId: () => randomUUID(),
    now: () => new Date(),
    async countOpenUploads(fundId) {
      const since = new Date(Date.now() - OPEN_UPLOAD_HOURS * 3_600_000).toISOString();
      const { count, error } = await service
        .from("brain_sources")
        .select("id", { count: "exact", head: true })
        .eq("fund_id", fundId)
        .is("upload_completed_at", null)
        .gte("created_at", since);
      if (error) throw new Error(`brain_sources count: ${error.message}`);
      return count ?? 0;
    },
    async insertSource(source) {
      const { error } = await service.from("brain_sources").insert({
        id: source.id,
        fund_id: source.fundId,
        kind: source.kind,
        title: source.title,
        trust_tier: source.trustTier,
        status: "queued",
        storage_path: source.storagePath,
        file_name: source.fileName,
        size_bytes: source.sizeBytes,
        origin_url: source.originUrl ?? null,
        created_by: source.createdBy,
      });
      if (error) throw new Error(`brain_sources insert: ${error.message}`);
    },
    async getSource(fundId, sourceId) {
      const { data, error } = await service
        .from("brain_sources")
        .select(COLUMNS)
        .eq("id", sourceId)
        .eq("fund_id", fundId)
        .maybeSingle();
      if (error) throw new Error(`brain_sources: ${error.message}`);
      return data ? toRecord(data as Record<string, unknown>) : null;
    },
    async updateSource(fundId, sourceId, update, only) {
      let query = service
        .from("brain_sources")
        .update(updateToColumns(update))
        .eq("id", sourceId)
        .eq("fund_id", fundId);
      if (only?.approvedAtNull) query = query.is("approved_at", null);
      if (only?.status) query = query.eq("status", only.status);
      const { data, error } = await query.select("id");
      if (error) {
        // The unique index on (fund, sha256): another source of the fund already holds this file.
        if (error.code === "23505") return "duplicate";
        throw new Error(`brain_sources update: ${error.message}`);
      }
      return only && (data ?? []).length === 0 ? "conflict" : "ok";
    },
    async deleteSource(fundId, sourceId) {
      const { error } = await service
        .from("brain_sources")
        .delete()
        .eq("id", sourceId)
        .eq("fund_id", fundId);
      if (error) throw new Error(`brain_sources delete: ${error.message}`);
    },
    async deleteUnapprovedSource(fundId, sourceId) {
      const { data, error } = await service
        .from("brain_sources")
        .delete()
        .eq("id", sourceId)
        .eq("fund_id", fundId)
        .is("approved_at", null)
        // A website's confirmed portfolio hangs on its source without a price (historical decisions).
        .neq("kind", "website")
        .select("id");
      if (error) throw new Error(`brain_sources delete: ${error.message}`);
      return (data ?? []).length > 0;
    },
    async findBySha(fundId, sha256, exceptId) {
      const { data, error } = await service
        .from("brain_sources")
        .select("id, title, status")
        .eq("fund_id", fundId)
        .eq("sha256", sha256)
        .neq("id", exceptId)
        .maybeSingle();
      if (error) throw new Error(`brain_sources sha: ${error.message}`);
      return data
        ? {
            id: data["id"] as string,
            title: data["title"] as string,
            status: data["status"] as string,
          }
        : null;
    },
    async signedUploadUrl(path) {
      const { data, error } = await storage().createSignedUploadUrl(path);
      if (error || !data) throw new Error(`createSignedUploadUrl: ${error?.message ?? "no data"}`);
      return { url: data.signedUrl, token: data.token };
    },
    async download(path) {
      const { data, error } = await storage().download(path);
      if (error || !data) return null;
      return new Uint8Array(await data.arrayBuffer());
    },
    async removeObject(path) {
      const { error } = await storage().remove([path]);
      if (error) throw new Error(`storage remove: ${error.message}`);
    },
    async putObject(path, bytes, contentType) {
      const { error } = await storage().upload(path, bytes, { contentType, upsert: false });
      if (error) throw new Error(`storage upload: ${error.message}`);
    },
    async highestIngestRun(fundId, sourceId) {
      const { data, error } = await service
        .from("brain_jobs")
        .select("key")
        .eq("fund_id", fundId)
        .eq("loop", "INGEST")
        .like("key", `${sourceId}%`)
        .limit(500);
      if (error) throw new Error(`brain_jobs: ${error.message}`);
      let highest = -1;
      for (const row of data ?? []) {
        const parsed = parseIngestKey(row["key"] as string);
        if (parsed && parsed.sourceId === sourceId.toLowerCase())
          highest = Math.max(highest, parsed.run);
      }
      return highest;
    },
    async enqueueIngest(fundId, key) {
      // Test seam (development only): the hosted queue does not deliver locally, so a script runs
      // the same worker code (processBrainMessage) on the key instead.
      if (import.meta.env.DEV && process.env["BRAIN_DEV_SKIP_ENQUEUE"] === "1") return;
      const result = await enqueueBrain({ fundId, loop: "INGEST", key });
      if (result === "disabled") throw new Error("Brain is switched off");
    },
    audit,
  };
}
