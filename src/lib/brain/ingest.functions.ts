import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { AI_BUDGETS } from "@/lib/analysis/budgets";
import { requireFundCapability, writeAudit } from "@/lib/auth/access.server";
import { hasCapability } from "@/lib/domain/workflow";
import { getServiceClient } from "@/lib/supabase/admin.server";
import { requireSupabaseAuth } from "@/lib/supabase/auth-middleware";
import { BrainUserError } from "./errors";
import { isBrainEnabled } from "./flags";
import { BRAIN_SOURCES_BUCKET } from "./forget.server";
import { supabaseIngestAdmin } from "./ingest-admin.server";
import { sourcePhase, sourceProgress, type SourcePhase } from "./ingest/phase";
import {
  approveIngest,
  completeUpload,
  discardUpload,
  requestUpload,
  retryIngest,
  submitText,
  type CompleteResult,
  type UploadTicket,
} from "./ingest/uploads";
import { serverText } from "@/lib/i18n/server-text";
import { inDemoView } from "@/lib/display/display-names.server";

/**
 * Brain · Kilder: upload, price approval, progress, retry and download. Everything
 * but the list needs brain_ingest (Admin, Lead, Medlem); the list is readable by every member
 * (Læser included). The capability is checked again on the server on every call.
 */
const fundId = z.guid();
const sourceId = z.guid();
const trust = z.enum(["customer_doc", "company_claim"]);

const requestInput = z
  .object({
    fundId,
    fileName: z.string().trim().min(1).max(300),
    sizeBytes: z.number().int().positive(),
    trustTier: trust,
    title: z.string().trim().max(500).optional(),
  })
  .strict();
const sourceInput = z.object({ fundId, sourceId }).strict();
const approveInput = z
  .object({ fundId, sourceId, pageLimit: z.number().int().min(1).max(300).optional() })
  .strict();
const textInput = z
  .object({
    fundId,
    title: z.string().trim().min(1).max(500),
    text: z.string().max(60_000),
    trustTier: trust,
  })
  .strict();

async function admin(context: { userId: string }, forFund: string) {
  const service = getServiceClient();
  return supabaseIngestAdmin(service, (event) =>
    writeAudit(service, {
      fundId: forFund,
      actorType: "user",
      actorId: context.userId,
      action: event.action,
      entity: "brain_sources",
      entityId: event.sourceId,
      payload: event.payload,
    }),
  );
}

/** A refusal meant for the user passes through; anything else is logged and replaced by a short text. */
async function userFacing<T>(action: string, fund: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (cause) {
    if (cause instanceof BrainUserError) throw cause;
    console.error(
      `[brain-ingest] ${action} fund=${fund}`,
      cause instanceof Error ? cause.message : cause,
    );
    throw new Error(serverText("brainServer.common.failed"));
  }
}

function requireBrain() {
  if (!isBrainEnabled()) throw new BrainUserError(serverText("brainServer.common.notEnabled"));
}

export const requestBrainUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => requestInput.parse(data))
  .handler(async ({ data, context }): Promise<UploadTicket> => {
    await requireFundCapability(context.supabase, context.userId, data.fundId, "brain_ingest");
    requireBrain();
    return userFacing("request", data.fundId, async () =>
      requestUpload(await admin(context, data.fundId), {
        fundId: data.fundId,
        userId: context.userId,
        fileName: data.fileName,
        sizeBytes: data.sizeBytes,
        trustTier: data.trustTier,
        title: data.title,
      }),
    );
  });

export const completeBrainUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => sourceInput.parse(data))
  .handler(async ({ data, context }): Promise<CompleteResult> => {
    await requireFundCapability(context.supabase, context.userId, data.fundId, "brain_ingest");
    requireBrain();
    // Demo view: a duplicate shows the earlier source's title.
    return userFacing("complete", data.fundId, async () =>
      inDemoView(data.fundId, await completeUpload(await admin(context, data.fundId), data)),
    );
  });

export const submitBrainText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => textInput.parse(data))
  .handler(async ({ data, context }): Promise<CompleteResult> => {
    await requireFundCapability(context.supabase, context.userId, data.fundId, "brain_ingest");
    requireBrain();
    // Demo view: as for an upload.
    return userFacing("text", data.fundId, async () =>
      inDemoView(
        data.fundId,
        await submitText(await admin(context, data.fundId), { ...data, userId: context.userId }),
      ),
    );
  });

export const approveBrainIngest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => approveInput.parse(data))
  .handler(async ({ data, context }) => {
    await requireFundCapability(context.supabase, context.userId, data.fundId, "brain_ingest");
    requireBrain();
    return userFacing("approve", data.fundId, async () =>
      approveIngest(await admin(context, data.fundId), { ...data, userId: context.userId }),
    );
  });

export const retryBrainIngest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => sourceInput.parse(data))
  .handler(async ({ data, context }) => {
    await requireFundCapability(context.supabase, context.userId, data.fundId, "brain_ingest");
    requireBrain();
    return userFacing("retry", data.fundId, async () =>
      retryIngest(await admin(context, data.fundId), { ...data, userId: context.userId }),
    );
  });

/** A card closed before "Læs ind": the upload nobody approved is removed. */
export const discardBrainUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => sourceInput.parse(data))
  .handler(async ({ data, context }) => {
    await requireFundCapability(context.supabase, context.userId, data.fundId, "brain_ingest");
    // Removing needs no running Brain (like "Glem denne kilde", d).
    return userFacing("discard", data.fundId, async () =>
      discardUpload(await admin(context, data.fundId), { ...data, userId: context.userId }),
    );
  });

export interface BrainSourceRow {
  id: string;
  title: string;
  kind: string;
  fileName: string | null;
  docType: string | null;
  trustTier: string;
  status: string;
  phase: SourcePhase;
  progress: number;
  step: string | null;
  failedStep: string | null;
  errorMessage: string | null;
  warnings: string[];
  summary: string | null;
  pageCount: number | null;
  chunkCount: number | null;
  sizeBytes: number | null;
  estimatedDkk: number | null;
  maxDkk: number | null;
  costDkk: number;
  periodStart: string | null;
  periodEnd: string | null;
  createdAt: string;
}

const toDkk = (usd: number) => Math.round(usd * AI_BUDGETS.exchangeRateDkkPerUsd * 100) / 100;

const LIST_COLUMNS =
  "id, title, kind, file_name, doc_type, trust_tier, status, step, failed_step, error_message, warnings, summary_md, page_count, chunk_count, size_bytes, estimated_cost_usd, max_cost_usd, cost_usd, period_start, period_end, created_at, upload_completed_at, approved_at";

/** The fund's sources, newest first. Read through the user's own session, so row security decides. */
export const listBrainSources = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => z.object({ fundId }).strict().parse(data))
  .handler(
    async ({
      data,
      context,
    }): Promise<{ sources: BrainSourceRow[]; canEdit: boolean; canForget: boolean }> => {
      const access = await requireFundCapability(
        context.supabase,
        context.userId,
        data.fundId,
        "view_case",
      );
      const { data: rows, error } = await context.supabase
        .from("brain_sources")
        .select(LIST_COLUMNS)
        .eq("fund_id", data.fundId)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) {
        console.error("[brain-ingest] list", error.message);
        throw new Error(serverText("brainServer.sources.notLoaded"));
      }
      // Demo view: titles, file names, summaries and warnings name companies and people.
      return inDemoView(data.fundId, {
        sources: (rows ?? []).map((row) => {
          const r = row as Record<string, unknown>;
          const status = r["status"] as string;
          return {
            id: r["id"] as string,
            title: r["title"] as string,
            kind: r["kind"] as string,
            fileName: (r["file_name"] as string | null) ?? null,
            docType: (r["doc_type"] as string | null) ?? null,
            trustTier: r["trust_tier"] as string,
            status,
            phase: sourcePhase({
              status,
              uploadCompletedAt: (r["upload_completed_at"] as string | null) ?? null,
              approvedAt: (r["approved_at"] as string | null) ?? null,
            }),
            progress: sourceProgress(status),
            step: (r["step"] as string | null) ?? null,
            failedStep: (r["failed_step"] as string | null) ?? null,
            errorMessage: (r["error_message"] as string | null) ?? null,
            warnings: (r["warnings"] as string[] | null) ?? [],
            summary: (r["summary_md"] as string | null) ?? null,
            pageCount: (r["page_count"] as number | null) ?? null,
            chunkCount: (r["chunk_count"] as number | null) ?? null,
            sizeBytes: r["size_bytes"] == null ? null : Number(r["size_bytes"]),
            estimatedDkk:
              r["estimated_cost_usd"] == null ? null : toDkk(Number(r["estimated_cost_usd"])),
            maxDkk: r["max_cost_usd"] == null ? null : toDkk(Number(r["max_cost_usd"])),
            costDkk: toDkk(Number(r["cost_usd"] ?? 0)),
            periodStart: (r["period_start"] as string | null) ?? null,
            periodEnd: (r["period_end"] as string | null) ?? null,
            createdAt: r["created_at"] as string,
          };
        }),
        canEdit: hasCapability(access.roles, "brain_ingest", access.settings),
        canForget: hasCapability(access.roles, "brain_forget", access.settings),
      });
    },
  );

/** A 60-second link to the stored file (private bucket, downloads through the server). */
export const getBrainSourceDownloadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => sourceInput.parse(data))
  .handler(async ({ data, context }): Promise<{ url: string }> => {
    await requireFundCapability(context.supabase, context.userId, data.fundId, "brain_ingest");
    return userFacing("download", data.fundId, async () => {
      const service = getServiceClient();
      const { data: source, error } = await service
        .from("brain_sources")
        .select("storage_path, file_name")
        .eq("id", data.sourceId)
        .eq("fund_id", data.fundId)
        .maybeSingle();
      if (error) throw new Error(`brain_sources: ${error.message}`);
      if (!source?.["storage_path"])
        throw new BrainUserError(serverText("brainServer.common.sourceNoFile"));
      const { data: signed, error: signError } = await service.storage
        .from(BRAIN_SOURCES_BUCKET)
        .createSignedUrl(source["storage_path"] as string, 60, {
          download: (source["file_name"] as string | null) ?? true,
        });
      if (signError || !signed)
        throw new Error(`createSignedUrl: ${signError?.message ?? "no data"}`);
      await writeAudit(service, {
        fundId: data.fundId,
        actorType: "user",
        actorId: context.userId,
        action: "brain_source_downloaded",
        entity: "brain_sources",
        entityId: data.sourceId,
        payload: {},
      });
      return { url: signed.signedUrl };
    });
  });
