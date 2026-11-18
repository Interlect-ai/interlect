import { enqueueBrainCapture } from "@/lib/brain/queue.server";
import { gatewayErrorSummary } from "@/lib/ai/gateway-log";
import { createServerFn } from "@tanstack/react-start";
import { waitUntil } from "@vercel/functions";
import { z } from "zod";
import { requireSupabaseAuth } from "@/lib/supabase/auth-middleware";
import { getServiceClient } from "@/lib/supabase/admin.server";
import { requireFundCapability } from "@/lib/auth/access.server";
import { type ScreeningCaseInput } from "./prompt";
import {
  isCaseOwnEvidence,
  loadPromptEvidenceRows,
  SCREENING_EVIDENCE_MAX,
  selectPromptEvidence,
  toPromptEvidence,
} from "./evidence-selection";
import type { FundProfile } from "@/lib/funds/profiles";
import {
  extractGatewayCostUsd,
  refusedWithoutUsage,
  ResearchFailedError,
  sumCompleteCosts,
} from "./gateway-response";
import { AiDataPolicyError, aiGatewayOptions } from "../ai/gateway-options";
import { postChatCompletion } from "@/lib/ai/model-call";
import type { Redactor } from "@/lib/ai/redact";
import {
  recordCvrLookupStep,
  buildFundResearchBrief,
  collectPublicCompanyResearch,
  getResearchModuleOverrides,
  loadCaseIdentityHints,
  reloadCompanyIdentity,
  PUBLIC_RESEARCH_VERSION,
  SCREENING_PUBLIC_RESEARCH_MODEL,
} from "./public-research";
import {
  assertActualSpendWithinBudget,
  assertWithinBudget,
  budgetCharge,
  estimateRequestMaximumUsd,
  type PricedModel,
} from "./budgets";
import { planColumns } from "./model-tiers";
import { COMPANY_LABEL, SCREENING_SUMMARY, SYNTHESIS_NEXT_STEPS } from "./deep-text-rules";
import { MAX_SCREENING_NEXT_STEPS } from "@/lib/cases/tasks";
import { researchDeadlineAt } from "./research-followup";
import {
  EVIDENCE_SHEET_BUDGET_USD,
  EVIDENCE_SHEET_TIMEOUT_MS,
  evidenceBesideSheet,
} from "./evidence-sheet";
import { writeEvidenceSheet } from "./evidence-sheet.server";
import { loadRunPlan } from "./run-plan.server";
import { releaseAnalysisCredits, reserveAnalysisCredits } from "../ai/credits.server";
import { mapProfile, type ConfigData } from "./fund-profile";
import {
  average,
  buildOverallScoreRationale,
  validateConfiguredCoverage,
  validateEvidenceReferences,
} from "./screening-checks";
export {
  average,
  buildOverallScoreRationale,
  validateConfiguredCoverage,
  validateEvidenceReferences,
};
import {
  dispatchScreeningAnalysis,
  failScreeningRun,
  type ScreeningStepKey,
} from "./screening-analysis.server";
import { withFundLanguage } from "@/lib/i18n/language-scope.server";
import { requestLanguage, serverText } from "@/lib/i18n/server-text";
import { gatewayToken, missingGatewayToken } from "@/lib/ai/gateway-token";
import { STALE_SCREENING_MS } from "@/lib/cases/run-stall";
import { releaseStalledRun } from "./run-release.server";

const fundIdSchema = z.guid();
/** The model (light screening). Runs use the fund's tier model (RunPlan). */
export const SCREENING_MODEL = "openai/gpt-5.4-mini";
const PROMPT_VERSION = "interlect-screening-v13-short-texts";

// Moved to fund-profile.ts so scripts can load a fund profile; kept here for importers.
export { mapProfile, type ConfigData };

export const runInitialScreening = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ caseId: z.guid(), fundId: fundIdSchema }).parse(input))
  .handler(async ({ data, context }) => {
    // The research's follow-up rounds and the sheet must end inside this function.
    const functionStartedAt = Date.now();
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
    await requireFundCapability(context.supabase, context.userId, config.fund_id, "start_analysis");

    const { data: priorScreeningRuns, error: priorScreeningRunsError } = await context.supabase
      .from("analysis_runs")
      .select("id, status, created_at, started_at")
      .eq("fund_id", data.fundId)
      .eq("case_id", data.caseId)
      .eq("config_version_id", config.id)
      .eq("kind", "screening")
      .in("status", ["queued", "running", "awaiting_approval", "complete", "failed", "cancelled"])
      .order("created_at", { ascending: false });
    if (priorScreeningRunsError) {
      throw new Error(serverText("analysisServer.screening.earlierNotChecked"));
    }
    const blockingScreening = (priorScreeningRuns ?? []).find((candidate) =>
      ["queued", "running"].includes(candidate["status"] as string),
    );
    if (blockingScreening) {
      // En screening kører i to baggrundsfunktioner med hver sit loft på 300 s. Hænger
      // den stadig efter STALE_SCREENING_MS, blev den afbrudt uden at nå sin fejlhåndtering.
      const startedAt = Date.parse(
        (blockingScreening["started_at"] ?? blockingScreening["created_at"]) as string,
      );
      if (!(Date.now() - startedAt > STALE_SCREENING_MS)) {
        throw new Error("Denne case screenes allerede.");
      }
      // The released run keeps the price its steps reported (the research).
      await releaseStalledRun(getServiceClient(), {
        fundId: data.fundId,
        runId: blockingScreening["id"] as string,
        message: serverText("analysisServer.screening.released"),
        logTag: "screening",
      }).catch((cause: unknown) => {
        console.error(
          `[screening] stale run not released (run ${String(blockingScreening["id"])})`,
          cause instanceof Error ? cause.message : cause,
        );
        throw new Error("Denne case screenes allerede.");
      });
    }
    const retryGeneration = priorScreeningRuns?.[0]?.["id"] ?? "initial";

    const { data: caseRow, error: caseError } = await context.supabase
      .from("cases")
      .select(
        "id, fund_id, phase, primary_origin, companies(name, website, stage, sector, geography, description)",
      )
      .eq("id", data.caseId)
      .eq("fund_id", data.fundId)
      .single();
    if (caseError || !caseRow) throw new Error(serverText("analysisServer.common.caseNotFound"));
    // En besluttet case screenes ikke igen, før den er genåbnet (harden).
    if (caseRow["phase"] === "decided") {
      throw new Error(serverText("analysisServer.common.caseDecidedScreen"));
    }
    const { data: initialEvidenceRows, error: evidenceError } = await loadPromptEvidenceRows(
      context.supabase,
      data.fundId,
      data.caseId,
    );
    if (evidenceError) throw new Error(serverText("analysisServer.screening.evidenceNotFetched"));

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
    let evidenceRows = selectPromptEvidence(initialEvidenceRows ?? [], SCREENING_EVIDENCE_MAX);
    let inputEvidenceIds = evidenceRows.map((row) => row["id"] as string);
    let caseInput: ScreeningCaseInput = {
      caseId: data.caseId,
      companyName: company.name,
      website: company.website,
      stage: company.stage,
      intakeSources: [caseRow["primary_origin"] as ScreeningCaseInput["intakeSources"][number]],
      evidence: evidenceRows.map(toPromptEvidence),
      relatedPastCases: [],
    };
    const service = getServiceClient();
    // Tier, model and cap are resolved once here and kept on the run.
    const plan = await loadRunPlan(service, data.fundId, "screening");
    const identityHints = await loadCaseIdentityHints(service, data.fundId, data.caseId);
    caseInput = { ...caseInput, founders: identityHints.founders };
    const idempotencyKey = `screening:${data.caseId}:${config.id}:${PROMPT_VERSION}:${retryGeneration}`;
    // Loftet reserveres, før kørslen oprettes; ved tom saldo starter ingen screening.
    const reservedRunId = crypto.randomUUID();
    const creditLedgerId = await reserveAnalysisCredits(service, {
      fundId: config.fund_id,
      runId: reservedRunId,
      capUsd: plan.budget.usd,
      userId: context.userId,
      model: plan.model,
      kind: "screening",
    });
    const { data: run, error: runError } = await service
      .from("analysis_runs")
      .insert({
        id: reservedRunId,
        fund_id: config.fund_id,
        case_id: data.caseId,
        config_version_id: config.id,
        kind: "screening",
        status: "queued",
        workflow_version: "interlect-screening-workflow-v5",
        prompt_template_name: "initial-screening",
        prompt_template_version: PROMPT_VERSION,
        model_provider: "vercel-ai-gateway",
        model_name: plan.model,
        ...planColumns(plan),
        estimated_cost: plan.budget.usd,
        idempotency_key: idempotencyKey,
        input_evidence_ids: inputEvidenceIds,
        requested_by: context.userId,
      })
      .select("id")
      .single();
    if (runError || !run) {
      await releaseAnalysisCredits(service, creditLedgerId);
      throw new Error(serverText("analysisServer.screening.notStarted"));
    }
    const runId = run["id"] as string;
    const { error: jobError } = await service.from("analysis_jobs").insert({
      fund_id: config.fund_id,
      case_id: data.caseId,
      run_id: runId,
      kind: "screening",
      status: "queued",
      idempotency_key: idempotencyKey,
      attempt_count: 0,
    });
    const { error: stepError } = await service.from("analysis_run_steps").insert([
      {
        fund_id: config.fund_id,
        run_id: runId,
        step_key: "screening_research",
        step_order: 1,
        status: "queued",
        model_name: SCREENING_PUBLIC_RESEARCH_MODEL,
        prompt_version: PUBLIC_RESEARCH_VERSION,
        attempt_count: 0,
      },
      {
        fund_id: config.fund_id,
        run_id: runId,
        step_key: "fund_screening",
        step_order: 2,
        status: "queued",
        model_name: plan.model,
        prompt_version: PROMPT_VERSION,
        attempt_count: 0,
      },
    ]);
    if (jobError || stepError) {
      await service
        .from("analysis_runs")
        .update({
          status: "failed",
          error_message: serverText("analysisServer.common.jobNotRegistered"),
        })
        .eq("id", runId);
      throw new Error(serverText("analysisServer.common.jobNotRegisteredSafely"));
    }

    await service
      .from("cases")
      .update({ execution_status: "queued", updated_at: new Date().toISOString() })
      .eq("id", data.caseId)
      .eq("fund_id", data.fundId);

    /** The research phase; true when it handed the run to the analysis phase. */
    const executeScreening = async (): Promise<boolean> => {
      let incurredActualCostUsd: number | null = null;
      // The research's price, so a failure after the paid research still books it.
      let researchCostUsd: number | null = null;
      // What the research charged against the budget, booked when its price is unknown.
      let incurredChargeUsd: number | null = null;
      let activeStepKey: ScreeningStepKey = "screening_research";
      try {
        const startedAt = new Date().toISOString();
        // The analysis phase only runs a "running" run: a lost update must stop here.
        const [runStarted] = await Promise.all([
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
        if (runStarted.error) throw new Error(serverText("analysisServer.screening.notMarked"));
        await service
          .from("cases")
          .update({ execution_status: "collecting_evidence", updated_at: new Date().toISOString() })
          .eq("id", data.caseId)
          .eq("fund_id", data.fundId);

        await service
          .from("analysis_run_steps")
          .update({ status: "running", attempt_count: 1, started_at: new Date().toISOString() })
          .eq("run_id", runId)
          .eq("step_key", activeStepKey);
        const researchModuleOverrides = await getResearchModuleOverrides(service, config.id);
        const publicResearch = await collectPublicCompanyResearch({
          service,
          fundId: data.fundId,
          caseId: data.caseId,
          actorId: context.userId,
          companyName: company.name,
          website: company.website,
          stage: company.stage,
          mode: "screening",
          // The evidence sheet's share is set aside from the research budget and time.
          researchBudgetUsd: plan.budget.researchUsd - EVIDENCE_SHEET_BUDGET_USD.screening,
          researchModuleOverrides,
          fundResearchBrief: buildFundResearchBrief(profile),
          // Brief and plan first; a screening is a new run each time, so nothing to reuse.
          researchPlan: {
            tier: plan.tier,
            setup: { profile, screeningInstruction: profile.screeningInstruction },
          },
          researchDeadlineAt:
            researchDeadlineAt("screening", functionStartedAt) -
            EVIDENCE_SHEET_TIMEOUT_MS.screening,
          identityHints,
        });
        incurredActualCostUsd = publicResearch.actualCostUsd;
        incurredChargeUsd = publicResearch.budgetChargeUsd;
        const refreshedIdentity = await reloadCompanyIdentity(service, data.fundId, data.caseId);
        if (refreshedIdentity) {
          company.name = refreshedIdentity.name;
          company.stage = refreshedIdentity.stage;
        }
        await recordCvrLookupStep(service, {
          fundId: data.fundId,
          runId,
          outcome: publicResearch.cvrLookup,
        });
        const researchOutput = {
          ...publicResearch.packet,
          persistedSources: publicResearch.sourceCount,
          persistedEvidence: publicResearch.insertedEvidence,
          researchLog: publicResearch.researchLog ?? null,
          researchPlan: publicResearch.researchPlan ?? null,
          researchPlanStatus: publicResearch.researchPlanStatus ?? null,
          questionNeutralizer: publicResearch.questionNeutralizer ?? null,
          researchFollowUp: publicResearch.researchFollowUp ?? null,
          identityExtraction: publicResearch.identityExtraction ?? null,
          deckOcr: publicResearch.deckOcr ?? null,
          founderCheck: publicResearch.founderCheck ?? null,
        };
        const { error: researchSaveError } = await service
          .from("analysis_run_steps")
          .update({
            status: "complete",
            input_tokens: publicResearch.inputTokens,
            output_tokens: publicResearch.outputTokens,
            total_tokens: publicResearch.totalTokens,
            actual_cost: publicResearch.actualCostUsd,
            charged_cost: publicResearch.budgetChargeUsd,
            output_json: researchOutput,
            completed_at: new Date().toISOString(),
          })
          .eq("run_id", runId)
          .eq("step_key", activeStepKey);
        if (researchSaveError)
          throw new Error(serverText("analysisServer.common.screeningResearchNotSaved"));

        const { data: refreshedEvidence, error: refreshedEvidenceError } =
          await loadPromptEvidenceRows(service, data.fundId, data.caseId);
        if (refreshedEvidenceError || !refreshedEvidence?.length) {
          throw new Error(serverText("analysisServer.common.noBasis"));
        }
        evidenceRows = selectPromptEvidence(refreshedEvidence, SCREENING_EVIDENCE_MAX);
        // The research condensed to one sourced sheet per criterion and gate, which the
        // screening reads instead of the whole pile of public research. Never stops the run.
        const evidenceSheetOutcome = await writeEvidenceSheet({
          service,
          fundId: data.fundId,
          kind: "screening",
          tier: plan.tier,
          profile,
          plan: publicResearch.researchPlan ?? null,
          followUp: publicResearch.researchFollowUp ?? null,
          evidence: evidenceRows.map(toPromptEvidence),
          availableUsd: EVIDENCE_SHEET_BUDGET_USD.screening,
          timeLeftMs: researchDeadlineAt("screening", functionStartedAt) - Date.now(),
        });
        const evidenceSheet =
          evidenceSheetOutcome.status === "ok" ? evidenceSheetOutcome.sheet : null;
        if (evidenceSheet) {
          evidenceRows = evidenceBesideSheet(evidenceRows, evidenceSheet, isCaseOwnEvidence);
        }
        inputEvidenceIds = evidenceRows.map((row) => row["id"] as string);
        const researchActualCostUsd = sumCompleteCosts([
          publicResearch.actualCostUsd,
          evidenceSheetOutcome.actualCostUsd,
        ]);
        const researchChargeUsd = publicResearch.budgetChargeUsd + evidenceSheetOutcome.chargeUsd;
        incurredActualCostUsd = researchActualCostUsd;
        researchCostUsd = researchActualCostUsd;
        incurredChargeUsd = researchChargeUsd;
        // The sheet is part of the research step: its cost, its tokens and the sheet itself.
        const { error: sheetSaveError } = await service
          .from("analysis_run_steps")
          .update({
            // Again with the hand-off, so the analysis phase finds a complete step.
            status: "complete",
            completed_at: new Date().toISOString(),
            input_tokens: addTokens(
              publicResearch.inputTokens,
              evidenceSheetOutcome.usage.inputTokens,
            ),
            output_tokens: addTokens(
              publicResearch.outputTokens,
              evidenceSheetOutcome.usage.outputTokens,
            ),
            total_tokens: addTokens(
              publicResearch.totalTokens,
              evidenceSheetOutcome.usage.totalTokens,
            ),
            actual_cost: researchActualCostUsd,
            charged_cost: researchChargeUsd,
            output_json: {
              ...researchOutput,
              evidenceSheet,
              evidenceSheetStatus:
                evidenceSheetOutcome.status === "ok" ? "ok" : evidenceSheetOutcome.reason,
              // What the analysis phase reads back in its own function.
              researchChargeUsd,
              promptFounders: publicResearch.identityHints?.founders ?? caseInput.founders ?? [],
            },
          })
          .eq("run_id", runId)
          .eq("step_key", activeStepKey);
        if (sheetSaveError) {
          // The analysis phase reads the sheet and the evidence from here: without them it would
          // analyse a thinner basis without saying so.
          console.error(`[screening] research not saved (run ${runId})`, sheetSaveError.message);
          throw new Error(serverText("analysisServer.common.screeningResearchNotSaved"));
        }
        const [evidenceIdsSaved, caseMarked] = await Promise.all([
          service
            .from("analysis_runs")
            .update({ input_evidence_ids: inputEvidenceIds })
            .eq("id", runId),
          service
            .from("cases")
            .update({
              execution_status: "screening_in_progress",
              updated_at: new Date().toISOString(),
            })
            .eq("id", data.caseId)
            .eq("fund_id", data.fundId),
        ]);
        if (evidenceIdsSaved.error)
          throw new Error(serverText("analysisServer.screening.basisNotSaved"));
        if (caseMarked.error) {
          console.error(
            `[screening] case status not updated (run ${runId})`,
            caseMarked.error.message,
          );
        }
        // The analysis call runs in a function of its own (the hosted queue), so the
        // research, its follow-up rounds and the evidence sheet have this one to themselves.
        activeStepKey = "fund_screening";
        await dispatchScreeningAnalysis(runId);
        return true;
      } catch (cause) {
        await failScreeningRun(service, {
          runId,
          fundId: data.fundId,
          caseId: data.caseId,
          plan,
          activeStepKey,
          cause,
          // A call that answered but was cut off or went over budget is paid for.
          incurredUsd: activeStepKey === "fund_screening" ? researchCostUsd : incurredActualCostUsd,
          // A research that failed after paid calls carries what they charged.
          incurredChargeUsd:
            incurredChargeUsd ?? (cause instanceof ResearchFailedError ? cause.chargeUsd : null),
          callCostUsd: null,
        });
        return false;
      }
    };

    // Brain: research and screening results become case knowledge, also after a failure;
    // after the hand-off the analysis phase captures them when it ends.
    waitUntil(
      // The background work writes in the fund's language, after the request ends.
      withFundLanguage(getServiceClient(), data.fundId, executeScreening).then((handedOff) =>
        handedOff ? undefined : enqueueBrainCapture(data.fundId, data.caseId),
      ),
    );
    return { runId, status: "queued" as const };
  });

/**
 * A failure the provider may have charged for: it carries the known price, the estimate when the
 * price is unknown, or the maximum after a timeout, so the caller can book it.
 */
export class ScreeningGatewayError extends Error {
  constructor(
    message: string,
    readonly costUsd: number,
  ) {
    super(message);
    this.name = "ScreeningGatewayError";
  }
}

/** The screening's fund-fit call; the trial run makes the same call on a draft. */
/** The research's tokens plus the evidence sheet's (a sheet without a count adds nothing). */
function addTokens(research: number | null, sheet: number | null): number | null {
  return research == null ? null : research + (sheet ?? 0);
}

export async function callGateway(
  system: string,
  user: string,
  profile: FundProfile,
  availableUsd: number,
  allowedEvidenceIds: readonly string[],
  model: PricedModel,
  timeoutMs: number,
  /** Masks the call with the fund's dictionary. */
  redactor: Redactor,
  /** The product uses "low"; scripts/screening-variance.ts measures the other levels. */
  reasoningEffort: "low" | "medium" | "high" = "low",
) {
  const token = gatewayToken();
  if (!token)
    throw missingGatewayToken(
      "screening",
      serverText("analysisServer.screening.vercelGatewayMissing"),
    );
  const maxOutputTokens = 9_000;
  const requestBody = {
    model,
    stream: false,
    max_tokens: maxOutputTokens,
    reasoning: { effort: reasoningEffort },
    providerOptions: aiGatewayOptions({ model, data: "confidential" }),
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "pap_screening_v1",
        strict: true,
        schema: screeningJsonSchema(profile, allowedEvidenceIds),
      },
    },
  } as const;
  const estimate = estimateRequestMaximumUsd({
    model,
    requestBody,
    maxOutputTokens,
  });
  assertWithinBudget(estimate, availableUsd, "Screeningens fondsfit-analyse", requestLanguage());
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
    const timedOut = cause instanceof Error && ["TimeoutError", "AbortError"].includes(cause.name);
    console.error("[ai-gateway] screening", timedOut ? "timeout" : "fetch failed");
    // As the deep analysis: the provider may have charged for a call that timed out; the
    // usage is unknown, so the call costs its maximum.
    throw new ScreeningGatewayError(
      timedOut
        ? serverText("analysisServer.screening.timeout", { seconds: Math.round(timeoutMs / 1000) })
        : serverText("analysisServer.deep.gatewayUnreachable"),
      estimate.maxCostUsd,
    );
  }
  try {
    body = (await response.json()) as typeof body;
  } catch {
    // Not JSON: an error page from the gateway (a 502 or 429 without a body) was not billed; a
    // 200 that is not JSON was answered, so it costs the call's maximum.
    console.error("[ai-gateway] screening answer is not JSON", response.status);
    if (!response.ok) throw new Error(serverText("analysisServer.common.gatewayInvalid"));
    throw new ScreeningGatewayError(
      serverText("analysisServer.common.gatewayInvalid"),
      estimate.maxCostUsd,
    );
  }
  const actualCostUsd = extractGatewayCostUsd(body);
  // Before the empty check: a cut-off answer can be empty, and it was paid for.
  if (body.choices?.[0]?.finish_reason === "length") {
    throw new ScreeningGatewayError(
      serverText("analysisServer.screening.cutOff"),
      budgetCharge(actualCostUsd, estimate),
    );
  }
  if (!response.ok || !body.choices?.[0]?.message?.content) {
    console.error("[ai-gateway]", gatewayErrorSummary(body.error));
    // An error status without any usage was not billed; anything else was.
    if (refusedWithoutUsage({ ok: response.ok, actualCostUsd, usage: body.usage })) {
      throw new Error(serverText("analysisServer.common.gatewayInvalid"));
    }
    throw new ScreeningGatewayError(
      serverText("analysisServer.common.gatewayInvalid"),
      budgetCharge(actualCostUsd, estimate),
    );
  }
  try {
    assertActualSpendWithinBudget(
      budgetCharge(actualCostUsd, estimate),
      availableUsd,
      "Screeningens fondsfit-analyse",
      requestLanguage(),
    );
  } catch (cause) {
    throw new ScreeningGatewayError(
      cause instanceof Error ? cause.message : String(cause),
      budgetCharge(actualCostUsd, estimate),
    );
  }
  return {
    content: body.choices![0]!.message!.content!,
    inputTokens: body.usage?.prompt_tokens ?? null,
    outputTokens: body.usage?.completion_tokens ?? null,
    totalTokens: body.usage?.total_tokens ?? null,
    actualCostUsd,
    estimatedMaximumUsd: estimate,
  };
}

export function screeningJsonSchema(
  profile: FundProfile,
  allowedEvidenceIds: readonly string[] = [],
  /** The screening's presentation fields (company profile, key findings); not in the deep run. */
  caseProfile = true,
) {
  const evidenceId = allowedEvidenceIds.length
    ? { type: "string", enum: [...allowedEvidenceIds] }
    : { type: "string" };
  const stringArray = {
    type: "array",
    maxItems: 4,
    items: { type: "string", maxLength: 450 },
  };
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      schemaVersion: { type: "string", const: "interlect-screening-v1" },
      fundProfileId: { type: "string", const: profile.id },
      fundProfileVersion: { type: "string", const: profile.version },
      caseId: { type: "string" },
      assessments: {
        type: "array",
        minItems: profile.criteria.length,
        maxItems: profile.criteria.length,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            criterionKey: { type: "string", enum: profile.criteria.map((item) => item.key) },
            proposedScore: { type: ["number", "null"], minimum: 0, maximum: 100 },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            verdict: { type: "string", maxLength: 220 },
            rationale: { type: "string", maxLength: 1_800 },
            positiveDrivers: {
              type: "array",
              maxItems: 3,
              items: { type: "string", maxLength: 280 },
            },
            negativeDrivers: {
              type: "array",
              maxItems: 3,
              items: { type: "string", maxLength: 280 },
            },
            citations: {
              type: "array",
              maxItems: 5,
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
      gates: {
        type: "array",
        minItems: profile.gates.length,
        maxItems: profile.gates.length,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            gateKey: { type: "string", enum: profile.gates.map((item) => item.key) },
            passed: { type: ["boolean", "null"] },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            rationale: { type: "string", maxLength: 500 },
            evidenceIds: {
              type: "array",
              maxItems: 5,
              items: evidenceId,
            },
          },
          required: ["gateKey", "passed", "confidence", "rationale", "evidenceIds"],
        },
      },
      risks: {
        type: "array",
        maxItems: 5,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            riskKey: { type: "string", maxLength: 100 },
            label: { type: "string", maxLength: 120 },
            level: { type: "string", enum: ["low", "medium", "high", "critical"] },
            likelihood: { type: "integer", minimum: 1, maximum: 5 },
            impact: { type: "integer", minimum: 1, maximum: 5 },
            rationale: { type: "string", maxLength: 500 },
            evidenceIds: {
              type: "array",
              maxItems: 5,
              items: evidenceId,
            },
            mitigation: { type: ["string", "null"], maxLength: 400 },
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
      openQuestions: stringArray,
      overallAssessment: { type: "string", minLength: 1, maxLength: SCREENING_SUMMARY.max },
      contraryCase: { type: "string", maxLength: 650 },
      proposedRecommendation: {
        type: "string",
        enum: ["go_forward", "follow", "reject", "outside_thesis_interesting"],
      },
      nextSteps: nextStepsJsonSchema(MAX_SCREENING_NEXT_STEPS),
      ...(caseProfile ? caseProfileJsonProperties(profile) : {}),
    },
    required: [
      "schemaVersion",
      "fundProfileId",
      "fundProfileVersion",
      "caseId",
      "assessments",
      "gates",
      "risks",
      "strengths",
      "weaknesses",
      "openQuestions",
      "overallAssessment",
      "contraryCase",
      "proposedRecommendation",
      "nextSteps",
      ...(caseProfile ? ["companyProfile", "keyFindings", "companyLabel"] : []),
    ],
  };
}

/**
 * "Skal afklares" as a curated list (the synthesis's since v10c, the screening's): a
 * short title, the precise question or action, why, kind, link and priority. `sanitizeNextSteps`
 * checks everything again in code.
 */
export function nextStepsJsonSchema(maxItems: number) {
  return {
    type: "array",
    maxItems,
    items: {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string", maxLength: SYNTHESIS_NEXT_STEPS.titleMax },
        question: { type: "string", maxLength: SYNTHESIS_NEXT_STEPS.questionMax },
        why: { type: "string", maxLength: SYNTHESIS_NEXT_STEPS.whyMax },
        kind: {
          type: "string",
          enum: ["document", "verification", "research", "question", "meeting"],
        },
        linkedKind: { type: ["string", "null"], enum: ["criterion", "gate", null] },
        linkedKey: { type: ["string", "null"] },
        priority: { type: "integer", minimum: 1, maximum: 3 },
      },
      required: ["title", "question", "why", "kind", "linkedKind", "linkedKey", "priority"],
    },
  };
}

/** "Læs mere om virksomheden" and Nøglefund (prompt v8); see companyProfileSchema. */
function caseProfileJsonProperties(profile: FundProfile) {
  const section = { type: "string", maxLength: 700 };
  return {
    companyProfile: {
      type: "object",
      additionalProperties: false,
      properties: {
        business: section,
        productModel: section,
        market: section,
        team: section,
        economyCapital: section,
        status: section,
      },
      required: ["business", "productModel", "market", "team", "economyCapital", "status"],
    },
    companyLabel: {
      type: "object",
      additionalProperties: false,
      properties: {
        stage: { type: "string", maxLength: COMPANY_LABEL.stageMax },
        sector: { type: "string", maxLength: COMPANY_LABEL.sectorMax },
        country: { type: "string", maxLength: COMPANY_LABEL.countryMax },
      },
      required: ["stage", "sector", "country"],
    },
    keyFindings: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          statement: { type: "string", maxLength: 200 },
          direction: { type: "string", enum: ["up", "down"] },
          criterionKey: { type: "string", enum: profile.criteria.map((item) => item.key) },
          importance: { type: "integer", minimum: 1, maximum: 3 },
        },
        required: ["statement", "direction", "criterionKey", "importance"],
      },
    },
  };
}
