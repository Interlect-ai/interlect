import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/lib/supabase/auth-middleware";
import { requireFundCapability } from "@/lib/auth/access.server";
import { getServiceClient } from "@/lib/supabase/admin.server";
import { AiDataPolicyError } from "@/lib/ai/gateway-options";
import { redactorForFund } from "@/lib/ai/redact-dictionary.server";
import { BudgetExceededError, budgetCharge } from "@/lib/analysis/budgets";
import { parseScreeningOutput } from "@/lib/analysis/contracts";
import {
  loadEvidenceRowsByIds,
  loadPromptEvidenceRows,
  SCREENING_EVIDENCE_MAX,
  selectPromptEvidence,
  toPromptEvidence,
} from "@/lib/analysis/evidence-selection";
import { applyGateAnswers, teamAnswersForNewRun } from "@/lib/analysis/gate-answers";
import { loadTeamGateAnswers } from "@/lib/analysis/rescore.server";
import { isCodeAnchored } from "@/lib/analysis/code-anchor";
import { evaluateFinanceGate, isFinanceGate } from "@/lib/analysis/financial-gates";
import {
  loadFinanceCodeScore,
  loadFinanceGateContext,
  withFinanceGates,
} from "@/lib/analysis/financial-statements";
import { SCREENING_CALL_TIMEOUT_MS, type AiTier } from "@/lib/analysis/model-tiers";
import { buildScreeningPrompt, type ScreeningCaseInput } from "@/lib/analysis/prompt";
import { loadCaseIdentityHints } from "@/lib/analysis/public-research";
import { loadRunPlan } from "@/lib/analysis/run-plan.server";
import {
  callGateway,
  mapProfile,
  ScreeningGatewayError,
  validateConfiguredCoverage,
  validateEvidenceReferences,
  type ConfigData,
} from "@/lib/analysis/screening.functions";
import { scoreScreening } from "@/lib/analysis/scoring";
import { CONFIG_SELECT } from "@/lib/analysis/fund-profile";
import { recordAttempt, reserveAssistCredits, settleAssistCredits } from "./assist-calls.server";
import { serverText } from "@/lib/i18n/server-text";

/**
 * The trial run of the fund's screening: the draft's whole screening (criteria and
 * weights, gates, risk posture and the "sådan screener vi" instruction) on a case the fund has
 * already screened, next to that case's latest real screening. It makes the same fund-fit call
 * as a screening, at the fund's level, on the evidence the latest screening read (no new
 * research, no similar cases from memory) and with the team's gate answers as a real screening
 * under the draft would apply them, so the difference comes from the setup.
 * Nothing on the case changes and nothing is stored but the audit row and the credits (paid like
 * an analysis, at most 10 per fund per hour). The customer sees no prices (P13). The page is.
 */

const TRIAL_AUDIT_ACTION = "fund_screening_trial_run";
const TRIAL_RUNS_PER_HOUR = 10;

/** The columns mapProfile needs (with the stage per row and the setup) and the status. */
const TRIAL_CONFIG_SELECT = `${CONFIG_SELECT}, status`;

export interface ScreeningTrialView {
  caseId: string;
  companyName: string;
  tier: AiTier;
  /** The version tried (the draft) and the one behind the case's latest screening. */
  draftVersion: number;
  trial: {
    overallScore: number | null;
    recommendation: string;
    outcome: string;
    overallAssessment: string;
    criteria: Array<{ key: string; label: string; weight: number; score: number | null }>;
    gates: Array<{
      key: string;
      label: string;
      treatment: "hard" | "review";
      passed: boolean | null;
      rationale: string;
    }>;
    strengths: string[];
    weaknesses: string[];
  };
  current: {
    runId: string;
    configVersion: number | null;
    /** The level and model the latest screening ran with (the trial uses the fund's current). */
    tier: string | null;
    model: string | null;
    /** As the case page shows it: a recalculation (a task answer) replaces the run's score. */
    overallScore: number | null;
    recommendation: string | null;
    criteria: Array<{ key: string; score: number | null; weight: number }>;
  };
}

function one<T>(value: unknown): T | null {
  return (Array.isArray(value) ? value[0] : value) as T | null;
}

export const trialRunScreening = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ fundId: z.guid(), configId: z.guid(), caseId: z.guid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<ScreeningTrialView> => {
    const { fundId, caseId } = data;
    await requireFundCapability(context.supabase, context.userId, fundId, "configure_fund");
    const { data: configRow, error: configError } = await context.supabase
      .from("fund_config_versions")
      .select(TRIAL_CONFIG_SELECT)
      .eq("id", data.configId)
      .eq("fund_id", fundId)
      .maybeSingle();
    if (configError) throw new Error(serverText("fundServer.common.setupNotLoaded"));
    if (!configRow) throw new Error(serverText("fundServer.common.versionNotFound"));
    if ((configRow as { status?: string }).status !== "draft") {
      throw new Error(serverText("fundServer.trial.draftOnly"));
    }
    const config = configRow as unknown as ConfigData;
    const service = getServiceClient();

    const { data: caseRow, error: caseError } = await service
      .from("cases")
      .select("id, primary_origin, companies(name, website, stage)")
      .eq("id", caseId)
      .eq("fund_id", fundId)
      .maybeSingle();
    if (caseError) throw new Error(serverText("fundServer.common.caseNotLoaded"));
    if (!caseRow) throw new Error(serverText("fundServer.common.caseNotFound"));
    const company = one<{ name: string; website: string | null; stage: string }>(
      caseRow["companies"],
    );
    if (!company) throw new Error(serverText("fundServer.common.caseCompanyNotFound"));
    // The draft's setup for the case's stage, as a real screening would use it.
    const mapped = mapProfile(config, { caseStage: company.stage });
    // The trial compares scores; the economy points change no score and are not shown
    // here, so they are not asked (and not paid for).
    const profile = mapped.teamSetup
      ? { ...mapped, teamSetup: { ...mapped.teamSetup, economy: null } }
      : mapped;
    if (!profile.criteria.length) throw new Error(serverText("fundServer.trial.noCriteria"));

    const { data: currentRun, error: currentError } = await service
      .from("analysis_runs")
      .select(
        "id, input_evidence_ids, ai_tier, model_name, fund_config_versions(version), recommendations(overall_score, recommendation), category_scores(category, validated_score, weight)",
      )
      .eq("fund_id", fundId)
      .eq("case_id", caseId)
      .eq("kind", "screening")
      .in("status", ["complete", "awaiting_approval"])
      .not("completed_at", "is", null)
      .order("completed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (currentError) throw new Error(serverText("fundServer.common.caseScreeningNotLoaded"));
    if (!currentRun) throw new Error(serverText("fundServer.trial.notScreened"));

    // The evidence the latest screening read, so both sides judge the same material; a later
    // deep analysis or new documents would otherwise push some of it out.
    const screenedIds = ((currentRun["input_evidence_ids"] ?? []) as string[]).filter(Boolean);
    const { data: evidence, error: evidenceError } = screenedIds.length
      ? await loadEvidenceRowsByIds(service, fundId, caseId, screenedIds)
      : await loadPromptEvidenceRows(service, fundId, caseId);
    if (evidenceError) throw new Error(serverText("fundServer.common.caseBasisNotLoaded"));
    if (!evidence?.length) throw new Error(serverText("fundServer.common.caseNoBasis"));
    const evidenceRows = selectPromptEvidence(evidence, SCREENING_EVIDENCE_MAX);
    const evidenceIds = evidenceRows.map((row) => row["id"] as string);

    // C7 and C8 as in a screening: finance gates and the finance score are computed in code.
    const financeGateKeys = profile.gates.map((gate) => gate.key).filter(isFinanceGate);
    const hasFinanceCriterion = profile.criteria.some(isCodeAnchored);
    const financeContext =
      financeGateKeys.length || hasFinanceCriterion
        ? await loadFinanceGateContext(service, fundId, caseId, company.stage)
        : null;
    const [identityHints, financeScore, storedTeamAnswers, recalculation] = await Promise.all([
      loadCaseIdentityHints(service, fundId, caseId),
      loadFinanceCodeScore(
        service,
        { fundId, caseId, stage: company.stage, hasFinanceCriterion },
        financeContext,
      ),
      // Read only: the team's answers count in a screening under any version (harden F2).
      loadTeamGateAnswers(service, { fundId, caseId }),
      service
        .from("case_score_recalculations")
        .select("overall_score, recommendation:result->>recommendation")
        .eq("fund_id", fundId)
        .eq("case_id", caseId)
        .eq("run_id", currentRun["id"] as string)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    if (recalculation.error) {
      console.error("[screening-trial] recalculation", recalculation.error.message);
    }
    const caseInput: ScreeningCaseInput = {
      caseId,
      companyName: company.name,
      website: company.website,
      stage: company.stage,
      intakeSources: [caseRow["primary_origin"] as ScreeningCaseInput["intakeSources"][number]],
      founders: identityHints.founders,
      evidence: evidenceRows.map(toPromptEvidence),
      relatedPastCases: [],
      ...(financeContext && financeGateKeys.length
        ? {
            codeEvaluatedGates: financeGateKeys.map((gateKey) => {
              const result = evaluateFinanceGate(gateKey, financeContext);
              return { gateKey, passed: result.passed, rationale: result.rationale };
            }),
          }
        : {}),
      ...(financeScore?.score != null ? { financeCodeScore: financeScore.score } : {}),
    };

    // The fund-fit share of a screening at the fund's level (the research is not run here).
    const plan = await loadRunPlan(service, fundId, "screening");
    const capUsd = plan.budget.analysisUsd;
    await recordAttempt(service, {
      fundId,
      userId: context.userId,
      action: TRIAL_AUDIT_ACTION,
      entity: "cases",
      entityId: caseId,
      payload: { configId: data.configId, tier: plan.tier, model: plan.model },
      perHour: TRIAL_RUNS_PER_HOUR,
      refusal: serverText("fundServer.trial.rateLimited", { count: TRIAL_RUNS_PER_HOUR }),
    });
    const ledgerId = await reserveAssistCredits(service, {
      fundId,
      userId: context.userId,
      capUsd,
      model: plan.model,
    });

    let completion: Awaited<ReturnType<typeof callGateway>> | null = null;
    let scored: {
      output: ReturnType<typeof applyGateAnswers>;
      result: ReturnType<typeof scoreScreening>;
    };
    try {
      const prompt = buildScreeningPrompt(profile, caseInput);
      completion = await callGateway(
        prompt.system,
        prompt.user,
        profile,
        capUsd,
        evidenceIds,
        plan.model,
        SCREENING_CALL_TIMEOUT_MS[plan.tier],
        await redactorForFund(fundId, "screening", service),
      );
      const output = await withFinanceGates(
        service,
        { fundId, caseId, stage: company.stage, gateKeys: profile.gates.map((gate) => gate.key) },
        parseScreeningOutput(JSON.parse(completion.content)),
        financeContext,
      );
      if (output.caseId !== caseId) throw new Error(serverText("fundServer.trial.otherCase"));
      validateConfiguredCoverage(output, profile);
      validateEvidenceReferences(output, new Set(evidenceIds));
      // As a real screening under the draft would: the team's answers lie over the AI's verdicts.
      const teamAnswers = teamAnswersForNewRun(storedTeamAnswers, {
        configVersionId: data.configId,
        verdicts: new Map(output.gates.map((gate) => [gate.gateKey, gate.passed])),
      });
      const answered = applyGateAnswers(output, teamAnswers);
      scored = {
        output: answered,
        result: scoreScreening(profile, answered, company.stage, financeScore),
      };
    } catch (cause) {
      // Whatever the provider is known to have charged is booked; the estimate when unknown.
      const charged =
        cause instanceof ScreeningGatewayError
          ? cause.costUsd
          : completion
            ? budgetCharge(completion.actualCostUsd, completion.estimatedMaximumUsd)
            : null;
      await settleAssistCredits(service, ledgerId, {
        fundId,
        succeeded: false,
        costUsd: charged,
        capUsd,
        model: plan.model,
      });
      if (cause instanceof AiDataPolicyError) throw cause;
      console.error("[screening-trial]", cause instanceof Error ? cause.message : cause);
      // The budget message names dollars; the customer sees no prices (P13).
      if (cause instanceof BudgetExceededError) {
        throw new Error(serverText("fundServer.trial.tooLarge"));
      }
      throw new Error(serverText("fundServer.common.trialFailed"));
    }
    await settleAssistCredits(service, ledgerId, {
      fundId,
      succeeded: true,
      costUsd: completion.actualCostUsd,
      capUsd,
      model: plan.model,
      inputTokens: completion.inputTokens,
      outputTokens: completion.outputTokens,
    });

    const { output, result } = scored;
    const gateByKey = new Map(output.gates.map((gate) => [gate.gateKey, gate]));
    const scores = (currentRun["category_scores"] ?? []) as Array<{
      category: string;
      validated_score: number | null;
      weight: number;
    }>;
    const runRecommendation = one<{
      overall_score: number | null;
      recommendation: string | null;
    }>(currentRun["recommendations"]);
    const recalculated = recalculation.error ? null : recalculation.data;
    const currentScore = recalculated
      ? recalculated.overall_score
      : runRecommendation?.overall_score;
    return {
      caseId,
      companyName: company.name,
      tier: plan.tier,
      draftVersion: Number(config.version),
      trial: {
        overallScore: result.overallScore,
        recommendation: result.recommendation,
        outcome: result.outcome,
        overallAssessment: output.overallAssessment,
        criteria: result.criteria.map((criterion) => ({
          key: criterion.criterionKey,
          label: criterion.label,
          weight: criterion.weight,
          score: criterion.score,
        })),
        gates: profile.gates.map((gate) => ({
          key: gate.key,
          label: gate.label,
          treatment: gate.treatment,
          passed: gateByKey.get(gate.key)?.passed ?? null,
          rationale: gateByKey.get(gate.key)?.rationale ?? "",
        })),
        strengths: output.strengths,
        weaknesses: output.weaknesses,
      },
      current: {
        runId: currentRun["id"] as string,
        configVersion:
          one<{ version: number }>(currentRun["fund_config_versions"])?.version ?? null,
        tier: (currentRun["ai_tier"] as string | null) ?? null,
        model: (currentRun["model_name"] as string | null) ?? null,
        overallScore: currentScore == null ? null : Number(currentScore),
        recommendation:
          (recalculated?.recommendation as string | null | undefined) ??
          runRecommendation?.recommendation ??
          null,
        criteria: scores.map((row) => ({
          key: row.category,
          score: row.validated_score == null ? null : Number(row.validated_score),
          weight: Number(row.weight),
        })),
      },
    };
  });
