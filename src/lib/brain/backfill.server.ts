import type { SupabaseClient } from "@supabase/supabase-js";
import {
  backfillKey,
  backfillRunId,
  backfillStartedAt,
  backfillStopKey,
  estimateBackfill,
  type BackfillEstimate,
  type BackfillLevel,
} from "./backfill";
import { BrainUserError } from "./errors";
import { isBrainEnabled } from "./flags";
import { JOB_LEASE_SECONDS, MAX_JOB_ATTEMPTS } from "./jobs";
import { enqueueBrain } from "./queue.server";
import { isBrainLoopBuilt } from "./worker.server";
import { serverText } from "../i18n/server-text.ts";

/**
 * Server side of "Indlæs eksisterende cases i Brain", shared by the server functions
 * (brain_ingest, backfill.functions.ts) and the operator route (/api/brain/backfill). Callers
 * check access first; everything here runs with the service client and is fund-scoped.
 */

/** A page that has not moved for this long no longer counts as a running backfill. */
const ACTIVE_RUN_WINDOW_MS = 60 * 60 * 1000;

export type BackfillReadiness = BackfillEstimate & {
  /** L0 is a learning loop: with learning off for the fund, nothing would be captured. */
  learningEnabled: boolean;
  /** "Fuld forståelse" needs L1. */
  fullAvailable: boolean;
};

export async function estimateFundBackfill(
  service: SupabaseClient,
  fundId: string,
): Promise<BackfillReadiness> {
  const [cases, learningEnabled] = await Promise.all([
    countFundCases(service, fundId),
    isLearningEnabled(service, fundId),
  ]);
  return {
    ...estimateBackfill(cases),
    learningEnabled,
    fullAvailable: isBrainLoopBuilt("L1_extract"),
  };
}

export type BackfillStart = {
  runId: string;
  level: BackfillLevel;
  estimate: BackfillEstimate;
  /** true: a run was already going, and this is that run (nothing new was started). */
  alreadyRunning: boolean;
};

/**
 * Starts a run: refuses what would silently do nothing, returns a run that is still going instead
 * of starting a second one, calls `beforeEnqueue` (the audit, written first) and enqueues page 0.
 */
export async function startFundBackfill(
  service: SupabaseClient,
  fundId: string,
  level: BackfillLevel,
  beforeEnqueue: (start: BackfillStart) => Promise<void>,
  now = new Date(),
): Promise<BackfillStart> {
  if (!isBrainEnabled()) throw new BrainUserError(serverText("brainServer.common.notEnabled"));
  const readiness = await estimateFundBackfill(service, fundId);
  if (!readiness.learningEnabled) {
    throw new BrainUserError(serverText("brainServer.backfill.learningOff"));
  }
  if (level === "full" && !readiness.fullAvailable) {
    throw new BrainUserError(serverText("brainServer.backfill.fullNotReady"));
  }
  const { cases, search, full } = readiness;
  const estimate: BackfillEstimate = { cases, search, full };

  const running = await activeRun(service, fundId, now);
  if (running) return { ...running, estimate, alreadyRunning: true };

  const start: BackfillStart = {
    runId: backfillRunId(now),
    level,
    estimate,
    alreadyRunning: false,
  };
  await beforeEnqueue(start);
  await enqueueBrain({ fundId, loop: "BACKFILL", key: backfillKey(level, start.runId, 0) });
  return start;
}

/**
 * Stops a run: writes its stop row (a finished BACKFILL job). Later pages enqueue nothing, and
 * the run's L0 and L1 jobs that have not started yet skip themselves.
 */
export async function stopFundBackfill(
  service: SupabaseClient,
  fundId: string,
  level: BackfillLevel,
  runId: string,
): Promise<void> {
  const { data, error } = await service.rpc("brain_claim_job", {
    _fund_id: fundId,
    _loop: "BACKFILL",
    _key: backfillStopKey(level, runId),
    _lease_seconds: JOB_LEASE_SECONDS,
    _max_attempts: MAX_JOB_ATTEMPTS,
  });
  const row = (Array.isArray(data) ? data[0] : data) as {
    job_id: string;
    claimed: boolean;
    attempts: number;
  } | null;
  if (error || !row) throw new Error(`backfill stop: ${error?.message ?? "no row"}`);
  // Already stopped: the row exists, which is all the pages and L0 look for.
  if (!row.claimed) return;
  const { error: finishError } = await service.rpc("brain_finish_job", {
    _job_id: row.job_id,
    _fund_id: fundId,
    _attempt: row.attempts,
    _status: "skipped",
    _stats: { reason: "stopped_by_user" },
  });
  // The row exists either way, so the run is stopped; only its status text is off.
  if (finishError) console.error("[brain-backfill] stop row not finished", finishError.code);
}

export type BackfillProgress = {
  level: BackfillLevel;
  runId: string;
  stopped: boolean;
  /** Every page is enqueued (the last page had fewer than 20 cases). */
  pagesFinished: boolean;
  /** A page failed on its last attempt: the run halted and must be started again. */
  pagesFailed: number;
  casesQueued: number;
  captured: number;
  /** L0 jobs that failed but still have attempts left. */
  retrying: number;
  /** L0 jobs that failed on their last attempt. */
  failed: number;
  budgetReached: number;
  extracted: number;
};

/** Progress from the job rows of the run ("fremdriftsvisning"). */
export async function fundBackfillProgress(
  service: SupabaseClient,
  fundId: string,
  level: BackfillLevel,
  runId: string,
): Promise<BackfillProgress> {
  const startedAt = backfillStartedAt(runId);
  if (!startedAt) throw new BrainUserError(serverText("brainServer.backfill.invalidRun"));
  const { data: pages, error } = await service
    .from("brain_jobs")
    .select("key, status, attempts, stats")
    .eq("fund_id", fundId)
    .eq("loop", "BACKFILL")
    .like("key", `${level}:${runId}:%`);
  if (error) throw new Error(`backfill progress: ${error.message}`);

  let stopped = false;
  let pagesFinished = false;
  let pagesFailed = 0;
  let casesQueued = 0;
  for (const page of pages ?? []) {
    if ((page["key"] as string).endsWith(":stop")) {
      stopped = true;
      continue;
    }
    const stats = (page["stats"] ?? {}) as { cases?: unknown; last?: unknown };
    if (page["status"] === "done") {
      casesQueued += typeof stats.cases === "number" ? stats.cases : 0;
      if (stats.last === true) pagesFinished = true;
    } else if (page["status"] === "failed" && Number(page["attempts"]) >= MAX_JOB_ATTEMPTS) {
      pagesFailed += 1;
    }
  }

  const l0Keys = `${level}:%:${startedAt.toISOString()}`;
  const [captured, retrying, failed, budgetReached, extracted] = await Promise.all([
    countJobs(service, fundId, "L0_capture", l0Keys, ["done", "skipped"]),
    countJobs(service, fundId, "L0_capture", l0Keys, ["failed"], "retrying"),
    countJobs(service, fundId, "L0_capture", l0Keys, ["failed"], "exhausted"),
    countJobs(service, fundId, "L0_capture", l0Keys, ["budget_reached"]),
    level === "full"
      ? countJobs(service, fundId, "L1_extract", l0Keys, ["done", "skipped"])
      : Promise.resolve(0),
  ]);
  return {
    level,
    runId,
    stopped,
    pagesFinished,
    pagesFailed,
    casesQueued,
    captured,
    retrying,
    failed,
    budgetReached,
    extracted,
  };
}

async function countFundCases(service: SupabaseClient, fundId: string): Promise<number> {
  const { count, error } = await service
    .from("cases")
    .select("id", { count: "exact", head: true })
    .eq("fund_id", fundId);
  if (error) throw new Error(`backfill case count: ${error.message}`);
  return count ?? 0;
}

/** Same default as the worker: no settings row for an existing fund means learning is on. */
async function isLearningEnabled(service: SupabaseClient, fundId: string): Promise<boolean> {
  const { data, error } = await service
    .from("brain_fund_settings")
    .select("learning_enabled")
    .eq("fund_id", fundId)
    .maybeSingle();
  if (error) throw new Error(`brain_fund_settings: ${error.message}`);
  return data ? data["learning_enabled"] === true : true;
}

/**
 * The fund's newest run that is still going: not stopped, its last page not reached, no page
 * failed for good, and a page started within the last hour.
 */
async function activeRun(
  service: SupabaseClient,
  fundId: string,
  now: Date,
): Promise<{ runId: string; level: BackfillLevel } | null> {
  const since = new Date(now.getTime() - ACTIVE_RUN_WINDOW_MS).toISOString();
  const { data: recent, error } = await service
    .from("brain_jobs")
    .select("key")
    .eq("fund_id", fundId)
    .eq("loop", "BACKFILL")
    .gte("started_at", since)
    .order("started_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(`backfill active run: ${error.message}`);
  const newest = recent?.[0]?.["key"] as string | undefined;
  if (!newest) return null;
  const [level, runId] = newest.split(":") as [BackfillLevel, string];
  const progress = await fundBackfillProgress(service, fundId, level, runId);
  const over = progress.stopped || progress.pagesFinished || progress.pagesFailed > 0;
  return over ? null : { runId, level };
}

async function countJobs(
  service: SupabaseClient,
  fundId: string,
  loop: "L0_capture" | "L1_extract",
  keyPattern: string,
  statuses: string[],
  attempts?: "retrying" | "exhausted",
): Promise<number> {
  let query = service
    .from("brain_jobs")
    .select("id", { count: "exact", head: true })
    .eq("fund_id", fundId)
    .eq("loop", loop)
    .like("key", keyPattern)
    .in("status", statuses);
  if (attempts === "retrying") query = query.lt("attempts", MAX_JOB_ATTEMPTS);
  if (attempts === "exhausted") query = query.gte("attempts", MAX_JOB_ATTEMPTS);
  const { count, error } = await query;
  if (error) throw new Error(`backfill progress ${loop}: ${error.message}`);
  return count ?? 0;
}
