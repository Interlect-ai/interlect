/**
 * Which of the fund's reasons (brain_reason_codes) a confirmation dialog shows first, and
 * which sit behind "Flere årsager" (suggested reasons + an open text field).
 * Pure; the server checks again that every chosen code fits the movement.
 */
import type { MovementKind } from "@/lib/brain/movement";

export interface ReasonCodeLike {
  code: string;
  label: string;
  appliesTo: string[];
}

/** A short, prototype-sized first row per movement; the fund's full list is one click away. */
const SUGGESTED: Partial<Record<MovementKind, string[]>> = {
  hold: [
    "awaiting_milestone",
    "wrong_timing",
    "too_early",
    "valuation_too_high",
    "weak_financials",
  ],
  reject: [
    "outside_sector",
    "dealbreaker_hit",
    "weak_founder_market_fit",
    "small_market",
    "strong_competition",
    "valuation_too_high",
  ],
  decline_ic: [
    "weak_founder_market_fit",
    "small_market",
    "strong_competition",
    "valuation_too_high",
    "team_risk",
    "portfolio_overlap",
  ],
  invest: ["strong_team", "clear_traction", "large_market", "thesis_fit"],
  advance: ["strong_team", "clear_traction", "large_market", "thesis_fit"],
  reopen: ["clear_traction", "thesis_fit", "strong_team", "large_market"],
};

/** "Andet" is the note itself: a note without a chip is saved with this code. */
export const OTHER_REASON = "other";

/** The most reasons one move carries; the dialog and the server share it (harden SF1). */
export const MAX_REASONS = 10;

export function reasonOptions(
  codes: readonly ReasonCodeLike[],
  kinds: readonly MovementKind[],
): { primary: { value: string; label: string }[]; more: { value: string; label: string }[] } {
  // Bulk: only reasons that fit every selected case's movement.
  const fitting = codes.filter(
    (code) => code.code !== OTHER_REASON && kinds.every((kind) => code.appliesTo.includes(kind)),
  );
  const wanted = new Set(kinds.flatMap((kind) => SUGGESTED[kind] ?? []));
  let primary = fitting.filter((code) => wanted.has(code.code));
  // A fund with its own list: show its first reasons instead of an empty row.
  if (primary.length < 3) primary = fitting.slice(0, 6);
  const shown = new Set(primary.map((code) => code.code));
  const toOption = (code: ReasonCodeLike) => ({ value: code.code, label: code.label });
  return {
    primary: primary.map(toOption),
    more: fitting.filter((code) => !shown.has(code.code)).map(toOption),
  };
}

/**
 * The codes sent to the server. A note alone becomes "Andet" where the movement needs a
 * reason; null when that is impossible (the fund has no "Andet" for this movement).
 */
export function reasonCodesToSend(
  chosen: readonly string[],
  note: string,
  kinds: readonly MovementKind[],
  codes: readonly ReasonCodeLike[],
  reasonRequired: (kind: MovementKind) => boolean,
): string[] | null {
  if (chosen.length > 0) return [...chosen];
  if (!note.trim() || !kinds.some(reasonRequired)) return [];
  // The list could not be loaded: send "Andet" and let the server check it (harden D).
  if (codes.length === 0) return [OTHER_REASON];
  const other = codes.find((code) => code.code === OTHER_REASON);
  if (!other || !kinds.every((kind) => other.appliesTo.includes(kind))) return null;
  return [OTHER_REASON];
}
