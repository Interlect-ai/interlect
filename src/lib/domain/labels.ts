import type {
  ActorType,
  AnalysisExecutionStatus,
  CompanyStage,
  EvidenceStatus,
  FundRole,
  IntakeSource,
  InvestmentProcessStage,
  PapRecommendation,
  RiskLevel,
  ScoreCategory,
} from "./types";
import { DEFAULT_LANGUAGE, type Language } from "../i18n/language.ts";
import { translate, type MessageKey } from "../i18n/translate.ts";

export const intakeSourceLabel: Record<IntakeSource, string> = {
  scanner: "Scanner",
  pitch_deck: "Pitch deck",
  manual: "Manuel",
};

/** What Interlect is doing technically. */
export const executionStatusLabel: Record<AnalysisExecutionStatus, string> = {
  queued: "I kø",
  collecting_evidence: "Indsamler dokumentation",
  screening_in_progress: "Indledende screening i gang",
  screening_complete: "Indledende screening færdig",
  awaiting_approval: "Afventer godkendelse",
  deep_analysis_in_progress: "Dyb analyse i gang",
  quality_audit: "Kvalitets- og kildekontrol",
  needs_information: "Mangler oplysninger",
  complete: "Analyse færdig",
  failed: "Fejlet",
  cancelled: "Annulleret",
};

/** Status on one step of an analysis run (analysis_step_status). */
export const analysisStepStatusLabel: Record<string, string> = {
  queued: "I kø",
  running: "Kører",
  complete: "Færdig",
  failed: "Fejlet",
  skipped: "Sprunget over",
};

/** Interlect's analytical recommendation — ikke en investeringsbeslutning. */
export const papRecommendationLabel: Record<PapRecommendation, string> = {
  go_forward: "Gå videre",
  follow: "Følg udviklingen",
  reject: "Fravælg",
  outside_thesis_interesting: "Uden for thesis, usædvanligt interessant",
};

/** Human investment process — kun autoriserede personer kan flytte den. */
export const processStageLabel: Record<InvestmentProcessStage, string> = {
  new_case: "Ny case",
  initial_screening: "Indledende screening",
  preliminary_analysis: "Foreløbig analyse",
  partner_review: "Partnergennemgang",
  ready_for_contact: "Klar til kontakt",
  contacted: "Kontaktet",
  first_meeting: "Første møde",
  further_evaluation: "Videre vurdering",
  due_diligence: "Due diligence",
  investment_memo: "Investeringsmemo",
  investment_committee: "Investeringskomité",
  invested: "Investeret",
  closed_without_investment: "Afsluttet uden investering",
};

export const fundRoleLabel: Record<FundRole, string> = {
  admin: "Admin",
  lead: "Lead",
  member: "Medlem",
  reader: "Læser",
};

export const actorTypeLabel: Record<ActorType, string> = {
  pap: "Interlect",
  user: "Bruger",
  system: "System",
};

export const riskLabel: Record<RiskLevel, string> = {
  low: "Lav",
  medium: "Middel",
  high: "Høj",
  critical: "Kritisk",
};

export const evidenceStatusLabel: Record<EvidenceStatus, string> = {
  verified: "Verificeret",
  corroborated: "Underbygget / sandsynlig",
  company_stated: "Virksomhedsangivet",
  contradictory: "Modstridende",
  unknown: "Ukendt",
};

export const stageLabel: Record<CompanyStage, string> = {
  pre_seed: "Pre-seed",
  seed: "Seed",
  series_a: "Series A",
  series_b: "Series B",
  growth: "Vækst",
  buyout: "Buyout / generationsskifte",
  later: "Senere",
  unknown: "Ukendt",
};

// Model input in the AI helpers' prompts (criterion-assist, specialist-assist); their words change
// with the prompts. The screen shows scoreCategoryLabelIn (the dictionary).
export const scoreCategoryLabel: Record<ScoreCategory, string> = {
  fund_thesis_fit: "Fonds- og thesis-match",
  founder_market_fit: "Founder-market fit",
  team_market_fit: "Team-market fit",
  product_market_fit: "Tegn på product-market fit",
  product_technology: "Produkt og teknologi",
  market_timing: "Marked og timing",
  traction_gtm: "Traction og go-to-market",
  financial_strength: "Finansiel styrke",
  evidence_quality: "Datatillid",
};

/**
 * The same labels in the fund's language. The Danish Records above stay as they are for
 * the server and other callers; these return `undefined` for a value the dictionary does not know.
 */
const intakeSourceKeys: Record<IntakeSource, MessageKey> = {
  scanner: "screening.labels.intakeScanner",
  pitch_deck: "screening.labels.intakePitchDeck",
  manual: "screening.labels.intakeManual",
};

const executionStatusKeys: Record<AnalysisExecutionStatus, MessageKey> = {
  queued: "screening.labels.execQueued",
  collecting_evidence: "screening.labels.execCollectingEvidence",
  screening_in_progress: "screening.labels.execScreeningInProgress",
  screening_complete: "screening.labels.execScreeningComplete",
  awaiting_approval: "screening.labels.execAwaitingApproval",
  deep_analysis_in_progress: "screening.labels.execDeepAnalysisInProgress",
  quality_audit: "screening.labels.execQualityAudit",
  needs_information: "screening.labels.execNeedsInformation",
  complete: "screening.labels.execComplete",
  failed: "screening.labels.execFailed",
  cancelled: "screening.labels.execCancelled",
};

const analysisStepStatusKeys: Record<string, MessageKey> = {
  queued: "screening.labels.stepQueued",
  running: "screening.labels.stepRunning",
  complete: "screening.labels.stepComplete",
  failed: "screening.labels.stepFailed",
  skipped: "screening.labels.stepSkipped",
};

const papRecommendationKeys: Record<PapRecommendation, MessageKey> = {
  go_forward: "screening.labels.recGoForward",
  follow: "screening.labels.recFollow",
  reject: "screening.labels.recReject",
  outside_thesis_interesting: "screening.labels.recOutsideThesis",
};

const scoreCategoryKeys: Record<ScoreCategory, MessageKey> = {
  fund_thesis_fit: "screening.labels.catFundThesisFit",
  founder_market_fit: "screening.labels.catFounderMarketFit",
  team_market_fit: "screening.labels.catTeamMarketFit",
  product_market_fit: "screening.labels.catProductMarketFit",
  product_technology: "screening.labels.catProductTechnology",
  market_timing: "screening.labels.catMarketTiming",
  traction_gtm: "screening.labels.catTractionGtm",
  financial_strength: "screening.labels.catFinancialStrength",
  evidence_quality: "screening.labels.catEvidenceQuality",
};

function labelIn(
  keys: Record<string, MessageKey>,
  value: string,
  language: Language,
): string | undefined {
  const key = Object.hasOwn(keys, value) ? keys[value] : undefined;
  return key ? translate(language, key) : undefined;
}

export function intakeSourceLabelIn(source: string, language: Language = DEFAULT_LANGUAGE) {
  return labelIn(intakeSourceKeys, source, language);
}

export function executionStatusLabelIn(status: string, language: Language = DEFAULT_LANGUAGE) {
  return labelIn(executionStatusKeys, status, language);
}

export function analysisStepStatusLabelIn(status: string, language: Language = DEFAULT_LANGUAGE) {
  return labelIn(analysisStepStatusKeys, status, language);
}

export function papRecommendationLabelIn(value: string, language: Language = DEFAULT_LANGUAGE) {
  return labelIn(papRecommendationKeys, value, language);
}

export function scoreCategoryLabelIn(category: string, language: Language = DEFAULT_LANGUAGE) {
  return labelIn(scoreCategoryKeys, category, language);
}
