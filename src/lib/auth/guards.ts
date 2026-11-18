/**
 * Pure authorization and safety decisions for the user-management server functions, pulled out
 * so they can be tested with node --test (the server functions themselves cannot be loaded
 * there). Each function is the exact rule the server applies.
 */
import { z } from "zod";
import { roleValues } from "./roles.ts";
import { usesSeat } from "./seats.ts";

/** One role per person ("Én rolle pr. person"): the schema refuses more or fewer. */
export const singleRoleSchema = z.array(z.enum(roleValues)).length(1);

/** An e-mail is trimmed before it is validated (the client regex below is the same shape). */
export const emailSchema = z.string().trim().email().max(320);
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Two admins changing each other at the same moment can both pass the database's last-admin
 * triggers (each sees the other in its own snapshot). After the change has committed the server
 * recounts the fund's ACTIVE admins; zero means the change must be rolled back. A remaining
 * window exists between the two commits; closing it needs a lock in the triggers (migration, the
 * product owner decides).
 */
export function needsAdminRollback(activeAdminsAfter: number): boolean {
  return activeAdminsAfter <= 0;
}

/** The membership must belong to the caller's fund; the message never says it exists elsewhere. */
export function refuseForeignMembership(
  membershipFundId: string | null | undefined,
  callerFundId: string,
): "unknown" | null {
  return membershipFundId === callerFundId ? null : "unknown";
}

/** Nobody changes their own role or access. */
export function isSelfChange(targetUserId: string, callerUserId: string): boolean {
  return targetUserId === callerUserId;
}

/** A pending invitation must never reactivate a person an Admin has deactivated. */
export function acceptanceBlockedBy(
  existingMembershipStatus: "active" | "deactivated" | null | undefined,
): boolean {
  return existingMembershipStatus === "deactivated";
}

export const MAX_PENDING_INVITATIONS = 50;
export const INVITE_RATE = { limit: 20, windowMs: 10 * 60_000 } as const;

export function pendingInvitationCapReached(pendingCount: number): boolean {
  return pendingCount >= MAX_PENDING_INVITATIONS;
}

/**
 * After the insert (check-then-insert race): is the installation over a configured limit with
 * this invitation counted? Then the invitation is revoked again.
 */
export function overSeatLimitAfterInsert(
  usage: {
    seatsUsed: number;
    seatLimit: number | null;
    readersUsed: number;
    readerLimit: number | null;
  },
  roles: readonly string[],
  alreadyCounted: boolean,
): boolean {
  if (alreadyCounted) return false;
  return usesSeat(roles)
    ? usage.seatLimit !== null && usage.seatsUsed > usage.seatLimit
    : usage.readerLimit !== null && usage.readersUsed > usage.readerLimit;
}

/** The locked page's payload: trimmed, non-empty full names and nothing else. */
export function adminNamesOnly(profiles: ReadonlyArray<{ full_name: string | null }>): string[] {
  return profiles
    .map((profile) => profile.full_name?.trim() ?? "")
    .filter((name) => name.length > 0)
    .sort((a, b) => a.localeCompare(b, "da"));
}

/** Fortryd is only safe while the person is still as we left them. */
export function undoStillValid(
  current: { roles: readonly string[]; status: string } | undefined,
  expected: { roles?: readonly string[]; status?: string },
): boolean {
  if (!current) return false;
  if (expected.status !== undefined && current.status !== expected.status) return false;
  if (expected.roles !== undefined) {
    const a = [...current.roles].sort().join();
    const b = [...expected.roles].sort().join();
    if (a !== b) return false;
  }
  return true;
}

/**
 * Two-step login belongs to the person's account, not to the team: a reset also applies
 * in the person's other teams. It is refused when the person has active access to another team
 * the caller is not an Admin of.
 */
export function mfaResetBlockedByOtherTeams(
  targetOtherFundIds: readonly string[],
  callerAdminFundIds: readonly string[],
): boolean {
  const administered = new Set(callerAdminFundIds);
  return targetOtherFundIds.some((fundId) => !administered.has(fundId));
}

/** "Nulstil adgangskode": the link lives 48 hours and works once. */
export const PASSWORD_RESET_HOURS = 48;
export const PASSWORD_RESET_RATE = { limit: 20, windowMs: 10 * 60_000 } as const;
export const PASSWORD_MIN_LENGTH = 12;
export const passwordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(200);

/** A reset link is usable until it is used, revoked or expired (the server answers the same for all). */
export function passwordResetUsable(
  row: { used_at: string | null; revoked_at: string | null; expires_at: string },
  now: Date,
): boolean {
  return !row.used_at && !row.revoked_at && new Date(row.expires_at).getTime() > now.getTime();
}
