import { test } from "node:test";
import assert from "node:assert/strict";
import {
  acceptanceBlockedBy,
  adminNamesOnly,
  emailSchema,
  EMAIL_PATTERN,
  isSelfChange,
  mfaResetBlockedByOtherTeams,
  needsAdminRollback,
  overSeatLimitAfterInsert,
  passwordResetUsable,
  passwordSchema,
  pendingInvitationCapReached,
  refuseForeignMembership,
  singleRoleSchema,
  undoStillValid,
} from "./guards.ts";

test("single-role cap: exactly one valid role", () => {
  assert.ok(singleRoleSchema.safeParse(["lead"]).success);
  assert.ok(!singleRoleSchema.safeParse([]).success);
  assert.ok(!singleRoleSchema.safeParse(["lead", "member"]).success);
  assert.ok(!singleRoleSchema.safeParse(["administrator"]).success);
});

test("e-mail is trimmed before validation; client pattern agrees", () => {
  assert.equal(emailSchema.parse("  maja@fond.dk "), "maja@fond.dk");
  assert.ok(!emailSchema.safeParse("maja@").success);
  assert.ok(EMAIL_PATTERN.test("maja@fond.dk"));
  assert.ok(!EMAIL_PATTERN.test("maja@fond"));
  assert.ok(!EMAIL_PATTERN.test("ma ja@fond.dk"));
});

test("admin rollback: zero active admins after the change means roll back", () => {
  assert.equal(needsAdminRollback(0), true);
  assert.equal(needsAdminRollback(1), false);
  assert.equal(needsAdminRollback(2), false);
});

test("cross-fund membership id is refused as 'unknown', own fund passes", () => {
  assert.equal(refuseForeignMembership("fund-b", "fund-a"), "unknown");
  assert.equal(refuseForeignMembership(null, "fund-a"), "unknown");
  assert.equal(refuseForeignMembership(undefined, "fund-a"), "unknown");
  assert.equal(refuseForeignMembership("fund-a", "fund-a"), null);
});

test("self change is detected", () => {
  assert.equal(isSelfChange("u1", "u1"), true);
  assert.equal(isSelfChange("u2", "u1"), false);
});

test("a deactivated member cannot be reactivated by an old invitation", () => {
  assert.equal(acceptanceBlockedBy("deactivated"), true);
  assert.equal(acceptanceBlockedBy("active"), false);
  assert.equal(acceptanceBlockedBy(null), false);
});

test("pending invitation cap", () => {
  assert.equal(pendingInvitationCapReached(49), false);
  assert.equal(pendingInvitationCapReached(50), true);
});

test("seat race after insert: over the limit only with a limit and a new person", () => {
  const usage = { seatsUsed: 9, seatLimit: 8, readersUsed: 2, readerLimit: null };
  assert.equal(overSeatLimitAfterInsert(usage, ["member"], false), true);
  assert.equal(overSeatLimitAfterInsert(usage, ["member"], true), false);
  assert.equal(overSeatLimitAfterInsert(usage, ["reader"], false), false);
  assert.equal(overSeatLimitAfterInsert({ ...usage, seatLimit: null }, ["member"], false), false);
  assert.equal(
    overSeatLimitAfterInsert({ ...usage, readersUsed: 6, readerLimit: 5 }, ["reader"], false),
    true,
  );
});

test("getFundAdminNames payload is names only", () => {
  const names = adminNamesOnly([
    { full_name: " Sofie Lind " },
    { full_name: null },
    { full_name: "  " },
    { full_name: "Maja Holm" },
  ]);
  assert.deepEqual(names, ["Maja Holm", "Sofie Lind"]);
  assert.ok(names.every((name) => typeof name === "string" && !name.includes("@")));
});

test("undoStillValid: refuses when the person changed meanwhile", () => {
  const now = { roles: ["lead"], status: "active" };
  assert.equal(undoStillValid(now, { roles: ["lead"] }), true);
  assert.equal(undoStillValid(now, { roles: ["member"] }), false);
  assert.equal(undoStillValid(now, { status: "active" }), true);
  assert.equal(undoStillValid({ ...now, status: "deactivated" }, { status: "active" }), false);
  assert.equal(undoStillValid(undefined, { status: "active" }), false);
});

test("MFA reset: refused when the person is in another team the caller does not administer", () => {
  assert.equal(mfaResetBlockedByOtherTeams([], []), false);
  assert.equal(mfaResetBlockedByOtherTeams(["f2"], ["f2", "f3"]), false);
  assert.equal(mfaResetBlockedByOtherTeams(["f2", "f4"], ["f2"]), true);
  assert.equal(mfaResetBlockedByOtherTeams(["f2"], []), true);
});

test("password link: usable until it is used, revoked or expired", () => {
  const now = new Date("2026-10-21T12:00:00Z");
  const open = { used_at: null, revoked_at: null, expires_at: "2026-10-23T12:00:00Z" };
  assert.equal(passwordResetUsable(open, now), true);
  assert.equal(passwordResetUsable({ ...open, used_at: "2026-10-21T11:00:00Z" }, now), false);
  assert.equal(passwordResetUsable({ ...open, revoked_at: "2026-10-21T11:00:00Z" }, now), false);
  assert.equal(passwordResetUsable({ ...open, expires_at: "2026-10-21T12:00:00Z" }, now), false);
  assert.equal(passwordResetUsable({ ...open, expires_at: "2026-10-20T12:00:00Z" }, now), false);
});

test("password link: the new password needs at least 12 characters", () => {
  assert.ok(!passwordSchema.safeParse("elleve-tegn").success);
  assert.ok(passwordSchema.safeParse("tolv-tegn-ok").success);
  assert.ok(!passwordSchema.safeParse("x".repeat(201)).success);
});
