/**
 * The Brain worker: one queue message = one loop run for one fund and key. Every run
 * takes its job row in one statement (brain_claim_job, lease + attempt as fencing token), stores
 * each finished step before the message is acknowledged, reserves budget before any model call,
 * and ends with done / skipped / budget_reached / failed. Loops that are not built yet are
 * acknowledged without a job row (gap C §4.7), so they can run as soon as they exist.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { aiPolicyBlockedText } from "@/lib/ai/gateway-options";
import { isPermanentPolicyStop } from "@/lib/ai/model-call";
import { getServiceClient } from "@/lib/supabase/admin.server";
import { budgetMonthKey } from "./budget";
import { BrainBudgetReachedError, BrainLeaseLostError } from "./errors";
import { isBrainEnabled } from "./flags";
import {
  interpretClaim,
  JOB_LEASE_SECONDS,
  MAX_JOB_ATTEMPTS,
  parseBrainQueueMessage,
  safeErrorText,
  shouldRunLoop,
  type BrainClaimRow,
  type BrainFundSwitches,
  type BrainJobStatus,
  type BrainLoop,
  type BrainQueueMessage,
  type BudgetScope,
} from "./jobs";
import { backfillLoop } from "./loops/backfill";
import { captureLoop } from "./loops/capture";
import { extractLoop } from "./loops/extract";
import { failIngestSourceOfDeadJob, ingestLoop } from "./loops/ingest";
import { nightlyLoop } from "./loops/nightly";
import { reflectLoop } from "./loops/reflect";
import { retentionLoop } from "./loops/retention";
import { withFundLanguage } from "@/lib/i18n/language-scope.server";
import { serverText } from "@/lib/i18n/server-text";

export interface LoopContext {
  service: SupabaseClient;
  fundId: string;
  loop: BrainLoop;
  key: string;
  step?: string | undefined;
  jobId: string;
  attempt: number;
  now: Date;
  /** Stores a finished step; false when it already existed. Throws when the lease was lost. */
  recordStep(step: string, output: unknown, costUsd?: number): Promise<boolean>;
  /** Long steps extend their lease. Throws when the lease was lost. */
  extendLease(seconds?: number): Promise<void>;
  /** Reserves the maximum price of one model call; throws BrainBudgetReachedError at the limit. */
  reserve(
    scope: BudgetScope,
    maxUsd: number,
    meta?: { model?: string; refId?: string },
  ): Promise<number>;
  finalize(
    usageId: number,
    costUsd: number,
    tokens?: { input?: number; output?: number },
  ): Promise<void>;
  release(usageId: number): Promise<void>;
}

export interface LoopResult {
  status: "done" | "skipped";
  stats: Record<string, unknown>;
}
export type LoopHandler = (ctx: LoopContext) => Promise<LoopResult>;

/** The loops that exist. The rest (L3, L5 … L8, WATCH) come in later tickets. */
const HANDLERS: Partial<Record<BrainLoop, LoopHandler>> = {
  L0_capture: captureLoop,
  L1_extract: extractLoop,
  L2_reflect: reflectLoop,
  INGEST: ingestLoop,
  BACKFILL: backfillLoop,
  RETENTION: retentionLoop,
  L4_nightly: nightlyLoop,
};

/** Whether a loop has a handler yet; the others are acknowledged as "not_built". */
export function isBrainLoopBuilt(loop: BrainLoop): boolean {
  return HANDLERS[loop] !== undefined;
}

export type BrainDelivery = { action: "ack"; reason: string } | { action: "retry"; reason: string };

export async function processBrainMessage(raw: unknown, now = new Date()): Promise<BrainDelivery> {
  if (!isBrainEnabled()) return { action: "ack", reason: "disabled" };
  const message = parseBrainQueueMessage(raw);
  if (!message) {
    console.error("[brain] invalid queue message");
    return { action: "ack", reason: "invalid" };
  }
  const handler = HANDLERS[message.loop];
  if (!handler) return { action: "ack", reason: "not_built" };

  const service = getServiceClient();
  const switches = await loadSwitches(service, message.fundId);
  if (!switches) return { action: "ack", reason: "unknown_fund" };
  const gate = shouldRunLoop(message, switches);
  if (!gate.run) return { action: "ack", reason: gate.reason };
  // What the run stores for people (source notes, insights, page sections) is in the fund's
  // language; prompts stay as they are.
  return withFundLanguage(service, message.fundId, () =>
    runBrainMessage(service, handler, message, now),
  );
}

async function runBrainMessage(
  service: SupabaseClient,
  handler: LoopHandler,
  message: BrainQueueMessage,
  now: Date,
): Promise<BrainDelivery> {
  const decision = interpretClaim(await claimJob(service, message));
  if (decision.action === "ack") return { action: "ack", reason: decision.reason };
  if (decision.action === "retry_later") return { action: "retry", reason: "busy" };
  if (decision.action === "exhaust") {
    await finishJob(service, message.fundId, decision.jobId, decision.attempt, "failed", {
      error: "The lease expired on the last attempt.",
    });
    await jobFailedInsight(service, message);
    if (message.loop === "INGEST")
      await failIngestSourceOfDeadJob(service, message.fundId, message.key, decision.jobId);
    return { action: "ack", reason: "exhausted" };
  }

  const ctx = loopContext(service, message, decision.jobId, decision.attempt, now);
  try {
    const result = await handler(ctx);
    const finished = await finishJob(
      service,
      message.fundId,
      decision.jobId,
      decision.attempt,
      result.status,
      result.stats,
    );
    if (!finished) console.warn(`[brain] ${message.loop}: job ${decision.jobId} was taken over`);
    return { action: "ack", reason: result.status };
  } catch (cause) {
    if (cause instanceof BrainLeaseLostError) return { action: "ack", reason: "lease_lost" };
    if (cause instanceof BrainBudgetReachedError) {
      await finishJob(service, message.fundId, decision.jobId, decision.attempt, "budget_reached", {
        scope: cause.scope,
      });
      await budgetReachedInsight(service, message.fundId, cause.scope, now);
      return { action: "ack", reason: "budget_reached" };
    }
    const error = safeErrorText(cause);
    console.error(`[brain] ${message.loop} ${message.fundId}: ${error}`);
    await finishJob(service, message.fundId, decision.jobId, decision.attempt, "failed", { error });
    // A call stopped by the data rules fails the same way on every attempt; a masking
    // dictionary that could not be loaded is retried.
    const blocked = isPermanentPolicyStop(cause);
    if (decision.attempt >= MAX_JOB_ATTEMPTS || blocked) {
      await jobFailedInsight(service, message, blocked);
      if (message.loop === "INGEST")
        await failIngestSourceOfDeadJob(service, message.fundId, message.key, decision.jobId);
      return { action: "ack", reason: "failed" };
    }
    return { action: "retry", reason: "failed" };
  }
}

async function loadSwitches(
  service: SupabaseClient,
  fundId: string,
): Promise<BrainFundSwitches | null> {
  const { data, error } = await service
    .from("brain_fund_settings")
    .select("learning_enabled, watch_enabled")
    .eq("fund_id", fundId)
    .maybeSingle();
  if (error) throw new Error(`brain_fund_settings: ${error.message}`);
  if (data) {
    return {
      learningEnabled: data["learning_enabled"] === true,
      watchEnabled: data["watch_enabled"] === true,
    };
  }
  // No settings row: the fund is gone, or its defaults were never created (0040 heals that on
  // the first reservation). Defaults apply only to a fund that exists.
  const { data: fund, error: fundError } = await service
    .from("funds")
    .select("id")
    .eq("id", fundId)
    .maybeSingle();
  if (fundError) throw new Error(`funds: ${fundError.message}`);
  return fund ? { learningEnabled: true, watchEnabled: false } : null;
}

async function claimJob(
  service: SupabaseClient,
  message: BrainQueueMessage,
): Promise<BrainClaimRow> {
  const { data, error } = await service.rpc("brain_claim_job", {
    _fund_id: message.fundId,
    _loop: message.loop,
    _key: message.key,
    _lease_seconds: JOB_LEASE_SECONDS,
    _max_attempts: MAX_JOB_ATTEMPTS,
  });
  const row = (Array.isArray(data) ? data[0] : data) as {
    job_id: string;
    claimed: boolean;
    status: BrainJobStatus;
    attempts: number;
    lease_until: string;
    db_now: string;
  } | null;
  if (error || !row) throw new Error(`brain_claim_job: ${error?.message ?? "no row"}`);
  return {
    jobId: row.job_id,
    claimed: row.claimed,
    status: row.status,
    attempts: row.attempts,
    leaseUntil: new Date(row.lease_until),
    dbNow: new Date(row.db_now),
  };
}

async function finishJob(
  service: SupabaseClient,
  fundId: string,
  jobId: string,
  attempt: number,
  status: Exclude<BrainJobStatus, "running">,
  stats: Record<string, unknown>,
): Promise<boolean> {
  const { data, error } = await service.rpc("brain_finish_job", {
    _job_id: jobId,
    _fund_id: fundId,
    _attempt: attempt,
    _status: status,
    _stats: stats,
  });
  if (error) throw new Error(`brain_finish_job: ${error.message}`);
  return data === true;
}

function loopContext(
  service: SupabaseClient,
  message: BrainQueueMessage,
  jobId: string,
  attempt: number,
  now: Date,
): LoopContext {
  const { fundId, loop } = message;
  return {
    service,
    fundId,
    loop,
    key: message.key,
    step: message.step,
    jobId,
    attempt,
    now,
    async recordStep(step, output, costUsd = 0) {
      const { data, error } = await service.rpc("brain_record_job_step", {
        _job_id: jobId,
        _fund_id: fundId,
        _attempt: attempt,
        _step: step,
        _output: output ?? null,
        _cost_usd: costUsd,
      });
      if (error) throw new Error(`brain_record_job_step: ${error.message}`);
      if (data === true) return true;
      // false: the step already existed, or the lease was lost. Only the latter stops the run.
      await assertLease(service, fundId, jobId, attempt);
      return false;
    },
    async extendLease(seconds = JOB_LEASE_SECONDS) {
      const { data, error } = await service.rpc("brain_extend_job_lease", {
        _job_id: jobId,
        _fund_id: fundId,
        _attempt: attempt,
        _lease_seconds: seconds,
      });
      if (error) throw new Error(`brain_extend_job_lease: ${error.message}`);
      if (!data) throw new BrainLeaseLostError(jobId);
    },
    async reserve(scope, maxUsd, meta = {}) {
      const { data, error } = await service.rpc("brain_reserve_budget", {
        _fund_id: fundId,
        _scope: scope,
        _max_usd: maxUsd,
        _loop: loop,
        _ref_id: meta.refId ?? null,
        _model: meta.model ?? null,
      });
      if (error) throw new Error(`brain_reserve_budget: ${error.message}`);
      if (data === null || data === undefined) throw new BrainBudgetReachedError(scope);
      return Number(data);
    },
    async finalize(usageId, costUsd, tokens = {}) {
      const { error } = await service.rpc("brain_finalize_usage", {
        _usage_id: usageId,
        _fund_id: fundId,
        _cost_usd: costUsd,
        _input_tokens: tokens.input ?? null,
        _output_tokens: tokens.output ?? null,
      });
      if (error) throw new Error(`brain_finalize_usage: ${error.message}`);
    },
    async release(usageId) {
      const { error } = await service.rpc("brain_release_usage", {
        _usage_id: usageId,
        _fund_id: fundId,
      });
      if (error) throw new Error(`brain_release_usage: ${error.message}`);
    },
  };
}

async function assertLease(
  service: SupabaseClient,
  fundId: string,
  jobId: string,
  attempt: number,
): Promise<void> {
  const { data, error } = await service
    .from("brain_jobs")
    .select("attempts, status")
    .eq("id", jobId)
    .eq("fund_id", fundId)
    .maybeSingle();
  if (error) throw new Error(`brain_jobs: ${error.message}`);
  if (!data || data["attempts"] !== attempt || data["status"] !== "running") {
    throw new BrainLeaseLostError(jobId);
  }
}

/** One insight per fund, scope and month (dedupe key), for Admin only (0043 policy). */
async function budgetReachedInsight(
  service: SupabaseClient,
  fundId: string,
  scope: BudgetScope,
  now: Date,
): Promise<void> {
  await insertInsight(service, {
    fund_id: fundId,
    kind: "budget_reached",
    title: serverText("brainServer.worker.budgetTitle"),
    body_md: serverText("brainServer.worker.budgetBody", { scope }),
    priority: 1,
    created_by_loop: "system",
    dedupe_key: `budget_reached:${scope}:${budgetMonthKey(now)}`,
  });
}

async function jobFailedInsight(
  service: SupabaseClient,
  message: BrainQueueMessage,
  /** Stopped by the data rules: a retry would stop the same way, so none is promised. */
  blocked = false,
): Promise<void> {
  await insertInsight(service, {
    fund_id: message.fundId,
    kind: "job_failed",
    title: serverText("brainServer.worker.failedTitle"),
    body_md: serverText(
      blocked
        ? "brainServer.worker.blocked"
        : message.loop === "BACKFILL"
          ? "brainServer.worker.backfill"
          : message.loop === "L4_nightly"
            ? "brainServer.worker.nightly"
            : message.loop === "L2_reflect"
              ? "brainServer.worker.reflect"
              : "brainServer.worker.other",
      { loop: message.loop, key: message.key, reason: aiPolicyBlockedText() },
    ),
    priority: 2,
    created_by_loop: message.loop,
    dedupe_key: `job_failed:${message.loop}:${message.key}`.slice(0, 300),
  });
}

async function insertInsight(service: SupabaseClient, row: Record<string, unknown>): Promise<void> {
  const { error } = await service
    .from("brain_insights")
    .upsert(row, { onConflict: "fund_id,dedupe_key", ignoreDuplicates: true });
  // The job state is already saved; a missing insight is logged, never a reason to retry.
  if (error) console.error("[brain] insight", error.code, error.message);
}
