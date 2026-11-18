import { createHash } from "node:crypto";
import { decideStepClaim, MAX_STEP_ATTEMPTS } from "./deep-claim";
import { isCodeAnchored } from "./code-anchor";
import { returnFailedDeepCaseToScreening } from "@/lib/cases/lifecycle.server";
import { enqueueBrainCaptureForRun } from "@/lib/brain/queue.server";
import {
  FUNCTION_MAX_DURATION_SECONDS,
  OPEN_TASK_TITLES_FOR_SYNTHESIS,
  STEP_STALE_AFTER_MS,
} from "./deep-text-rules";
import { outputTokenCap, synthesisReasoningEffort } from "./deep-limits";
import { mergeSpecialistRationales } from "./deep-merge";
import {
  ANALYSIS_CATEGORIES,
  categoryFallbackWarning,
  withCategoryFallbacks,
} from "./finding-categories";
import { loadOpenTaskTitles, writeAiTasks } from "@/lib/cases/ai-tasks.server";
import { writeDeepResultRows } from "./analysis-persist.server";
import { deepTaskSource } from "@/lib/cases/deep-tasks";
import {
  founderQuestions,
  readStoredResearchFollowUp,
  researchDeadlineAt,
} from "./research-followup";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadCompactFinancialMetrics } from "./financial-statements";
import { withFinanceGates, loadFinanceCodeScore } from "./financial-statements";
import type { CompactFinancialMetrics } from "./financial-metrics";
import type { FinancialScore } from "./financial-score";
import { getServiceClient } from "@/lib/supabase/admin.server";
import { redactorForFund } from "@/lib/ai/redact-dictionary.server";
import type { ScreeningCaseInput } from "./prompt";
import { screeningOutputSchema } from "./contracts";
import { deepAnalysisOutputSchema, type DeepAnalysisOutput } from "./deep.contracts";
import { specialistOutputSchema, type SpecialistOutput } from "./specialist.contracts";
import { withSanitizedCardData } from "./card-data";
import { financeScoreAudit, scoreScreening, SCORING_FORMULA_VERSION } from "./scoring";
import { applyGateAnswers, teamAnswersForNewRun, type StoredGateAnswer } from "./gate-answers";
import { loadTeamGateAnswers } from "./rescore.server";
import { FINANCE_FORMULA_VERSION } from "./finance";
import { checkDeepFinancialInputs } from "./financial-input-check.server";
import {
  DEEP_EVIDENCE_MAX,
  loadEvidenceRowsByIds,
  loadPromptEvidenceRows,
  selectPromptEvidence,
} from "./evidence-selection";
import { mapProfile, type ConfigData } from "./screening.functions";
import { specialistResearchQuestions } from "./specialist-research";
import {
  buildInvestmentCommitteeSynthesisPrompt,
  buildSpecialistPrompt,
  DEEP_PROMPT_VERSION,
  DEEP_WORKFLOW_VERSION,
  type DeepSpecialist,
} from "./specialist-prompts";
import { MAX_SPECIALISTS, specialistSetSummary } from "./specialist-set";
import { loadSpecialistSet } from "./specialist-set.server";
import {
  recordCvrLookupStep,
  buildFundResearchBrief,
  collectPublicCompanyResearch,
  getResearchModuleOverrides,
  loadCaseIdentityHints,
  PUBLIC_RESEARCH_CALL_COUNT,
  PUBLIC_RESEARCH_MODEL,
  PUBLIC_RESEARCH_VERSION,
  type PublicResearchOutput,
  type PublicResearchResult,
  type CaseIdentityHints,
} from "./public-research";
import { assertActualSpendWithinBudget, budgetCharge } from "./budgets";
import { DEEP_CALL_TIMEOUT_MS, legacyRunPlan, type RunPlan } from "./model-tiers";
import { loadStoredRunPlan } from "./run-plan.server";
import { ResearchFailedError, stepRunCosts, sumCompleteCosts } from "./gateway-response";
import { buildMemoryQueryText, retrieveFundMemory, type FundMemoryStatus } from "./memory";
import {
  DeepGatewayError,
  failedCallCompletion,
  failedStepChargeUsd,
  auditDeepOutput,
  buildDeepCaseInput,
  callDeepGateway,
  completionUsage,
  deepJsonSchema,
  errorMessage,
  loadReusablePublicResearch,
  loadReusableResearchPlan,
  saveResearchPlanOnStep,
  loadReusableSpecialists,
  specialistJsonSchema,
  validateReferences,
  validateSpecialistPacket,
  validateSynthesizedFinancialInputs,
  type DeepGatewayCompletion,
} from "./deep.functions";
import type { DeepAnalysisPhase } from "./deep-queue.server";
import {
  EVIDENCE_SHEET_BUDGET_USD,
  EVIDENCE_SHEET_STEP,
  promptEvidenceSheet,
} from "./evidence-sheet";
import { loadRunEvidenceSheet, runDeepEvidenceSheetStep } from "./evidence-sheet.server";
import { readCaseOwnMaterial } from "./case-material.server";
import { withRunLanguage } from "./run-language.server";
import { requestLanguage, serverText } from "@/lib/i18n/server-text";

/** Research, every specialist a fund can have and the synthesis. */
const MAX_DEEP_MODEL_CALLS = PUBLIC_RESEARCH_CALL_COUNT + MAX_SPECIALISTS + 1;
const SYNTHESIS_STEP = "investment_committee_synthesis";
export type DeepAnalysisPhaseResult = "completed" | "busy" | "failed" | "ignored";

type ServiceClient = SupabaseClient;
type StepRow = {
  step_key: string;
  status: string;
  attempt_count: number | null;
  started_at: string | null;
  output_json: unknown;
  actual_cost: number | null;
  /** What the step charged against its budget; null before 0116 or not run. */
  charged_cost: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
};

type DeepWorkerContext = {
  service: ServiceClient;
  runId: string;
  run: Record<string, unknown>;
  config: ConfigData;
  profile: ReturnType<typeof mapProfile>;
  caseRow: Record<string, unknown>;
  company: { name: string; website: string | null; stage: string };
  screeningRun: Record<string, unknown>;
  evidenceRows: Array<Record<string, unknown>>;
  evidenceIds: string[];
  caseInput: ScreeningCaseInput;
  identityHints: CaseIdentityHints;
  computedFinancials: CompactFinancialMetrics | null;
  /** C8: kode-scoren for finansiel styrke; samme værdi i syntese-prompten og ved gem. */
  financeScore: FinancialScore | null;
  priorFailedRunId: string | null;
  /** The run's specialists: its config version's set with the fund's module text. */
  specialists: DeepSpecialist[];
  /** The level, model and cap the run was started with, never the fund's current ones. */
  plan: RunPlan;
  /** Kept on the run, so "blocked" or "failed" is never read as "no similar cases". */
  fundMemoryStatus: FundMemoryStatus;
};

export async function processDeepAnalysisPhase(
  runId: string,
  dispatchNextPhase = true,
  expectedPhase?: DeepAnalysisPhase,
): Promise<DeepAnalysisPhaseResult> {
  // What the worker writes to the person follows the fund's language.
  const result = await withRunLanguage(runId, () =>
    runDeepAnalysisPhase(runId, dispatchNextPhase, expectedPhase),
  );
  // Brain: research, specialists and the synthesis become case knowledge as each
  // phase ends, also when the run failed.
  if (result === "completed" || result === "failed") await enqueueBrainCaptureForRun(runId);
  return result;
}

async function runDeepAnalysisPhase(
  runId: string,
  dispatchNextPhase: boolean,
  expectedPhase: DeepAnalysisPhase | undefined,
): Promise<DeepAnalysisPhaseResult> {
  const service = getServiceClient();
  // The research's follow-up rounds must leave the phase time to save what it found.
  const phaseStartedAt = Date.now();
  let activeStepKey: string | null = null;
  let synthesisCompletion: DeepGatewayCompletion | null = null;

  try {
    const context = await loadWorkerContext(service, runId);
    if (!context) return "ignored";
    if (!(await markRunActive(context))) return "ignored";

    const steps = await loadSteps(service, runId);
    const currentPhase = pendingPhase(steps, context.specialists);
    if (!currentPhase) return "ignored";
    if (expectedPhase && currentPhase !== expectedPhase) {
      console.info(
        `Dyb analyse ${runId}: ignorerer dublet for ${expectedPhase}; aktuel fase er ${currentPhase}.`,
      );
      return "ignored";
    }
    const publicStep = steps.get("public_research");
    if (!publicStep || publicStep.status !== "complete") {
      activeStepKey = "public_research";
      const claimed = await claimStep(service, runId, activeStepKey);
      if (!claimed) return "busy";
      await runPublicResearchPhase(context, phaseStartedAt);
      // Runs started before the evidence sheet have no sheet step and go straight on.
      await releasePhase(
        context,
        steps.has(EVIDENCE_SHEET_STEP) ? "evidence_sheet" : "specialists",
        dispatchNextPhase,
      );
      return "completed";
    }

    const sheetStep = steps.get(EVIDENCE_SHEET_STEP);
    if (sheetStep && !isStepDone(sheetStep)) {
      activeStepKey = EVIDENCE_SHEET_STEP;
      const claimed = await claimStep(service, runId, activeStepKey);
      if (!claimed) return "busy";
      await runEvidenceSheetPhase(context, steps, phaseStartedAt);
      await releasePhase(context, "specialists", dispatchNextPhase);
      return "completed";
    }

    const specialistSteps = context.specialists.map((module) => steps.get(module.id));
    if (specialistSteps.some((step) => !step || step.status !== "complete")) {
      const phaseComplete = await runSpecialistPhase(context, steps);
      if (!phaseComplete) return "busy";
      await releasePhase(context, "synthesis", dispatchNextPhase);
      return "completed";
    }

    const synthesisStep = steps.get(SYNTHESIS_STEP);
    if (!synthesisStep || synthesisStep.status !== "complete") {
      activeStepKey = SYNTHESIS_STEP;
      const claimed = await claimStep(service, runId, activeStepKey);
      if (!claimed) return "busy";
      synthesisCompletion = await runSynthesisPhase(context, steps);
      return "completed";
    }
    return "ignored";
  } catch (cause) {
    const message = errorMessage(cause, "Den grundige analyse fejlede.");
    const completion = synthesisCompletion ?? failedCallCompletion(cause);
    await failDeepRun(
      service,
      runId,
      activeStepKey,
      completion,
      message,
      cause instanceof DeepGatewayError ? cause.diagnostics : null,
      failedStepChargeUsd(cause, completion),
    );
    console.error(`Dyb analyse ${runId} fejlede: ${message}`);
    return "failed";
  }
}

async function loadWorkerContext(
  service: ServiceClient,
  runId: string,
  /** After public research: use the evidence saved on the run instead of selecting again. */
  evidenceSource: "select" | "saved_input" = "select",
): Promise<DeepWorkerContext | null> {
  const { data: run, error: runError } = await service
    .from("analysis_runs")
    .select(
      "id, fund_id, case_id, config_version_id, previous_run_id, status, requested_by, workflow_version, prompt_template_version, model_name, input_evidence_ids",
    )
    .eq("id", runId)
    .eq("kind", "deep")
    .single();
  if (runError || !run) throw new Error(serverText("analysisServer.deep.runDataNotLoaded"));
  if (["complete", "failed", "cancelled"].includes(run["status"] as string)) return null;
  const plan = await loadStoredRunPlan(service, runId, "deep");

  const fundId = run["fund_id"] as string;
  const caseId = run["case_id"] as string;
  const configVersionId = run["config_version_id"] as string;
  const { data: configRow, error: configError } = await service
    .from("fund_config_versions")
    .select(
      `id, fund_id, profile_key, version, funds(name, language),
      fund_mandates(thesis, stages, geographies, sectors, fund_size_eur, ticket_min_eur, ticket_max_eur, ticket_note, analysis_threshold, approval_mode, risk_posture, strategy_type, stage_expectations, dealbreakers, screening_instruction),
      mandate_gates(gate_key, label, description, treatment, sort_order),
      assessment_criteria(criterion_key, label, description, score_category, weight, sort_order, code_anchor)`,
    )
    .eq("id", configVersionId)
    .eq("fund_id", fundId)
    .single();
  if (configError || !configRow)
    throw new Error(serverText("analysisServer.deep.lockedProfileMissing"));
  const config = configRow as unknown as ConfigData;
  const profile = mapProfile(config);

  const { set: specialists } = await loadSpecialistSet(service, config.id);

  const { data: caseRow, error: caseError } = await service
    .from("cases")
    .select(
      "id, fund_id, primary_origin, companies(name, website, stage, sector, geography, description)",
    )
    .eq("id", caseId)
    .eq("fund_id", fundId)
    .single();
  if (caseError || !caseRow) throw new Error(serverText("analysisServer.deep.caseNotReloaded"));
  const rawCompany = caseRow["companies"] as unknown;
  const company = (Array.isArray(rawCompany) ? rawCompany[0] : rawCompany) as {
    name: string;
    website: string | null;
    stage: string;
    sector: string | null;
    geography: string | null;
    description: string | null;
  };

  const previousRunId = run["previous_run_id"] as string;
  const { data: screeningRun, error: screeningError } = await service
    .from("analysis_runs")
    .select(
      "id, status, raw_response, input_evidence_ids, recommendations(overall_score, recommendation, rationale)",
    )
    .eq("id", previousRunId)
    .eq("fund_id", fundId)
    .eq("case_id", caseId)
    .single();
  if (screeningError || !screeningRun)
    throw new Error(serverText("analysisServer.deep.screeningNotReloaded"));

  const savedEvidenceIds = Array.isArray(run["input_evidence_ids"])
    ? (run["input_evidence_ids"] as string[])
    : [];
  const useSavedEvidence = evidenceSource === "saved_input" && savedEvidenceIds.length > 0;
  const { data: evidence, error: evidenceError } = useSavedEvidence
    ? await loadEvidenceRowsByIds(service, fundId, caseId, savedEvidenceIds)
    : await loadPromptEvidenceRows(service, fundId, caseId);
  if (evidenceError || !evidence?.length) throw new Error("Dybdeanalysen mangler evidens.");
  const evidenceRows = useSavedEvidence
    ? evidence
    : selectPromptEvidence(evidence as Array<Record<string, unknown>>, DEEP_EVIDENCE_MAX);
  const evidenceIds = evidenceRows.map((row) => row["id"] as string);

  const { data: priorFailed } = await service
    .from("analysis_runs")
    .select("id")
    .eq("fund_id", fundId)
    .eq("case_id", caseId)
    .eq("previous_run_id", previousRunId)
    .eq("kind", "deep")
    .eq("status", "failed")
    .eq("config_version_id", configVersionId)
    .eq("workflow_version", DEEP_WORKFLOW_VERSION)
    .eq("prompt_template_version", DEEP_PROMPT_VERSION)
    .eq("model_name", plan.model)
    .neq("id", runId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const fundMemory = await retrieveFundMemory({
    service,
    fundId,
    caseId,
    runId,
    queryText: buildMemoryQueryText({
      companyName: company.name,
      sector: company.sector,
      geography: company.geography,
      stage: company.stage,
      description: company.description,
    }),
  });
  const [identityHints, computedFinancials, financeScore] = await Promise.all([
    loadCaseIdentityHints(service, fundId, caseId),
    loadCompactFinancialMetrics(service, fundId, caseId),
    loadFinanceCodeScore(service, {
      fundId,
      caseId,
      stage: company.stage,
      hasFinanceCriterion: profile.criteria.some(isCodeAnchored),
    }),
  ]);
  // After the sheet phase the run's saved evidence is the evidence beside the sheet.
  const evidenceSheet = useSavedEvidence ? await loadRunEvidenceSheet(service, runId) : null;
  const deepCaseInput = buildDeepCaseInput(
    caseId,
    company,
    caseRow["primary_origin"] as ScreeningCaseInput["intakeSources"][number],
    evidenceRows,
    fundMemory.cases,
    identityHints.founders,
  );
  const baseCaseInput = evidenceSheet
    ? { ...deepCaseInput, evidenceSheet: promptEvidenceSheet(evidenceSheet) }
    : deepCaseInput;

  return {
    service,
    runId,
    run: run as Record<string, unknown>,
    config,
    profile,
    caseRow: caseRow as Record<string, unknown>,
    company,
    screeningRun: screeningRun as Record<string, unknown>,
    evidenceRows,
    evidenceIds,
    caseInput:
      financeScore?.score != null
        ? { ...baseCaseInput, financeCodeScore: financeScore.score }
        : baseCaseInput,
    identityHints,
    computedFinancials,
    financeScore,
    priorFailedRunId: (priorFailed?.["id"] as string | undefined) ?? null,
    specialists,
    plan,
    fundMemoryStatus: fundMemory.status,
  };
}

/**
 * Marks the run, its job and the case as running. Only a run that is still queued or running is
 * touched: a double delivery after the run failed or finished must not bring it back.
 * Returns false when the run is no longer active.
 */
async function markRunActive(context: DeepWorkerContext): Promise<boolean> {
  const now = new Date().toISOString();
  const { service, run, runId } = context;
  const { data: active, error } = await service
    .from("analysis_runs")
    .update({
      status: "running",
      started_at: (run["status"] as string) === "queued" ? now : undefined,
    })
    .eq("id", runId)
    .in("status", ["queued", "running"])
    .select("id")
    .maybeSingle();
  if (error) throw new Error(serverText("analysisServer.deep.runDataNotLoaded"));
  if (!active) return false;
  await Promise.all([
    service
      .from("analysis_jobs")
      .update({
        status: "running",
        locked_at: now,
        locked_by: "vercel-phase-worker",
        updated_at: now,
      })
      .eq("run_id", runId)
      .in("status", ["queued", "running"]),
    service
      .from("cases")
      .update({
        execution_status: "deep_analysis_in_progress",
        updated_at: now,
      })
      .eq("id", run["case_id"] as string)
      .eq("fund_id", run["fund_id"] as string),
  ]);
  return true;
}

async function loadSteps(service: ServiceClient, runId: string): Promise<Map<string, StepRow>> {
  const { data, error } = await service
    .from("analysis_run_steps")
    .select(
      "step_key, status, attempt_count, started_at, output_json, actual_cost, charged_cost, input_tokens, output_tokens, total_tokens",
    )
    .eq("run_id", runId);
  if (error || !data) throw new Error(serverText("analysisServer.deep.stepsNotLoaded"));
  return new Map((data as StepRow[]).map((step) => [step.step_key, step]));
}

async function claimStep(service: ServiceClient, runId: string, stepKey: string): Promise<boolean> {
  const { data: current, error: currentError } = await service
    .from("analysis_run_steps")
    .select("status, attempt_count, started_at")
    .eq("run_id", runId)
    .eq("step_key", stepKey)
    .maybeSingle();
  if (currentError || !current)
    throw new Error(serverText("analysisServer.deep.stepNotLocked", { step: stepKey }));

  const now = new Date();
  // The lease is longer than any gateway call plus the saving after it (deep-text-rules.ts), so a
  // queue redelivery never starts a second paid call while the first is still running; and a
  // step is taken over at most once (deep-claim.ts), so a crash loop cannot pay again and again.
  const decision = decideStepClaim(current, now.getTime(), STEP_STALE_AFTER_MS);
  if (decision === "attempts_exhausted") {
    throw new Error(
      serverText("analysisServer.deep.stepRetried", { step: stepKey, count: MAX_STEP_ATTEMPTS }),
    );
  }
  if (decision === "step_failed") {
    throw new Error(serverText("analysisServer.deep.stepFailed", { step: stepKey }));
  }
  if (decision === "busy") return false;
  const isStale = current.status === "running";

  let claim = service
    .from("analysis_run_steps")
    .update({
      status: "running",
      attempt_count: Number(current.attempt_count ?? 0) + 1,
      started_at: now.toISOString(),
      error_message: null,
    })
    .eq("run_id", runId)
    .eq("step_key", stepKey)
    .eq("status", current.status);
  if (isStale) claim = claim.eq("started_at", current.started_at);
  const { data, error } = await claim.select("step_key").maybeSingle();
  if (error) throw new Error(serverText("analysisServer.deep.stepNotLocked", { step: stepKey }));
  return Boolean(data);
}

/** A step that is finished: complete, or (the evidence sheet only) skipped without a sheet. */
function isStepDone(step: StepRow): boolean {
  return step.status === "complete" || step.status === "skipped";
}

function pendingPhase(
  steps: Map<string, StepRow>,
  specialists: readonly DeepSpecialist[],
): DeepAnalysisPhase | null {
  if (steps.get("public_research")?.status !== "complete") return "public_research";
  const sheetStep = steps.get(EVIDENCE_SHEET_STEP);
  if (sheetStep && !isStepDone(sheetStep)) return "evidence_sheet";
  if (specialists.some((module) => steps.get(module.id)?.status !== "complete")) {
    return "specialists";
  }
  if (steps.get(SYNTHESIS_STEP)?.status !== "complete") return "synthesis";
  return null;
}

async function runPublicResearchPhase(context: DeepWorkerContext, phaseStartedAt: number) {
  const { service, run, runId, profile, company, config } = context;
  if (context.specialists.length === 0) {
    throw new Error(serverText("analysisServer.common.noSpecialists"));
  }
  if (PUBLIC_RESEARCH_CALL_COUNT + context.specialists.length + 1 > MAX_DEEP_MODEL_CALLS) {
    throw new Error(serverText("analysisServer.common.deepOverBudget"));
  }

  const reusable = context.priorFailedRunId
    ? await loadReusablePublicResearch(service, context.priorFailedRunId)
    : null;
  // The case's own unread files and more of its website, alongside the research (free).
  const caseMaterial = readCaseOwnMaterial({
    service,
    fundId: run["fund_id"] as string,
    caseId: run["case_id"] as string,
    actorId: run["requested_by"] as string,
  });
  const research: PublicResearchResult = reusable
    ? reusable.result
    : await collectPublicCompanyResearch({
        service,
        fundId: run["fund_id"] as string,
        caseId: run["case_id"] as string,
        actorId: run["requested_by"] as string,
        companyName: company.name,
        website: company.website,
        stage: company.stage,
        // The evidence sheet's share is set aside from the research budget.
        researchBudgetUsd: context.plan.budget.researchUsd - EVIDENCE_SHEET_BUDGET_USD.deep,
        researchModuleOverrides: await getResearchModuleOverrides(service, config.id),
        fundResearchBrief: buildFundResearchBrief(profile),
        specialistQuestions: specialistResearchQuestions(
          context.specialists,
          buildFundResearchBrief(profile),
          profile.screeningInstruction,
        ),
        researchPlan: {
          tier: context.plan.tier,
          setup: {
            profile,
            screeningInstruction: profile.screeningInstruction,
            specialists: context.specialists,
          },
          // A plan this run (an earlier attempt of the phase) or the failed run before it
          // saved is reused unpaid; the failed run has the same setup and prompt version.
          reuse:
            (await loadReusableResearchPlan(service, runId)) ??
            (context.priorFailedRunId
              ? await loadReusableResearchPlan(service, context.priorFailedRunId)
              : null),
          onPlan: (plan) => saveResearchPlanOnStep(service, runId, "public_research", plan),
        },
        researchDeadlineAt: researchDeadlineAt("deep", phaseStartedAt),
        identityHints: context.identityHints,
      });
  // A failure after the paid research (its own material, the basis, saving the step)
  // books what the research charged, so the failed run is not booked 0 kr.
  try {
    const material = await caseMaterial;
    if (!reusable) {
      await recordCvrLookupStep(service, {
        fundId: run["fund_id"] as string,
        runId,
        outcome: research.cvrLookup,
      });
    }

    const { data: refreshedEvidence, error: evidenceError } = await loadPromptEvidenceRows(
      service,
      run["fund_id"] as string,
      run["case_id"] as string,
    );
    if (evidenceError || !refreshedEvidence?.length) {
      throw new Error(serverText("analysisServer.common.basisNotReloaded"));
    }
    const evidenceIds = selectPromptEvidence(
      refreshedEvidence as Array<Record<string, unknown>>,
      DEEP_EVIDENCE_MAX,
    ).map((row) => row["id"] as string);

    const [stepSave] = await Promise.all([
      service
        .from("analysis_run_steps")
        .update({
          status: "complete",
          input_tokens: research.inputTokens,
          output_tokens: research.outputTokens,
          total_tokens: research.totalTokens,
          actual_cost: research.actualCostUsd,
          charged_cost: research.budgetChargeUsd,
          output_json: {
            ...research.packet,
            persistedSources: research.sourceCount,
            persistedEvidence: research.insertedEvidence,
            researchLog: research.researchLog ?? null,
            researchPlan: research.researchPlan ?? null,
            researchPlanStatus: research.researchPlanStatus ?? null,
            questionNeutralizer: research.questionNeutralizer ?? null,
            researchFollowUp: research.researchFollowUp ?? null,
            caseMaterial: material,
            ...(reusable ? { reusedFromRunId: reusable.runId } : {}),
          },
          completed_at: new Date().toISOString(),
        })
        .eq("run_id", runId)
        .eq("step_key", "public_research"),
      service.from("analysis_runs").update({ input_evidence_ids: evidenceIds }).eq("id", runId),
    ]);
    if (stepSave.error) {
      console.error(`Dyb analyse ${runId}: researchen blev ikke gemt`, stepSave.error.message);
      throw new Error(serverText("analysisServer.deep.researchNotSaved"));
    }
  } catch (cause) {
    if (reusable || cause instanceof ResearchFailedError) throw cause;
    throw new ResearchFailedError(cause, research.budgetChargeUsd);
  }
}

/**
 * The evidence sheet, its own phase between the research and the specialists (its own
 * function invocation, so the research keeps its time). Written once; the specialists read it.
 * Without a sheet (time, budget, a model error) the step is skipped and the run goes on with the
 * evidence as before.
 */
async function runEvidenceSheetPhase(
  initialContext: DeepWorkerContext,
  steps: Map<string, StepRow>,
  phaseStartedAt: number,
) {
  const context =
    (await loadWorkerContext(initialContext.service, initialContext.runId, "saved_input")) ??
    initialContext;
  await runDeepEvidenceSheetStep({
    service: context.service,
    fundId: context.run["fund_id"] as string,
    runId: context.runId,
    tier: context.plan.tier,
    profile: context.profile,
    evidenceRows: context.evidenceRows,
    researchOutput: steps.get("public_research")?.output_json,
    priorFailedRunId: context.priorFailedRunId,
    // Saving the step and the evidence after the call takes a few seconds.
    timeLeftMs: phaseStartedAt + FUNCTION_MAX_DURATION_SECONDS * 1_000 - 30_000 - Date.now(),
  });
}

async function runSpecialistPhase(
  context: DeepWorkerContext,
  initialSteps: Map<string, StepRow>,
): Promise<boolean> {
  const refreshed = await loadWorkerContext(context.service, context.runId, "saved_input");
  if (!refreshed) return false;
  context = refreshed;
  const { service, runId, profile, evidenceIds, specialists } = context;
  const promptInput = buildPromptInput(context);
  const reusable = context.priorFailedRunId
    ? await loadReusableSpecialists({
        service,
        failedRunId: context.priorFailedRunId,
        profile,
        caseId: context.run["case_id"] as string,
        allowedEvidenceIds: new Set(evidenceIds),
        model: context.plan.model,
        specialists,
      })
    : new Map<string, SpecialistOutput>();

  for (const module of specialists) {
    const current = initialSteps.get(module.id);
    const packet = reusable.get(module.id);
    if (current?.status !== "complete" && packet) {
      await service
        .from("analysis_run_steps")
        .update({
          status: "complete",
          attempt_count: 0,
          input_tokens: 0,
          output_tokens: 0,
          total_tokens: 0,
          actual_cost: 0,
          charged_cost: 0,
          output_json: packet,
          error_message: null,
          completed_at: new Date().toISOString(),
        })
        .eq("run_id", runId)
        .eq("step_key", module.id);
    }
  }

  const steps = await loadSteps(service, runId);
  const results = await Promise.all(
    specialists.map(async (module) => {
      const existing = steps.get(module.id);
      if (existing?.status === "complete") {
        const parsed = specialistOutputSchema.parse(existing.output_json);
        validateSpecialistPacket(
          parsed,
          module,
          profile,
          context.run["case_id"] as string,
          new Set(evidenceIds),
        );
        return { packet: parsed, completion: null, busy: false, error: null };
      }

      const claimed = await claimStep(service, runId, module.id);
      if (!claimed) return { packet: null, completion: null, busy: true, error: null };

      let completion: DeepGatewayCompletion | null = null;
      try {
        const prompt = buildSpecialistPrompt(profile, promptInput, module);
        completion = await callDeepGateway(
          prompt.system,
          prompt.user,
          `pap_specialist_${module.id}`,
          specialistJsonSchema(profile, module, evidenceIds),
          outputTokenCap("specialist", context.plan.tier, context.plan.model),
          context.plan.budget.specialistsUsd / specialists.length,
          DEEP_CALL_TIMEOUT_MS[context.plan.tier].specialist,
          "low",
          context.plan.model,
          await redactorForFund(context.run["fund_id"] as string, "deep_analysis", context.service),
        );
        const parsedPacket = specialistOutputSchema.parse(JSON.parse(completion.content));
        // A category the specialist skipped becomes an 'unknown' finding, never a failed step.
        // A card point without an allowed source is dropped, never a failed step.
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
        validateSpecialistPacket(
          packet,
          module,
          profile,
          context.run["case_id"] as string,
          new Set(evidenceIds),
        );
        await service
          .from("analysis_run_steps")
          .update({
            status: "complete",
            input_tokens: completion.inputTokens,
            output_tokens: completion.outputTokens,
            total_tokens: completion.totalTokens,
            actual_cost: completion.actualCostUsd,
            charged_cost: budgetCharge(completion.actualCostUsd, completion.estimatedMaximumUsd),
            output_json: packet,
            completed_at: new Date().toISOString(),
          })
          .eq("run_id", runId)
          .eq("step_key", module.id);
        return { packet, completion, busy: false, error: null };
      } catch (cause) {
        const message = errorMessage(cause, "Specialistanalysen fejlede.");
        // A call cut off by the token cap was still paid for: keep its usage on the step.
        completion = completion ?? failedCallCompletion(cause);
        const chargedUsd = failedStepChargeUsd(cause, completion);
        await service
          .from("analysis_run_steps")
          .update({
            status: "failed",
            error_message: message,
            ...completionUsage(completion),
            ...(chargedUsd === null ? {} : { charged_cost: chargedUsd }),
            completed_at: new Date().toISOString(),
          })
          .eq("run_id", runId)
          .eq("step_key", module.id);
        return { packet: null, completion, busy: false, error: message };
      }
    }),
  );

  // A failure is looked at before "busy": a failed specialist beside one another
  // delivery still runs would otherwise answer "busy" and leave the run running for ever.
  const failed = results.find((result) => result.error !== null);
  if (failed) throw new Error(failed.error ?? serverText("analysisServer.common.specialistFailed"));
  if (results.some((result) => result.busy)) return false;
  const charged = results.reduce(
    (sum, result) =>
      sum +
      (result.completion
        ? budgetCharge(result.completion.actualCostUsd, result.completion.estimatedMaximumUsd)
        : 0),
    0,
  );
  assertActualSpendWithinBudget(
    charged,
    context.plan.budget.specialistsUsd,
    "Specialistanalyserne",
    requestLanguage(),
  );
  return true;
}

function buildPromptInput(context: DeepWorkerContext) {
  return specialistPromptInput(context.screeningRun, context.caseInput, context.computedFinancials);
}

/**
 * What a specialist is given about the case: the case input and the locked screening. Also used
 * by the trial run of a fund's own specialist, so a trial sees what a run would see.
 */
export function specialistPromptInput(
  screeningRun: Record<string, unknown>,
  caseInput: ScreeningCaseInput,
  computedFinancials: CompactFinancialMetrics | null,
) {
  const rawRecommendation = screeningRun["recommendations"] as unknown;
  const recommendation = (
    Array.isArray(rawRecommendation) ? rawRecommendation[0] : rawRecommendation
  ) as {
    overall_score: number | null;
    recommendation: string | null;
    rationale: string | null;
  } | null;
  const parsed = screeningOutputSchema.safeParse(screeningRun["raw_response"]);
  return {
    caseInput,
    computedFinancials,
    screening: {
      runId: screeningRun["id"] as string,
      overallScore:
        recommendation?.overall_score == null ? null : Number(recommendation.overall_score),
      recommendation: recommendation?.recommendation ?? null,
      rationale: recommendation?.rationale ?? null,
      inputEvidenceIds: Array.isArray(screeningRun["input_evidence_ids"])
        ? (screeningRun["input_evidence_ids"] as string[])
        : [],
      snapshot: parsed.success ? parsed.data : null,
    },
  };
}

async function runSynthesisPhase(
  initialContext: DeepWorkerContext,
  initialSteps: Map<string, StepRow>,
): Promise<DeepGatewayCompletion> {
  const refreshed = await loadWorkerContext(
    initialContext.service,
    initialContext.runId,
    "saved_input",
  );
  if (!refreshed) throw new Error(serverText("analysisServer.deep.endedBeforeSynthesis"));
  const context = refreshed;
  const { service, runId, profile, evidenceIds } = context;
  const specialistPackets = context.specialists.map((module) => {
    const step = initialSteps.get(module.id);
    if (!step || step.status !== "complete") {
      throw new Error(serverText("analysisServer.deep.specialistUnfinished", { name: module.id }));
    }
    const packet = specialistOutputSchema.parse(step.output_json);
    validateSpecialistPacket(
      packet,
      module,
      profile,
      context.run["case_id"] as string,
      new Set(evidenceIds),
    );
    return packet;
  });

  const promptInput = buildPromptInput(context);
  const openTaskTitles = await loadOpenTaskTitles(
    service,
    context.run["fund_id"] as string,
    context.run["case_id"] as string,
    OPEN_TASK_TITLES_FOR_SYNTHESIS,
    "deep",
  );
  const prompt = buildInvestmentCommitteeSynthesisPrompt(
    profile,
    promptInput,
    specialistPackets,
    openTaskTitles,
    context.specialists,
  );
  // Teamets gate-svar læses før det betalte kald (harden G11).
  const storedTeamAnswers = await loadTeamGateAnswers(context.service, {
    fundId: context.run["fund_id"] as string,
    caseId: context.run["case_id"] as string,
  });
  const completion = await callDeepGateway(
    prompt.system,
    prompt.user,
    "pap_deep_v1",
    deepJsonSchema(profile, evidenceIds),
    outputTokenCap("synthesis", context.plan.tier, context.plan.model),
    context.plan.budget.synthesisUsd,
    DEEP_CALL_TIMEOUT_MS[context.plan.tier].synthesis,
    synthesisReasoningEffort(context.plan.model),
    context.plan.model,
    await redactorForFund(context.run["fund_id"] as string, "deep_analysis", context.service),
  );
  const chargedSynthesis = budgetCharge(completion.actualCostUsd, completion.estimatedMaximumUsd);
  // Everything below is paid for already: if it fails (also the budget check), the failed step
  // still records the call's tokens and cost (DeepGatewayError carries them to failDeepRun).
  try {
    assertActualSpendWithinBudget(
      chargedSynthesis,
      context.plan.budget.synthesisUsd,
      "Komitésyntesen",
      requestLanguage(),
    );
    // C7: fondens finans-gates regnes i kode, ikke af AI.
    const gatedOutput = await withFinanceGates(
      service,
      {
        fundId: context.run["fund_id"] as string,
        caseId: context.run["case_id"] as string,
        stage: context.company.stage,
        gateKeys: profile.gates.map((gate) => gate.key),
      },
      deepAnalysisOutputSchema.parse(JSON.parse(completion.content)),
    );
    // A category the model skipped becomes an 'unknown' finding, never a failed run after payment
    // (principle 7); the audit shows it as a warning.
    const categories = withCategoryFallbacks(
      gatedOutput.findings,
      ANALYSIS_CATEGORIES,
      specialistPackets.flatMap((packet) => packet.findings),
      requestLanguage(),
    );
    // A number the finance specialist took from the evidence must be in that evidence and
    // agree with the register; the others are dropped here and reported in the quality audit.
    const financeCheck = await checkDeepFinancialInputs(service, {
      fundId: context.config.fund_id,
      caseId: context.run["case_id"] as string,
      inputs: gatedOutput.financialInputs,
      evidenceRows: context.evidenceRows,
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
    if (output.caseId !== context.run["case_id"]) {
      throw new Error(serverText("analysisServer.common.otherCase"));
    }
    validateReferences(output, new Set(evidenceIds));
    validateSynthesizedFinancialInputs(output, specialistPackets);
    const qualityAudit = auditDeepOutput(output, profile);
    qualityAudit.warnings.push(...financeCheck.warnings);
    qualityAudit.warnings.push(
      ...categoryFallbackWarning(categories.added, categories.copied, requestLanguage()),
    );
    if (qualityAudit.blockingErrors.length) {
      // Every fund member can read a step row, so the rejected text itself is NOT stored there:
      // only the reasons, the size and a hash (to recognise the output). The server log gets the
      // same, never the text (it has its masking undone); the masked request is in
      // ai_call_log.
      const rejectedJson = JSON.stringify(output);
      const outputSha256 = createHash("sha256").update(rejectedJson).digest("hex");
      console.error(
        `[deep-synthesis] run ${runId} rejected by quality control: ${qualityAudit.blockingErrors.join(" ")} (${rejectedJson.length} characters, sha256 ${outputSha256})`,
      );
      await service
        .from("analysis_run_steps")
        .update({
          output_json: {
            qualityRejected: true,
            blockingErrors: qualityAudit.blockingErrors,
            warnings: qualityAudit.warnings,
            outputLength: rejectedJson.length,
            outputSha256,
          },
        })
        .eq("run_id", runId)
        .eq("step_key", SYNTHESIS_STEP);
      throw new Error(
        `Kvalitetskontrollen afviste analysen: ${qualityAudit.blockingErrors.join(" ")}`,
      );
    }

    await service
      .from("analysis_run_steps")
      .update({
        input_tokens: completion.inputTokens,
        output_tokens: completion.outputTokens,
        total_tokens: completion.totalTokens,
        actual_cost: completion.actualCostUsd,
        charged_cost: chargedSynthesis,
        output_json: output,
      })
      .eq("run_id", runId)
      .eq("step_key", SYNTHESIS_STEP);

    await persistDeepAnalysis(context, output, specialistPackets, qualityAudit, storedTeamAnswers);
    await service
      .from("analysis_run_steps")
      .update({ status: "complete", completed_at: new Date().toISOString() })
      .eq("run_id", runId)
      .eq("step_key", SYNTHESIS_STEP);
    return completion;
  } catch (cause) {
    if (cause instanceof DeepGatewayError) throw cause;
    throw new DeepGatewayError(errorMessage(cause, "Komitésyntesen fejlede."), completion);
  }
}

async function persistDeepAnalysis(
  context: DeepWorkerContext,
  output: DeepAnalysisOutput,
  specialistPackets: SpecialistOutput[],
  qualityAudit: ReturnType<typeof auditDeepOutput>,
  storedTeamAnswers: StoredGateAnswer[],
) {
  const { service, runId, profile, config, run, evidenceIds } = context;
  const screeningShape = { ...output, schemaVersion: "interlect-screening-v1" as const };
  // Teamets gate-svar under samme opsætning gælder også for den dybe analyse (harden F2).
  const teamAnswers = teamAnswersForNewRun(storedTeamAnswers, {
    configVersionId: config.id,
    verdicts: new Map(output.gates.map((gate) => [gate.gateKey, gate.passed])),
  });
  const result = scoreScreening(
    profile,
    applyGateAnswers(screeningShape, teamAnswers),
    context.company.stage,
    context.financeScore,
  );
  await writeDeepResultRows(service, {
    fundId: config.fund_id,
    caseId: run["case_id"] as string,
    runId,
    output,
    result,
  });

  const steps = await loadSteps(service, runId);
  const stepRows = [...steps.values()];
  // Ærligt: null når mindst ét trins forbrug ikke blev rapporteret af Gatewayen --
  // vises som "ukendt" i UI'en i stedet for et falsk præcist 0,00 kr.
  const totalCostUsd = sumCompleteCosts(stepRows.map((step) => step.actual_cost));
  // What the run charged against its budget, booked by the settlement (0114) when the
  // price is unknown. Only when every step left its price or charge: a step saved before 0116
  // without a price leaves it unknown, and the run is booked to its reservation as before.
  const stepCosts = stepRunCosts(stepRows);
  const chargedUsd = stepCosts.everyStepKnown ? stepCosts.chargedUsd : null;
  // Kendt delsum bruges kun til selve budgetgennemtvingelsen -- et manglende
  // enkelt trins forbrug skal ikke stoppe den samlede løbske-forbrug-kontrol.
  const knownCostUsd = stepRows.reduce((sum, step) => sum + (step.actual_cost ?? 0), 0);
  const inputTokens = stepRows.reduce((sum, step) => sum + Number(step.input_tokens ?? 0), 0);
  const outputTokens = stepRows.reduce((sum, step) => sum + Number(step.output_tokens ?? 0), 0);
  const totalTokens = stepRows.reduce(
    (sum, step) =>
      sum +
      Number(step.total_tokens ?? Number(step.input_tokens ?? 0) + Number(step.output_tokens ?? 0)),
    0,
  );
  assertActualSpendWithinBudget(
    knownCostUsd,
    context.plan.budget.usd,
    "Den dybe analyse",
    requestLanguage(),
  );
  const publicPacket = publicResearchPacket(steps.get("public_research")?.output_json);
  const completedAt = new Date().toISOString();

  // The run is only complete when these writes landed; a failed write fails the run
  // (with its cost) instead of leaving it "running" with nobody to finish it.
  const finished = await Promise.all([
    service
      .from("analysis_runs")
      .update({
        status: "complete",
        raw_response: {
          schemaVersion: "interlect-deep-orchestrated-v1",
          publicResearch: publicPacket,
          specialists: specialistPackets,
          specialistSet: specialistSetSummary(context.specialists),
          synthesis: output,
        },
        validation_result: {
          ok: true,
          formulaVersion: SCORING_FORMULA_VERSION,
          // Teamets gate-svar, der indgik i scoren (harden G2).
          teamGateAnswers: teamAnswers,
          financeScore: financeScoreAudit(context.financeScore, result),
          financeFormulaVersion: FINANCE_FORMULA_VERSION,
          fundMemory: context.fundMemoryStatus,
          blockers: result.blockers,
          qualityAudit,
          executionMode: "durable-phases-v1",
          costCurrency: "USD",
          aiTier: context.plan.tier,
          model: context.plan.model,
          budget: {
            dkk: context.plan.budget.dkk,
            usd: context.plan.budget.usd,
            researchUsd: context.plan.budget.researchUsd,
            specialistsUsd: context.plan.budget.specialistsUsd,
            synthesisUsd: context.plan.budget.synthesisUsd,
            customCap: context.plan.customCap,
            chargedUsd,
            actualUsd: totalCostUsd,
          },
        },
        token_usage: totalTokens,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        actual_cost: totalCostUsd,
        completed_at: completedAt,
      })
      .eq("id", runId)
      .in("status", ["queued", "running"])
      .select("id"),
    service
      .from("cases")
      .update({
        execution_status: "complete",
        pap_recommendation: result.recommendation,
        updated_at: completedAt,
      })
      .eq("id", run["case_id"] as string)
      .eq("fund_id", run["fund_id"] as string),
    service
      .from("analysis_jobs")
      .update({
        status: "complete",
        locked_at: null,
        locked_by: null,
        completed_at: completedAt,
        updated_at: completedAt,
      })
      .eq("run_id", runId),
  ]);
  const [runWrite, caseWrite, jobWrite] = finished;
  if (runWrite.error || !runWrite.data?.length) {
    throw new Error(serverText("analysisServer.deep.notCompleted"));
  }
  if (caseWrite.error || jobWrite.error) {
    // The result is saved and the run is complete; only the case's or job's status lags.
    console.error(
      `Dyb analyse ${runId}: status på case eller job blev ikke opdateret`,
      caseWrite.error?.message ?? jobWrite.error?.message,
    );
  }
  await service.from("case_transition_events").insert({
    fund_id: run["fund_id"],
    case_id: run["case_id"],
    field: "execution_status",
    actor_type: "pap",
    actor_id: runId,
    previous_value: "deep_analysis_in_progress",
    new_value: "complete",
    reason: serverText("analysisServer.deep.approvedSummary", {
      name: profile.name,
      version: profile.version,
    }),
    evidence_ids: evidenceIds,
    analysis_run_id: runId,
  });
  // "Skal afklares": den dybe analyses huller og spørgsmål som AI-tasks (0034).
  await writeAiTasks(service, {
    fundId: run["fund_id"] as string,
    caseId: run["case_id"] as string,
    runId,
    runKind: "deep",
    createdBy: run["requested_by"] as string,
    source: deepTaskSource({
      configVersionId: config.id,
      profile,
      modules: context.specialists,
      unresolvedGateKeys: result.unresolvedGateKeys,
      missingCriterionKeys: result.missingCriterionKeys,
      output,
      specialists: specialistPackets,
      researchQuestions: founderQuestions(
        readStoredResearchFollowUp(
          (steps.get("public_research")?.output_json as Record<string, unknown> | null)?.[
            "researchFollowUp"
          ],
        ),
      ),
    }),
  });
}

function publicResearchPacket(value: unknown): PublicResearchOutput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(serverText("analysisServer.deep.storedResearchInvalid"));
  }
  const packet = { ...(value as Record<string, unknown>) };
  delete packet["persistedSources"];
  delete packet["persistedEvidence"];
  delete packet["reusedFromRunId"];
  return packet as PublicResearchOutput;
}

async function releasePhase(
  context: DeepWorkerContext,
  nextPhase: DeepAnalysisPhase,
  dispatchNextPhase: boolean,
) {
  await context.service
    .from("analysis_jobs")
    .update({
      locked_at: null,
      locked_by: null,
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("run_id", context.runId)
    .in("status", ["queued", "running"]);
  if (dispatchNextPhase) {
    const { enqueueDeepAnalysisPhase } = await import("./deep-queue.server");
    await enqueueDeepAnalysisPhase(context.runId, nextPhase);
  }
  console.info(`Dyb analyse ${context.runId}: fase ${nextPhase} er klar.`);
}

async function failDeepRun(
  service: ServiceClient,
  runId: string,
  activeStepKey: string | null,
  completion: DeepGatewayCompletion | null,
  message: string,
  diagnostics: DeepGatewayError["diagnostics"] = null,
  /** What the failed step charged against its budget; null leaves the step's own. */
  stepChargeUsd: number | null = null,
) {
  if (activeStepKey) {
    await service
      .from("analysis_run_steps")
      .update({
        status: "failed",
        error_message: message,
        // finish_reason, duration and the cut-off text of a failed call (never overwrites the
        // rejected output a quality-control failure saved: that has no diagnostics).
        ...(diagnostics ? { output_json: { callFailed: diagnostics } } : {}),
        ...(activeStepKey === SYNTHESIS_STEP ? completionUsage(completion) : {}),
        ...(stepChargeUsd === null ? {} : { charged_cost: stepChargeUsd }),
        completed_at: new Date().toISOString(),
      })
      .eq("run_id", runId)
      .eq("step_key", activeStepKey);
  }

  // Marking the run failed must not itself fail because the plan cannot be read.
  const plan = await loadStoredRunPlan(service, runId, "deep").catch((cause) => {
    console.error(`Dyb analyse ${runId}: kørslens AI-niveau kunne ikke læses ved fejl`, cause);
    return legacyRunPlan("deep");
  });
  const [{ data: run }, { data: usageRows, error: usageError }] = await Promise.all([
    service.from("analysis_runs").select("fund_id, case_id").eq("id", runId).maybeSingle(),
    service
      .from("analysis_run_steps")
      .select("actual_cost, charged_cost, input_tokens, output_tokens, total_tokens")
      .eq("run_id", runId),
  ]);
  if (!run) return;
  if (usageError) {
    // The run is still failed; without its steps it is booked as if nothing was used.
    console.error(
      `Dyb analyse ${runId}: trinnenes forbrug kunne ikke læses ved fejl`,
      usageError.message,
    );
  }
  const rows = usageRows ?? [];
  // A step that charged without a price leaves the run's price unknown, and the
  // settlement (0114) books what the steps charged instead of only the known prices.
  const costs = stepRunCosts(rows);
  const input = rows.reduce((sum, row) => sum + Number(row["input_tokens"] ?? 0), 0);
  const output = rows.reduce((sum, row) => sum + Number(row["output_tokens"] ?? 0), 0);
  const total = rows.reduce(
    (sum, row) =>
      sum +
      Number(
        row["total_tokens"] ?? Number(row["input_tokens"] ?? 0) + Number(row["output_tokens"] ?? 0),
      ),
    0,
  );
  const now = new Date().toISOString();
  // Only a run that is still active is failed. A late delivery of a run that already
  // failed (or was released, and the case restarted) must not touch the case or the new run.
  const { data: failed } = await service
    .from("analysis_runs")
    .update({
      status: "failed",
      error_message: message,
      actual_cost: costs.actualUsd,
      input_tokens: input || null,
      output_tokens: output || null,
      token_usage: total || null,
      validation_result: {
        ok: false,
        executionMode: "durable-phases-v1",
        costCurrency: "USD",
        aiTier: plan.tier,
        budget: {
          dkk: plan.budget.dkk,
          usd: plan.budget.usd,
          researchUsd: plan.budget.researchUsd,
          analysisUsd: plan.budget.analysisUsd,
          chargedUsd: costs.chargedUsd,
          actualUsd: costs.actualUsd,
        },
      },
      completed_at: now,
    })
    .eq("id", runId)
    .in("status", ["queued", "running"])
    .select("id")
    .maybeSingle();
  if (!failed) return;
  await Promise.all([
    service
      .from("cases")
      .update({ execution_status: "failed", updated_at: now })
      .eq("id", run["case_id"] as string)
      .eq("fund_id", run["fund_id"] as string),
    service
      .from("analysis_jobs")
      .update({
        status: "failed",
        last_error: message,
        locked_at: null,
        locked_by: null,
        updated_at: now,
      })
      .eq("run_id", runId),
  ]);
  await returnFailedDeepCaseToScreening(
    service,
    run["fund_id"] as string,
    run["case_id"] as string,
    runId,
  );
}
