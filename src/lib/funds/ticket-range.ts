/**
 * The ticket bar in "Jeres tese" (prototype Teamopsaetning v3, `ticketBox`). The bar is
 * logarithmic from 10,000 to 100,000,000 (positions 0-1000), a dragged value snaps to a round
 * amount, and a typed amount understands "250.000", "2,5 mio", "500k" and plain thousands ("250"
 * is 250,000), as the prototype's `parseA` does. Pure, so it can be tested with node --test.
 */
import { parseTypedNumber } from "./typed-number.ts";

/** The bar's ends as powers of ten: 10^4 = 10,000 and 10^8 = 100,000,000. */
const LOG_MIN = 4;
const LOG_MAX = 8;
/** Positions on the bar run from 0 to this. */
export const TICKET_POSITIONS = 1000;
/** The amounts under the bar (one per power of ten). */
export const TICKET_TICKS = [10_000, 100_000, 1_000_000, 10_000_000, 100_000_000] as const;

/** A dragged amount rounded the way a person would say it. */
export function snapTicket(amount: number): number {
  if (amount < 1e6) return Math.max(10_000, Math.round(amount / 10_000) * 10_000);
  if (amount < 1e7) return Math.round(amount / 100_000) * 100_000;
  return Math.round(amount / 1e6) * 1e6;
}

/** The amount at a position on the bar (0-1000), snapped. */
export function ticketAtPosition(position: number): number {
  const clamped = Math.max(0, Math.min(TICKET_POSITIONS, position));
  return snapTicket(10 ** (LOG_MIN + ((LOG_MAX - LOG_MIN) * clamped) / TICKET_POSITIONS));
}

/** The position of an amount on the bar (0-1000); below 10,000 is the start. */
export function ticketPosition(amount: number): number {
  const log = Math.log10(Math.max(10_000, amount));
  return Math.max(
    0,
    Math.min(TICKET_POSITIONS, (TICKET_POSITIONS * (log - LOG_MIN)) / (LOG_MAX - LOG_MIN)),
  );
}

// i18n-keep: currency words and suffixes a person may type in the amount field (not shown).
const CURRENCY = /€|kr\.?|\$|£|eur|dkk|usd|gbp|nok|sek|chf/g;

/**
 * A typed amount with its suffix, or null when it is not one. Both formats are read in either
 * language: "1.500.000" and "1,500,000" are 1,500,000. With a suffix a single separator
 * is a decimal ("2,5 mio", "1.5m").
 */
function readAmount(text: string): { amount: number; suffix: string } | null {
  const cleaned = String(text)
    .toLowerCase()
    .replace(/[\s\u00a0\u202f]/g, "")
    .replace(CURRENCY, "");
  const match = cleaned.match(/^([\d.,]+)(mio\.?|mill\w*|m|mia|t|k|tkr)?$/);
  if (!match) return null;
  const raw = match[1]!;
  const suffix = match[2] ?? "";
  const singleSeparator = (raw.match(/[.,]/g) ?? []).length === 1;
  const amount = suffix && singleSeparator ? Number(raw.replace(",", ".")) : parseTypedNumber(raw);
  if (amount === null || !Number.isFinite(amount)) return null;
  let multiplier = 1;
  if (suffix === "mia") multiplier = 1e9;
  else if (suffix.startsWith("m")) multiplier = 1e6;
  else if (suffix === "t" || suffix === "k" || suffix === "tkr") multiplier = 1e3;
  return { amount: amount * multiplier, suffix };
}

/**
 * A typed amount, or null when it is not one. Without a suffix a number under 1,000 means
 * thousands; "k"/"t" thousand, "m"/"mio"/"mill…" million, "mia" billion. Kept between 1,000 and
 * 1,000,000,000.
 */
export function parseTicketAmount(text: string): number | null {
  const read = readAmount(text);
  if (!read) return null;
  const amount = !read.suffix && read.amount < 1000 ? read.amount * 1000 : read.amount;
  return Math.max(1000, Math.min(1e9, Math.round(amount)));
}

/**
 * A typed amount in whole units without the ticket's shortcuts (no "250 means 250,000", no
 * floor or ceiling): the team's fund size. Null when it is not an amount or not above zero.
 */
export function parseWholeAmount(text: string): number | null {
  const read = readAmount(text);
  if (!read) return null;
  const amount = Math.round(read.amount);
  return amount > 0 && amount < 1e12 ? amount : null;
}

export interface TicketRange {
  ticketMinEur: number | null;
  ticketMaxEur: number | null;
}

/** "Fra" set to `amount`; "Til" follows when it would be below it (never from above to). */
export function withTicketMin(range: TicketRange, amount: number): TicketRange {
  return {
    ticketMinEur: amount,
    ticketMaxEur:
      range.ticketMaxEur !== null && range.ticketMaxEur < amount ? amount : range.ticketMaxEur,
  };
}

/** "Til" set to `amount`; "Fra" follows when it would be above it. */
export function withTicketMax(range: TicketRange, amount: number): TicketRange {
  return {
    ticketMinEur:
      range.ticketMinEur !== null && range.ticketMinEur > amount ? amount : range.ticketMinEur,
    ticketMaxEur: amount,
  };
}

/** Which thumb a press on the bar moves: the nearest one (on a tie, the side it is on). */
export function nearestThumb(position: number, range: TicketRange): 0 | 1 {
  const low = ticketPosition(range.ticketMinEur ?? 10_000);
  const high = ticketPosition(range.ticketMaxEur ?? range.ticketMinEur ?? 10_000);
  const toLow = Math.abs(position - low);
  const toHigh = Math.abs(position - high);
  if (toLow < toHigh) return 0;
  if (toHigh < toLow) return 1;
  return position < low ? 0 : 1;
}
