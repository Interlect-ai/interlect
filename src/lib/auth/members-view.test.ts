import { test } from "node:test";
import assert from "node:assert/strict";
import {
  activeAdmins,
  duplicatePendingEmails,
  existingMemberFor,
  extraRoleCount,
  filterMembers,
  initials,
  invitationStatus,
  joinNames,
  memberLockReason,
  primaryRole,
  type InvitationLike,
  type MemberLike,
} from "./members-view.ts";

const member = (
  id: string,
  email: string,
  roles: MemberLike["roles"],
  status: MemberLike["status"] = "active",
  fullName: string | null = null,
): MemberLike => ({ membershipId: `m-${id}`, userId: `u-${id}`, email, fullName, status, roles });

const MEMBERS = [
  member("1", "maja@nordhav.vc", ["admin"], "active", "Maja Holm"),
  member("2", "jonas@nordhav.vc", ["member"], "active", "Jonas Berg"),
  member("3", "sofie@nordhav.vc", ["lead", "member"], "active", "Sofie Lind"),
  member("4", "line@lp-partner.dk", ["reader"], "active", "Line Vestergaard"),
  member("5", "mikkel@nordhav.vc", ["member"], "deactivated", null),
];

test("primaryRole: the highest role; extraRoleCount counts the rest", () => {
  assert.equal(primaryRole(["member", "lead"]), "lead");
  assert.equal(primaryRole(["reader", "admin"]), "admin");
  assert.equal(primaryRole([]), "reader");
  assert.equal(extraRoleCount(["member", "lead"]), 1);
  assert.equal(extraRoleCount(["member"]), 0);
});

test("filterMembers: search on name or e-mail, role filter on the shown role", () => {
  assert.equal(filterMembers(MEMBERS, "", "all").length, 5);
  assert.deepEqual(
    filterMembers(MEMBERS, "  HOLM ", "all").map((m) => m.membershipId),
    ["m-1"],
  );
  assert.deepEqual(
    filterMembers(MEMBERS, "lp-partner", "all").map((m) => m.membershipId),
    ["m-4"],
  );
  // Sofie holds lead + member and shows as Lead, so she is not under Medlem.
  assert.deepEqual(
    filterMembers(MEMBERS, "", "member").map((m) => m.membershipId),
    ["m-2", "m-5"],
  );
  assert.deepEqual(
    filterMembers(MEMBERS, "", "lead").map((m) => m.membershipId),
    ["m-3"],
  );
  assert.equal(filterMembers(MEMBERS, "findes ikke", "all").length, 0);
});

test("invitationStatus: accepted, revoked, expired, pending", () => {
  const now = Date.parse("2026-10-01T12:00:00Z");
  const base: InvitationLike = {
    id: "i",
    email: "a@b.dk",
    roles: ["member"],
    expiresAt: "2026-10-05T00:00:00Z",
    acceptedAt: null,
    revokedAt: null,
  };
  assert.equal(invitationStatus(base, now), "pending");
  assert.equal(invitationStatus({ ...base, expiresAt: "2026-09-30T00:00:00Z" }, now), "expired");
  assert.equal(invitationStatus({ ...base, revokedAt: "2026-10-01T00:00:00Z" }, now), "revoked");
  assert.equal(invitationStatus({ ...base, acceptedAt: "2026-10-01T00:00:00Z" }, now), "accepted");
  // Accepted wins over a later revoke or expiry.
  assert.equal(
    invitationStatus(
      { ...base, acceptedAt: "x", revokedAt: "y", expiresAt: "2026-01-01T00:00:00Z" },
      now,
    ),
    "accepted",
  );
});

test("duplicatePendingEmails: only pending invitations to the same address", () => {
  const now = Date.parse("2026-10-01T00:00:00Z");
  const inv = (id: string, email: string, extra: Partial<InvitationLike> = {}): InvitationLike => ({
    id,
    email,
    roles: ["member"],
    expiresAt: "2026-10-05T00:00:00Z",
    acceptedAt: null,
    revokedAt: null,
    ...extra,
  });
  const dupes = duplicatePendingEmails(
    [
      inv("1", "a@b.dk"),
      inv("2", "A@b.dk"),
      inv("3", "c@b.dk"),
      inv("4", "c@b.dk", { revokedAt: "2026-09-30T00:00:00Z" }),
    ],
    now,
  );
  assert.deepEqual([...dupes], ["a@b.dk"]);
});

test("existingMemberFor: also finds a deactivated member, ignores case and blanks", () => {
  assert.equal(existingMemberFor(MEMBERS, "MIKKEL@nordhav.vc")?.membershipId, "m-5");
  assert.equal(existingMemberFor(MEMBERS, "  "), undefined);
  assert.equal(existingMemberFor(MEMBERS, "ny@nordhav.vc"), undefined);
});

test("memberLockReason: own row and the last active admin are locked", () => {
  assert.equal(memberLockReason(MEMBERS[0]!, MEMBERS, "u-1"), "self");
  assert.equal(memberLockReason(MEMBERS[0]!, MEMBERS, "u-2"), "last_admin");
  assert.equal(memberLockReason(MEMBERS[1]!, MEMBERS, "u-1"), null);
  // Two active admins: neither is "the last", but a deactivated admin does not count.
  const two = [...MEMBERS, member("6", "to@nordhav.vc", ["admin"])];
  assert.equal(memberLockReason(two[0]!, two, "u-6"), null);
  const withDeactivated = [
    member("1", "a@x.dk", ["admin"]),
    member("2", "b@x.dk", ["admin"], "deactivated"),
  ];
  assert.equal(activeAdmins(withDeactivated).length, 1);
  assert.equal(memberLockReason(withDeactivated[0]!, withDeactivated, "u-9"), "last_admin");
});

test("joinNames and initials", () => {
  assert.equal(joinNames([]), "");
  assert.equal(joinNames(["Maja"]), "Maja");
  assert.equal(joinNames(["Maja", "Jonas"]), "Maja eller Jonas");
  assert.equal(joinNames(["Maja", "Jonas", "Sofie", "Maja"]), "Maja, Jonas eller Sofie");
  assert.equal(initials("Maja Holm"), "MH");
  assert.equal(initials("line@lp-partner.dk"), "L");
  assert.equal(initials("Anders Kjær Hansen"), "AK");
});
