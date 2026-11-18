/**
 * The screening's analysis phase, in a function of its own after the research phase
 * (runInitialScreening in screening.functions.ts). Server only: the hosted queue delivers it
 * (server/plugins/screening-queue.ts); off Vercel the research phase runs it inline.
 */
import { isCodeAnchored } from "./code-anchor";
import { enqueueBrainCapture } from "@/lib/brain/queue.server";
import {
  loadFinanceGateContext,
  withFinanceGates,
  loadFinanceCodeScore,
} from "./financial-statements";
import { evaluateFinanceGate, isFinanceGate } from "./financial-gates";
import { getServiceClient } from "@/lib/supabase/admin.server";
import { buildScreeningPrompt, type ScreeningCaseInput } from "./prompt";
import { parseScreeningOutput } from "./contracts";
import { writeAiTasks } from "@/lib/cases/ai-tasks.server";
import { MAX_SCREENING_NEXT_STEPS, sanitizeNextSteps } from "@/lib/cases/tasks";
import { financeScoreAudit, scoreScreening, SCORING_FORMULA_VERSION } from "./scoring";
import { applyGateAnswers, teamAnswersForNewRun } from "./gate-answers";
import { loadTeamGateAnswers } from "./rescore.server";
import { PROMPT_EVIDENCE_SELECT, toPromptEvidence } from "./evidence-selection";
import { failedScreeningCosts, sumCompleteCosts } from "./gateway-response";
import { redactorForFund } from "@/lib/ai/redact-dictionary.server";
import { buildMemoryQueryText, retrieveFundMemory, type FundMemoryStatus } from "./memory";
import { assertActualSpendWithinBudget, budgetCharge } from "./budgets";
import { SCREENING_CALL_TIMEOUT_MS, type RunPlan } from "./model-tiers";
import { founderQuestions } from "./research-followup";
import { promptEvidenceSheet } from "./evidence-sheet";
import { loadStoredRunPlan } from "./run-plan.server";
import { CONFIG_SELECT, mapProfile, type ConfigData } from "./fund-profile";
import { readResearchHandOff, screeningClaimDecision } from "./screening-phases";
import { enqueueScreeningAnalysis } from "./screening-queue.server";
import {
  average,
  buildOverallScoreRationale,
  callGateway,
  ScreeningGatewayError,
  validateConfiguredCoverage,
  validateEvidenceReferences,
} from "./screening.functions";
import { withRunLanguage } from "./run-language.server";
import { requestLanguage, serverText } from "@/lib/i18n/server-text";

/** The fund-fit call's step and the research's (each in its own function). */
export type ScreeningStepKey = "screening_research" | "fund_screening";
type ServiceClient = ReturnType<typeof getServiceClient>;

/**
 * A screening that failed in either phase: the run, the case, the step and the job are marked,
 * with what was paid.
 */
export async function failScreeningRun(
  service: ServiceClient,
  input: {
    runId: string;
    fundId: string;
    caseId: string;
    plan: RunPlan | null;
    activeStepKey: ScreeningStepKey;
    cause: unknown;
    /** The run's price so far (before the failed step). */
    incurredUsd: number | null;
    /** What the run had charged against its budget so far; null when not known. */
    incurredChargeUsd: number | null;
    /** The fund-fit call's charge once it has answered. */
    callCostUsd: number | null;
  },
): Promise<void> {
  const { runId, plan } = input;
  const message = input.cause instanceof Error ? input.cause.message : "Screeningen fejlede.";
  const costs = failedScreeningCosts({
    failedStep: input.activeStepKey,
    incurredUsd: input.incurredUsd,
    incurredChargeUsd: input.incurredChargeUsd,
    callCostUsd:
      input.callCostUsd ??
      (input.cause instanceof ScreeningGatewayError ? input.cause.costUsd : null),
  });
  const results = await Promise.all([
    service
      .from("analysis_runs")
      .update({
        status: "failed",
        error_message: message,
        actual_cost: costs.runUsd,
        validation_result: {
          ok: false,
          costCurrency: "USD",
          aiTier: plan?.tier ?? null,
          budget: {
            dkk: plan?.budget.dkk ?? null,
            usd: plan?.budget.usd ?? null,
            // The settlement books this when actual_cost is unknown.
            chargedUsd: costs.chargedUsd,
            actualUsd: costs.runUsd,
          },
        },
        completed_at: new Date().toISOString(),
      })
      .eq("id", runId),
    service
      .from("cases")
      .update({ execution_status: "failed", updated_at: new Date().toISOString() })
      .eq("id", input.caseId)
      .eq("fund_id", input.fundId),
    service
      .from("analysis_run_steps")
      .update({
        status: "failed",
        error_message: message,
        actual_cost: costs.stepUsd,
        completed_at: new Date().toISOString(),
      })
      .eq("run_id", runId)
      .eq("step_key", input.activeStepKey),
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
  const writeError = results.find((result) => result.error)?.error;
  if (writeError) {
    console.error(`[screening] failure of run ${runId} not fully saved`, writeError.message);
  }
  console.error(`Screening ${runId} fejlede: ${message}`);
}

/**
 * The analysis phase runs in a function of its own. On Vercel the hosted queue delivers it
 * (topic interlect-screening, server/plugins/screening-queue.ts); elsewhere (the dev server,
 * scripts) it runs right after the research in the same process.
 */
export async function dispatchScreeningAnalysis(runId: string): Promise<void> {
  if (!process.env["VERCEL_ENV"]) {
    const result = await runScreeningAnalysisPhase(runId);
    // Nothing else runs the phase here, so a skipped one would leave the run hanging.
    if (result === "busy" || result === "ignored") {
      throw new Error(serverText("analysisServer.screening.notRun", { result }));
    }
    return;
  }
  await enqueueScreeningAnalysis(runId);
}

/**
 * Claims the fund-fit step: from queued, or from running when the function that had it cannot
 * still be alive (screeningClaimDecision). "busy" asks the queue to deliver again later.
 */
async function claimScreeningAnalysis(
  service: ServiceClient,
  runId: string,
): Promise<"claimed" | "busy" | "done" | "exhausted"> {
  const { data: step, error } = await service
    .from("analysis_run_steps")
    .select("status, started_at, attempt_count")
    .eq("run_id", runId)
    .eq("step_key", "fund_screening")
    .maybeSingle();
  // i18n-keep: carries the database's own message; logged, and the person gets a calm fallback.
  if (error) throw new Error(`Screeningens analysetrin kunne ikke læses: ${error.message}`);
  const status = step ? (step["status"] as string) : "";
  const startedAt = (step?.["started_at"] as string | null) ?? null;
  const attemptCount = step ? Number(step["attempt_count"] ?? 0) : null;
  const decision = screeningClaimDecision(
    step ? { status, startedAt, attemptCount } : null,
    Date.now(),
  );
  if (decision === "done" || decision === "busy" || decision === "exhausted") return decision;
  // The update only lands while the step is as just read, so one delivery wins.
  let claim = service
    .from("analysis_run_steps")
    .update({
      status: "running",
      attempt_count: (attemptCount ?? 0) + 1,
      started_at: new Date().toISOString(),
    })
    .eq("run_id", runId)
    .eq("step_key", "fund_screening")
    .eq("status", status);
  if (decision === "take_over") {
    claim = startedAt ? claim.eq("started_at", startedAt) : claim.is("started_at", null);
  }
  const { data: claimed, error: claimError } = await claim.select("id");
  if (claimError) {
    // i18n-keep: carries the database's own message; logged, and the person gets a calm fallback.
    throw new Error(`Screeningens analysetrin kunne ikke låses: ${claimError.message}`);
  }
  return claimed?.length ? "claimed" : "busy";
}

/**
 * The research step's price and what it charged against the budget, for a failure before
 * the hand-off was read (never booked as 0).
 */
async function storedResearchCosts(
  service: ServiceClient,
  runId: string,
): Promise<{ actualUsd: number | null; chargeUsd: number | null }> {
  const { data, error } = await service
    .from("analysis_run_steps")
    .select("actual_cost, research_charge:output_json->researchChargeUsd")
    .eq("run_id", runId)
    .eq("step_key", "screening_research")
    .maybeSingle();
  if (error) {
    console.error(`[screening] research price not read (run ${runId})`, error.message);
    return { actualUsd: null, chargeUsd: null };
  }
  const row = (data ?? {}) as Record<string, unknown>;
  const usd = (value: unknown) => {
    if (value == null) return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : null;
  };
  return { actualUsd: usd(row["actual_cost"]), chargeUsd: usd(row["research_charge"]) };
}

/** The evidence rows the research phase chose (input_evidence_ids), in that order. */
async function loadChosenEvidence(
  service: ServiceClient,
  fundId: string,
  caseId: string,
  ids: readonly string[],
): Promise<Array<Record<string, unknown>>> {
  const byId = new Map<string, Record<string, unknown>>();
  for (let index = 0; index < ids.length; index += 100) {
    const { data, error } = await service
      .from("evidence_items")
      .select(PROMPT_EVIDENCE_SELECT)
      .eq("fund_id", fundId)
      .eq("case_id", caseId)
      .in("id", ids.slice(index, index + 100));
    if (error) throw new Error(serverText("analysisServer.screening.evidenceNotLoaded"));
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      byId.set(row["id"] as string, row);
    }
  }
  return ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
}

/**
 * The screening's analysis phase, in a function of its own after the research phase. It
 * reads everything the research phase saved (the chosen evidence, the evidence sheet, the
 * research's price and founders), asks the fund-fit call, scores in code and saves the result.
 * Never throws after it has claimed the step: a failure marks the run as failed.
 */
export async function runScreeningAnalysisPhase(
  runId: string,
): Promise<"completed" | "failed" | "ignored" | "busy"> {
  // What the worker writes to the person follows the fund's language.
  return withRunLanguage(runId, () => runScreeningAnalysisInLanguage(runId));
}

async function runScreeningAnalysisInLanguage(
  runId: string,
): Promise<"completed" | "failed" | "ignored" | "busy"> {
  const service = getServiceClient();
  const { data: run, error: runError } = await service
    .from("analysis_runs")
    .select("id, fund_id, case_id, config_version_id, requested_by, status, input_evidence_ids")
    .eq("id", runId)
    .eq("kind", "screening")
    .maybeSingle();
  // i18n-keep: carries the database's own message; logged, and the person gets a calm fallback.
  if (runError) throw new Error(`Screeningen kunne ikke læses: ${runError.message}`);
  if (!run || run["status"] !== "running") return "ignored";
  const fundId = run["fund_id"] as string;
  const caseId = run["case_id"] as string;
  const requestedBy = run["requested_by"] as string;
  const claim = await claimScreeningAnalysis(service, runId);
  if (claim === "exhausted") {
    const stored = await storedResearchCosts(service, runId);
    await failScreeningRun(service, {
      runId,
      fundId,
      caseId,
      plan: await loadStoredRunPlan(service, runId, "screening").catch(() => null),
      activeStepKey: "fund_screening",
      cause: new Error(serverText("analysisServer.screening.stoppedTwice")),
      incurredUsd: stored.actualUsd,
      incurredChargeUsd: stored.chargeUsd,
      callCostUsd: null,
    });
    await enqueueBrainCapture(fundId, caseId);
    return "failed";
  }
  if (claim !== "claimed") return claim === "busy" ? "busy" : "ignored";
  let plan: RunPlan | null = null;
  let researchCostUsd: number | null = null;
  let researchChargeUsd: number | null = null;
  let screeningCallCostUsd: number | null = null;
  try {
    await service
      .from("analysis_jobs")
      .update({ locked_at: new Date().toISOString(), locked_by: "vercel-queue" })
      .eq("run_id", runId);
    plan = await loadStoredRunPlan(service, runId, "screening");
    const [configResult, caseResult, stepResult] = await Promise.all([
      service
        .from("fund_config_versions")
        .select(CONFIG_SELECT)
        .eq("id", run["config_version_id"] as string)
        .single(),
      service
        .from("cases")
        .select(
          "id, fund_id, primary_origin, companies(name, website, stage, sector, geography, description)",
        )
        .eq("id", caseId)
        .eq("fund_id", fundId)
        .single(),
      service
        .from("analysis_run_steps")
        .select("output_json, input_tokens, output_tokens, total_tokens, actual_cost")
        .eq("run_id", runId)
        .eq("step_key", "screening_research")
        .eq("status", "complete")
        .maybeSingle(),
    ]);
    if (configResult.error || !configResult.data) {
      throw new Error(serverText("analysisServer.screening.profileNotLoaded"));
    }
    if (caseResult.error || !caseResult.data)
      throw new Error(serverText("analysisServer.common.caseNotFound"));
    if (stepResult.error || !stepResult.data) {
      throw new Error(serverText("analysisServer.screening.researchNotFound"));
    }
    const config = configResult.data as unknown as ConfigData;
    const profile = mapProfile(config);
    const caseRow = caseResult.data as Record<string, unknown>;
    const rawCompany = caseRow["companies"] as unknown;
    const company = (Array.isArray(rawCompany) ? rawCompany[0] : rawCompany) as {
      name: string;
      website: string | null;
      stage: string;
      sector: string | null;
      geography: string | null;
      description: string | null;
    };
    const research = readResearchHandOff(
      stepResult.data as Parameters<typeof readResearchHandOff>[0],
      plan.budget.researchUsd,
    );
    researchCostUsd = research.actualCostUsd;
    researchChargeUsd = research.chargeUsd;
    const chosenIds = ((run["input_evidence_ids"] as string[] | null) ?? []).filter(Boolean);
    const evidenceRows = await loadChosenEvidence(service, fundId, caseId, chosenIds);
    if (!evidenceRows.length) {
      throw new Error(serverText("analysisServer.common.noBasis"));
    }
    const inputEvidenceIds = evidenceRows.map((row) => row["id"] as string);
    const fundMemory = await retrieveFundMemory({
      service,
      fundId: fundId,
      caseId: caseId,
      runId,
      queryText: buildMemoryQueryText({
        companyName: company.name,
        sector: company.sector,
        geography: company.geography,
        stage: company.stage,
        description: company.description,
      }),
    });
    const fundMemoryStatus: FundMemoryStatus = fundMemory.status;
    let caseInput: ScreeningCaseInput = {
      caseId,
      companyName: company.name,
      website: company.website,
      stage: company.stage,
      intakeSources: [caseRow["primary_origin"] as ScreeningCaseInput["intakeSources"][number]],
      // Trin 0 kan have fundet founders i decket, som ikke var tastet ind.
      founders: research.founders,
      evidence: evidenceRows.map(toPromptEvidence),
      ...(research.evidenceSheet
        ? { evidenceSheet: promptEvidenceSheet(research.evidenceSheet) }
        : {}),
      relatedPastCases: fundMemory.cases,
    };
    // C7: finans-gates regnes i kode før AI-kaldet, så AI'ens tekst stemmer med dem.
    const financeGateKeys = profile.gates.map((gate) => gate.key).filter(isFinanceGate);
    const hasFinanceCriterion = profile.criteria.some(isCodeAnchored);
    // Regnskaberne læses én gang og bruges til gates, kode-score og efterkontrol.
    const financeContext =
      financeGateKeys.length || hasFinanceCriterion
        ? await loadFinanceGateContext(service, fundId, caseId, company.stage)
        : null;
    if (financeContext && financeGateKeys.length) {
      caseInput = {
        ...caseInput,
        codeEvaluatedGates: financeGateKeys.map((gateKey) => {
          const result = evaluateFinanceGate(gateKey, financeContext);
          return { gateKey, passed: result.passed, rationale: result.rationale };
        }),
      };
    }
    const financeScore = await loadFinanceCodeScore(
      service,
      {
        fundId: fundId,
        caseId: caseId,
        stage: company.stage,
        hasFinanceCriterion,
      },
      financeContext,
    );
    if (financeScore?.score != null) {
      caseInput = { ...caseInput, financeCodeScore: financeScore.score };
    }
    const prompt = buildScreeningPrompt(profile, caseInput);
    // Teamets gate-svar læses før det betalte kald (harden G11).
    const storedTeamAnswers = await loadTeamGateAnswers(service, {
      fundId: fundId,
      caseId: caseId,
    });
    const completion = await callGateway(
      prompt.system,
      prompt.user,
      profile,
      plan.budget.analysisUsd,
      inputEvidenceIds,
      plan.model,
      SCREENING_CALL_TIMEOUT_MS[plan.tier],
      await redactorForFund(fundId, "screening", service),
    );
    const incurredActualCostUsd = sumCompleteCosts([
      research.actualCostUsd,
      completion.actualCostUsd,
    ]);
    screeningCallCostUsd = budgetCharge(completion.actualCostUsd, completion.estimatedMaximumUsd);
    const chargedScreeningUsd =
      research.chargeUsd + budgetCharge(completion.actualCostUsd, completion.estimatedMaximumUsd);
    assertActualSpendWithinBudget(
      chargedScreeningUsd,
      plan.budget.usd,
      "Screeningen",
      requestLanguage(),
    );
    // C7: fondens finans-gates regnes i kode, ikke af AI.
    const output = await withFinanceGates(
      service,
      {
        fundId: fundId,
        caseId: caseId,
        stage: company.stage,
        gateKeys: profile.gates.map((gate) => gate.key),
      },
      parseScreeningOutput(JSON.parse(completion.content)),
      financeContext,
    );
    if (output.caseId !== caseId) throw new Error(serverText("analysisServer.common.otherCase"));
    validateConfiguredCoverage(output, profile);
    validateEvidenceReferences(output, new Set(inputEvidenceIds));
    // Teamets gate-svar under samme opsætning gælder også for den nye screening (harden F2):
    // et brud, teamet har registreret, kan ikke skjules bag et nyt AI-svar. Det gemte
    // AI-svar (raw_response) forbliver AI'ens eget.
    const teamAnswers = teamAnswersForNewRun(storedTeamAnswers, {
      configVersionId: config.id,
      verdicts: new Map(output.gates.map((gate) => [gate.gateKey, gate.passed])),
    });
    const result = scoreScreening(
      profile,
      applyGateAnswers(output, teamAnswers),
      company.stage,
      financeScore,
    );
    const assessmentByKey = new Map(output.assessments.map((item) => [item.criterionKey, item]));

    const finalStatus = result.outcome === "awaiting_approval" ? "awaiting_approval" : "complete";
    const caseStatus =
      result.outcome === "awaiting_approval"
        ? "awaiting_approval"
        : result.outcome === "needs_information"
          ? "needs_information"
          : "screening_complete";
    const rationale = buildOverallScoreRationale(output, result, profile);

    const { error: categoryScoreError } = await service.from("category_scores").insert(
      result.criteria.map((criterion) => ({
        fund_id: fundId,
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
    if (categoryScoreError) throw new Error(serverText("analysisServer.screening.scoresNotSaved"));
    if (output.risks.length) {
      const { error: riskError } = await service.from("risks").insert(
        output.risks.map((risk) => ({
          fund_id: fundId,
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
      if (riskError) throw new Error(serverText("analysisServer.screening.risksNotSaved"));
    }
    const findingRows = [
      ...output.strengths.map((statement) => ({ findingType: "strength", statement })),
      ...output.weaknesses.map((statement) => ({ findingType: "weakness", statement })),
      ...output.openQuestions.map((statement) => ({ findingType: "question", statement })),
    ].map((finding) => ({
      fund_id: fundId,
      run_id: runId,
      category: "screening_summary",
      finding_type: finding.findingType,
      statement: finding.statement,
      confidence: average(output.assessments.map((item) => item.confidence)),
      nature: "judgement",
      origin: "model",
    }));
    if (findingRows.length) {
      const { error: findingError } = await service.from("analysis_findings").insert(findingRows);
      if (findingError)
        throw new Error(serverText("analysisServer.screening.explanationsNotSaved"));
    }
    const assessmentConfidence = average(output.assessments.map((item) => item.confidence));
    const { error: recommendationError } = await service.from("recommendations").insert({
      fund_id: fundId,
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
      throw new Error(serverText("analysisServer.screening.recommendationNotSaved"));
    const { data: finished, error: finishError } = await service
      .from("analysis_runs")
      .update({
        status: finalStatus,
        raw_response: output,
        validation_result: {
          ok: true,
          formulaVersion: SCORING_FORMULA_VERSION,
          outcome: result.outcome,
          fundMemory: fundMemoryStatus,
          // Teamets gate-svar, der indgik i scoren (harden G2): visningen lægger dem ovenpå
          // AI'ens vurdering, og scoren kan regnes igen fra kørslen alene.
          teamGateAnswers: teamAnswers,
          blockers: result.blockers,
          financeScore: financeScoreAudit(financeScore, result),
          costCurrency: "USD",
          aiTier: plan.tier,
          model: plan.model,
          budget: {
            dkk: plan.budget.dkk,
            usd: plan.budget.usd,
            researchUsd: plan.budget.researchUsd,
            analysisUsd: plan.budget.analysisUsd,
            customCap: plan.customCap,
            chargedUsd: chargedScreeningUsd,
            actualUsd: incurredActualCostUsd,
          },
        },
        token_usage: (research.totalTokens ?? 0) + (completion.totalTokens ?? 0),
        input_tokens: (research.inputTokens ?? 0) + (completion.inputTokens ?? 0),
        output_tokens: (research.outputTokens ?? 0) + (completion.outputTokens ?? 0),
        actual_cost: incurredActualCostUsd,
        completed_at: new Date().toISOString(),
      })
      .eq("id", runId)
      // A run a newer screening released (STALE_SCREENING_MS) must not come back to life.
      .eq("status", "running")
      .select("id");
    if (finishError) throw new Error(serverText("analysisServer.screening.resultNotSaved"));
    if (!finished?.length) {
      console.warn(`[screening] run ${runId} was released before it finished; result not applied`);
      return "ignored";
    }
    await service
      .from("cases")
      .update({
        execution_status: caseStatus,
        pap_recommendation: result.recommendation,
        updated_at: new Date().toISOString(),
      })
      .eq("id", caseId)
      .eq("fund_id", fundId);
    await service.from("case_transition_events").insert({
      fund_id: fundId,
      case_id: caseId,
      field: "execution_status",
      actor_type: "pap",
      actor_id: runId,
      previous_value: "queued",
      new_value: caseStatus,
      reason: serverText("analysisServer.screening.summary", {
        name: profile.name,
        version: profile.version,
      }),
      analysis_run_id: runId,
      evidence_ids: inputEvidenceIds,
    });
    await Promise.all([
      service
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
        .eq("step_key", "fund_screening"),
      service
        .from("analysis_jobs")
        .update({
          status: "complete",
          locked_at: null,
          locked_by: null,
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("run_id", runId),
    ]);
    // "Skal afklares": screeningens ukendte gates, huller og åbne spørgsmål som AI-tasks (0034).
    await writeAiTasks(service, {
      fundId: fundId,
      caseId: caseId,
      runId,
      runKind: "screening",
      createdBy: requestedBy,
      source: {
        language: profile.language ?? "da",
        configVersionId: config.id,
        gates: profile.gates,
        criteria: profile.criteria,
        unresolvedGateKeys: result.unresolvedGateKeys,
        missingCriterionKeys: result.missingCriterionKeys,
        assessments: output.assessments,
        openQuestions: output.openQuestions,
        researchQuestions: founderQuestions(research.followUp),
        // The screening's own curated list (prompt v12); older output has none.
        nextSteps:
          output.nextSteps === undefined
            ? undefined
            : sanitizeNextSteps(
                output.nextSteps,
                {
                  gates: profile.gates.map((gate) => gate.key),
                  criteria: profile.criteria.map((criterion) => criterion.key),
                },
                MAX_SCREENING_NEXT_STEPS,
              ),
      },
    });
    return "completed";
  } catch (cause) {
    // A failure before the hand-off was read still books the paid research.
    const stored = researchChargeUsd === null ? await storedResearchCosts(service, runId) : null;
    await failScreeningRun(service, {
      runId,
      fundId,
      caseId,
      plan,
      activeStepKey: "fund_screening",
      cause,
      incurredUsd: researchCostUsd ?? stored?.actualUsd ?? null,
      incurredChargeUsd: researchChargeUsd ?? stored?.chargeUsd ?? null,
      callCostUsd: screeningCallCostUsd,
    });
    return "failed";
  } finally {
    // Brain: the research and the screening become case knowledge, also after a failure.
    await enqueueBrainCapture(fundId, caseId);
  }
}
