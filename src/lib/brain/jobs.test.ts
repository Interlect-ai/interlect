/** Brain job logic (migration 0043). Kør: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  brainIdempotencyKey,
  canTakeOver,
  interpretClaim,
  MAX_JOB_ATTEMPTS,
  parseBrainQueueMessage,
  safeErrorText,
  shouldRunLoop,
  type BrainClaimRow,
} from "./jobs.ts";

const FUND = "a0000000-0000-4000-8000-00000000000a";
const now = new Date("2026-09-30T10:00:00Z");
const row = (patch: Partial<BrainClaimRow>): BrainClaimRow => ({
  jobId: "j1",
  claimed: false,
  status: "running",
  attempts: 1,
  leaseUntil: new Date(now.getTime() + 60_000),
  dbNow: now,
  ...patch,
});

test("a queue message is validated strictly; the fund id never comes from elsewhere", () => {
  assert.deepEqual(parseBrainQueueMessage({ fundId: FUND, loop: "RETENTION", key: "2026-09-30" }), {
    fundId: FUND,
    loop: "RETENTION",
    key: "2026-09-30",
  });
  assert.equal(parseBrainQueueMessage({ fundId: "nope", loop: "RETENTION", key: "x" }), null);
  assert.equal(parseBrainQueueMessage({ fundId: FUND, loop: "L9", key: "x" }), null);
  assert.equal(parseBrainQueueMessage({ fundId: FUND, loop: "L0_capture", key: "a b" }), null);
  assert.equal(
    parseBrainQueueMessage({ fundId: FUND, loop: "L0_capture", key: "x", extra: 1 }),
    null,
  );
});

test("the idempotency key is stable, and long keys are hashed", () => {
  const message = { fundId: FUND, loop: "L4_nightly" as const, key: "2026-09-30" };
  assert.equal(brainIdempotencyKey(message), `brain:L4_nightly:${FUND}:2026-09-30:-`);
  const long = brainIdempotencyKey({ ...message, key: "k".repeat(190) });
  assert.ok(long.length <= 200 && long.includes(":sha256:"));
  assert.equal(long, brainIdempotencyKey({ ...message, key: "k".repeat(190) }));
});

test("learning off stops learning loops, but not a user's own upload, ingest or retention", () => {
  const off = { learningEnabled: false, watchEnabled: false };
  const msg = (loop: Parameters<typeof shouldRunLoop>[0]["loop"], key = "x") => ({
    fundId: FUND,
    loop,
    key,
  });
  assert.deepEqual(shouldRunLoop(msg("L4_nightly"), off), {
    run: false,
    reason: "learning_disabled",
  });
  assert.deepEqual(shouldRunLoop(msg("L0_capture", "upload:src-1"), off), { run: true });
  assert.deepEqual(shouldRunLoop(msg("INGEST"), off), { run: true });
  assert.deepEqual(shouldRunLoop(msg("RETENTION"), off), { run: true });
  assert.deepEqual(shouldRunLoop(msg("WATCH"), off), { run: false, reason: "watch_disabled" });
});

test("a claim decides run, acknowledge, retry later or exhaust (02 §3 rule 1)", () => {
  assert.deepEqual(interpretClaim(row({ claimed: true, attempts: 2 })), {
    action: "run",
    jobId: "j1",
    attempt: 2,
  });
  assert.equal(interpretClaim(row({ status: "done" })).action, "ack");
  assert.equal(interpretClaim(row({ status: "budget_reached" })).action, "ack");
  assert.equal(interpretClaim(row({ status: "running" })).action, "retry_later");
  assert.equal(
    interpretClaim(row({ status: "running", leaseUntil: new Date(now.getTime() - 1000) })).action,
    "exhaust",
  );
  assert.deepEqual(interpretClaim(row({ status: "failed", attempts: MAX_JOB_ATTEMPTS })), {
    action: "ack",
    jobId: "j1",
    reason: "exhausted",
  });
});

test("takeover mirrors the SQL rule: running or failed, lease expired, attempts left", () => {
  const expired = new Date(now.getTime() - 1);
  assert.equal(canTakeOver({ status: "running", leaseUntil: expired, attempts: 1 }, now), true);
  assert.equal(canTakeOver({ status: "failed", leaseUntil: expired, attempts: 4 }, now), true);
  assert.equal(canTakeOver({ status: "failed", leaseUntil: expired, attempts: 5 }, now), false);
  assert.equal(canTakeOver({ status: "done", leaseUntil: expired, attempts: 1 }, now), false);
  assert.equal(canTakeOver({ status: "running", leaseUntil: now, attempts: 1 }, now), false);
});

test("error text stored on a job hides URLs and secrets", () => {
  const text = safeErrorText(new Error("fetch https://x.test/a?token=abc failed; key=sk-123"));
  assert.ok(!text.includes("https://") && !text.includes("sk-123") && !text.includes("abc"));
});
