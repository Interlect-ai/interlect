import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireFundCapability, writeAudit } from "@/lib/auth/access.server";
import { getServiceClient } from "@/lib/supabase/admin.server";
import { requireSupabaseAuth } from "@/lib/supabase/auth-middleware";
import { BrainUserError } from "./errors";
import { isBrainEnabled } from "./flags";
import { BRAIN_SOURCES_BUCKET } from "./forget.server";
import {
  buildHistory,
  MAX_HISTORY_ROWS,
  suggestMapping,
  validMapping,
  type HistoryBuild,
  type HistoryMapping,
  type HistoryReasonCode,
} from "./ingest/history";
import { readRawTable, type RawTable } from "./ingest/table";
import { detectFileKind } from "./ingest/file-kind";
import { serverText } from "@/lib/i18n/server-text";
import { inDemoView, loadChoiceKey } from "@/lib/display/display-names.server";

/**
 * Historiske beslutninger: a CSV/Excel file of the fund's earlier decisions. Step 1
 * is the upload (Kilder); step 2 is the column mapping, step 3 the reasons. Needs brain_ingest.
 * Rows go to brain_historical_decisions (0046), never to cases, and cost nothing (no AI here).
 */
const fundId = z.guid();
const sourceId = z.guid();
const index = z.number().int().min(0).max(200).nullable();
const mappingSchema = z
  .object({
    company: index,
    domain: index,
    cvr: index,
    date: index,
    decision: index,
    reason: index,
    amount: index,
  })
  .strict();

const previewInput = z.object({ fundId, sourceId }).strict();
const commitInput = z
  .object({
    fundId,
    sourceId,
    mapping: mappingSchema,
    /** The user's confirmed codes per distinct reason text (lower case). */
    reasonMap: z.record(z.string().max(2000), z.array(z.string().max(60)).max(10)).default({}),
  })
  .strict();

export interface HistoryPreview {
  headers: string[];
  sample: string[][];
  rowCount: number;
  mapping: HistoryMapping;
  /** What the suggested mapping gives: counts, how decision words were read, reasons to confirm. */
  build: Pick<HistoryBuild, "decisionWords" | "unmatchedReasons"> & {
    usable: number;
    problems: HistoryBuild["problems"];
  };
  reasonCodes: HistoryReasonCode[];
}

export interface HistoryCommitResult {
  inserted: number;
  duplicates: number;
  problems: HistoryBuild["problems"];
}

interface LoadedSource {
  table: RawTable;
  codes: HistoryReasonCode[];
}

async function loadSource(
  service: SupabaseClient,
  fund: string,
  source: string,
): Promise<LoadedSource> {
  const { data: row, error } = await service
    .from("brain_sources")
    .select("id, kind, status, storage_path, sha256")
    .eq("id", source)
    .eq("fund_id", fund)
    .maybeSingle();
  if (error) throw new Error(`brain_sources: ${error.message}`);
  if (!row) throw new BrainUserError(serverText("brainServer.common.sourceNotFound"));
  if (row["kind"] !== "csv" && row["kind"] !== "xlsx")
    throw new BrainUserError(serverText("brainServer.history.onlyTable"));
  if (row["status"] !== "review")
    throw new BrainUserError(serverText("brainServer.history.notReady"));
  const path = row["storage_path"] as string | null;
  if (!path) throw new BrainUserError(serverText("brainServer.common.sourceNoFile"));
  const { data: blob, error: downloadError } = await service.storage
    .from(BRAIN_SOURCES_BUCKET)
    .download(path);
  if (downloadError || !blob) throw new BrainUserError(serverText("brainServer.history.fileGone"));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const type = detectFileKind(bytes, `fil.${row["kind"] as string}`);
  if (!type.ok || type.kind !== row["kind"])
    throw new BrainUserError(serverText("brainServer.history.typeMismatch"));
  const table = await readRawTable(bytes, row["kind"] as "csv" | "xlsx");
  if (table.rows.length > MAX_HISTORY_ROWS)
    throw new BrainUserError(
      serverText("brainServer.history.tooManyRows", { max: MAX_HISTORY_ROWS }),
    );
  const { data: codes, error: codesError } = await service
    .from("brain_reason_codes")
    .select("code, label")
    .eq("fund_id", fund)
    .eq("is_active", true);
  if (codesError) throw new Error(`brain_reason_codes: ${codesError.message}`);
  return {
    table,
    codes: (codes ?? []).map((c) => ({ code: c["code"] as string, label: c["label"] as string })),
  };
}

async function userFacing<T>(action: string, fund: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (cause) {
    if (cause instanceof BrainUserError) throw cause;
    console.error(
      `[brain-history] ${action} fund=${fund}`,
      cause instanceof Error ? cause.message : cause,
    );
    throw new Error(serverText("brainServer.common.failed"));
  }
}

export const previewHistoryImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => previewInput.parse(data))
  .handler(async ({ data, context }): Promise<HistoryPreview> => {
    await requireFundCapability(context.supabase, context.userId, data.fundId, "brain_ingest");
    if (!isBrainEnabled()) throw new BrainUserError(serverText("brainServer.common.notEnabled"));
    return userFacing("preview", data.fundId, async () => {
      const { table, codes } = await loadSource(getServiceClient(), data.fundId, data.sourceId);
      const mapping = suggestMapping(table.headers);
      const build =
        validMapping(mapping, table.headers.length) === null
          ? buildHistory(table.rows, mapping, codes)
          : null;
      // Demo view: the file's rows name companies, and its reasons may too; the names in
      // its company column get an alias before they are imported.
      const column = mapping.company;
      const companies =
        column === null ? [] : table.rows.map((row) => ({ name: row[column] ?? "" }));
      return inDemoView(
        data.fundId,
        {
          headers: table.headers,
          sample: table.rows.slice(0, 5),
          rowCount: table.rows.length,
          mapping,
          build: {
            usable: build?.rows.length ?? 0,
            problems: build?.problems.slice(0, 50) ?? [],
            decisionWords: build?.decisionWords ?? [],
            unmatchedReasons: build?.unmatchedReasons.slice(0, 200) ?? [],
          },
          reasonCodes: codes,
        },
        companies,
      );
    });
  });

export const commitHistoryImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => commitInput.parse(data))
  .handler(async ({ data, context }): Promise<HistoryCommitResult> => {
    await requireFundCapability(context.supabase, context.userId, data.fundId, "brain_ingest");
    if (!isBrainEnabled()) throw new BrainUserError(serverText("brainServer.common.notEnabled"));
    return userFacing("commit", data.fundId, async () => {
      const service = getServiceClient();
      const { table, codes } = await loadSource(service, data.fundId, data.sourceId);
      const refusal = validMapping(data.mapping, table.headers.length);
      if (refusal) throw new BrainUserError(refusal);
      // Demo view: the reasons come back as the preview showed them; `buildHistory` looks
      // each up by the file's own text in lower case.
      const key = await loadChoiceKey(service, data.fundId);
      const chosen = new Map(
        Object.entries(data.reasonMap).map(([shown, codes]) => [shown.toLowerCase(), codes]),
      );
      // No prototype: a reason that reads "constructor" is a text like any other.
      const reasonMap: Record<string, string[]> = Object.create(null);
      const column = data.mapping.reason;
      if (column !== null) {
        for (const row of table.rows) {
          const reason = (row[column] ?? "").trim().toLowerCase();
          const codes = reason ? chosen.get(key(reason)) : undefined;
          if (codes) reasonMap[reason] = codes;
        }
      }
      const build = buildHistory(table.rows, data.mapping, codes, reasonMap);
      if (build.rows.length === 0)
        throw new BrainUserError(serverText("brainServer.history.noUsableRows"));

      let inserted = 0;
      let duplicates = 0;
      for (let start = 0; start < build.rows.length; start += 500) {
        const { data: result, error } = await service.rpc("brain_import_historical_decisions", {
          _fund_id: data.fundId,
          _source_id: data.sourceId,
          _rows: build.rows.slice(start, start + 500),
          _imported_by: context.userId,
        });
        if (error) throw new Error(`brain_import_historical_decisions: ${error.message}`);
        const counts = result as { inserted: number; skipped: number };
        inserted += counts.inserted;
        duplicates += counts.skipped;
      }

      // Compare-and-set: only a source still waiting in 'review' becomes ready.
      const { error: updateError } = await service
        .from("brain_sources")
        .update({
          status: "ready",
          step: null,
          chunk_count: build.rows.length,
          doc_type: "decision_history",
          warnings:
            build.problems.length > 0
              ? [serverText("brainServer.history.rowsSkipped", { count: build.problems.length })]
              : [],
        })
        .eq("id", data.sourceId)
        .eq("fund_id", data.fundId)
        .eq("status", "review");
      if (updateError) throw new Error(`brain_sources: ${updateError.message}`);

      await writeAudit(service, {
        fundId: data.fundId,
        actorType: "user",
        actorId: context.userId,
        action: "brain.history_import",
        entity: "brain_sources",
        entityId: data.sourceId,
        payload: { inserted, duplicates, skipped: build.problems.length },
      });
      return inDemoView(data.fundId, {
        inserted,
        duplicates,
        problems: build.problems.slice(0, 200),
      });
    });
  });
