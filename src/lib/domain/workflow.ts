/**
 * Workflow contracts for Interlect.ai.
 *
 * Three concepts are kept strictly separate:
 *  1. AnalysisExecutionStatus  — what PAP is technically doing.
 *  2. PapRecommendation        — PAP's analytical recommendation.
 *  3. InvestmentProcessStage   — where the humans are in the fund's process.
 *
 * Milestone 1: contracts only. These tables, policies and server functions are
 * implemented in later milestones; the frontend must never be the only guard.
 */

import type {
  ActorType,
  AnalysisExecutionStatus,
  FundRole,
  InvestmentProcessStage,
  PapRecommendation,
} from "./types";
import { humanOnlyStages } from "./types.ts";
import type { Language } from "../i18n/language.ts";
import { translate } from "../i18n/translate.ts";

/* ------------------------------------------------------------------ */
/* Permitted transitions                                               */
/* ------------------------------------------------------------------ */

/** PAP owns this machine end to end; humans may only retry or cancel. */
export const executionTransitions: Record<
  AnalysisExecutionStatus,
  readonly AnalysisExecutionStatus[]
> = {
  queued: ["collecting_evidence", "cancelled", "failed"],
  collecting_evidence: ["screening_in_progress", "needs_information", "failed", "cancelled"],
  screening_in_progress: ["screening_complete", "needs_information", "failed", "cancelled"],
  screening_complete: ["awaiting_approval", "deep_analysis_in_progress", "complete", "cancelled"],
  awaiting_approval: ["deep_analysis_in_progress", "complete", "cancelled"],
  deep_analysis_in_progress: ["quality_audit", "needs_information", "failed", "cancelled"],
  quality_audit: ["complete", "deep_analysis_in_progress", "failed"],
  needs_information: ["collecting_evidence", "screening_in_progress", "cancelled"],
  complete: ["queued", "collecting_evidence"],
  failed: ["queued", "cancelled"],
  cancelled: ["queued"],
};

/** Ordered human process. Forward one step, or close out, unless overridden. */
export const processStageTransitions: Record<
  InvestmentProcessStage,
  readonly InvestmentProcessStage[]
> = {
  new_case: ["initial_screening", "closed_without_investment"],
  initial_screening: ["preliminary_analysis", "closed_without_investment"],
  preliminary_analysis: ["partner_review", "closed_without_investment"],
  partner_review: ["ready_for_contact", "further_evaluation", "closed_without_investment"],
  ready_for_contact: ["contacted", "closed_without_investment"],
  contacted: ["first_meeting", "closed_without_investment"],
  first_meeting: ["further_evaluation", "due_diligence", "closed_without_investment"],
  further_evaluation: ["due_diligence", "partner_review", "closed_without_investment"],
  due_diligence: ["investment_memo", "closed_without_investment"],
  investment_memo: ["investment_committee", "closed_without_investment"],
  investment_committee: ["invested", "closed_without_investment"],
  invested: [],
  closed_without_investment: ["partner_review"],
};

export function canTransitionExecution(
  from: AnalysisExecutionStatus,
  to: AnalysisExecutionStatus,
): boolean {
  return executionTransitions[from].includes(to);
}

export function canTransitionProcessStage(
  from: InvestmentProcessStage,
  to: InvestmentProcessStage,
): boolean {
  return processStageTransitions[from].includes(to);
}

/** PAP may never assert that a human interaction happened. */
export function isHumanOnlyStage(stage: InvestmentProcessStage): boolean {
  return (humanOnlyStages as readonly InvestmentProcessStage[]).includes(stage);
}

/* ------------------------------------------------------------------ */
/* Role responsibilities                                               */
/* ------------------------------------------------------------------ */

export type Capability =
  | "view_case"
  | "write_messages"
  | "write_notes"
  | "create_case"
  | "upload_document"
  | "start_analysis"
  | "retry_analysis"
  | "cancel_analysis"
  | "review_evidence"
  | "correct_evidence"
  | "review_entity_match"
  | "manage_tasks"
  | "approve_deep_analysis"
  | "move_process_stage"
  | "decide_case"
  | "override_mandate_gate"
  | "propose_fund_change"
  | "configure_fund"
  | "publish_fund_config"
  | "manage_users"
  | "brain_chat"
  | "brain_ingest"
  | "brain_review"
  | "brain_forget";

/** The two things an Admin can switch on for Medlem, per fund (both off by default). */
export interface FundSettings {
  memberCanDecide: boolean;
  memberCanPublish: boolean;
}

export const strictFundSettings: FundSettings = { memberCanDecide: false, memberCanPublish: false };

/** "Se cases og analyser" and "Skrive i Beskeder og noter": every role, also Læser. */
const everyone: readonly Capability[] = ["view_case", "write_messages", "write_notes"];

/** Case work shared by Admin, Lead and Medlem (the rights matrix in "Brugere og adgang"). */
const caseWork: readonly Capability[] = [
  "create_case",
  "upload_document",
  "start_analysis",
  "retry_analysis",
  "cancel_analysis",
  "review_evidence",
  "correct_evidence",
  "review_entity_match",
  "manage_tasks",
  "approve_deep_analysis",
  "move_process_stage",
  "propose_fund_change",
  "brain_chat",
  "brain_ingest",
  "brain_review",
];

/** Decisions and the fund configuration: Admin and Lead. */
const leadership: readonly Capability[] = [
  "decide_case",
  "override_mandate_gate",
  "configure_fund",
  "publish_fund_config",
];

/**
 * Server-side source of truth. The UI may hide controls, but every mutation
 * must re-check this on the server together with fund membership.
 * Admin, Lead, Medlem and Læser as in the prototype "Brugere og adgang".
 */
export const roleCapabilities: Record<FundRole, readonly Capability[]> = {
  reader: everyone,
  member: [...everyone, ...caseWork],
  lead: [...everyone, ...caseWork, ...leadership],
  admin: [...everyone, ...caseWork, ...leadership, "manage_users", "brain_forget"],
};

/** Capabilities Medlem gets only when the fund has switched the setting on. */
export const memberOptIn: Partial<Record<Capability, keyof FundSettings>> = {
  decide_case: "memberCanDecide",
  publish_fund_config: "memberCanPublish",
};

/**
 * A user may hold several roles. An unknown role (e.g. an old role name) grants nothing,
 * so a code/database mismatch fails closed instead of crashing.
 */
export function hasCapability(
  roles: readonly FundRole[],
  capability: Capability,
  settings: FundSettings = strictFundSettings,
): boolean {
  if (roles.some((role) => roleCapabilities[role]?.includes(capability) ?? false)) return true;
  const setting = memberOptIn[capability];
  return setting !== undefined && settings[setting] && roles.includes("member");
}

/** Every capability the user has in the fund, for hiding controls in the UI. */
export function capabilitiesFor(
  roles: readonly FundRole[],
  settings: FundSettings = strictFundSettings,
): Capability[] {
  const all = new Set<Capability>([...everyone, ...caseWork, ...leadership]);
  all.add("manage_users");
  all.add("brain_forget");
  return [...all].filter((capability) => hasCapability(roles, capability, settings));
}

/** Which actor types are allowed to write a given field. */
export const fieldWriters: Record<
  "execution_status" | "pap_recommendation" | "process_stage" | "mandate_gate_override",
  readonly ActorType[]
> = {
  execution_status: ["pap", "system", "user"],
  pap_recommendation: ["pap", "user"],
  process_stage: ["user"],
  mandate_gate_override: ["user"],
};

/** Human-written reason is mandatory for these changes. */
export const reasonRequiredFor = [
  "mandate_gate_override",
  "process_stage",
  "pap_recommendation",
] as const;

export interface ProcessStageChangeRequest {
  from: InvestmentProcessStage;
  to: InvestmentProcessStage;
  actorType: ActorType;
  actorRoles: readonly FundRole[];
  /** The fund's Medlem settings; omitted means the strict default (off). */
  fundSettings?: FundSettings;
  reason: string | null;
}

export type AuthorizationResult =
  | { allowed: true }
  | {
      allowed: false;
      code: "forbidden_actor" | "forbidden_role" | "invalid_transition" | "reason_required";
      message: string;
    };

/** Pure rule used by both the UI and (later) the server function. */
export function authorizeProcessStageChange(
  request: ProcessStageChangeRequest,
  language: Language = "da",
): AuthorizationResult {
  if (request.actorType !== "user") {
    return {
      allowed: false,
      code: "forbidden_actor",
      message: translate(language, "appServer.workflow.forbiddenActor"),
    };
  }
  // Investeret og lukket er beslutninger (decide_case); alt andet er at flytte casen.
  const capability: Capability =
    request.to === "invested" || request.to === "closed_without_investment"
      ? "decide_case"
      : "move_process_stage";
  if (!hasCapability(request.actorRoles, capability, request.fundSettings)) {
    return {
      allowed: false,
      code: "forbidden_role",
      message: translate(language, "appServer.workflow.forbiddenRole"),
    };
  }
  if (!canTransitionProcessStage(request.from, request.to)) {
    return {
      allowed: false,
      code: "invalid_transition",
      message: translate(language, "appServer.workflow.invalidTransition"),
    };
  }
  if (!request.reason || request.reason.trim().length === 0) {
    return {
      allowed: false,
      code: "reason_required",
      message: translate(language, "appServer.workflow.reasonRequired"),
    };
  }
  return { allowed: true };
}
