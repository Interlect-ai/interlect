/**
 * Pladser: Admin, Lead og Medlem bruger en plads, Læsere har
 * egen kvote. Der tælles pr. installation, som unikke personer. Grænserne er miljøvariabler
 * (SEAT_LIMIT, READER_LIMIT); ingen værdi betyder ingen grænse, som i piloten.
 * Ren fil, så den kan testes med node --test.
 */

import type { Language } from "../i18n/language.ts";
import { translate } from "../i18n/translate.ts";

export interface SeatUsage {
  seatsUsed: number;
  seatLimit: number | null;
  readersUsed: number;
  readerLimit: number | null;
}

/** A positive whole number, or null (no limit) for anything else. */
export function parseSeatLimit(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === "") return null;
  const value = Number(raw.trim());
  if (Number.isInteger(value) && value > 0) return value;
  // A mistyped limit would silently mean "no limit"; say so in the log (harden).
  console.warn(`[seats] ignoring invalid seat limit "${raw}": no limit is applied`);
  return null;
}

/** Roles that use a paid seat. A person with only "reader" counts against the reader quota. */
export function usesSeat(roles: readonly string[]): boolean {
  return roles.some((role) => role !== "reader");
}

/**
 * Why an invitation must be refused, or null when there is room. Only refuses when a limit
 * is set and already reached; a person who already holds a seat is never counted twice.
 */
export function seatLimitMessage(
  usage: SeatUsage,
  roles: readonly string[],
  alreadyCounted: { seat: boolean; reader: boolean },
  language: Language = "da",
): string | null {
  if (usesSeat(roles)) {
    if (alreadyCounted.seat || usage.seatLimit === null) return null;
    return usage.seatsUsed >= usage.seatLimit
      ? translate(language, "appServer.invitations.seatsFullCount", { limit: usage.seatLimit })
      : null;
  }
  if (alreadyCounted.seat || alreadyCounted.reader || usage.readerLimit === null) return null;
  return usage.readersUsed >= usage.readerLimit
    ? translate(language, "appServer.invitations.readersFullCount", { limit: usage.readerLimit })
    : null;
}
