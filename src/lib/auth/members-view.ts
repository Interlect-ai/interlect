/**
 * Pure rules for the "Brugere og adgang" page: member filter, the one role the UI shows,
 * the invitation status, duplicate checks and the last-admin lock. Tested with node --test.
 */
import type { AppRole } from "@/lib/supabase/types";
import { roleValues } from "./roles.ts";
import { LANGUAGE_TAGS, type Language } from "../i18n/language.ts";
import { translate } from "../i18n/translate.ts";

export interface MemberLike {
  membershipId: string;
  userId: string;
  email: string;
  fullName: string | null;
  status: "active" | "deactivated";
  roles: readonly AppRole[];
}

export interface InvitationLike {
  id: string;
  email: string;
  roles: readonly AppRole[];
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
}

export type RoleFilter = AppRole | "all";

/** The highest role (Admin > Lead > Medlem > Læser); a person with several shows as this. */
export function primaryRole(roles: readonly AppRole[]): AppRole {
  return roleValues.find((role) => roles.includes(role)) ?? "reader";
}

/** Extra roles beyond the shown one ("+1"); the UI is one role per person. */
export function extraRoleCount(roles: readonly AppRole[]): number {
  return Math.max(0, new Set(roles).size - 1);
}

/** Search on name or e-mail, and the role filter (matches the shown, highest role). */
export function filterMembers<T extends MemberLike>(
  members: readonly T[],
  query: string,
  roleFilter: RoleFilter,
): T[] {
  const q = query.trim().toLowerCase();
  return members.filter(
    (member) =>
      (roleFilter === "all" || primaryRole(member.roles) === roleFilter) &&
      (!q || `${member.fullName ?? ""} ${member.email}`.toLowerCase().includes(q)),
  );
}

export type InvitationStatus = "pending" | "accepted" | "expired" | "revoked";

export function invitationStatus(invitation: InvitationLike, now = Date.now()): InvitationStatus {
  if (invitation.acceptedAt) return "accepted";
  if (invitation.revokedAt) return "revoked";
  return new Date(invitation.expiresAt).getTime() <= now ? "expired" : "pending";
}

export function pendingInvitations<T extends InvitationLike>(
  invitations: readonly T[],
  now = Date.now(),
): T[] {
  return invitations.filter((invitation) => invitationStatus(invitation, now) === "pending");
}

/** "Personen er allerede medlem" (active or deactivated) for an e-mail typed in the form. */
export function existingMemberFor(
  members: readonly MemberLike[],
  email: string,
): MemberLike | undefined {
  const key = email.trim().toLowerCase();
  return key ? members.find((member) => member.email.toLowerCase() === key) : undefined;
}

/**
 * B10-2: no automatic revoking, but a second pending invitation to the same address is shown
 * clearly (both count a seat and both links work until one is revoked).
 */
export function duplicatePendingEmails(
  invitations: readonly InvitationLike[],
  now = Date.now(),
): Set<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const invitation of pendingInvitations(invitations, now)) {
    const key = invitation.email.toLowerCase();
    if (seen.has(key)) duplicates.add(key);
    seen.add(key);
  }
  return duplicates;
}

/** Active members who are Admin (the last-admin lock). */
export function activeAdmins<T extends MemberLike>(members: readonly T[]): T[] {
  return members.filter((member) => member.status === "active" && member.roles.includes("admin"));
}

/**
 * Why a member's role or status cannot be changed in the UI, or null. The server and the
 * database still decide; this only avoids offering a button that must fail.
 */
export function memberLockReason(
  member: MemberLike,
  members: readonly MemberLike[],
  myUserId: string | null | undefined,
): "self" | "last_admin" | null {
  if (member.userId === myUserId) return "self";
  const admins = activeAdmins(members);
  if (admins.length === 1 && admins[0]?.membershipId === member.membershipId) return "last_admin";
  return null;
}

/**
 * With exactly two active admins, each can remove the other. That is allowed, but two admins
 * doing it at the same moment could leave none (the server rolls the second one back); the UI
 * says so on the admin's controls.
 */
export function twoAdminsHint(
  member: MemberLike,
  members: readonly MemberLike[],
  language: Language = "da",
): string | null {
  const admins = activeAdmins(members);
  return admins.length === 2 && admins.some((a) => a.membershipId === member.membershipId)
    ? translate(language, "users.members.twoAdmins")
    : null;
}

/** Why the role and status controls are locked, in the fund's language. */
export function lockText(reason: "self" | "last_admin", language: Language = "da"): string {
  return translate(
    language,
    reason === "self" ? "users.members.lockSelf" : "users.members.lockLastAdmin",
  );
}

/** Names for "kontakt Maja eller Jonas" (deduplicated, in the given order). */
export function joinNames(names: readonly string[], language: Language = "da"): string {
  const unique = [...new Set(names.map((name) => name.trim()).filter(Boolean))];
  if (unique.length === 0) return "";
  if (unique.length === 1) return unique[0]!;
  return translate(language, "users.members.namesOr", {
    names: unique.slice(0, -1).join(", "),
    last: unique[unique.length - 1]!,
  });
}

/** Initials for the avatar: first letters of the first two words (persons, not logos). */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0]!)
    .join("")
    .slice(0, 2)
    .toLocaleUpperCase("da");
}

/** "5. okt" (the prototype's date), or "5 Oct" in English. */
export function shortDate(value: string, language: Language = "da"): string {
  return new Date(value)
    .toLocaleDateString(LANGUAGE_TAGS[language], { day: "numeric", month: "short" })
    .replace(/\.$/, "");
}
