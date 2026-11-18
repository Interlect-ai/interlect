import type { ScoreCategory } from "@/lib/domain/types";

/**
 * The four standard specialists by id, name and the score areas they own: what screens show
 * . Their instructions are prompt text and live in `specialist-prompts.ts`, which no
 * component imports, so they never reach the browser's bundle.
 */
export type SpecialistModuleId =
  "people_team" | "product_market_gtm" | "technology_risk" | "fund_finance_deal";

export interface SpecialistModuleInfo {
  id: SpecialistModuleId;
  title: string;
  categories: ScoreCategory[];
}

export const specialistCatalog: SpecialistModuleInfo[] = [
  {
    id: "people_team",
    title: "Founder, ledelse og team",
    categories: ["founder_market_fit", "team_market_fit"],
  },
  {
    id: "product_market_gtm",
    title: "Problem, produkt, PMF, marked og go-to-market",
    categories: ["product_market_fit", "market_timing", "traction_gtm"],
  },
  {
    id: "technology_risk",
    title: "Produktteknologi, data, IP og tværgående risici",
    categories: ["product_technology", "evidence_quality"],
  },
  {
    id: "fund_finance_deal",
    title: "Tesematch, økonomi, kapitalbehov og deal",
    categories: ["fund_thesis_fit", "financial_strength"],
  },
];

/** Hvilket specialistmodul der ejer en given scorekategori -- til transparens-siden. */
export const categoryToModule: Record<ScoreCategory, SpecialistModuleId> = specialistCatalog.reduce(
  (map, module) => {
    for (const category of module.categories) map[category] = module.id;
    return map;
  },
  {} as Record<ScoreCategory, SpecialistModuleId>,
);
