import type { SupabaseClient } from "@supabase/supabase-js";
import { BRAIN_SOURCES_BUCKET } from "../ingest/bucket.ts";
import { failIngestSourceOfDeadJob } from "../ingest/dead-job.ts";
import type { LoopHandler } from "../worker.server";

/** Search log after 180 days, chat threads after 24 months without activity. */
export const RETRIEVAL_EVENTS_DAYS = 180;
export const THREAD_MONTHS = 24;
/** Deleted tasks keep their dedupe key; their text and answer go after 30 days (harden). */
export const DELETED_TASK_DAYS = 30;

/** An upload that was requested but never finished (a closed tab) is removed after a day. */
export const ABANDONED_UPLOAD_HOURS = 24;

/**
 * A finished upload that nobody approved (a card closed before "Læs ind") is removed after
 * this many days: its row and file would otherwise stay for ever, without a price approved.
 */
export const UNAPPROVED_UPLOAD_DAYS = 7;

/**
 * A running job whose lease ran out this long ago has no worker left: a live worker renews its
 * 15-minute lease, and a lost queue message would have been redelivered long before.
 */
export const ABANDONED_JOB_HOURS = 1;

const DAY = 24 * 60 * 60 * 1000;

/**
 * Jobs no worker holds any more: still "running", but the lease ran out before `before`
 * and no queue message came to take them over (a script run that died, a laptop that slept), so
 * the status would say "running" for ever. They become failed. A message that still comes takes
 * a failed job over just like an expired running one (brain_claim_job), so nothing is lost. The
 * update is guarded by the old lease, so a job taken over meanwhile keeps running. An INGEST job's
 * source is failed too, so the user can retry it, as when a job dies on its last attempt, unless
 * another run holds the source now.
 */
export async function failAbandonedJobs(
  service: SupabaseClient,
  fundId: string,
  before: Date,
  now: Date,
): Promise<number> {
  const { data, error } = await service
    .from("brain_jobs")
    .update({
      status: "failed",
      finished_at: now.toISOString(),
      stats: { error: "Abandoned: the lease ran out and no worker took the job over." },
    })
    .eq("fund_id", fundId)
    .eq("status", "running")
    .lt("lease_until", before.toISOString())
    .select("id, loop, key");
  if (error) throw new Error(`abandoned jobs: ${error.message}`);
  for (const job of data ?? []) {
    if (job["loop"] === "INGEST") {
      // A newer run (a continuation or a retry) that holds the source keeps it.
      await failIngestSourceOfDeadJob(
        service,
        fundId,
        job["key"] as string,
        job["id"] as string,
        now,
      );
    }
  }
  return data?.length ?? 0;
}

/** Rows and files of uploads that never finished. Never throws for one bad file: it is counted. */
export function removeAbandonedUploads(
  service: SupabaseClient,
  fundId: string,
  before: Date,
): Promise<{ removed: number; failed: number }> {
  return removeUploadsWhereNull(service, fundId, before, "upload_completed_at");
}

/** Rows and files of uploads that were never approved; same guards as above. */
export function removeUnapprovedUploads(
  service: SupabaseClient,
  fundId: string,
  before: Date,
): Promise<{ removed: number; failed: number }> {
  return removeUploadsWhereNull(service, fundId, before, "approved_at", true);
}

/**
 * Only an upload that never started (waiting, or refused at upload) is removed: a read-in source
 * can lack both timestamps, like the demo fund's seeded reports, and must never go.
 */
const NOT_STARTED = ["queued", "failed"];

async function removeUploadsWhereNull(
  service: SupabaseClient,
  fundId: string,
  before: Date,
  column: "upload_completed_at" | "approved_at",
  /** A website's confirmed portfolio (historical decisions) hangs on its source without a price. */
  exceptWebsites = false,
): Promise<{ removed: number; failed: number }> {
  let query = service
    .from("brain_sources")
    .select("id, storage_path")
    .eq("fund_id", fundId)
    .is(column, null)
    .in("status", NOT_STARTED)
    .lt("created_at", before.toISOString());
  if (exceptWebsites) query = query.neq("kind", "website");
  const { data, error } = await query.limit(200);
  if (error) throw new Error(`abandoned uploads: ${error.message}`);
  let removed = 0;
  let failed = 0;
  for (const row of data ?? []) {
    // The row goes first, guarded: an upload that finished (or was approved) in the meantime keeps
    // its row, and its file is never touched. Only a row that was really deleted has its file removed.
    let deletion = service
      .from("brain_sources")
      .delete()
      .eq("id", row["id"] as string)
      .eq("fund_id", fundId)
      .is(column, null)
      .in("status", NOT_STARTED);
    if (exceptWebsites) deletion = deletion.neq("kind", "website");
    const { data: deleted, error: deleteError } = await deletion.select("id");
    if (deleteError) {
      failed += 1;
      continue;
    }
    if (!deleted || deleted.length === 0) continue;
    removed += 1;
    const path = row["storage_path"] as string | null;
    if (path) {
      const { error: storageError } = await service.storage
        .from(BRAIN_SOURCES_BUCKET)
        .remove([path]);
      // A file that was never uploaded is fine; another failure is counted (the file is orphaned).
      if (storageError && !/not found|does not exist/i.test(storageError.message)) failed += 1;
    }
  }
  return { removed, failed };
}

/**
 * RETENTION: deletes old rows and closes abandoned jobs; no model call, 0 kr. Runs once a day per
 * fund (cron key = the date). The database functions refuse cut-offs that are too recent.
 */
export const retentionLoop: LoopHandler = async (ctx) => {
  const now = ctx.now.getTime();
  const eventsBefore = new Date(now - RETRIEVAL_EVENTS_DAYS * DAY).toISOString();
  const threadsBefore = new Date(now - THREAD_MONTHS * 30 * DAY).toISOString();
  const tasksBefore = new Date(now - DELETED_TASK_DAYS * DAY).toISOString();

  const { data: deleted, error } = await ctx.service.rpc("brain_retention", {
    _fund_id: ctx.fundId,
    _events_before: eventsBefore,
    _threads_before: threadsBefore,
  });
  if (error) throw new Error(`brain_retention: ${error.message}`);
  const { data: purged, error: purgeError } = await ctx.service.rpc("brain_purge_deleted_tasks", {
    _fund_id: ctx.fundId,
    _deleted_before: tasksBefore,
  });
  if (purgeError) throw new Error(`brain_purge_deleted_tasks: ${purgeError.message}`);

  const abandoned = await removeAbandonedUploads(
    ctx.service,
    ctx.fundId,
    new Date(now - ABANDONED_UPLOAD_HOURS * 60 * 60 * 1000),
  );

  const unapproved = await removeUnapprovedUploads(
    ctx.service,
    ctx.fundId,
    new Date(now - UNAPPROVED_UPLOAD_DAYS * DAY),
  );

  const abandonedJobs = await failAbandonedJobs(
    ctx.service,
    ctx.fundId,
    new Date(now - ABANDONED_JOB_HOURS * 60 * 60 * 1000),
    ctx.now,
  );

  const stats = {
    ...((deleted ?? {}) as Record<string, number>),
    purgedTasks: Number(purged ?? 0),
    abandonedUploads: abandoned.removed,
    abandonedFailed: abandoned.failed,
    unapprovedUploads: unapproved.removed,
    unapprovedFailed: unapproved.failed,
    abandonedJobs,
  };
  await ctx.recordStep("retention", stats);
  return { status: "done", stats };
};
