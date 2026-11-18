import type { LoopContext, LoopHandler } from "../worker.server";
import {
  captureExtracts,
  captureKey,
  EMBED_BATCH_LIMIT,
  EMBEDDING_MODEL,
  parseCaptureKey,
  profileNeedsUpdate,
  sha256Hex,
  type CaptureOrigin,
} from "../capture";
import { embedWithGateway, type BrainEmbedder } from "../embeddings.server";
import { backfillStopped, embedWithBudget } from "./shared";
import { readForgetGeneration, storeVectorsChecked } from "./forget-guard";
import { writeBrainLog } from "../log.server";
import { enqueueBrain } from "../queue.server";
import { enqueuePendingReflections } from "./reflect";

type CaptureCounts = {
  episodes: number;
  added: number;
  removed: number;
  chunks_added: number;
  pending_chunks: number;
};

/**
 * L0 · Indfang (06 L0), one case per run. Episodes and chunks come from SQL
 * (brain_capture_case: anti-join, no model, no cost); this loop embeds the chunks that have no
 * vector yet (budget "learning"), runs the projection, refreshes the case's profile vector when
 * its text changed, logs the change and hands unextracted episodes to L1 (not for the backfill
 * level Søgbar) and the case's new decisions to L2 (only for a change). Every step is
 * idempotent, so a retried message pays nothing twice.
 */
export function createCaptureLoop(embed: BrainEmbedder): LoopHandler {
  return async (ctx) => {
    const key = parseCaptureKey(ctx.key);
    if (!key) return { status: "skipped", stats: { reason: "invalid_key" } };
    const { caseId } = key;
    if (key.origin !== "change" && (await backfillStopped(ctx, key.origin, key.changedAt))) {
      return { status: "skipped", stats: { reason: "backfill_stopped" } };
    }

    const { data: caseRow, error: caseError } = await ctx.service
      .from("cases")
      .select("id")
      .eq("id", caseId)
      .eq("fund_id", ctx.fundId)
      .maybeSingle();
    if (caseError) throw new Error(`L0 case lookup: ${caseError.message}`);
    // Deleted since the message was sent: its episodes went with it (cascade).
    if (!caseRow) return { status: "skipped", stats: { reason: "case_gone" } };

    // The _checked functions hold the fund's forget lock shared: a "Glem" waits for them.
    const { data: captured, error: captureError } = await ctx.service.rpc(
      "brain_capture_case_checked",
      { _fund_id: ctx.fundId, _case_id: caseId },
    );
    if (captureError) throw new Error(`brain_capture_case: ${captureError.message}`);
    const counts = captured as CaptureCounts;
    await ctx.recordStep("episodes", counts);

    const embedded = await embedPendingChunks(ctx, caseId, embed);
    await ctx.recordStep("embed", embedded, embedded.costUsd);

    const { data: projection, error: projectionError } = await ctx.service.rpc(
      "brain_project_db_entities_checked",
      { _fund_id: ctx.fundId, _case_id: caseId },
    );
    if (projectionError) throw new Error(`brain_project_db_entities: ${projectionError.message}`);
    const projected = projection as { case_entity_id?: string; changed?: boolean };
    await ctx.recordStep("project", projected);

    const profile = await refreshCaseProfile(ctx, caseId, projected.case_entity_id ?? null, embed);
    await ctx.recordStep("profile", { profile: profile.status }, profile.costUsd);

    if (counts.added > 0 || counts.removed > 0) {
      await writeBrainLog(ctx.service, [
        {
          fundId: ctx.fundId,
          actor: "L0_capture",
          action: "update",
          objectKind: "case_capture",
          objectId: caseId,
          after: { added: counts.added, removed: counts.removed, episodes: counts.episodes },
          jobId: ctx.jobId,
        },
      ]);
    }
    // L1 takes every episode of the case that is not extracted yet: the new ones, and those
    // left by a "Søgbar" backfill or an earlier L1 that stopped at the budget.
    const toExtract = captureExtracts(key.origin) ? await pendingExtraction(ctx, caseId) : 0;
    if (toExtract > 0) {
      await enqueueBrain({ fundId: ctx.fundId, loop: "L1_extract", key: ctx.key });
    }
    await settleChangeMarks(ctx, caseId, key);
    // A decision is a change of the case: its reflection (L2) follows, not for a backfill.
    const toReflect =
      key.origin === "change" ? await enqueuePendingReflections(ctx, caseId, ctx.now) : 0;

    return {
      status: "done",
      stats: {
        ...counts,
        embeddedChunks: embedded.chunks,
        stillPending: Math.max(counts.pending_chunks - embedded.chunks, 0),
        profile: profile.status,
        toExtract,
        toReflect,
        costUsd: embedded.costUsd + profile.costUsd,
      },
    };
  };
}

/**
 * The case's "changed" mark (brain_capture_queue). A change or full run has captured and handed
 * to L1 everything up to its key's time, so older marks go; a later mark gets its own L0, so
 * corrected or deleted text never waits for the nightly reconciliation. A Søgbar run does not
 * extract, so it leaves every mark and makes sure a normal L0 (with L1) follows for it.
 */
async function settleChangeMarks(
  ctx: LoopContext,
  caseId: string,
  key: { changedAt: Date; origin: CaptureOrigin },
): Promise<void> {
  if (key.origin !== "search") {
    const { error } = await ctx.service
      .from("brain_capture_queue")
      .delete()
      .eq("fund_id", ctx.fundId)
      .eq("case_id", caseId)
      .lte("changed_at", key.changedAt.toISOString());
    if (error) console.error("[brain] L0 capture queue not cleared", error.code);
  }

  let marks = ctx.service
    .from("brain_capture_queue")
    .select("changed_at")
    .eq("fund_id", ctx.fundId)
    .eq("case_id", caseId);
  if (key.origin !== "search") marks = marks.gt("changed_at", key.changedAt.toISOString());
  const { data: mark, error } = await marks.maybeSingle();
  if (error) throw new Error(`L0 capture queue: ${error.message}`);
  if (mark) {
    await enqueueBrain({
      fundId: ctx.fundId,
      loop: "L0_capture",
      key: captureKey(caseId, new Date(mark["changed_at"] as string)),
    });
  }
}

async function pendingExtraction(ctx: LoopContext, caseId: string): Promise<number> {
  const { count, error } = await ctx.service
    .from("brain_episodes")
    .select("id", { count: "exact", head: true })
    .eq("fund_id", ctx.fundId)
    .eq("case_id", caseId)
    .eq("extraction_status", "pending");
  if (error) throw new Error(`L0 pending extraction: ${error.message}`);
  return count ?? 0;
}

export const captureLoop = createCaptureLoop(embedWithGateway);

async function embedPendingChunks(
  ctx: LoopContext,
  caseId: string,
  embed: BrainEmbedder,
): Promise<{ chunks: number; tokens: number; costUsd: number; forgotten?: true }> {
  // Before the texts: a "Glem" after this means the vectors are not stored.
  const generation = await readForgetGeneration(ctx.service, ctx.fundId);
  const { data, error } = await ctx.service.rpc("brain_case_pending_chunks", {
    _fund_id: ctx.fundId,
    _case_id: caseId,
    _limit: EMBED_BATCH_LIMIT,
  });
  if (error) throw new Error(`brain_case_pending_chunks: ${error.message}`);
  const rows = (data ?? []) as Array<{ chunk_id: string; content: string }>;
  if (rows.length === 0) return { chunks: 0, tokens: 0, costUsd: 0 };

  const texts = rows.map((row) => row.content);
  const vectors = await embedWithBudget(ctx, texts, caseId, embed);

  const { stored, forgotten } = await storeVectorsChecked(
    ctx.service,
    ctx.fundId,
    generation,
    rows.flatMap((row, index) => {
      const embedding = vectors.embeddings[index];
      return embedding
        ? [{ table: "chunk" as const, id: row.chunk_id, embedding, model: EMBEDDING_MODEL }]
        : [];
    }),
  );
  // Forgotten meanwhile: the chunks keep no vector and are embedded from the masked text next run.
  return {
    chunks: stored,
    tokens: vectors.tokens,
    costUsd: vectors.costUsd,
    ...(forgotten ? { forgotten: true as const } : {}),
  };
}

/** The case's profile vector. The text's hash is kept in brain_log. */
async function refreshCaseProfile(
  ctx: LoopContext,
  caseId: string,
  caseEntityId: string | null,
  embed: BrainEmbedder,
): Promise<{ status: "none" | "unchanged" | "updated" | "forgotten"; costUsd: number }> {
  if (!caseEntityId) return { status: "none", costUsd: 0 };
  const generation = await readForgetGeneration(ctx.service, ctx.fundId);
  const { data: text, error } = await ctx.service.rpc("brain_case_profile_text", {
    _fund_id: ctx.fundId,
    _case_id: caseId,
  });
  if (error) throw new Error(`brain_case_profile_text: ${error.message}`);
  const profileText = typeof text === "string" ? text : null;
  if (!profileText) return { status: "none", costUsd: 0 };

  const { data: last, error: lastError } = await ctx.service
    .from("brain_log")
    .select("after")
    .eq("fund_id", ctx.fundId)
    .eq("object_kind", "case_profile")
    .eq("object_id", caseEntityId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastError) throw new Error(`brain_log profile lookup: ${lastError.message}`);
  const lastHash = (last?.after as { hash?: unknown } | null)?.hash;
  if (!profileNeedsUpdate(profileText, typeof lastHash === "string" ? lastHash : null)) {
    return { status: "unchanged", costUsd: 0 };
  }

  const vectors = await embedWithBudget(ctx, [profileText], caseId, embed);
  const embedding = vectors.embeddings[0];
  if (!embedding) throw new Error("brain_entities profile: the embedder returned no vector");
  const profileStore = await storeVectorsChecked(ctx.service, ctx.fundId, generation, [
    { table: "entity", id: caseEntityId, embedding },
  ]);
  // No hash in brain_log either: the next run makes the profile again from the masked text.
  if (profileStore.forgotten) return { status: "forgotten", costUsd: vectors.costUsd };
  await writeBrainLog(ctx.service, [
    {
      fundId: ctx.fundId,
      actor: "L0_capture",
      action: "update",
      objectKind: "case_profile",
      objectId: caseEntityId,
      after: { hash: sha256Hex(profileText), characters: profileText.length },
      jobId: ctx.jobId,
    },
  ]);
  return { status: "updated", costUsd: vectors.costUsd };
}
