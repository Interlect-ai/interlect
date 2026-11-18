/**
 * D-8: én sandhed for kørselstrinnenes navne og orbens tilstand (screening, dyb analyse,
 * fanen "I gang" og Overblik). Orbens tilstand følger verbet (designretning 08, P3).
 */
import type { OrbState } from "@/components/ai/AiOrb";
import type { Language } from "../i18n/language.ts";
import { translate, type MessageKey } from "../i18n/translate.ts";

/** Step keys that have a name in the dictionary (`intake.runStep.name.<key>`). */
const STEP_NAME_KEYS = new Set<string>([
  "intake_create",
  "intake_origin",
  "intake_identity",
  "intake_website",
  "intake_upload",
  "intake_extract",
  "intake_screening",
  "screening_research",
  "cvr_financials",
  "fund_screening",
  "public_research",
  "evidence_sheet",
  "people_team",
  "product_market_gtm",
  "technology_risk",
  "fund_finance_deal",
  "investment_committee_synthesis",
  "quality_audit",
]);

const STEP_ORB: Record<string, OrbState> = {
  intake_create: "working",
  intake_origin: "working",
  intake_identity: "searching",
  intake_website: "searching",
  intake_upload: "listening",
  intake_extract: "shaping",
  intake_screening: "breathing",
  screening_research: "searching",
  cvr_financials: "searching",
  fund_screening: "solving",
  public_research: "searching",
  evidence_sheet: "shaping",
  people_team: "connecting",
  product_market_gtm: "working",
  technology_risk: "shaping",
  fund_finance_deal: "solving",
  investment_committee_synthesis: "weaving",
  quality_audit: "solving",
};

/** The step of one of the fund's own specialists (the key is `custom_…`). */
function isOwnSpecialistStep(key: string) {
  return key.startsWith("custom_");
}

export function runStepName(key: string, language: Language = "da") {
  if (isOwnSpecialistStep(key)) return translate(language, "intake.runStep.ownSpecialist");
  if (STEP_NAME_KEYS.has(key)) {
    return translate(language, `intake.runStep.name.${key}` as MessageKey);
  }
  return key.replaceAll("_", " ");
}

/** Navneordsform til tidslinjen over færdige kørsler ("Vurdering mod investeringstesen"). */
const STEP_TITLE_KEYS = new Set<string>([
  "screening",
  "screening_research",
  "cvr_financials",
  "fund_screening",
  "public_research",
  "evidence_sheet",
  "people_team",
  "product_market_gtm",
  "technology_risk",
  "fund_finance_deal",
  "investment_committee_synthesis",
  "quality_audit",
]);

export function runStepTitle(key: string, language: Language = "da") {
  if (isOwnSpecialistStep(key)) return translate(language, "intake.runStep.ownSpecialistTitle");
  if (STEP_TITLE_KEYS.has(key)) {
    return translate(language, `intake.runStep.title.${key}` as MessageKey);
  }
  return runStepName(key, language);
}

export function runStepOrb(key: string): OrbState {
  return STEP_ORB[key] ?? "working";
}

/** Et færdigt trin (CVR er berigelse: et mislykket opslag stopper ikke kørslen). */
export function isStepDone(step: { key: string; status: string }) {
  return (
    step.status === "complete" ||
    step.status === "skipped" ||
    (step.key === "cvr_financials" && step.status === "failed")
  );
}

/** Varighed som "8 s" eller "2 min" (kun når begge tider findes). */
export function stepDuration(startedAt: string | null, completedAt: string | null) {
  if (!startedAt || !completedAt) return null;
  const seconds = Math.max(0, (Date.parse(completedAt) - Date.parse(startedAt)) / 1000);
  if (!Number.isFinite(seconds)) return null;
  return seconds < 60 ? `${Math.max(1, Math.round(seconds))} s` : `${Math.round(seconds / 60)} min`;
}
