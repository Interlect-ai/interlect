import type { ScoreCategory } from "@/lib/domain/types";
import { DEFAULT_LANGUAGE, type Language } from "@/lib/i18n/language";
import { translate, type MessageKey } from "@/lib/i18n/translate";

/**
 * Hvilke typer offentlig evidens (research-modulernes `categories`) der er
 * relevante for hver scorekategori. Bruges kun til at forklare kæden på
 * /fond/metode -- selve scoringen læser al evidens på casen, så denne tabel
 * styrer ikke hvad AI'en må se, kun hvad siden fremhæver som primær kilde.
 */
export const researchCategoriesForScoreCategory: Record<ScoreCategory, readonly string[]> = {
  fund_thesis_fit: ["corporate_identity", "market_competition", "funding"],
  founder_market_fit: ["team"],
  team_market_fit: ["team"],
  product_market_fit: ["traction_customers", "market_competition", "product_technology"],
  product_technology: ["product_technology", "legal_regulatory"],
  market_timing: ["market_competition"],
  traction_gtm: ["traction_customers"],
  financial_strength: ["financials", "funding"],
  evidence_quality: ["corporate_identity", "reputation", "legal_regulatory"],
};

const RESEARCH_CATEGORY_KEYS: Record<string, MessageKey> = {
  corporate_identity: "charts.method.category.corporate_identity",
  financials: "charts.method.category.financials",
  legal_regulatory: "charts.method.category.legal_regulatory",
  team: "charts.method.category.team",
  funding: "charts.method.category.funding",
  product_technology: "charts.method.category.product_technology",
  traction_customers: "charts.method.category.traction_customers",
  market_competition: "charts.method.category.market_competition",
  reputation: "charts.method.category.reputation",
};

/** A research category's name in `language`; an unknown category shows its id. */
export function researchCategoryLabelIn(
  category: string,
  language: Language = DEFAULT_LANGUAGE,
): string {
  const key = RESEARCH_CATEGORY_KEYS[category];
  return key ? translate(language, key) : category;
}

/** Data der kommer ind uden om Perplexity-researchen. */
const DIRECT_DATA_SOURCE_KEYS: Partial<Record<ScoreCategory, readonly MessageKey[]>> = {
  financial_strength: ["charts.method.directSource.annualReports"],
};

/** The data that comes in outside the Perplexity research for `category`, in `language`. */
export function directDataSourcesIn(
  category: ScoreCategory,
  language: Language = DEFAULT_LANGUAGE,
): string[] {
  return (DIRECT_DATA_SOURCE_KEYS[category] ?? []).map((key) => translate(language, key));
}

export function researchModuleFeedsCategory(
  moduleCategories: readonly string[],
  category: ScoreCategory,
): boolean {
  const wanted = researchCategoriesForScoreCategory[category];
  return moduleCategories.some((moduleCategory) => wanted.includes(moduleCategory));
}
