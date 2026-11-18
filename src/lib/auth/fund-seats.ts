/**
 * What the Admin sees on "Brugere og adgang" (B10-5): only THIS fund's numbers. The limit
 * is the installation's (SEAT_LIMIT/READER_LIMIT), enforced on the server only; neither the
 * limit nor a yes/no about it reaches the client, and never another fund's count. Pure file, tested with node --test.
 */
import { usesSeat } from "./seats.ts";
import type { Language } from "../i18n/language.ts";
import { translate } from "../i18n/translate.ts";

export interface FundSeatUsage {
  seatsUsed: number;
  readersUsed: number;
}

export interface SeatHolder {
  email: string;
  roles: readonly string[];
}

/**
 * Unique people in one fund who hold a seat or a reader place: active members plus pending
 * invitations, one per e-mail (a person counts once; a seat beats a reader place). Mirrors the
 * installation-wide `seat_usage` (0032) but for a single fund, so no migration is needed.
 */
export function countFundSeats(
  activeMembers: readonly SeatHolder[],
  pendingInvitations: readonly SeatHolder[],
): { seatsUsed: number; readersUsed: number } {
  const holdsSeat = new Map<string, boolean>();
  for (const holder of [...activeMembers, ...pendingInvitations]) {
    const key = holder.email.trim().toLowerCase();
    if (!key) continue;
    holdsSeat.set(key, (holdsSeat.get(key) ?? false) || usesSeat(holder.roles));
  }
  let seatsUsed = 0;
  let readersUsed = 0;
  for (const seat of holdsSeat.values()) {
    if (seat) seatsUsed += 1;
    else readersUsed += 1;
  }
  return { seatsUsed, readersUsed };
}

/** Whether a limit is set and the count has reached it. */
export function limitReached(used: number, limit: number | null): boolean {
  return limit !== null && used >= limit;
}

/**
 * The counter text (beslutning 7: in the pilot only the number). "pladser i brug" without a
 * limit, "af 8 pladser" with one.
 */
export function seatCounterText(
  used: number,
  limit: number | null,
  noun: { one: string; many: string },
  language: Language = "da",
): string {
  return limit === null
    ? translate(language, "users.seats.inUse", { noun: used === 1 ? noun.one : noun.many })
    : translate(language, "users.seats.ofLimit", { limit, noun: noun.many });
}
