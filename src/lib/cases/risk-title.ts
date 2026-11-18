import { translate, type MessageKey } from "../i18n/translate.ts";
import type { Language } from "../i18n/language.ts";

/** A risk's title: the model's own short title, else a fixed name for the category. */
const riskTitleKeys: Record<string, MessageKey> = {
  founder_integrity: "deep.riskTitles.founder_integrity",
  key_person: "deep.riskTitles.key_person",
  key_person_team_gap: "deep.riskTitles.key_person_team_gap",
  team_gap: "deep.riskTitles.team_gap",
  execution: "deep.riskTitles.execution",
  governance: "deep.riskTitles.governance",
  weak_problem: "deep.riskTitles.weak_problem",
  false_pmf: "deep.riskTitles.false_pmf",
  market_size: "deep.riskTitles.market_size",
  competition: "deep.riskTitles.competition",
  timing: "deep.riskTitles.timing",
  distribution: "deep.riskTitles.distribution",
  concentration: "deep.riskTitles.concentration",
  technology: "deep.riskTitles.technology",
  security: "deep.riskTitles.security",
  privacy: "deep.riskTitles.privacy",
  data_rights: "deep.riskTitles.data_rights",
  ip: "deep.riskTitles.ip",
  ip_defensibility: "deep.riskTitles.ip_defensibility",
  regulatory: "deep.riskTitles.regulatory",
  safety_regulatory: "deep.riskTitles.safety_regulatory",
  platform_dependency: "deep.riskTitles.platform_dependency",
  evidence_integrity: "deep.riskTitles.evidence_integrity",
  mandate: "deep.riskTitles.mandate",
  financial: "deep.riskTitles.financial",
  financial_quality_runway: "deep.riskTitles.financial_quality_runway",
  revenue_customer_quality: "deep.riskTitles.revenue_customer_quality",
  prototype_to_production: "deep.riskTitles.prototype_to_production",
  technical_moat: "deep.riskTitles.technical_moat",
  safety_certification: "deep.riskTitles.safety_certification",
  runway: "deep.riskTitles.runway",
  capital_intensity: "deep.riskTitles.capital_intensity",
  financing: "deep.riskTitles.financing",
  cap_table: "deep.riskTitles.cap_table",
  valuation: "deep.riskTitles.valuation",
  ownership: "deep.riskTitles.ownership",
  portfolio_conflict: "deep.riskTitles.portfolio_conflict",
};

export function riskTitle(
  risk: { category: string; label: string | null },
  language: Language = "da",
) {
  const key = riskTitleKeys[risk.category];
  return risk.label ?? (key ? translate(language, key) : risk.category.replaceAll("_", " "));
}
