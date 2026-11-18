/**
 * Typed domain contracts for Interlect.ai.
 *
 * Milestone 1: types only. No data source is wired yet — every surface renders
 * an explicit empty state until the Supabase schema (milestone 2+) exists.
 */

export type FundRole = "admin" | "lead" | "member" | "reader";

export type IntakeSource = "scanner" | "pitch_deck" | "manual";

/** Which operational room owns the case inside one fund's workspace. */
export type CaseWorkspaceStatus = "screening" | "deep_analysis" | "on_hold" | "archived";

/**
 * 1) What PAP is technically doing right now. Machine-owned.
 * Never implies any human action has taken place.
 */
export type AnalysisExecutionStatus =
  | "queued"
  | "collecting_evidence"
  | "screening_in_progress"
  | "screening_complete"
  | "awaiting_approval"
  | "deep_analysis_in_progress"
  | "quality_audit"
  | "needs_information"
  | "complete"
  | "failed"
  | "cancelled";

/**
 * 3) Where the case is in the fund's human investment process.
 * Only authorized humans may move this; PAP may never advance it.
 */
export type InvestmentProcessStage =
  | "new_case"
  | "initial_screening"
  | "preliminary_analysis"
  | "partner_review"
  | "ready_for_contact"
  | "contacted"
  | "first_meeting"
  | "further_evaluation"
  | "due_diligence"
  | "investment_memo"
  | "investment_committee"
  | "invested"
  | "closed_without_investment";

/** Stages that require an authorized human action and can never be set by PAP. */
export const humanOnlyStages = [
  "ready_for_contact",
  "contacted",
  "first_meeting",
  "further_evaluation",
  "due_diligence",
  "investment_memo",
  "investment_committee",
  "invested",
  "closed_without_investment",
] as const satisfies readonly InvestmentProcessStage[];

/**
 * 2) PAP's analytical recommendation. Never a human investment decision.
 */
export type PapRecommendation = "go_forward" | "follow" | "reject" | "outside_thesis_interesting";

/** @deprecated Use PapRecommendation. Kept only as a naming alias during migration. */
export type Recommendation = PapRecommendation;

export type RiskLevel = "low" | "medium" | "high" | "critical";

export type EvidenceStatus =
  "verified" | "corroborated" | "company_stated" | "contradictory" | "unknown";

export type FindingNature = "fact" | "company_claim" | "calculation" | "judgement";

export type FindingOrigin = "model" | "deterministic";

export type CompanyStage =
  "pre_seed" | "seed" | "series_a" | "series_b" | "later" | "growth" | "buyout" | "unknown";

export type ScoreCategory =
  | "fund_thesis_fit"
  | "founder_market_fit"
  | "team_market_fit"
  | "product_market_fit"
  | "product_technology"
  | "market_timing"
  | "traction_gtm"
  | "financial_strength"
  | "evidence_quality";

export interface CategoryScore {
  category: ScoreCategory;
  /** 0-100, 100 is strongest. */
  score: number | null;
  weight: number;
  confidence: number | null;
}

export interface MandateGateResult {
  id: string;
  label: string;
  passed: boolean | null;
  rationale: string | null;
  overriddenBy?: { userId: string; reason: string; at: string } | null;
}

export interface EvidenceRef {
  id: string;
  claim: string;
  status: EvidenceStatus;
  sourceUrl: string | null;
  documentId: string | null;
  slideRef: number | null;
  observationDate: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  collectedAt: string;
  statedBy: string | null;
  excerpt: string | null;
  confidence: number | null;
}

export interface CaseSummary {
  id: string;
  companyName: string;
  website: string | null;
  logoUrl: string | null;
  primarySource: IntakeSource;
  allSources: IntakeSource[];
  /** What PAP is doing technically. */
  executionStatus: AnalysisExecutionStatus;
  /** PAP's analytical recommendation. */
  papRecommendation: PapRecommendation | null;
  /** Where the humans are in the investment process. */
  processStage: InvestmentProcessStage;
  stage: CompanyStage;
  sector: string | null;
  geography: string | null;
  /** Deep-analysis score when present, otherwise null. */
  overallScore: number | null;
  screeningScore: number | null;
  fundFit: number | null;
  risk: RiskLevel | null;
  evidenceConfidence: number | null;
  hasFailedGate: boolean;
  /** Role expected to act next, and the person assigned when one exists. */
  responsibleRole: FundRole | null;
  responsiblePersonName: string | null;
  /** Short Danish description of the pending human action, when any. */
  pendingAction: string | null;
  lastMaterialChangeAt: string | null;
  lastMaterialChangeSummary: string | null;
  updatedAt: string;
}

/** Actor behind any state change. PAP is the automated analyst itself. */
export type ActorType = "pap" | "user" | "system";

export type TransitionField =
  | "execution_status"
  | "pap_recommendation"
  | "process_stage"
  | "mandate_gate_override"
  | "workspace_status";

/** Immutable, append-only. Rows are never updated or deleted. */
export interface CaseTransitionEvent {
  id: string;
  caseId: string;
  field: TransitionField;
  actorType: ActorType;
  /** User id when actorType is "user", model/run id when "pap", null for "system". */
  actorId: string | null;
  previousValue: string | null;
  newValue: string;
  /** Mandatory for human overrides and for any PAP-driven change. */
  reason: string | null;
  evidenceIds: string[];
  analysisRunId: string | null;
  occurredAt: string;
}

export interface AnalysisFinding {
  id: string;
  runId: string;
  category: ScoreCategory;
  findingType: string;
  statement: string;
  confidence: number | null;
  nature: FindingNature;
  origin: FindingOrigin;
  supportingEvidenceIds: string[];
  opposingEvidenceIds: string[];
  relevantDate: string | null;
}

/** Deterministic calculations return this shape; missing inputs are never estimated. */
export type CalculationResult<T> =
  | { status: "ok"; value: T; formulaVersion: string; warnings: string[] }
  | { status: "kan_ikke_beregnes"; missingInputs: string[]; formulaVersion: string };

export type LoadState = "idle" | "loading" | "empty" | "error" | "forbidden" | "ready";
