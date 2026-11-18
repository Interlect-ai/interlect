/**
 * Pure job logic for the Brain queue: message
 * format, idempotency keys, which loops may run, and how a claim result is interpreted.
 * No I/O here, so it is tested with node --test (jobs.test.ts). The SQL side lives in
 * migration 0043 (brain_claim_job, brain_finish_job, brain_record_job_step).
 */
import { createHash } from "node:crypto";
import { z } from "zod";

export const BRAIN_LOOPS = [
  "L0_capture",
  "L1_extract",
  "L2_reflect",
  "L3_outcome",
  "L4_nightly",
  "L5_weekly",
  "L7_eval",
  "L8_file_answer",
  "INGEST",
  "BACKFILL",
  "WATCH",
  "RETENTION",
] as const;
export type BrainLoop = (typeof BRAIN_LOOPS)[number];

export const BUDGET_SCOPES = ["learning", "watch", "chat", "ingest"] as const;
export type BudgetScope = (typeof BUDGET_SCOPES)[number];

/** A queue message. fundId always comes from the server, never from a model. */
export type BrainQueueMessage = {
  fundId: string;
  loop: BrainLoop;
  /** Idempotency within the loop, e.g. an episode id, an event id or "2026-09-25". */
  key: string;
  /** For multi-step loops (INGEST: extract|classify|chunk|embed|facts|link). */
  step?: string;
};

export const JOB_LEASE_SECONDS = 15 * 60;
export const MAX_JOB_ATTEMPTS = 5;
/** Keys starting with this prefix come from a user's own upload and ignore learning_enabled. */
export const UPLOAD_KEY_PREFIX = "upload:";

const messageSchema = z
  .object({
    fundId: z.guid(),
    loop: z.enum(BRAIN_LOOPS),
    key: z
      .string()
      .min(1)
      .max(200)
      .regex(/^[A-Za-z0-9:._\-+]+$/),
    step: z
      .string()
      .min(1)
      .max(60)
      .regex(/^[a-z0-9_]+$/)
      .optional(),
  })
  .strict();

/** Validates an untrusted queue payload. Returns null for anything malformed. */
export function parseBrainQueueMessage(raw: unknown): BrainQueueMessage | null {
  const parsed = messageSchema.safeParse(raw);
  if (!parsed.success) return null;
  const { fundId, loop, key, step } = parsed.data;
  return step === undefined ? { fundId, loop, key } : { fundId, loop, key, step };
}

/**
 * `brain:${loop}:${fundId}:${key}:${step?? "-"}`. A repeated send with the same
 * key is dropped by the queue; the job row's unique (fund_id, loop, key) catches the rest.
 * Very long keys are hashed so the queue header stays short.
 */
export function brainIdempotencyKey(message: BrainQueueMessage): string {
  const raw = `brain:${message.loop}:${message.fundId}:${message.key}:${message.step ?? "-"}`;
  if (raw.length <= 200) return raw;
  const digest = createHash("sha256").update(raw).digest("hex");
  return `brain:${message.loop}:${message.fundId}:sha256:${digest}`;
}

type LoopPolicy = {
  scope: BudgetScope;
  /** Which fund setting must be on; "none" = the user asked for it or it costs nothing. */
  gate: "learning" | "watch" | "none";
};

/** Loop -> budget scope and gate (rule 3). */
export const LOOP_POLICY: Record<BrainLoop, LoopPolicy> = {
  L0_capture: { scope: "learning", gate: "learning" },
  L1_extract: { scope: "learning", gate: "learning" },
  L2_reflect: { scope: "learning", gate: "learning" },
  L3_outcome: { scope: "learning", gate: "learning" },
  L4_nightly: { scope: "learning", gate: "learning" },
  L5_weekly: { scope: "learning", gate: "learning" },
  L7_eval: { scope: "learning", gate: "learning" },
  // "Gem i Brain" is an explicit click, so it runs even when learning is off.
  L8_file_answer: { scope: "learning", gate: "none" },
  INGEST: { scope: "ingest", gate: "none" },
  // "Indlæs eksisterende cases" is started by a user who has seen the price.
  BACKFILL: { scope: "learning", gate: "none" },
  WATCH: { scope: "watch", gate: "watch" },
  // Deletes old rows only; no model call, always allowed.
  RETENTION: { scope: "learning", gate: "none" },
};

export type BrainFundSwitches = { learningEnabled: boolean; watchEnabled: boolean };

export type LoopGate =
  { run: true } | { run: false; reason: "learning_disabled" | "watch_disabled" };

/**
 * learning_enabled = false stops the learning loops; L0/L1 for a user's own upload still
 * run (rule 3). WATCH needs watch_enabled.
 */
export function shouldRunLoop(message: BrainQueueMessage, switches: BrainFundSwitches): LoopGate {
  const { gate } = LOOP_POLICY[message.loop];
  if (gate === "watch" && !switches.watchEnabled) return { run: false, reason: "watch_disabled" };
  if (gate === "learning" && !switches.learningEnabled) {
    const fromUpload =
      (message.loop === "L0_capture" || message.loop === "L1_extract") &&
      message.key.startsWith(UPLOAD_KEY_PREFIX);
    if (!fromUpload) return { run: false, reason: "learning_disabled" };
  }
  return { run: true };
}

export type BrainJobStatus = "running" | "done" | "failed" | "budget_reached" | "skipped";

/** One row from public.brain_claim_job. dbNow comes from the database clock. */
export type BrainClaimRow = {
  jobId: string;
  claimed: boolean;
  status: BrainJobStatus;
  attempts: number;
  leaseUntil: Date;
  dbNow: Date;
};

export type BrainClaimDecision =
  | { action: "run"; jobId: string; attempt: number }
  | { action: "ack"; jobId: string; reason: "done" | "skipped" | "budget_reached" | "exhausted" }
  | { action: "retry_later"; jobId: string; delaySeconds: number }
  | { action: "exhaust"; jobId: string; attempt: number };

/**
 * Mirror of the WHERE clause in brain_claim_job: a job can be (re)taken when it is running
 * or failed, its lease has expired, and it has attempts left.
 */
export function canTakeOver(
  row: { status: BrainJobStatus; leaseUntil: Date; attempts: number },
  now: Date,
  maxAttempts = MAX_JOB_ATTEMPTS,
): boolean {
  return (
    (row.status === "running" || row.status === "failed") &&
    row.leaseUntil.getTime() < now.getTime() &&
    row.attempts < maxAttempts
  );
}

/**
 * What the worker does with a claim result (rule 1):
 *   claimed                       -> run the loop with this attempt number (fencing token)
 *   done / skipped / budget_reached -> acknowledge (0 new rows, 0 kr)
 *   running, lease not expired    -> give the message back to the queue (retry later)
 *   running, expired, no attempts -> mark failed + insight, then acknowledge
 *   failed, no attempts left      -> acknowledge
 */
export function interpretClaim(
  row: BrainClaimRow,
  maxAttempts = MAX_JOB_ATTEMPTS,
): BrainClaimDecision {
  if (row.claimed) return { action: "run", jobId: row.jobId, attempt: row.attempts };
  const leaseLeftSeconds = Math.ceil((row.leaseUntil.getTime() - row.dbNow.getTime()) / 1000);
  switch (row.status) {
    case "done":
    case "skipped":
    case "budget_reached":
      return { action: "ack", jobId: row.jobId, reason: row.status };
    case "failed":
      if (row.attempts >= maxAttempts) {
        return { action: "ack", jobId: row.jobId, reason: "exhausted" };
      }
      return {
        action: "retry_later",
        jobId: row.jobId,
        delaySeconds: retryDelay(leaseLeftSeconds),
      };
    case "running":
      if (leaseLeftSeconds > 0) {
        return {
          action: "retry_later",
          jobId: row.jobId,
          delaySeconds: retryDelay(leaseLeftSeconds),
        };
      }
      return { action: "exhaust", jobId: row.jobId, attempt: row.attempts };
  }
}

function retryDelay(leaseLeftSeconds: number): number {
  return Math.min(Math.max(leaseLeftSeconds, 30), JOB_LEASE_SECONDS);
}

/** Error text stored on a failed job: short, no stack, no secrets in URLs. */
export function safeErrorText(cause: unknown): string {
  const text = cause instanceof Error ? cause.message : String(cause);
  return text
    .replace(/https?:\/\/\S+/g, "[url]")
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[email]")
    .replace(/(key|token|secret|password)=\S+/gi, "$1=[hidden]")
    .slice(0, 500);
}
