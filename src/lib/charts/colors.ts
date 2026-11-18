/**
 * One colour source for everything a chart, dot or tab colours by series. The same id
 * always gets the same colour: a criterion by its key, a specialist by its module id. Cards, a
 * tab's dot, the tab and its sub-pages all ask here, so a colour cannot shift when a list is
 * filtered or sorted differently on another page.
 */

/** `--series-1` … `--series-10`, wrapping around. */
export function seriesSlot(index: number): string {
  return `var(--series-${(((index % 10) + 10) % 10) + 1})`;
}

/** The prototype's specialist colours ("Graf-system": Team 2, Marked 5, Produkt 1, Deal 7). */
export const STANDARD_SPECIALIST_COLORS: Readonly<Record<string, string>> = {
  people_team: "var(--series-2)",
  product_market_gtm: "var(--series-5)",
  technology_risk: "var(--series-1)",
  fund_finance_deal: "var(--series-7)",
};

/** The fund's own specialists, in the order the fund created them (the figures use the same). */
export const OWN_SPECIALIST_COLORS: readonly string[] = [
  "var(--series-3)",
  "var(--series-4)",
  "var(--series-6)",
  "var(--series-9)",
];

export const ECONOMY_COLOR = "var(--series-8)";
export const RISKS_COLOR = "var(--critical)";
export const OTHER_COLOR = "var(--ink-3)";

/** Own specialist nr. `index` among the fund's own (0 = the first). */
export function ownSpecialistColor(index: number): string {
  const n = OWN_SPECIALIST_COLORS.length;
  return OWN_SPECIALIST_COLORS[((index % n) + n) % n]!;
}

/**
 * A specialist's colour: a standard one by its module id, the fund's own by its place among the
 * fund's own (`ownIndex`).
 */
export function specialistColor(moduleId: string, ownIndex = 0): string {
  return STANDARD_SPECIALIST_COLORS[moduleId] ?? ownSpecialistColor(ownIndex);
}

/**
 * The criteria's colours by key. `orderedKeys` is the fund's own order (the prototype's rule:
 * the first criterion is --series-1); pass every list that can hold criteria, most canonical
 * first (e.g. the screening's, then the deep run's), and a key keeps the colour of its first
 * place. A key that is not in the lists gets a stable colour from the key itself.
 */
export function criterionColors(...orderedKeys: ReadonlyArray<readonly string[]>): CriterionColors {
  const colors = new Map<string, string>();
  for (const keys of orderedKeys) {
    for (const key of keys) if (!colors.has(key)) colors.set(key, seriesSlot(colors.size));
  }
  return {
    of: (key: string) => colors.get(key) ?? seriesSlot(hashKey(key)),
  };
}

export interface CriterionColors {
  of: (key: string) => string;
}

function hashKey(key: string): number {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) | 0;
  return Math.abs(hash);
}
