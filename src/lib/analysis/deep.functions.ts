import { isCodeAnchored } from "./code-anchor";
import { gatewayErrorSummary } from "@/lib/ai/gateway-log";
import { reasonsLikelihoodAndImpact } from "./risk-reasoning";
import { enqueueBrainCapture } from "@/lib/brain/queue.server";
import { createServerFn } from "@tanstack/react-start";
import { loadCompactFinancialMetrics } from "./financial-statements";
import { withFinanceGates, loadFinanceCodeScore } from "./financial-statements";
import { waitUntil } from "@vercel/functions";
import { z } from "zod";
import { requireSupabaseAuth } from "@/lib/supabase/auth-middleware";
import { getServiceClient } from "@/lib/supabase/admin.server";
import { requireFundCapability } from "@/lib/auth/access.server";
import {
  returnFailedDeepCaseToScreening,
  staleCaseMessage,
  transitionCase,
  TransitionRefused,
} from "@/lib/cases/lifecycle.server";
import {
  expectedCaseStateSchema,
  movedSinceSeen,
  type CasePhase,
  type CaseStatus,
} from "@/lib/cases/lifecycle";
import {
  auditDeepTextLengths,
  auditRiskRationale,
  countSentences,
  CRITERION_RATIONALE,
  FINDING_STATEMENT,
  OPEN_TASK_TITLES_FOR_SYNTHESIS,
  PARTIAL_TEXT_MAX_CHARS,
  OVERALL_ASSESSMENT,
  SYNTHESIS_CRITERION_RATIONALE,
  SYNTHESIS_FINDINGS,
  SYNTHESIS_NEXT_STEPS,
  SYNTHESIS_RISK,
  SPECIALIST_HEADLINE,
  SPECIALIST_SUMMARY,
} from "./deep-text-rules";
import { outputTokenCap, synthesisReasoningEffort } from "./deep-limits";
import { mergeSpecialistRationales } from "./deep-merge";
import {
  ANALYSIS_CATEGORIES,
  categoryFallbackWarning,
  withCategoryFallbacks,
} from "./finding-categories";
import { loadOpenTaskTitles, writeAiTasks } from "@/lib/cases/ai-tasks.server";
import { deepTaskSource } from "@/lib/cases/deep-tasks";
import {
  founderQuestions,
  readStoredResearchFollowUp,
  researchDeadlineAt,
} from "./research-followup";
import type { RelatedPastCaseInput, ScreeningCaseInput } from "./prompt";
import { screeningOutputSchema } from "./contracts";
import { DEEP_FINDING_CATEGORIES, deepAnalysisOutputSchema } from "./deep.contracts";
import { financeScoreAudit, scoreScreening, SCORING_FORMULA_VERSION } from "./scoring";
import { applyGateAnswers, teamAnswersForNewRun } from "./gate-answers";
import { loadTeamGateAnswers } from "./rescore.server";
import { calculateFinance, FINANCE_FORMULA_VERSION } from "./finance";
import { FINANCE_POINT_SELECT, financeInputsFor, type FinancePointRow } from "./finance-inputs";
import { checkDeepFinancialInputs } from "./financial-input-check.server";
import {
  loadPromptEvidenceRows,
  DEEP_EVIDENCE_MAX,
  selectPromptEvidence,
  toPromptEvidence,
} from "./evidence-selection";
import {
  mapProfile,
  nextStepsJsonSchema,
  screeningJsonSchema,
  type ConfigData,
} from "./screening.functions";
import { AiDataPolicyError, aiGatewayOptions } from "../ai/gateway-options";
import { postChatCompletion } from "@/lib/ai/model-call";
import { deepRunReleasable } from "@/lib/cases/run-stall";
import { releaseStalledRun } from "./run-release.server";
import { enqueueBrainCaptureForRun } from "@/lib/brain/queue.server";
import type { Redactor } from "@/lib/ai/redact";
import { redactorForFund } from "@/lib/ai/redact-dictionary.server";
import { buildMemoryQueryText, retrieveFundMemory, type FundMemoryStatus } from "./memory";
import { specialistResearchQuestions } from "./specialist-research";
import { readStoredResearchPlan, type ResearchPlan } from "./research-plan";
import {
  EVIDENCE_SHEET_BUDGET_USD,
  EVIDENCE_SHEET_MODELS,
  EVIDENCE_SHEET_STEP,
  EVIDENCE_SHEET_TIMEOUT_MS,
  EVIDENCE_SHEET_VERSION,
  promptEvidenceSheet,
} from "./evidence-sheet";
import { runDeepEvidenceSheetStep } from "./evidence-sheet.server";
import { readCaseOwnMaterial } from "./case-material.server";
import {
  buildInvestmentCommitteeSynthesisPrompt,
  buildSpecialistPrompt,
  DEEP_PROMPT_VERSION,
  DEEP_SYNTHESIS_PROMPT_VERSION,
  DEEP_WORKFLOW_VERSION,
  isCustomSpecialist,
  isFinanceSpecialist,
  type DeepSpecialist,
} from "./specialist-prompts";
import { MAX_SPECIALISTS, specialistSetSummary } from "./specialist-set";
import { loadSpecialistSet } from "./specialist-set.server";
import { specialistOutputSchema, type SpecialistOutput } from "./specialist.contracts";
import { cardDataJsonSchema, withSanitizedCardData } from "./card-data";
import type { EvidenceStatus } from "@/lib/domain/types";
import {
  recordCvrLookupStep,
  buildFundResearchBrief,
  collectPublicCompanyResearch,
  getResearchModuleOverrides,
  loadCaseIdentityHints,
  reloadCompanyIdentity,
  PUBLIC_RESEARCH_CALL_COUNT,
  PUBLIC_RESEARCH_MODEL,
  PUBLIC_RESEARCH_VERSION,
  type PublicResearchOutput,
  type PublicResearchResult,
} from "./public-research";
import type { ResearchLogEntry } from "./public-research";
import {
  extractGatewayCostUsd,
  failedCallChargeUsd,
  ResearchFailedError,
  sumCompleteCosts,
} from "./gateway-response";
import {
  assertActualSpendWithinBudget,
  assertWithinBudget,
  budgetCharge,
  estimateRequestMaximumUsd,
  type PricedModel,
} from "./budgets";
import { DEEP_CALL_TIMEOUT_MS, planColumns } from "./model-tiers";
import { loadRunPlan } from "./run-plan.server";
import { releaseAnalysisCredits, reserveAnalysisCredits } from "../ai/credits.server";
import { withFundLanguage } from "@/lib/i18n/language-scope.server";
import { requestLanguage, serverText } from "@/lib/i18n/server-text";
import { gatewayToken, missingGatewayToken } from "@/lib/ai/gateway-token";

const fundIdSchema = z.guid();
/** The model (Middel). Runs use the fund's tier model (RunPlan). */
export const DEEP_MODEL = "openai/gpt-5.4";
/** Research, every specialist a fund can have and the synthesis. */
const MAX_DEEP_MODEL_CALLS = PUBLIC_RESEARCH_CALL_COUNT + MAX_SPECIALISTS + 1;
/**
 * A gateway call that failed after the provider may have charged for it (output cut off by the
 * token cap, or a timeout): carries what is known about the call, so the step records it.
 */
export class DeepGatewayError extends Error {
  readonly completion: DeepGatewayCompletion | null;
  /**
   * What the call charged, when the error decides it: its maximum for a call without an
   * answer (it may be billed), 0 for a call the gateway refused without usage. Null: the answer's
   * price, or its maximum, as `budgetCharge`.
   */
  readonly callChargeUsd: number | null;
  /** What is known about the failed call, saved on the step so it can be inspected. */
  readonly diagnostics: {
    finishReason: string | null;
    durationMs: number;
    maxOutputTokens: number;
    partialText?: string;
  } | null;
  constructor(
    message: string,
    completion: DeepGatewayCompletion | null,
    diagnostics: DeepGatewayError["diagnostics"] = null,
    callChargeUsd: number | null = null,
  ) {
    super(message);
    this.name = "DeepGatewayError";
    this.completion = completion;
    this.diagnostics = diagnostics;
    this.callChargeUsd = callChargeUsd;
  }
}

/** The usage of a failed call, when the error carries it. */
export function failedCallCompletion(cause: unknown): DeepGatewayCompletion | null {
  return cause instanceof DeepGatewayError ? cause.completion : null;
}

/**
 * What a failed step charged against its budget, saved as its `charged_cost` (0116): the
 * call's price, else its maximum; for the research, what its calls charged before it failed.
 * Null when nothing is known to have been sent.
 */
export function failedStepChargeUsd(
  cause: unknown,
  completion: DeepGatewayCompletion | null,
): number | null {
  if (cause instanceof ResearchFailedError) return cause.chargeUsd;
  return failedCallChargeUsd(
    completion,
    cause instanceof DeepGatewayError ? cause.callChargeUsd : null,
  );
}
export type DeepGatewayCompletion = Awaited<ReturnType<typeof callDeepGateway>>;

/**
 * A deep analysis that is queued or running but has had no new step for `STALE_DEEP_MS`
 * was stopped without reaching its error handling; starting again releases it (with what its
 * steps paid) instead of answering "already sent" for ever. The candidate becomes "failed", so
 * its research is reused like any failed run's (G25). The case stays where it is: the new run
 * starts from the same phase.
 */
async function releaseIfStalled(
  fundId: string,
  caseId: string,
  candidate: Record<string, unknown>,
): Promise<boolean> {
  const status = candidate["status"] as string;
  if (status !== "queued" && status !== "running") return false;
  const service = getServiceClient();
  const runId = candidate["id"] as string;
  const { data: steps, error } = await service
    .from("analysis_run_steps")
    .select("started_at, completed_at")
    .eq("run_id", runId)
    .eq("fund_id", fundId);
  if (error) {
    console.error(`[deep] steps of run ${runId} not read for the stall check`, error.message);
    return false;
  }
  const stalled = deepRunReleasable(
    {
      startedAt: candidate["created_at"] as string,
      steps: (steps ?? []).map((step) => ({
        startedAt: step["started_at"] as string | null,
        completedAt: step["completed_at"] as string | null,
      })),
    },
    Date.now(),
  );
  if (!stalled) return false;
  const released = await releaseStalledRun(service, {
    fundId,
    runId,
    caseId,
    message: serverText("analysisServer.deep.released"),
    logTag: "deep",
  }).catch((cause: unknown) => {
    console.error(`[deep] stalled run ${runId} not released`, errorMessage(cause, "unknown"));
    return false;
  });
  if (!released) return false;
  candidate["status"] = "failed";
  // Like any failed run, what it got done becomes case knowledge.
  await enqueueBrainCaptureForRun(runId);
  return true;
}

export const approveAndRunDeepAnalysis = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        caseId: z.guid(),
        fundId: fundIdSchema,
        /** The phase and status the page showed (harden G4). */
        expected: expectedCaseStateSchema.optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: configRow, error: configError } = await context.supabase
      .from("fund_config_versions")
      .select(
        `id, fund_id, profile_key, version, funds(name, language),
        fund_mandates(thesis, stages, geographies, sectors, fund_size_eur, ticket_min_eur, ticket_max_eur, ticket_note, analysis_threshold, approval_mode, risk_posture, strategy_type, stage_expectations, dealbreakers, screening_instruction),
        mandate_gates(gate_key, label, description, treatment, sort_order),
        assessment_criteria(criterion_key, label, description, score_category, weight, sort_order, code_anchor)`,
      )
      .eq("fund_id", data.fundId)
      .eq("status", "active")
      .single();
    if (configError || !configRow)
      throw new Error(serverText("analysisServer.common.profileNotLoaded"));
    const config = configRow as unknown as ConfigData;
    await requireFundCapability(
      context.supabase,
      context.userId,
      config.fund_id,
      "approve_deep_analysis",
    );

    // The fund's own set of specialists of the active version, with its module text.
    const { set: specialists } = await loadSpecialistSet(context.supabase, config.id);
    // The publish rule in 0076 keeps one specialist active; never pay for research without one.
    if (specialists.length === 0) {
      throw new Error(serverText("analysisServer.common.noSpecialists"));
    }

    const { data: screeningRun } = await context.supabase
      .from("analysis_runs")
      .select(
        "id, status, raw_response, input_evidence_ids, recommendations(overall_score, recommendation, rationale)",
      )
      .eq("case_id", data.caseId)
      .eq("fund_id", data.fundId)
      .eq("config_version_id", config.id)
      .eq("kind", "screening")
      .in("status", ["awaiting_approval", "complete"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!screeningRun) {
      throw new Error(serverText("analysisServer.deep.needsScreening"));
    }

    // Tier, model and cap are resolved once here and kept on the run.
    const plan = await loadRunPlan(getServiceClient(), data.fundId, "deep", specialists.length);

    // Versions and model are not readable with the member's own key.
    const { data: priorDeepRuns, error: priorDeepRunsError } = await getServiceClient()
      .from("analysis_runs")
      .select(
        "id, status, created_at, config_version_id, workflow_version, prompt_template_version, model_name",
      )
      .eq("fund_id", data.fundId)
      .eq("case_id", data.caseId)
      .eq("previous_run_id", screeningRun["id"])
      .eq("kind", "deep")
      .in("status", ["queued", "running", "complete", "failed", "cancelled"])
      .order("created_at", { ascending: false });
    if (priorDeepRunsError) {
      throw new Error(serverText("analysisServer.deep.earlierNotChecked"));
    }
    const blockingDeep = (priorDeepRuns ?? []).find((candidate) => {
      const status = candidate["status"] as string;
      if (status === "queued" || status === "running") return true;
      if (status !== "complete") return false;
      return (
        candidate["config_version_id"] === config.id &&
        candidate["workflow_version"] === DEEP_WORKFLOW_VERSION &&
        candidate["prompt_template_version"] === DEEP_PROMPT_VERSION &&
        candidate["model_name"] === plan.model
      );
    });
    if (blockingDeep && !(await releaseIfStalled(data.fundId, data.caseId, blockingDeep))) {
      throw new Error(serverText("analysisServer.deep.alreadySent"));
    }
    // Every finished run (also a complete one) starts a new generation of the key below: a new
    // run on another level after a complete one must not collide with it (found live).
    const latestTerminalDeep = (priorDeepRuns ?? []).find((candidate) =>
      ["failed", "cancelled", "complete"].includes(candidate["status"] as string),
    );
    // Genbrug af research kun fra en fejlet kørsel, også når en annulleret kom efter (G25).
    const latestFailedDeep = (priorDeepRuns ?? []).find(
      (candidate) => candidate["status"] === "failed",
    );

    const { data: caseRow, error: caseError } = await context.supabase
      .from("cases")
      .select(
        "id, fund_id, phase, status, execution_status, primary_origin, companies(name, website, stage, sector, geography, description)",
      )
      .eq("id", data.caseId)
      .eq("fund_id", data.fundId)
      .single();
    if (caseError || !caseRow) throw new Error(serverText("analysisServer.common.caseNotFound"));
    // En besluttet case skal genåbnes (en beslutning), før den kan analyseres igen.
    if (caseRow["phase"] === "decided") {
      throw new Error(serverText("analysisServer.deep.caseDecided"));
    }
    if (
      movedSinceSeen(data.expected, {
        phase: caseRow["phase"] as CasePhase,
        status: caseRow["status"] as CaseStatus,
      })
    ) {
      throw new Error(staleCaseMessage());
    }
    const { data: initialEvidenceRows, error: evidenceError } = await loadPromptEvidenceRows(
      context.supabase,
      data.fundId,
      data.caseId,
    );
    if (evidenceError || !initialEvidenceRows?.length)
      throw new Error("Den grundige analyse mangler evidens.");

    const profile = mapProfile(config);
    const rawCompany = caseRow["companies"] as unknown;
    const company = (Array.isArray(rawCompany) ? rawCompany[0] : rawCompany) as {
      name: string;
      website: string | null;
      stage: string;
      sector: string | null;
      geography: string | null;
      description: string | null;
    };
    let evidenceRows = selectPromptEvidence(
      initialEvidenceRows as Array<Record<string, unknown>>,
      DEEP_EVIDENCE_MAX,
    );
    let evidenceIds = evidenceRows.map((row) => row["id"] as string);
    let input = buildDeepCaseInput(
      data.caseId,
      company,
      caseRow["primary_origin"] as ScreeningCaseInput["intakeSources"][number],
      evidenceRows,
    );

    const service = getServiceClient();
    const identityHints = await loadCaseIdentityHints(service, data.fundId, data.caseId);
    input = { ...input, founders: identityHints.founders };
    // Et afsluttet run (fejlet, annulleret eller færdigt) bliver selve generationen, og modellen
    // er med i nøglen. To samtidige klik rammer derfor den samme unikke nøgle, mens næste
    // reelle kørsel får en ny.
    const retryGeneration = latestTerminalDeep?.["id"] ?? "initial";
    const idempotencyKey = `deep:${data.caseId}:${config.id}:${screeningRun["id"] as string}:${DEEP_PROMPT_VERSION}:${plan.model}:${retryGeneration}`;
    // The research carries the fund's own specialists' questions, so it is reused only from
    // a failed run on the same configuration and prompt version (as the worker does).
    const sameSetupFailedRunId =
      latestFailedDeep &&
      latestFailedDeep["config_version_id"] === config.id &&
      latestFailedDeep["prompt_template_version"] === DEEP_PROMPT_VERSION
        ? (latestFailedDeep["id"] as string)
        : null;
    const reusablePublicResearch = sameSetupFailedRunId
      ? await loadReusablePublicResearch(service, sameSetupFailedRunId)
      : null;
    // A plan the failed run saved before its research failed is reused unpaid.
    const reusableResearchPlan =
      sameSetupFailedRunId && !reusablePublicResearch
        ? await loadReusableResearchPlan(service, sameSetupFailedRunId)
        : null;
    // Loftet reserveres, før kørslen oprettes; ved tom saldo starter ingen analyse.
    const reservedRunId = crypto.randomUUID();
    const creditLedgerId = await reserveAnalysisCredits(service, {
      fundId: config.fund_id,
      runId: reservedRunId,
      capUsd: plan.budget.usd,
      userId: context.userId,
      model: plan.model,
      kind: "deep_analysis",
    });
    const { data: run, error: runError } = await service
      .from("analysis_runs")
      .insert({
        id: reservedRunId,
        fund_id: config.fund_id,
        case_id: data.caseId,
        config_version_id: config.id,
        previous_run_id: screeningRun["id"],
        kind: "deep",
        status: "queued",
        workflow_version: DEEP_WORKFLOW_VERSION,
        prompt_template_name: "specialists-and-ic-synthesis",
        prompt_template_version: DEEP_PROMPT_VERSION,
        model_provider: "vercel-ai-gateway",
        model_name: plan.model,
        ...planColumns(plan),
        estimated_cost: plan.budget.usd,
        idempotency_key: idempotencyKey,
        input_evidence_ids: evidenceIds,
        requested_by: context.userId,
        approved_by: context.userId,
        approved_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (runError || !run) {
      await releaseAnalysisCredits(service, creditLedgerId);
      throw new Error(serverText("analysisServer.deep.notStarted"));
    }
    const runId = run["id"] as string;
    const stepRows = [
      {
        fund_id: config.fund_id,
        run_id: runId,
        step_key: "public_research",
        step_order: 1,
        status: "queued",
        model_name: PUBLIC_RESEARCH_MODEL,
        prompt_version: PUBLIC_RESEARCH_VERSION,
      },
      {
        // The research condensed to one sheet per criterion and gate, its own phase.
        fund_id: config.fund_id,
        run_id: runId,
        step_key: EVIDENCE_SHEET_STEP,
        step_order: 2,
        status: "queued",
        model_name: EVIDENCE_SHEET_MODELS.deep[plan.tier],
        prompt_version: EVIDENCE_SHEET_VERSION,
      },
      ...specialists.map((module, index) => ({
        fund_id: config.fund_id,
        run_id: runId,
        step_key: module.id,
        step_order: index + 3,
        status: "queued",
        model_name: plan.model,
        prompt_version: DEEP_PROMPT_VERSION,
      })),
      {
        fund_id: config.fund_id,
        run_id: runId,
        step_key: "investment_committee_synthesis",
        step_order: specialists.length + 3,
        status: "queued",
        model_name: plan.model,
        // Its own version: the synthesis can change without making the paid research and
        // specialist steps of a failed run unusable for the retry (they key on DEEP_PROMPT_VERSION).
        prompt_version: DEEP_SYNTHESIS_PROMPT_VERSION,
      },
    ];
    const { error: jobError } = await service.from("analysis_jobs").insert({
      fund_id: config.fund_id,
      case_id: data.caseId,
      run_id: runId,
      kind: "deep",
      status: "queued",
      idempotency_key: idempotencyKey,
      attempt_count: 0,
    });
    const { error: stepsError } = await service.from("analysis_run_steps").insert(stepRows);
    if (jobError || stepsError) {
      console.error("[deep] register", jobError?.message ?? stepsError?.message);
      const cleanup = await Promise.all([
        service
          .from("analysis_runs")
          .update({
            status: "failed",
            error_message: serverText("analysisServer.common.jobNotRegistered"),
          })
          .eq("id", runId),
        service
          .from("analysis_jobs")
          .update({
            status: "failed",
            last_error: serverText("analysisServer.deep.stepsNotRegistered"),
          })
          .eq("run_id", runId),
      ]);
      for (const { error: cleanupError } of cleanup) {
        if (cleanupError) console.error(`[deep] cleanup of run ${runId}`, cleanupError.message);
      }
      throw new Error(serverText("analysisServer.common.jobNotRegisteredSafely"));
    }

    const queuedAt = new Date().toISOString();
    const previousExecutionStatus = caseRow["execution_status"] as string;
    const { error: queuedError } = await service
      .from("cases")
      .update({ execution_status: "queued", updated_at: queuedAt })
      .eq("id", data.caseId)
      .eq("fund_id", data.fundId);
    if (queuedError) console.error("[deep] case queued", queuedError.message);
    // Dyb analyse flytter kun en case frem fra Screening. En case i Dyb analyse eller Komité
    // bliver, hvor den er (harden); status bliver Aktiv. Overgangen går gennem den loggede
    // transition_case (0033) og kun, hvis casen stadig står, som den blev læst ovenfor. Afvises
    // den, annulleres kørslen (det er ikke en fejlet analyse), og casen får sin status tilbage.
    const fromPhase = caseRow["phase"] as CasePhase;
    const fromStatus = caseRow["status"] as CaseStatus;
    const toPhase: CasePhase | null = fromPhase === "screening" ? "deep_analysis" : null;
    if (toPhase !== null || fromStatus !== "active") {
      try {
        const outcome = await transitionCase(service, {
          fundId: data.fundId,
          caseId: data.caseId,
          actorId: context.userId,
          toPhase,
          toStatus: "active",
          expectedPhase: fromPhase,
          expectedStatus: fromStatus,
          note: serverText("analysisServer.deep.queuedManually"),
          analysisRunId: runId,
        });
        if (
          !outcome.changed &&
          (outcome.fromPhase !== fromPhase || outcome.fromStatus !== fromStatus)
        ) {
          throw new TransitionRefused(staleCaseMessage());
        }
      } catch (cause) {
        const message = errorMessage(cause, serverText("analysisServer.deep.notMoved"));
        const cleanup = await Promise.all([
          service
            .from("analysis_runs")
            .update({ status: "cancelled", error_message: message, completed_at: queuedAt })
            .eq("id", runId),
          service
            .from("analysis_jobs")
            .update({ status: "cancelled", last_error: message, updated_at: queuedAt })
            .eq("run_id", runId),
          service
            .from("cases")
            .update({ execution_status: previousExecutionStatus, updated_at: queuedAt })
            .eq("id", data.caseId)
            .eq("fund_id", data.fundId),
        ]);
        for (const { error: cleanupError } of cleanup) {
          if (cleanupError) console.error(`[deep] cleanup of run ${runId}`, cleanupError.message);
        }
        throw new Error(message);
      }
    }

    const executeDeepAnalysis = async () => {
      let activeStepKey: string | null = null;
      let fundMemoryStatus: FundMemoryStatus = "off";
      let publicResearch: Awaited<ReturnType<typeof collectPublicCompanyResearch>> | null = null;
      let synthesisCompletion: DeepGatewayCompletion | null = null;
      try {
        const startedAt = new Date().toISOString();
        await Promise.all([
          service
            .from("analysis_runs")
            .update({ status: "running", started_at: startedAt })
            .eq("id", runId),
          service
            .from("analysis_jobs")
            .update({
              status: "running",
              attempt_count: 1,
              locked_at: startedAt,
              locked_by: "vercel-wait-until",
              updated_at: startedAt,
            })
            .eq("run_id", runId),
        ]);
        await service
          .from("cases")
          .update({
            execution_status: "deep_analysis_in_progress",
            updated_at: new Date().toISOString(),
          })
          .eq("id", data.caseId)
          .eq("fund_id", data.fundId);
        if (PUBLIC_RESEARCH_CALL_COUNT + specialists.length + 1 > MAX_DEEP_MODEL_CALLS) {
          throw new Error(serverText("analysisServer.common.deepOverBudget"));
        }

        activeStepKey = "public_research";
        // The case's own unread files and more of its website, alongside the research.
        const caseMaterial = readCaseOwnMaterial({
          service,
          fundId: data.fundId,
          caseId: data.caseId,
          actorId: context.userId,
        });
        if (reusablePublicResearch) {
          publicResearch = reusablePublicResearch.result;
        } else {
          await service
            .from("analysis_run_steps")
            .update({ status: "running", attempt_count: 1, started_at: new Date().toISOString() })
            .eq("run_id", runId)
            .eq("step_key", activeStepKey);
          const researchModuleOverrides = await getResearchModuleOverrides(service, config.id);
          publicResearch = await collectPublicCompanyResearch({
            service,
            fundId: data.fundId,
            caseId: data.caseId,
            actorId: context.userId,
            companyName: company.name,
            website: company.website,
            stage: company.stage,
            // The evidence sheet's share is set aside from the research budget.
            researchBudgetUsd: plan.budget.researchUsd - EVIDENCE_SHEET_BUDGET_USD.deep,
            researchModuleOverrides,
            fundResearchBrief: buildFundResearchBrief(profile),
            specialistQuestions: specialistResearchQuestions(
              specialists,
              buildFundResearchBrief(profile),
              profile.screeningInstruction,
            ),
            researchPlan: {
              tier: plan.tier,
              setup: {
                profile,
                screeningInstruction: profile.screeningInstruction,
                specialists,
              },
              reuse: reusableResearchPlan,
              onPlan: (researchPlan) =>
                saveResearchPlanOnStep(service, runId, "public_research", researchPlan),
            },
            researchDeadlineAt: researchDeadlineAt("deep", Date.now()),
            identityHints,
          });
          await recordCvrLookupStep(service, {
            fundId: data.fundId,
            runId,
            outcome: publicResearch.cvrLookup,
          });
        }
        const material = await caseMaterial;
        const refreshedIdentity = await reloadCompanyIdentity(service, data.fundId, data.caseId);
        if (refreshedIdentity) {
          company.name = refreshedIdentity.name;
          company.stage = refreshedIdentity.stage;
        }
        await service
          .from("analysis_run_steps")
          .update({
            status: "complete",
            input_tokens: publicResearch.inputTokens,
            output_tokens: publicResearch.outputTokens,
            total_tokens: publicResearch.totalTokens,
            actual_cost: publicResearch.actualCostUsd,
            output_json: {
              ...publicResearch.packet,
              persistedSources: publicResearch.sourceCount,
              persistedEvidence: publicResearch.insertedEvidence,
              researchLog: publicResearch.researchLog ?? null,
              researchPlan: publicResearch.researchPlan ?? null,
              researchPlanStatus: publicResearch.researchPlanStatus ?? null,
              questionNeutralizer: publicResearch.questionNeutralizer ?? null,
              researchFollowUp: publicResearch.researchFollowUp ?? null,
              caseMaterial: material,
              ...(reusablePublicResearch ? { reusedFromRunId: reusablePublicResearch.runId } : {}),
            },
            completed_at: new Date().toISOString(),
          })
          .eq("run_id", runId)
          .eq("step_key", activeStepKey);
        activeStepKey = null;

        const { data: refreshedEvidence, error: refreshedEvidenceError } =
          await loadPromptEvidenceRows(service, data.fundId, data.caseId);
        if (refreshedEvidenceError || !refreshedEvidence?.length) {
          throw new Error(serverText("analysisServer.common.basisNotReloaded"));
        }
        evidenceRows = selectPromptEvidence(
          refreshedEvidence as Array<Record<string, unknown>>,
          DEEP_EVIDENCE_MAX,
        );
        await service
          .from("analysis_runs")
          .update({ input_evidence_ids: evidenceRows.map((row) => row["id"] as string) })
          .eq("id", runId);
        // The evidence sheet (the hosted queue runs it as its own phase).
        const evidenceSheetStartedAt = Date.now();
        await service
          .from("analysis_run_steps")
          .update({ status: "running", attempt_count: 1, started_at: new Date().toISOString() })
          .eq("run_id", runId)
          .eq("step_key", EVIDENCE_SHEET_STEP);
        const evidenceSheetResult = await runDeepEvidenceSheetStep({
          service,
          fundId: data.fundId,
          runId,
          tier: plan.tier,
          profile,
          evidenceRows,
          researchOutput: {
            researchPlan: publicResearch?.researchPlan ?? null,
            researchFollowUp: publicResearch?.researchFollowUp ?? null,
          },
          priorFailedRunId: null,
          timeLeftMs: evidenceSheetStartedAt + EVIDENCE_SHEET_TIMEOUT_MS.deep - Date.now(),
        });
        evidenceRows = evidenceSheetResult.evidenceRows;
        evidenceIds = evidenceRows.map((row) => row["id"] as string);
        const fundMemory = await retrieveFundMemory({
          service,
          fundId: config.fund_id,
          caseId: data.caseId,
          runId,
          queryText: buildMemoryQueryText({
            companyName: company.name,
            sector: company.sector,
            geography: company.geography,
            stage: company.stage,
            description: company.description,
          }),
        });
        fundMemoryStatus = fundMemory.status;
        input = buildDeepCaseInput(
          data.caseId,
          company,
          caseRow["primary_origin"] as ScreeningCaseInput["intakeSources"][number],
          evidenceRows,
          fundMemory.cases,
          identityHints.founders,
        );
        if (evidenceSheetResult.sheet) {
          input = { ...input, evidenceSheet: promptEvidenceSheet(evidenceSheetResult.sheet) };
        }

        const rawRecommendation = screeningRun["recommendations"] as unknown;
        const screeningRecommendation = (
          Array.isArray(rawRecommendation) ? rawRecommendation[0] : rawRecommendation
        ) as {
          overall_score: number | null;
          recommendation: string | null;
          rationale: string | null;
        } | null;
        const parsedScreening = screeningOutputSchema.safeParse(screeningRun["raw_response"]);
        const [computedFinancials, financeScore] = await Promise.all([
          loadCompactFinancialMetrics(service, data.fundId, data.caseId),
          loadFinanceCodeScore(service, {
            fundId: data.fundId,
            caseId: data.caseId,
            stage: company.stage,
            hasFinanceCriterion: profile.criteria.some(isCodeAnchored),
          }),
        ]);
        const promptInput = {
          caseInput:
            financeScore?.score != null
              ? { ...input, financeCodeScore: financeScore.score }
              : input,
          computedFinancials,
          screening: {
            runId: screeningRun["id"] as string,
            overallScore:
              screeningRecommendation?.overall_score == null
                ? null
                : Number(screeningRecommendation.overall_score),
            recommendation: screeningRecommendation?.recommendation ?? null,
            rationale: screeningRecommendation?.rationale ?? null,
            inputEvidenceIds: Array.isArray(screeningRun["input_evidence_ids"])
              ? (screeningRun["input_evidence_ids"] as string[])
              : [],
            snapshot: parsedScreening.success ? parsedScreening.data : null,
          },
        };
        const reusableSpecialistRunId = latestFailedDeep
          ? (latestFailedDeep["id"] as string)
          : null;
        const reusableSpecialists =
          latestFailedDeep &&
          latestFailedDeep["config_version_id"] === config.id &&
          latestFailedDeep["workflow_version"] === DEEP_WORKFLOW_VERSION &&
          latestFailedDeep["prompt_template_version"] === DEEP_PROMPT_VERSION &&
          latestFailedDeep["model_name"] === plan.model
            ? await loadReusableSpecialists({
                service,
                failedRunId: latestFailedDeep["id"] as string,
                profile,
                caseId: data.caseId,
                allowedEvidenceIds: new Set(evidenceIds),
                model: plan.model,
                specialists,
              })
            : new Map<string, SpecialistOutput>();
        const specialistResults = await Promise.all(
          specialists.map(async (module) => {
            const reusablePacket = reusableSpecialists.get(module.id);
            if (reusablePacket) {
              await service
                .from("analysis_run_steps")
                .update({
                  status: "complete",
                  attempt_count: 0,
                  input_tokens: 0,
                  output_tokens: 0,
                  total_tokens: 0,
                  actual_cost: 0,
                  output_json: reusablePacket,
                  error_message: null,
                  completed_at: new Date().toISOString(),
                })
                .eq("run_id", runId)
                .eq("step_key", module.id);
              return {
                packet: reusablePacket,
                completion: null,
                error: null,
                reusedFromRunId: reusableSpecialistRunId,
              };
            }
            await service
              .from("analysis_run_steps")
              .update({ status: "running", attempt_count: 1, started_at: new Date().toISOString() })
              .eq("run_id", runId)
              .eq("step_key", module.id);
            let completion: DeepGatewayCompletion | null = null;
            try {
              const specialistPrompt = buildSpecialistPrompt(profile, promptInput, module);
              completion = await callDeepGateway(
                specialistPrompt.system,
                specialistPrompt.user,
                `pap_specialist_${module.id}`,
                specialistJsonSchema(profile, module, evidenceIds),
                outputTokenCap("specialist", plan.tier, plan.model),
                plan.budget.specialistsUsd / specialists.length,
                DEEP_CALL_TIMEOUT_MS[plan.tier].specialist,
                "low",
                plan.model,
                await redactorForFund(data.fundId, "deep_analysis", service),
              );
              const parsedPacket = specialistOutputSchema.parse(JSON.parse(completion.content));
              const packet = withSanitizedCardData<SpecialistOutput>(
                {
                  ...parsedPacket,
                  findings: withCategoryFallbacks(
                    parsedPacket.findings,
                    module.categories,
                    [],
                    requestLanguage(),
                  ).findings,
                },
                evidenceIds,
              );
              validateSpecialistPacket(packet, module, profile, data.caseId, new Set(evidenceIds));
              await service
                .from("analysis_run_steps")
                .update({
                  status: "complete",
                  input_tokens: completion.inputTokens,
                  output_tokens: completion.outputTokens,
                  total_tokens: completion.totalTokens,
                  actual_cost: completion.actualCostUsd,
                  output_json: packet,
                  completed_at: new Date().toISOString(),
                })
                .eq("run_id", runId)
                .eq("step_key", module.id);
              return { packet, completion, error: null, reusedFromRunId: null };
            } catch (cause) {
              const message = errorMessage(cause, "Specialistanalysen fejlede.");
              completion = completion ?? failedCallCompletion(cause);
              await service
                .from("analysis_run_steps")
                .update({
                  status: "failed",
                  error_message: message,
                  ...completionUsage(completion),
                  completed_at: new Date().toISOString(),
                })
                .eq("run_id", runId)
                .eq("step_key", module.id);
              return { packet: null, completion, error: message, reusedFromRunId: null };
            }
          }),
        );
        const failedSpecialist = specialistResults.find((result) => result.error !== null);
        if (failedSpecialist) {
          throw new Error(
            failedSpecialist.error ?? serverText("analysisServer.common.specialistFailed"),
          );
        }
        const completedSpecialistResults = specialistResults as Array<{
          packet: SpecialistOutput;
          completion: Awaited<ReturnType<typeof callDeepGateway>> | null;
          error: null;
          reusedFromRunId: string | null;
        }>;
        const specialistPackets: SpecialistOutput[] = completedSpecialistResults.map(
          (result) => result.packet,
        );
        const chargedSpecialistUsd = completedSpecialistResults.reduce(
          (sum, result) =>
            sum +
            (result.completion
              ? budgetCharge(result.completion.actualCostUsd, result.completion.estimatedMaximumUsd)
              : 0),
          0,
        );
        assertActualSpendWithinBudget(
          chargedSpecialistUsd,
          plan.budget.specialistsUsd,
          "Specialistanalyserne",
          requestLanguage(),
        );
        let totalTokens =
          (publicResearch.totalTokens ?? 0) +
          completedSpecialistResults.reduce(
            (sum, result) => sum + (result.completion?.totalTokens ?? 0),
            0,
          );
        let inputTokens =
          (publicResearch.inputTokens ?? 0) +
          completedSpecialistResults.reduce(
            (sum, result) => sum + (result.completion?.inputTokens ?? 0),
            0,
          );
        let outputTokens =
          (publicResearch.outputTokens ?? 0) +
          completedSpecialistResults.reduce(
            (sum, result) => sum + (result.completion?.outputTokens ?? 0),
            0,
          );
        let totalCostUsd = sumCompleteCosts([
          publicResearch.actualCostUsd,
          ...completedSpecialistResults.map((result) => result.completion?.actualCostUsd ?? null),
        ]);

        activeStepKey = "investment_committee_synthesis";
        await service
          .from("analysis_run_steps")
          .update({ status: "running", attempt_count: 1, started_at: new Date().toISOString() })
          .eq("run_id", runId)
          .eq("step_key", activeStepKey);
        const openTaskTitles = await loadOpenTaskTitles(
          service,
          data.fundId,
          data.caseId,
          OPEN_TASK_TITLES_FOR_SYNTHESIS,
          "deep",
        );
        const synthesisPrompt = buildInvestmentCommitteeSynthesisPrompt(
          profile,
          promptInput,
          specialistPackets,
          openTaskTitles,
          specialists,
        );
        // Teamets gate-svar læses før det betalte kald (harden G11).
        const storedTeamAnswers = await loadTeamGateAnswers(service, {
          fundId: data.fundId,
          caseId: data.caseId,
        });
        const completion = await callDeepGateway(
          synthesisPrompt.system,
          synthesisPrompt.user,
          "pap_deep_v1",
          deepJsonSchema(profile, evidenceIds),
          outputTokenCap("synthesis", plan.tier, plan.model),
          plan.budget.synthesisUsd,
          DEEP_CALL_TIMEOUT_MS[plan.tier].synthesis,
          synthesisReasoningEffort(plan.model),
          plan.model,
          await redactorForFund(data.fundId, "deep_analysis", service),
        );
        synthesisCompletion = completion;
        totalTokens += completion.totalTokens ?? 0;
        inputTokens += completion.inputTokens ?? 0;
        outputTokens += completion.outputTokens ?? 0;
        totalCostUsd = sumCompleteCosts([totalCostUsd, completion.actualCostUsd]);
        const chargedSynthesisUsd = budgetCharge(
          completion.actualCostUsd,
          completion.estimatedMaximumUsd,
        );
        assertActualSpendWithinBudget(
          chargedSynthesisUsd,
          plan.budget.synthesisUsd,
          "Komitésyntesen",
          requestLanguage(),
        );
        const chargedDeepUsd =
          publicResearch.budgetChargeUsd + chargedSpecialistUsd + chargedSynthesisUsd;
        assertActualSpendWithinBudget(
          chargedDeepUsd,
          plan.budget.usd,
          "Den dybe analyse",
          requestLanguage(),
        );
        // C7: fondens finans-gates regnes i kode, ikke af AI.
        const gatedOutput = await withFinanceGates(
          service,
          {
            fundId: data.fundId,
            caseId: data.caseId,
            stage: company.stage,
            gateKeys: profile.gates.map((gate) => gate.key),
          },
          deepAnalysisOutputSchema.parse(JSON.parse(completion.content)),
        );
        const categories = withCategoryFallbacks(
          gatedOutput.findings,
          ANALYSIS_CATEGORIES,
          specialistPackets.flatMap((packet) => packet.findings),
          requestLanguage(),
        );
        // See deep-worker.server.ts; the same check on the direct path.
        const financeCheck = await checkDeepFinancialInputs(service, {
          fundId: data.fundId,
          caseId: data.caseId,
          inputs: gatedOutput.financialInputs,
          evidenceRows,
          language: requestLanguage(),
          registryUnreadableWarning: serverText("analysisServer.financeCheck.registryUnreadable"),
        });
        const output = {
          ...gatedOutput,
          financialInputs: financeCheck.kept,
          findings: categories.findings,
          // The long criterion texts come from the specialists (code, not the model).
          assessments: mergeSpecialistRationales(gatedOutput.assessments, specialistPackets),
        };
        if (output.caseId !== data.caseId)
          throw new Error(serverText("analysisServer.common.otherCase"));
        validateReferences(output, new Set(evidenceIds));
        validateSynthesizedFinancialInputs(output, specialistPackets);
        const qualityAudit = auditDeepOutput(output, profile);
        qualityAudit.warnings.push(...financeCheck.warnings);
        qualityAudit.warnings.push(
          ...categoryFallbackWarning(categories.added, categories.copied, requestLanguage()),
        );
        if (qualityAudit.blockingErrors.length) {
          throw new Error(
            `Kvalitetskontrollen afviste analysen: ${qualityAudit.blockingErrors.join(" ")}`,
          );
        }
        await service
          .from("analysis_run_steps")
          .update({
            status: "complete",
            input_tokens: completion.inputTokens,
            output_tokens: completion.outputTokens,
            total_tokens: completion.totalTokens,
            actual_cost: completion.actualCostUsd,
            output_json: output,
            completed_at: new Date().toISOString(),
          })
          .eq("run_id", runId)
          .eq("step_key", activeStepKey);
        activeStepKey = null;
        const screeningShape = { ...output, schemaVersion: "interlect-screening-v1" as const };
        // Teamets gate-svar under samme opsætning gælder også for den dybe analyse (harden F2).
        const teamAnswers = teamAnswersForNewRun(storedTeamAnswers, {
          configVersionId: config.id,
          verdicts: new Map(output.gates.map((gate) => [gate.gateKey, gate.passed])),
        });
        const result = scoreScreening(
          profile,
          applyGateAnswers(screeningShape, teamAnswers),
          company.stage,
          financeScore,
        );
        const assessmentByKey = new Map(
          output.assessments.map((item) => [item.criterionKey, item]),
        );

        const { error: categoryScoreError } = await service.from("category_scores").insert(
          result.criteria.map((criterion) => ({
            fund_id: config.fund_id,
            run_id: runId,
            category: criterion.criterionKey,
            proposed_score: assessmentByKey.get(criterion.criterionKey)?.proposedScore ?? null,
            validated_score: criterion.score,
            weight: criterion.weight,
            confidence: criterion.confidence,
            rationale:
              criterion.codeRationale ??
              assessmentByKey.get(criterion.criterionKey)?.rationale ??
              serverText("analysisServer.common.noAssessment"),
          })),
        );
        if (categoryScoreError)
          throw new Error(serverText("analysisServer.common.deepScoresNotSaved"));
        if (output.findings.length) {
          const { data: insertedFindings, error: findingError } = await service
            .from("analysis_findings")
            .insert(
              output.findings.map((finding) => ({
                fund_id: config.fund_id,
                run_id: runId,
                category: finding.category,
                finding_type: finding.findingType,
                statement: finding.statement,
                confidence: finding.confidence,
                nature: finding.nature,
                origin:
                  (finding as { origin?: string }).origin === "deterministic"
                    ? "deterministic"
                    : "model",
              })),
            )
            .select("id");
          if (findingError) throw findingError;
          const links = (insertedFindings ?? []).flatMap((row, index) =>
            (output.findings[index]?.evidenceIds ?? []).map((evidenceId) => ({
              fund_id: config.fund_id,
              finding_id: row["id"],
              evidence_id: evidenceId,
              supports: true,
            })),
          );
          if (links.length) {
            const { error: linkError } = await service
              .from("analysis_finding_evidence")
              .insert(links);
            if (linkError) throw linkError;
          }
        }
        if (output.risks.length) {
          const { error: riskError } = await service.from("risks").insert(
            output.risks.map((risk) => ({
              fund_id: config.fund_id,
              run_id: runId,
              category: risk.riskKey,
              level: risk.level,
              likelihood: risk.likelihood,
              impact: risk.impact,
              statement: risk.rationale,
              mitigation: risk.mitigation,
              evidence_ids: risk.evidenceIds,
            })),
          );
          if (riskError) throw new Error(serverText("analysisServer.common.deepRisksNotSaved"));
        }

        let calculations: ReturnType<typeof calculateFinance> = [];
        if (output.financialInputs.length) {
          const { data: inserted, error: financialError } = await service
            .from("financial_data_points")
            .insert(
              output.financialInputs.map((point) => ({
                fund_id: caseRow["fund_id"],
                case_id: data.caseId,
                metric: point.metric,
                value: point.value,
                unit: point.unit,
                period_start: normalizeFinancialDate(point.periodStart, "start"),
                period_end: normalizeFinancialDate(point.periodEnd, "end"),
                evidence_id: point.evidenceId,
              })),
            )
            .select("id, metric, value, unit");
          if (financialError) throw financialError;
          // The specialist's figures, topped up with the register's for what it did not give.
          const { data: caseFinanceRows, error: caseFinanceError } = await service
            .from("financial_data_points")
            .select(FINANCE_POINT_SELECT)
            .eq("fund_id", caseRow["fund_id"] as string)
            .eq("case_id", data.caseId);
          if (caseFinanceError) {
            console.error("[deep] finance inputs", caseFinanceError.message);
            throw new Error(serverText("analysisServer.common.financeNotSaved"));
          }
          calculations = calculateFinance(
            financeInputsFor(
              (caseFinanceRows ?? []) as unknown as FinancePointRow[],
              new Set((inserted ?? []).map((point) => point["id"] as string)),
            ),
            requestLanguage(),
          );
          const { error: calculationError } = await service.from("calculation_results").insert(
            calculations.map((item) => ({
              fund_id: config.fund_id,
              run_id: runId,
              metric: item.metric,
              status: item.status,
              value: item.value,
              unit: item.unit,
              formula_version: FINANCE_FORMULA_VERSION,
              input_ids: item.inputIds,
              missing_inputs: item.missingInputs,
              warnings: item.warnings,
            })),
          );
          if (calculationError)
            throw new Error(serverText("analysisServer.common.financeNotSaved"));
        }

        const rationale = [
          output.overallAssessment,
          serverText("analysisServer.deep.contrary", { text: output.contraryCase }),
        ].join("\n\n");
        const assessmentConfidence = average(output.assessments.map((item) => item.confidence));
        const { error: recommendationError } = await service.from("recommendations").insert({
          fund_id: config.fund_id,
          run_id: runId,
          recommendation: result.recommendation,
          overall_score: result.overallScore,
          evidence_confidence:
            assessmentConfidence === null ? null : assessmentConfidence * result.evidenceCoverage,
          has_failed_gate: result.failedHardGateKeys.length > 0,
          has_critical_risk: result.highestRisk === "critical",
          rationale,
        });
        if (recommendationError)
          throw new Error(serverText("analysisServer.common.deepRecommendationNotSaved"));
        await service
          .from("analysis_runs")
          .update({
            status: "complete",
            raw_response: {
              schemaVersion: "interlect-deep-orchestrated-v1",
              publicResearch: publicResearch.packet,
              specialists: specialistPackets,
              specialistSet: specialistSetSummary(specialists),
              synthesis: output,
            },
            validation_result: {
              ok: true,
              formulaVersion: SCORING_FORMULA_VERSION,
              financeFormulaVersion: FINANCE_FORMULA_VERSION,
              fundMemory: fundMemoryStatus,
              // Teamets gate-svar, der indgik i scoren (harden G2).
              teamGateAnswers: teamAnswers,
              financeScore: financeScoreAudit(financeScore, result),
              blockers: result.blockers,
              qualityAudit,
              costCurrency: "USD",
              aiTier: plan.tier,
              model: plan.model,
              budget: {
                dkk: plan.budget.dkk,
                usd: plan.budget.usd,
                researchUsd: plan.budget.researchUsd,
                specialistsUsd: plan.budget.specialistsUsd,
                synthesisUsd: plan.budget.synthesisUsd,
                customCap: plan.customCap,
                chargedUsd: chargedDeepUsd,
                actualUsd: totalCostUsd,
              },
              reusedSpecialists: completedSpecialistResults
                .filter((item) => item.reusedFromRunId !== null)
                .map((item) => ({
                  moduleId: item.packet.moduleId,
                  runId: item.reusedFromRunId,
                })),
            },
            token_usage: totalTokens,
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            actual_cost: totalCostUsd,
            completed_at: new Date().toISOString(),
          })
          .eq("id", runId);
        await service
          .from("cases")
          .update({
            execution_status: "complete",
            pap_recommendation: result.recommendation,
            updated_at: new Date().toISOString(),
          })
          .eq("id", data.caseId)
          .eq("fund_id", data.fundId);
        await service.from("case_transition_events").insert({
          fund_id: caseRow["fund_id"],
          case_id: data.caseId,
          field: "execution_status",
          actor_type: "pap",
          actor_id: runId,
          previous_value: "awaiting_approval",
          new_value: "complete",
          reason: serverText("analysisServer.deep.approvedSummary", {
            name: profile.name,
            version: profile.version,
          }),
          evidence_ids: evidenceIds,
          analysis_run_id: runId,
        });
        await writeAiTasks(service, {
          fundId: data.fundId,
          caseId: data.caseId,
          runId,
          runKind: "deep",
          createdBy: context.userId,
          source: deepTaskSource({
            configVersionId: config.id,
            profile,
            modules: specialists,
            unresolvedGateKeys: result.unresolvedGateKeys,
            missingCriterionKeys: result.missingCriterionKeys,
            output,
            specialists: specialistPackets,
            researchQuestions: founderQuestions(publicResearch.researchFollowUp),
          }),
        });
        await service
          .from("analysis_jobs")
          .update({
            status: "complete",
            locked_at: null,
            locked_by: null,
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("run_id", runId);
        return;
      } catch (cause) {
        const message = errorMessage(cause, "Den grundige analyse fejlede.");
        if (activeStepKey) {
          await service
            .from("analysis_run_steps")
            .update({
              status: "failed",
              error_message: message,
              ...(activeStepKey === "investment_committee_synthesis"
                ? completionUsage(synthesisCompletion ?? failedCallCompletion(cause))
                : {}),
              completed_at: new Date().toISOString(),
            })
            .eq("run_id", runId)
            .eq("step_key", activeStepKey);
        }
        const { data: costRows } = await service
          .from("analysis_run_steps")
          .select("actual_cost, input_tokens, output_tokens, total_tokens")
          .eq("run_id", runId);
        const rowsWithUsage = costRows ?? [];
        const partialActualCostUsd = rowsWithUsage.reduce(
          (sum, row) => sum + Number(row["actual_cost"] ?? 0),
          0,
        );
        const partialInputTokens = rowsWithUsage.reduce(
          (sum, row) => sum + Number(row["input_tokens"] ?? 0),
          0,
        );
        const partialOutputTokens = rowsWithUsage.reduce(
          (sum, row) => sum + Number(row["output_tokens"] ?? 0),
          0,
        );
        const partialTotalTokens = rowsWithUsage.reduce(
          (sum, row) =>
            sum +
            Number(
              row["total_tokens"] ??
                Number(row["input_tokens"] ?? 0) + Number(row["output_tokens"] ?? 0),
            ),
          0,
        );
        await Promise.all([
          service
            .from("analysis_runs")
            .update({
              status: "failed",
              error_message: message,
              actual_cost: rowsWithUsage.some((row) => row["actual_cost"] !== null)
                ? partialActualCostUsd
                : null,
              input_tokens: partialInputTokens || null,
              output_tokens: partialOutputTokens || null,
              token_usage: partialTotalTokens || null,
              validation_result: {
                ok: false,
                costCurrency: "USD",
                aiTier: plan.tier,
                budget: {
                  dkk: plan.budget.dkk,
                  usd: plan.budget.usd,
                  researchUsd: plan.budget.researchUsd,
                  analysisUsd: plan.budget.analysisUsd,
                  actualUsd: rowsWithUsage.some((row) => row["actual_cost"] !== null)
                    ? partialActualCostUsd
                    : null,
                },
              },
              completed_at: new Date().toISOString(),
            })
            .eq("id", runId),
          service
            .from("cases")
            .update({
              execution_status: "failed",
              updated_at: new Date().toISOString(),
            })
            .eq("id", data.caseId)
            .eq("fund_id", data.fundId),
          service
            .from("analysis_jobs")
            .update({
              status: "failed",
              last_error: message,
              locked_at: null,
              locked_by: null,
              updated_at: new Date().toISOString(),
            })
            .eq("run_id", runId),
        ]);
        await returnFailedDeepCaseToScreening(service, data.fundId, data.caseId, runId);
        console.error(`Dyb analyse ${runId} fejlede: ${message}`);
        return;
      }
    };

    if (!import.meta.env.DEV) {
      try {
        const { enqueueDeepAnalysisPhase } = await import("./deep-queue.server");
        await enqueueDeepAnalysisPhase(runId, "public_research");
      } catch (cause) {
        const message = errorMessage(cause, serverText("analysisServer.deep.notQueued"));
        await Promise.all([
          service
            .from("analysis_runs")
            .update({
              status: "failed",
              error_message: message,
              completed_at: new Date().toISOString(),
            })
            .eq("id", runId),
          service
            .from("analysis_jobs")
            .update({
              status: "failed",
              last_error: message,
              updated_at: new Date().toISOString(),
            })
            .eq("run_id", runId),
          service
            .from("cases")
            .update({
              execution_status: "failed",
              updated_at: new Date().toISOString(),
            })
            .eq("id", data.caseId)
            .eq("fund_id", data.fundId),
        ]);
        await returnFailedDeepCaseToScreening(service, data.fundId, data.caseId, runId);
        throw new Error(message);
      }
    } else if (process.env["DEEP_DEV_DRIVE_WORKER"] === "1") {
      // Test seam (development only): leave the run queued so tests/e2e/r9b-worker.ts can drive
      // the same worker phases the hosted queue runs, against the real database.
    } else {
      // Local development keeps the direct runner, which is easier to inspect without
      // requiring the hosted workflow queue.
      waitUntil(
        withFundLanguage(getServiceClient(), data.fundId, executeDeepAnalysis).finally(() =>
          enqueueBrainCapture(data.fundId, data.caseId),
        ),
      );
    }
    return { runId, status: "queued" as const };
  });

export async function callDeepGateway(
  system: string,
  user: string,
  schemaName: string,
  schema: unknown,
  maxTokens: number,
  availableUsd: number,
  timeoutMs: number,
  reasoningEffort: "low" | "medium",
  model: PricedModel,
  /** Masks the call with the fund's dictionary. */
  redactor: Redactor,
) {
  const token = gatewayToken();
  if (!token)
    throw missingGatewayToken("deep analysis", serverText("analysisServer.common.gatewayMissing"));
  const requestBody = {
    model,
    stream: false,
    max_tokens: maxTokens,
    reasoning: { effort: reasoningEffort },
    providerOptions: aiGatewayOptions({ model, data: "confidential" }),
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: schemaName, strict: true, schema },
    },
  } as const;
  const estimatedMaximumUsd = estimateRequestMaximumUsd({
    model,
    requestBody,
    maxOutputTokens: maxTokens,
  });
  assertWithinBudget(estimatedMaximumUsd, availableUsd, schemaName, requestLanguage());
  const startedAt = Date.now();
  let response: Response;
  let body: {
    error?: { message?: string };
    choices?: Array<{ finish_reason?: string; message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };
  try {
    response = await postChatCompletion({
      body: requestBody,
      redactor,
      token,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (cause) {
    // Stopped by the data rules or the masking before anything was sent.
    if (cause instanceof AiDataPolicyError) throw cause;
    const durationMs = Date.now() - startedAt;
    const timedOut = cause instanceof Error && ["TimeoutError", "AbortError"].includes(cause.name);
    console.error(
      `[deep-gateway] ${schemaName} ${timedOut ? "timeout" : "fetch failed"} after ${durationMs} ms (limit ${timeoutMs} ms, max output ${maxTokens} tokens)`,
      timedOut ? "" : errorMessage(cause, "").slice(0, 300),
    );
    // The provider may still have charged for a call that timed out; the usage is unknown, so
    // the budget reserves the worst case (`budgetCharge`) for the step.
    throw new DeepGatewayError(
      timedOut
        ? serverText("analysisServer.deep.timeout", {
            label: schemaName,
            seconds: Math.round(timeoutMs / 1000),
          })
        : // The fetch error (logged above) is never shown: the customer gets the neutral line.
          serverText("analysisServer.deep.gatewayUnreachable"),
      null,
      {
        finishReason: timedOut ? "timeout" : "fetch_failed",
        durationMs,
        maxOutputTokens: maxTokens,
      },
      estimatedMaximumUsd.maxCostUsd,
    );
  }
  try {
    body = (await response.json()) as typeof body;
  } catch {
    // Not JSON (as the screening): an error page from the gateway (a 502, 503 or
    // 429 with HTML or no body) was not billed; a 200 that is not JSON was answered, so it costs
    // the call's maximum.
    const durationMs = Date.now() - startedAt;
    console.error(
      `[deep-gateway] ${schemaName} answer is not JSON (status ${response.status}) after ${durationMs} ms`,
    );
    throw new DeepGatewayError(
      serverText("analysisServer.common.gatewayInvalid"),
      null,
      { finishReason: "not_json", durationMs, maxOutputTokens: maxTokens },
      response.ok ? estimatedMaximumUsd.maxCostUsd : 0,
    );
  }
  const completion = {
    content: body.choices?.[0]?.message?.content ?? "",
    inputTokens: body.usage?.prompt_tokens ?? null,
    outputTokens: body.usage?.completion_tokens ?? null,
    totalTokens: body.usage?.total_tokens ?? null,
    actualCostUsd: extractGatewayCostUsd(body),
    estimatedMaximumUsd,
    /** As reported by the provider ("stop", "length" …); stored with a failed call's diagnostics. */
    finishReason: body.choices?.[0]?.finish_reason ?? null,
    durationMs: Date.now() - startedAt,
  };
  // One line per paid call, so the first real run records real numbers for the limits.
  console.info(
    `[deep-gateway] ${schemaName} finish=${body.choices?.[0]?.finish_reason ?? "none"} ${Date.now() - startedAt} ms, in=${completion.inputTokens} out=${completion.outputTokens} (cap ${maxTokens}) cost=${completion.actualCostUsd ?? "unknown"} USD`,
  );
  if (!response.ok || !body.choices?.[0]?.message?.content) {
    // Only the kind and size: the error's text may echo the request unmasked.
    console.error("[ai-gateway]", schemaName, gatewayErrorSummary(body.error));
    // A call the gateway refused (an error status) without any usage was not billed.
    const refused =
      !response.ok &&
      completion.actualCostUsd === null &&
      completion.inputTokens === null &&
      completion.outputTokens === null &&
      completion.totalTokens === null;
    throw new DeepGatewayError(
      serverText("analysisServer.common.gatewayInvalid"),
      completion,
      {
        finishReason: completion.finishReason,
        durationMs: completion.durationMs,
        maxOutputTokens: maxTokens,
      },
      refused ? 0 : null,
    );
  }
  if (body.choices[0].finish_reason === "length") {
    // Already paid for: record the usage on the step instead of losing it.
    // Length only: the answer has its masking undone; the masked request is in ai_call_log.
    console.error(
      `[deep-gateway] ${schemaName} cut off (finish_reason length); ${completion.content.length} characters`,
    );
    throw new DeepGatewayError(
      serverText("analysisServer.deep.cutOff", { label: schemaName }),
      completion,
      {
        finishReason: completion.finishReason,
        durationMs: completion.durationMs,
        maxOutputTokens: maxTokens,
        // Step rows are readable by every fund member: only a short start of the cut-off text is
        // kept there, and never in the server log.
        partialText: completion.content.slice(0, PARTIAL_TEXT_MAX_CHARS),
      },
    );
  }
  return completion;
}

export function completionUsage(completion: DeepGatewayCompletion | null) {
  if (!completion) return {};
  return {
    input_tokens: completion.inputTokens,
    output_tokens: completion.outputTokens,
    total_tokens: completion.totalTokens,
    actual_cost: completion.actualCostUsd,
  };
}

export async function loadReusablePublicResearch(
  service: ReturnType<typeof getServiceClient>,
  failedRunId: string,
): Promise<{ runId: string; result: PublicResearchResult } | null> {
  const { data: step, error } = await service
    .from("analysis_run_steps")
    .select("status, model_name, prompt_version, output_json")
    .eq("run_id", failedRunId)
    .eq("step_key", "public_research")
    .maybeSingle();
  if (error || !step || step["status"] !== "complete") return null;
  if (
    step["model_name"] !== PUBLIC_RESEARCH_MODEL ||
    step["prompt_version"] !== PUBLIC_RESEARCH_VERSION
  ) {
    return null;
  }
  const raw = step["output_json"];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const stored = raw as Record<string, unknown>;
  if (
    stored["schemaVersion"] !== "interlect-public-research-v1" ||
    !Array.isArray(stored["findings"]) ||
    !Array.isArray(stored["gaps"])
  ) {
    return null;
  }
  const packet = { ...stored };
  delete packet["persistedSources"];
  delete packet["persistedEvidence"];
  delete packet["reusedFromRunId"];
  delete packet["researchLog"];
  delete packet["researchPlan"];
  delete packet["researchPlanStatus"];
  delete packet["questionNeutralizer"];
  delete packet["researchFollowUp"];
  return {
    runId: failedRunId,
    result: {
      packet: packet as PublicResearchOutput,
      insertedEvidence: 0,
      sourceCount: finiteNonNegativeInteger(stored["persistedSources"]),
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      actualCostUsd: 0,
      budgetChargeUsd: 0,
      cvrLookup: {
        status: "skipped",
        message: serverText("analysisServer.deep.researchReused"),
      },
      ...(Array.isArray(stored["researchLog"])
        ? { researchLog: stored["researchLog"] as ResearchLogEntry[] }
        : {}),
      researchPlan: readStoredResearchPlan(stored["researchPlan"]),
      researchFollowUp: readStoredResearchFollowUp(stored["researchFollowUp"]),
    },
  };
}

/**
 * The research plan a failed run saved before its research failed (or finished), so the
 * retry does not pay for a new one. The caller only asks for a run on the same setup.
 */
export async function loadReusableResearchPlan(
  service: ReturnType<typeof getServiceClient>,
  failedRunId: string,
): Promise<ResearchPlan | null> {
  const { data: step, error } = await service
    .from("analysis_run_steps")
    .select("output_json")
    .eq("run_id", failedRunId)
    .eq("step_key", "public_research")
    .maybeSingle();
  if (error || !step) return null;
  const raw = step["output_json"] as Record<string, unknown> | null;
  return readStoredResearchPlan(raw?.["researchPlan"]);
}

/** Saves the plan on the run's research step while the research is still running. */
export async function saveResearchPlanOnStep(
  service: ReturnType<typeof getServiceClient>,
  runId: string,
  stepKey: string,
  plan: ResearchPlan,
): Promise<void> {
  const { error } = await service
    .from("analysis_run_steps")
    .update({ output_json: { researchPlan: plan } })
    .eq("run_id", runId)
    .eq("step_key", stepKey)
    .eq("status", "running");
  if (error) throw new Error(error.message);
}

export async function loadReusableSpecialists({
  service,
  failedRunId,
  profile,
  caseId,
  allowedEvidenceIds,
  model,
  specialists,
}: {
  service: ReturnType<typeof getServiceClient>;
  failedRunId: string;
  profile: ReturnType<typeof mapProfile>;
  caseId: string;
  allowedEvidenceIds: Set<string>;
  /** Only steps done by the same model are reused (the run's tier model). */
  model: string;
  /** The run's specialist set; the failed run has the same config version. */
  specialists: readonly DeepSpecialist[];
}): Promise<Map<string, SpecialistOutput>> {
  const { data: steps, error } = await service
    .from("analysis_run_steps")
    .select("step_key, status, model_name, prompt_version, output_json")
    .eq("run_id", failedRunId)
    .in(
      "step_key",
      specialists.map((module) => module.id),
    );
  if (error || !steps?.length) return new Map();

  const moduleById = new Map<string, DeepSpecialist>(
    specialists.map((module) => [module.id, module]),
  );
  const reusable = new Map<string, SpecialistOutput>();
  for (const step of steps) {
    const stepKey = step["step_key"] as string;
    const module = moduleById.get(stepKey);
    if (
      !module ||
      step["status"] !== "complete" ||
      step["model_name"] !== model ||
      step["prompt_version"] !== DEEP_PROMPT_VERSION
    ) {
      continue;
    }
    const parsed = specialistOutputSchema.safeParse(step["output_json"]);
    if (!parsed.success) continue;
    try {
      validateSpecialistPacket(parsed.data, module, profile, caseId, allowedEvidenceIds);
      reusable.set(module.id, parsed.data);
    } catch {
      // A stale packet is deliberately rerun instead of weakening the current validation contract.
    }
  }
  return reusable;
}

function finiteNonNegativeInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

export function buildDeepCaseInput(
  caseId: string,
  company: { name: string; website: string | null; stage: string },
  origin: ScreeningCaseInput["intakeSources"][number],
  evidenceRows: Array<Record<string, unknown>>,
  relatedPastCases: RelatedPastCaseInput[] = [],
  founders: NonNullable<ScreeningCaseInput["founders"]> = [],
): ScreeningCaseInput {
  return {
    caseId,
    founders,
    companyName: company.name,
    website: company.website,
    stage: company.stage,
    intakeSources: [origin],
    relatedPastCases,
    evidence: evidenceRows.map(toPromptEvidence),
  };
}

export function specialistJsonSchema(
  profile: ReturnType<typeof mapProfile>,
  module: DeepSpecialist,
  allowedEvidenceIds: readonly string[],
) {
  const evidenceId = evidenceIdJsonSchema(allowedEvidenceIds);
  const stringArray = {
    type: "array",
    maxItems: 6,
    items: { type: "string", maxLength: 700 },
  };
  const relevantCriteria = profile.criteria.filter((criterion) =>
    module.categories.includes(criterion.category),
  );
  // A fund's own specialist may place a finding in any of the nine areas; a specialist
  // without criteria in this run gets an empty list instead of an empty enum.
  const findingCategories = isCustomSpecialist(module) ? ANALYSIS_CATEGORIES : module.categories;
  const noCriteria = relevantCriteria.length === 0;
  // A standard specialist also delivers its card's data; a fund's own specialist
  // delivers the figures it found (`highlights`).
  const cardData = cardDataJsonSchema(module.id, allowedEvidenceIds, isCustomSpecialist(module));
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      schemaVersion: { type: "string", const: "interlect-specialist-v1" },
      moduleId: { type: "string", const: module.id },
      caseId: { type: "string" },
      summary: {
        type: "string",
        minLength: SPECIALIST_SUMMARY.schemaMin,
        maxLength: SPECIALIST_SUMMARY.schemaMax,
      },
      headline: { type: "string", maxLength: SPECIALIST_HEADLINE.max },
      assessments: {
        type: "array",
        ...(noCriteria ? { maxItems: 0 } : {}),
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            criterionKey: noCriteria
              ? { type: "string" }
              : {
                  type: "string",
                  enum: relevantCriteria.map((criterion) => criterion.key),
                },
            proposedScore: { type: ["number", "null"], minimum: 0, maximum: 100 },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            verdict: { type: "string", maxLength: 300 },
            rationale: {
              type: "string",
              minLength: CRITERION_RATIONALE.schemaMin,
              maxLength: CRITERION_RATIONALE.schemaMax,
            },
            positiveDrivers: {
              type: "array",
              maxItems: 3,
              items: { type: "string", maxLength: 450 },
            },
            negativeDrivers: {
              type: "array",
              maxItems: 3,
              items: { type: "string", maxLength: 450 },
            },
            citations: {
              type: "array",
              maxItems: 8,
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  evidenceId,
                  support: { type: "string", enum: ["supporting", "opposing"] },
                },
                required: ["evidenceId", "support"],
              },
            },
            unknowns: stringArray,
          },
          required: [
            "criterionKey",
            "proposedScore",
            "confidence",
            "verdict",
            "rationale",
            "positiveDrivers",
            "negativeDrivers",
            "citations",
            "unknowns",
          ],
        },
      },
      findings: {
        type: "array",
        maxItems: 14,
        items: findingJsonSchema(findingCategories, allowedEvidenceIds),
      },
      risks: {
        type: "array",
        maxItems: 8,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            riskKey: { type: "string" },
            label: { type: "string" },
            level: { type: "string", enum: ["low", "medium", "high", "critical"] },
            likelihood: { type: "integer", minimum: 1, maximum: 5 },
            impact: { type: "integer", minimum: 1, maximum: 5 },
            rationale: { type: "string", maxLength: 900 },
            evidenceIds: { type: "array", maxItems: 8, items: evidenceId },
            mitigation: { type: ["string", "null"], maxLength: 700 },
          },
          required: [
            "riskKey",
            "label",
            "level",
            "likelihood",
            "impact",
            "rationale",
            "evidenceIds",
            "mitigation",
          ],
        },
      },
      strengths: stringArray,
      weaknesses: stringArray,
      unknowns: stringArray,
      questions: stringArray,
      financialInputs: isFinanceSpecialist(module)
        ? {
            type: "array",
            maxItems: 16,
            items: financialInputJsonSchema(allowedEvidenceIds),
          }
        : {
            type: "array",
            maxItems: 0,
            items: financialInputJsonSchema(allowedEvidenceIds),
          },
      ...(cardData ? { cardData } : {}),
    },
    required: [
      "schemaVersion",
      "moduleId",
      "caseId",
      "summary",
      "headline",
      "assessments",
      "findings",
      "risks",
      "strengths",
      "weaknesses",
      "unknowns",
      "questions",
      "financialInputs",
      ...(cardData ? ["cardData"] : []),
    ],
  };
}

function findingJsonSchema(categories: readonly string[], allowedEvidenceIds: readonly string[]) {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      category: { type: "string", enum: categories },
      findingType: {
        type: "string",
        enum: ["strength", "weakness", "unknown", "question", "assessment"],
      },
      statement: { type: "string", maxLength: FINDING_STATEMENT.schemaMax },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      nature: { type: "string", enum: ["fact", "company_claim", "judgement"] },
      evidenceIds: {
        type: "array",
        maxItems: 8,
        items: evidenceIdJsonSchema(allowedEvidenceIds),
      },
    },
    required: ["category", "findingType", "statement", "confidence", "nature", "evidenceIds"],
  };
}

function financialInputJsonSchema(allowedEvidenceIds: readonly string[]) {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      metric: {
        type: "string",
        enum: [
          "mrr",
          "arr",
          "monthly_revenue",
          "annual_revenue",
          "cash",
          "monthly_operating_expenses",
          "cogs",
          "sales_marketing_spend",
          "new_customers",
          "customers",
          "monthly_churn_rate",
          "monthly_growth_rate",
        ],
      },
      value: { type: "number" },
      unit: { type: "string" },
      periodStart: { type: ["string", "null"] },
      periodEnd: { type: ["string", "null"] },
      evidenceId: evidenceIdJsonSchema(allowedEvidenceIds),
    },
    required: ["metric", "value", "unit", "periodStart", "periodEnd", "evidenceId"],
  };
}

export function deepJsonSchema(
  profile: ReturnType<typeof mapProfile>,
  allowedEvidenceIds: readonly string[],
) {
  const base = screeningJsonSchema(profile, allowedEvidenceIds, false) as {
    properties: Record<string, unknown>;
    required: string[];
    [key: string]: unknown;
  };
  const evidenceId = evidenceIdJsonSchema(allowedEvidenceIds);
  const stringArray = { type: "array", maxItems: 10, items: evidenceId };
  // The deep analysis writes longer criterion texts than the screening it is built on.
  const baseAssessments = base.properties["assessments"] as {
    items: { properties: Record<string, unknown> };
    [key: string]: unknown;
  };
  return {
    ...base,
    properties: {
      ...base.properties,
      schemaVersion: { type: "string", const: "interlect-deep-v1" },
      assessments: {
        ...baseAssessments,
        items: {
          ...baseAssessments.items,
          properties: {
            ...baseAssessments.items.properties,
            rationale: {
              type: "string",
              minLength: SYNTHESIS_CRITERION_RATIONALE.schemaMin,
              maxLength: SYNTHESIS_CRITERION_RATIONALE.schemaMax,
            },
          },
        },
      },
      overallAssessment: {
        type: "string",
        minLength: OVERALL_ASSESSMENT.schemaMin,
        maxLength: OVERALL_ASSESSMENT.schemaMax,
      },
      investmentCondition: { type: ["string", "null"], maxLength: 700 },
      nextSteps: nextStepsJsonSchema(SYNTHESIS_NEXT_STEPS.maxItems),
      risks: {
        type: "array",
        maxItems: 5,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            riskKey: { type: "string", maxLength: 100 },
            label: { type: "string", maxLength: 140 },
            level: { type: "string", enum: ["low", "medium", "high", "critical"] },
            likelihood: { type: "integer", minimum: 1, maximum: 5 },
            impact: { type: "integer", minimum: 1, maximum: 5 },
            rationale: {
              type: "string",
              minLength: SYNTHESIS_RISK.rationaleSchemaMin,
              maxLength: SYNTHESIS_RISK.rationaleMax,
            },
            evidenceIds: {
              type: "array",
              maxItems: 8,
              items: evidenceId,
            },
            mitigation: { type: "string", minLength: 180, maxLength: SYNTHESIS_RISK.mitigationMax },
          },
          required: [
            "riskKey",
            "label",
            "level",
            "likelihood",
            "impact",
            "rationale",
            "evidenceIds",
            "mitigation",
          ],
        },
      },
      findings: {
        type: "array",
        maxItems: SYNTHESIS_FINDINGS.maxItems,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            category: {
              type: "string",
              enum: [
                "fund_thesis_fit",
                "founder_market_fit",
                "team_market_fit",
                "product_market_fit",
                "product_technology",
                "market_timing",
                "traction_gtm",
                "financial_strength",
                "evidence_quality",
              ],
            },
            findingType: {
              type: "string",
              enum: ["strength", "weakness", "unknown", "question", "assessment"],
            },
            statement: { type: "string", maxLength: 1_000 },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            nature: { type: "string", enum: ["fact", "company_claim", "judgement"] },
            evidenceIds: stringArray,
          },
          required: ["category", "findingType", "statement", "confidence", "nature", "evidenceIds"],
        },
      },
      financialInputs: {
        type: "array",
        maxItems: 24,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            metric: {
              type: "string",
              enum: [
                "mrr",
                "arr",
                "monthly_revenue",
                "annual_revenue",
                "cash",
                "monthly_operating_expenses",
                "cogs",
                "sales_marketing_spend",
                "new_customers",
                "customers",
                "monthly_churn_rate",
                "monthly_growth_rate",
              ],
            },
            value: { type: "number" },
            unit: { type: "string" },
            periodStart: { type: ["string", "null"] },
            periodEnd: { type: ["string", "null"] },
            evidenceId,
          },
          required: ["metric", "value", "unit", "periodStart", "periodEnd", "evidenceId"],
        },
      },
    },
    // The screening base already requires nextSteps; a JSON schema lists each key once.
    required: [...base.required, "investmentCondition", "findings", "financialInputs"],
  };
}

function evidenceIdJsonSchema(allowedEvidenceIds: readonly string[]) {
  return allowedEvidenceIds.length
    ? { type: "string", enum: [...allowedEvidenceIds] }
    : { type: "string" };
}

export function validateSpecialistPacket(
  packet: SpecialistOutput,
  module: DeepSpecialist,
  profile: ReturnType<typeof mapProfile>,
  caseId: string,
  allowedEvidenceIds: Set<string>,
) {
  if (packet.moduleId !== module.id || packet.caseId !== caseId) {
    throw new Error(serverText("analysisServer.deep.specialistOtherTask", { name: module.title }));
  }
  const expectedCriteria = profile.criteria
    .filter((criterion) => module.categories.includes(criterion.category))
    .map((criterion) => criterion.key);
  const actualCriteria = packet.assessments.map((assessment) => assessment.criterionKey);
  const duplicateCriteria = actualCriteria.filter(
    (key, index) => actualCriteria.indexOf(key) !== index,
  );
  const missingCriteria = expectedCriteria.filter((key) => !actualCriteria.includes(key));
  const unexpectedCriteria = actualCriteria.filter((key) => !expectedCriteria.includes(key));
  const missingCategories = module.categories.filter(
    (category) => !packet.findings.some((finding) => finding.category === category),
  );
  if (
    duplicateCriteria.length ||
    missingCriteria.length ||
    unexpectedCriteria.length ||
    missingCategories.length
  ) {
    throw new Error(serverText("analysisServer.deep.specialistCoverage", { name: module.title }));
  }
  if (!isFinanceSpecialist(module) && packet.financialInputs.length) {
    throw new Error(serverText("analysisServer.deep.financeOnly"));
  }
  const references = [
    ...packet.assessments.flatMap((item) => item.citations.map((citation) => citation.evidenceId)),
    ...packet.findings.flatMap((item) => item.evidenceIds),
    ...packet.risks.flatMap((item) => item.evidenceIds),
    ...packet.financialInputs.map((item) => item.evidenceId),
  ];
  if (references.some((id) => !allowedEvidenceIds.has(id))) {
    throw new Error(
      serverText("analysisServer.deep.specialistUnknownEvidence", { name: module.title }),
    );
  }
  if (
    packet.assessments.some((item) => item.proposedScore !== null && item.citations.length === 0)
  ) {
    throw new Error(
      serverText("analysisServer.deep.specialistScoreNoEvidence", { name: module.title }),
    );
  }
  if (
    packet.findings.some((item) => item.nature !== "judgement" && item.evidenceIds.length === 0)
  ) {
    throw new Error(
      serverText("analysisServer.deep.specialistClaimNoEvidence", { name: module.title }),
    );
  }
}

export function validateSynthesizedFinancialInputs(
  output: z.infer<typeof deepAnalysisOutputSchema>,
  specialists: SpecialistOutput[],
) {
  const permitted = new Set(
    specialists.flatMap((packet) => packet.financialInputs).map(financialInputIdentity),
  );
  if (output.financialInputs.some((input) => !permitted.has(financialInputIdentity(input)))) {
    throw new Error(serverText("analysisServer.deep.synthesisChangedFinance"));
  }
}

function financialInputIdentity(input: SpecialistOutput["financialInputs"][number]): string {
  return JSON.stringify([
    input.metric,
    input.value,
    input.unit,
    input.periodStart,
    input.periodEnd,
    input.evidenceId,
  ]);
}

export function validateReferences(
  output: z.infer<typeof deepAnalysisOutputSchema>,
  allowed: Set<string>,
) {
  const references = [
    ...output.assessments.flatMap((item) => item.citations.map((citation) => citation.evidenceId)),
    ...output.gates.flatMap((item) => item.evidenceIds),
    ...output.risks.flatMap((item) => item.evidenceIds),
    ...output.findings.flatMap((item) => item.evidenceIds),
    ...output.financialInputs.map((item) => item.evidenceId),
  ];
  if (references.some((id) => !allowed.has(id)))
    throw new Error(serverText("analysisServer.deep.unknownEvidence"));
  if (output.assessments.some((item) => item.proposedScore !== null && item.citations.length === 0))
    throw new Error(serverText("analysisServer.deep.scoreWithoutEvidence"));
  if (output.findings.some((item) => item.nature !== "judgement" && item.evidenceIds.length === 0))
    throw new Error(serverText("analysisServer.deep.claimWithoutEvidence"));
}

export function auditDeepOutput(
  output: z.infer<typeof deepAnalysisOutputSchema>,
  profile: ReturnType<typeof mapProfile>,
) {
  const blockingErrors: string[] = [];
  const warnings: string[] = [];
  const requiredCategories = DEEP_FINDING_CATEGORIES;
  const assessmentKeys = output.assessments.map((item) => item.criterionKey);
  const gateKeys = output.gates.map((item) => item.gateKey);
  const duplicateAssessments = assessmentKeys.filter(
    (key, index) => assessmentKeys.indexOf(key) !== index,
  );
  const duplicateGates = gateKeys.filter((key, index) => gateKeys.indexOf(key) !== index);
  const missingAssessments = profile.criteria
    .filter((criterion) => !assessmentKeys.includes(criterion.key))
    .map((criterion) => criterion.key);
  const missingGates = profile.gates
    .filter((gate) => !gateKeys.includes(gate.key))
    .map((gate) => gate.key);
  const missingCategories = requiredCategories.filter(
    (category) => !output.findings.some((finding) => finding.category === category),
  );

  if (duplicateAssessments.length)
    blockingErrors.push(
      `Dublerede kriterievurderinger: ${[...new Set(duplicateAssessments)].join(", ")}.`,
    );
  if (duplicateGates.length)
    blockingErrors.push(`Dublerede mandatkontroller: ${[...new Set(duplicateGates)].join(", ")}.`);
  if (missingAssessments.length)
    blockingErrors.push(`Manglende kriterievurderinger: ${missingAssessments.join(", ")}.`);
  if (missingGates.length)
    blockingErrors.push(`Manglende mandatkontroller: ${missingGates.join(", ")}.`);
  // Missing data is uncertainty, not a failure after payment (principle 7). Code fills a category
  // the model skipped with an 'unknown' finding (finding-categories.ts) before this audit, so
  // this is only a visible warning.
  if (missingCategories.length)
    warnings.push(
      serverText("analysisServer.deep.missingAreas", { areas: missingCategories.join(", ") }),
    );
  output.risks.forEach((risk, index) => {
    const title =
      risk.label.trim() ||
      risk.riskKey ||
      serverText("analysisServer.deep.riskNumber", { n: index + 1 });
    const reasoning = reasonsLikelihoodAndImpact(risk.rationale);
    const hasLikelihoodReasoning = reasoning.likelihood;
    const hasImpactReasoning = reasoning.impact;
    const rationaleCheck = auditRiskRationale(title, risk.rationale, requestLanguage());
    if (rationaleCheck.blockingError) blockingErrors.push(rationaleCheck.blockingError);
    if (rationaleCheck.warning) warnings.push(rationaleCheck.warning);
    if (!hasLikelihoodReasoning || !hasImpactReasoning) {
      blockingErrors.push(serverText("analysisServer.deep.riskNoBoth", { name: title }));
    }
    if (risk.mitigation.trim().length < 180 || countSentences(risk.mitigation) < 2) {
      blockingErrors.push(serverText("analysisServer.deep.riskNoPlan", { name: title }));
    }
  });
  const textAudit = auditDeepTextLengths(output, requestLanguage());
  blockingErrors.push(...textAudit.blockingErrors);
  warnings.push(...textAudit.warnings);
  if (output.contraryCase.trim().length < 40)
    warnings.push(serverText("analysisServer.deep.contraryShort"));
  if (!output.openQuestions.length)
    warnings.push(serverText("analysisServer.deep.noOpenQuestions"));
  if (output.financialInputs.some((item) => !item.periodStart && !item.periodEnd)) {
    warnings.push(serverText("analysisServer.deep.financeNoPeriod"));
  }
  return { blockingErrors, warnings, checkedAt: new Date().toISOString() };
}

export function normalizeFinancialDate(
  value: string | null,
  boundary: "start" | "end",
): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const month = /^(\d{4})-(\d{2})$/.exec(value);
  if (!month) return null;
  const year = Number(month[1]);
  const monthIndex = Number(month[2]);
  if (monthIndex < 1 || monthIndex > 12) return null;
  if (boundary === "start") return `${month[1]}-${month[2]}-01`;
  const lastDay = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
  return `${month[1]}-${month[2]}-${String(lastDay).padStart(2, "0")}`;
}

export function errorMessage(cause: unknown, fallback: string): string {
  if (cause instanceof Error && cause.message) return cause.message;
  if (cause && typeof cause === "object" && "message" in cause) {
    const message = String((cause as { message?: unknown }).message ?? "").trim();
    if (message) return message;
  }
  return fallback;
}

export function average(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}
