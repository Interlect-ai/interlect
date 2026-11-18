/**
 * Which standard specialist draws which card chart, and the team radar's axes. Kept apart
 * from `card-data.ts` (schemas and prompt text) so the case page's charts do not bundle those.
 */
export const CARD_DATA_KINDS = {
  people_team: "team",
  product_market_gtm: "market",
  technology_risk: "techBenchmarks",
  fund_finance_deal: "ownership",
} as const;

export type CardDataModuleId = keyof typeof CARD_DATA_KINDS;
export type CardDataKind = (typeof CARD_DATA_KINDS)[CardDataModuleId];
/**
 * The card every specialist can fall back to (and the only one a team's own specialist
 * draws): 3–6 figures it actually found, each with its source.
 */
export const HIGHLIGHTS_KIND = "highlights";
export type AnyCardDataKind = CardDataKind | typeof HIGHLIGHTS_KIND;

export function cardDataKindFor(moduleId: string): CardDataKind | null {
  return (CARD_DATA_KINDS as Record<string, CardDataKind>)[moduleId] ?? null;
}

/** The radar's axes, the same for every person, so the people can be drawn on one radar. */
export const TEAM_AXES = ["domain", "execution", "commercial", "technical", "leadership"] as const;
export type TeamAxis = (typeof TEAM_AXES)[number];

/**
 * A Team radar needs at least three axes that one of the first four people has a sourced score on
 * (an axis nobody scored is left out, never drawn as 0). Fewer: the card shows the criteria chart.
 */
export function teamHasRadar(data: {
  people: readonly { scores: Record<TeamAxis, number | null> }[];
}): boolean {
  const people = data.people.slice(0, 4);
  return (
    TEAM_AXES.filter((axis) => people.some((person) => person.scores[axis] !== null)).length >= 3
  );
}
