/**
 * The charts a specialist's card on Konklusion can switch between, and which one each card shows
 * first ("som standard vise mange forskellige, og så har brugerne mulighed for at skifte rundt").
 * Pure and tested, so the rule holds for every team's set-up, its own
 * specialists included.
 *
 * - `own`: the specialist's own chart from its sourced data (team radar, market line, key figures,
 *   ownership, rounds, or a team's own specialist's figures; `specialistChartPlan`).
 * - The criteria charts: every specialist with a scored criterion can draw its criteria, so a card
 *   with a score always has several charts and never a "not found" line.
 * - Defaults: each card gets a type no card before it on the screen uses (the same type is not
 * repeated close together); a card with its own chart starts on it.
 */

export type CriteriaVariant =
  "column" | "bar" | "squares" | "radar" | "slope" | "ring" | "pie" | "gauge";
export type CardVariant = "own" | CriteriaVariant;

/** What the variants read of a specialist group (`SpecialistGroup` in `deep-view.ts`). */
export interface VariantGroup {
  score: number | null;
  criteria: readonly { score: number | null; screeningScore: number | null; weight: number }[];
}

/** `CriteriaColumns` draws at most four criteria; rings get unreadable past six. */
const MAX_COLUMNS = 4;
const MAX_RINGS = 6;
/** A radar needs three axes (an unscored criterion would look like 0). */
const MIN_RADAR_AXES = 3;

/** Which criteria charts this specialist's data can draw, in the order of the buttons. */
export function criteriaVariants(group: VariantGroup): CriteriaVariant[] {
  const count = group.criteria.length;
  const scored = group.criteria.filter((row) => row.score !== null).length;
  if (scored === 0) return [];
  const both = group.criteria.filter(
    (row) => row.score !== null && row.screeningScore !== null,
  ).length;
  const weighted = group.criteria.some((row) => row.weight > 0 && (row.score ?? 0) > 0);
  // One criterion is the specialist's score itself: against the screening, as a ring or a gauge.
  if (count === 1) return ["column", "ring", ...(group.score !== null ? (["gauge"] as const) : [])];
  const variants: CriteriaVariant[] = [];
  if (count <= MAX_COLUMNS) variants.push("column");
  variants.push("bar", "squares");
  if (scored >= MIN_RADAR_AXES) variants.push("radar");
  if (both >= 2) variants.push("slope");
  if (count <= MAX_RINGS) variants.push("ring");
  if (count >= 2 && weighted) variants.push("pie");
  if (group.score !== null) variants.push("gauge");
  return variants;
}

/** Every chart the card can show: its own first, then the criteria charts. */
export function cardVariants(group: VariantGroup, hasOwn: boolean): CardVariant[] {
  return [...(hasOwn ? (["own"] as const) : []), ...criteriaVariants(group)];
}

/** The order a card without its own chart takes its first chart in. */
// The most striking first (the first charts may well have a "wow"); plain bars last.
export const DEFAULT_ORDER: readonly CriteriaVariant[] = [
  "ring",
  "radar",
  "squares",
  "pie",
  "slope",
  "gauge",
  "column",
  "bar",
];

export interface DefaultInput {
  variants: readonly CardVariant[];
  /** The kind of chart the card's own chart is, so a criteria card does not repeat it. */
  ownLooksLike?: CriteriaVariant | null;
  /** The own chart is tiles of figures rather than a chart: a criteria chart goes first. */
  ownIsTiles?: boolean;
}

/** One default per card, in screen order, without repeating a type while another is left. */
export function pickDefaults(cards: readonly DefaultInput[]): (CardVariant | null)[] {
  const used = new Set<CriteriaVariant>();
  return cards.map(({ variants, ownLooksLike, ownIsTiles }) => {
    if (variants.length === 0) return null;
    const criteria = variants.some((variant) => variant !== "own");
    if (variants.includes("own") && !(ownIsTiles && criteria)) {
      if (ownLooksLike) used.add(ownLooksLike);
      return "own";
    }
    const fresh = DEFAULT_ORDER.find((type) => variants.includes(type) && !used.has(type));
    const pick = fresh ?? DEFAULT_ORDER.find((type) => variants.includes(type)) ?? null;
    if (pick) used.add(pick);
    return pick;
  });
}
