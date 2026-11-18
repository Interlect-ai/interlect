import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/lib/supabase/auth-middleware";
import { requireFundCapability } from "@/lib/auth/access.server";
import { getServiceClient } from "@/lib/supabase/admin.server";
import { AiDataPolicyError } from "@/lib/ai/gateway-options";
import { redactorForFund } from "@/lib/ai/redact-dictionary.server";
import type { ScoreCategory } from "@/lib/domain/types";
import { BudgetExceededError } from "@/lib/analysis/budgets";
import { outputTokenCap } from "@/lib/analysis/deep-limits";
import {
  buildDeepCaseInput,
  callDeepGateway,
  DeepGatewayError,
  specialistJsonSchema,
  validateSpecialistPacket,
  type DeepGatewayCompletion,
} from "@/lib/analysis/deep.functions";
import { specialistPromptInput } from "@/lib/analysis/deep-worker.server";
import {
  DEEP_EVIDENCE_MAX,
  loadPromptEvidenceRows,
  selectPromptEvidence,
} from "@/lib/analysis/evidence-selection";
import { isCodeAnchored } from "@/lib/analysis/code-anchor";
import {
  loadCompactFinancialMetrics,
  loadFinanceCodeScore,
} from "@/lib/analysis/financial-statements";
import { withCategoryFallbacks } from "@/lib/analysis/finding-categories";
import { DEEP_CALL_TIMEOUT_MS, type AiTier } from "@/lib/analysis/model-tiers";
import { loadCaseIdentityHints } from "@/lib/analysis/public-research";
import { CONFIG_SELECT } from "@/lib/analysis/rescore.server";
import { loadRunPlan } from "@/lib/analysis/run-plan.server";
import { mapProfile, type ConfigData } from "@/lib/analysis/screening.functions";
import { buildSpecialistPrompt } from "@/lib/analysis/specialist-prompts";
import { CUSTOM_SPECIALIST_KEY, resolveSpecialistSet } from "@/lib/analysis/specialist-set";
import { loadSpecialistSet } from "@/lib/analysis/specialist-set.server";
import { specialistOutputSchema, type SpecialistOutput } from "@/lib/analysis/specialist.contracts";
import type { ScreeningCaseInput } from "@/lib/analysis/prompt";
import {
  paidHelperCall,
  recordAttempt,
  reserveAssistCredits,
  settleAssistCredits,
} from "./assist-calls.server";
import {
  buildCheckPrompt,
  buildDraftPrompt,
  CHECK_JSON_SCHEMA,
  codeIssues,
  customSpecialistSchema,
  DRAFT_JSON_SCHEMA,
  fixedAreaOwners,
  mergeIssues,
  parseAiCheck,
  parseDraft,
  resolveWithCandidate,
  type AssistFundContext,
  type CustomSpecialistInput,
  type SpecialistIssue,
} from "./specialist-assist";
import { requestLanguage, serverText } from "@/lib/i18n/server-text";

/**
 * The AI help for the fund's own specialists: "Beskriv eksperten, I
 * mangler" → a draft from a strong model → a quality check that points out vague and overlapping
 * points → the user corrects → a trial run on an existing case → activate (`saveCustomSpecialist`
 * in specialists.functions.ts, then the draft is published as always). Nothing here saves the
 * specialist or changes a case: the draft and the check land in the editor, and the trial run's
 * result is only shown. The customer sees no prices (P13). Every call is paid from the credits
 * like an analysis (reserved before, settled with the real price), recorded in the audit log and
 * limited per fund per hour. The page is.
 */

const DRAFT_BUDGET_USD = 0.2;
const CHECK_BUDGET_USD = 0.12;
/** Trial runs per fund per hour: each is one paid specialist call (about 1.5 kr at Middel). */
const TRIAL_RUNS_PER_HOUR = 10;
const TRIAL_AUDIT_ACTION = "fund_specialist_trial_run";
const THESIS_MAX_CHARS = 3_000;

const fundIdSchema = z.guid();
const configIdSchema = z.guid();
const keySchema = z.string().regex(CUSTOM_SPECIALIST_KEY);

/** The draft version with its profile and specialists; only for those who may configure it. */
async function loadAssistContext(
  supabase: SupabaseClient,
  userId: string,
  fundId: string,
  configId: string,
) {
  await requireFundCapability(supabase, userId, fundId, "configure_fund");
  const { data, error } = await supabase
    .from("fund_config_versions")
    .select(`${CONFIG_SELECT}, status`)
    .eq("id", configId)
    .eq("fund_id", fundId)
    .maybeSingle();
  if (error) throw new Error(serverText("fundServer.common.setupNotLoaded"));
  if (!data) throw new Error(serverText("fundServer.common.versionNotFound"));
  if ((data as { status?: string }).status !== "draft") {
    throw new Error(serverText("fundServer.common.draftOnlyEdit"));
  }
  const profile = mapProfile(data as unknown as ConfigData);
  const { rows, overrides } = await loadSpecialistSet(supabase, configId);
  const fund: AssistFundContext = {
    thesis: profile.thesis.slice(0, THESIS_MAX_CHARS),
    stages: profile.stages,
    sectors: profile.sectors,
    geographies: profile.geographies,
    riskPosture: profile.riskPosture,
    criteria: profile.criteria.map((criterion) => ({
      label: criterion.label,
      category: criterion.category,
    })),
  };
  return { profile, rows, overrides, fund };
}

/**
 * A draft of the fund's own specialist from the user's description, or a revision of one
 * (`current`). Never saved here: the draft lands in the editor.
 */
export const draftCustomSpecialist = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        fundId: fundIdSchema,
        configId: configIdSchema,
        /** The saved specialist being revised, so it is not compared with itself. */
        key: keySchema.optional(),
        description: z.string().trim().min(10).max(2000),
        current: customSpecialistSchema.optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<CustomSpecialistInput> => {
    const assist = await loadAssistContext(
      context.supabase,
      context.userId,
      data.fundId,
      data.configId,
    );
    // The draft's active set without the specialist being revised.
    const set = resolveSpecialistSet(
      assist.rows.filter((row) => row.specialist_key !== data.key),
      assist.overrides,
    );
    const prompt = buildDraftPrompt({
      description: data.description,
      current: data.current ?? null,
      fund: assist.fund,
      set,
      excludeId: data.key ?? null,
      owners: fixedAreaOwners(assist.rows, data.key ?? null),
    });
    const content = await paidHelperCall(
      { fundId: data.fundId, userId: context.userId, configId: data.configId, step: "draft" },
      {
        system: prompt.system,
        user: prompt.user,
        schema: { name: "interlect_fund_specialist_draft_v1", schema: DRAFT_JSON_SCHEMA },
        maxOutputTokens: 5_000,
        budgetUsd: DRAFT_BUDGET_USD,
        // i18n-keep: the call's name in logs and the AI log, not shown to the person.
        label: "Udkast til egen specialist",
        timeoutMs: 120_000,
      },
    );
    try {
      return parseDraft(content);
    } catch (cause) {
      console.error("[specialist-assist] draft", cause instanceof Error ? cause.message : cause);
      throw new Error(serverText("fundServer.specialists.draftUnusable"));
    }
  });

export interface SpecialistCheckView {
  issues: SpecialistIssue[];
  /** No point worth fixing and the model's verdict is "ready". */
  ready: boolean;
  /** The score areas the specialist will assess in a run with this draft. */
  assessedAreas: ScoreCategory[];
  /** False when the model's check failed and only code's checks are shown. */
  aiChecked: boolean;
}

/**
 * The quality check before the trial run: code's checks (duplicates, vague points, overlap with
 * the draft's other active specialists, which areas it really assesses) and the model's (vague,
 * overlapping or untestable points, with a better wording where it helps).
 */
export const checkCustomSpecialist = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        fundId: fundIdSchema,
        configId: configIdSchema,
        key: keySchema.optional(),
        specialist: customSpecialistSchema,
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<SpecialistCheckView> => {
    const assist = await loadAssistContext(
      context.supabase,
      context.userId,
      data.fundId,
      data.configId,
    );
    const { set, candidate } = resolveWithCandidate(
      assist.rows,
      assist.overrides,
      data.key,
      data.specialist,
      requestLanguage(),
    );
    const code = codeIssues(data.specialist, set, candidate, requestLanguage());
    const prompt = buildCheckPrompt({
      specialist: data.specialist,
      fund: assist.fund,
      set,
      excludeId: candidate.id,
      owners: fixedAreaOwners(assist.rows, data.key ?? null),
    });
    const content = await paidHelperCall(
      { fundId: data.fundId, userId: context.userId, configId: data.configId, step: "check" },
      {
        system: prompt.system,
        user: prompt.user,
        schema: { name: "interlect_fund_specialist_check_v1", schema: CHECK_JSON_SCHEMA },
        maxOutputTokens: 3_000,
        budgetUsd: CHECK_BUDGET_USD,
        // i18n-keep: the call's name in logs and the AI log, not shown to the person.
        label: "Kvalitetstjek af egen specialist",
        timeoutMs: 90_000,
      },
    );
    // An answer that is not a check leaves code's checks to show.
    const ai = parseAiCheck(content);
    if (!ai) console.error("[specialist-assist] check: the answer was not a check");
    const issues = mergeIssues(data.specialist, code, ai);
    return {
      issues,
      ready: ai?.verdict === "ready" && !issues.some((issue) => issue.severity === "fix"),
      assessedAreas: [...candidate.categories],
      aiChecked: ai !== null,
    };
  });

export interface SpecialistTrialCase {
  caseId: string;
  companyName: string;
  stage: string | null;
  screenedAt: string;
}

/** Cases a trial run can use: those with a finished screening, newest first. */
export const listSpecialistTrialCases = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ fundId: fundIdSchema }).parse(input))
  .handler(async ({ data, context }): Promise<SpecialistTrialCase[]> => {
    await requireFundCapability(context.supabase, context.userId, data.fundId, "configure_fund");
    const { data: runs, error } = await context.supabase
      .from("analysis_runs")
      .select("case_id, completed_at, cases(companies(name, stage))")
      .eq("fund_id", data.fundId)
      .eq("kind", "screening")
      .in("status", ["complete", "awaiting_approval"])
      .not("completed_at", "is", null)
      .order("completed_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(serverText("fundServer.specialists.casesNotLoaded"));
    const seen = new Set<string>();
    const cases: SpecialistTrialCase[] = [];
    for (const run of runs ?? []) {
      const caseId = run["case_id"] as string;
      if (seen.has(caseId)) continue;
      seen.add(caseId);
      const rawCase = run["cases"] as unknown;
      const caseRow = (Array.isArray(rawCase) ? rawCase[0] : rawCase) as {
        companies: unknown;
      } | null;
      const rawCompany = caseRow?.companies;
      const company = (Array.isArray(rawCompany) ? rawCompany[0] : rawCompany) as {
        name?: string;
        stage?: string | null;
      } | null;
      if (!company?.name) continue;
      cases.push({
        caseId,
        companyName: company.name,
        stage: company.stage ?? null,
        screenedAt: run["completed_at"] as string,
      });
      if (cases.length >= 20) break;
    }
    return cases;
  });

export interface SpecialistTrialView {
  caseId: string;
  companyName: string;
  specialist: { title: string; categories: ScoreCategory[] };
  /** The fund's level for deep analyses, which the trial ran at (no price, P13). */
  tier: AiTier;
  result: SpecialistOutput;
  criteria: Array<{ key: string; label: string }>;
  /** The evidence the result cites, so the page can show the sources. */
  evidence: Array<{ id: string; claim: string; source: string | null; url: string | null }>;
}

/**
 * Runs the specialist once on an existing case, as the deep analysis would with this draft (the
 * same prompt, model, level, cap per specialist, evidence selection and answer checks; the score
 * areas it would get, as if it were active), and returns the result without saving it: the case,
 * its runs and its tasks are not touched. The specialist sees the case's material as it stands: a
 * real run first collects new public research, and it also gets similar earlier cases from the
 * fund's memory; the trial has neither.
 */
export const trialRunCustomSpecialist = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        fundId: fundIdSchema,
        configId: configIdSchema,
        caseId: z.guid(),
        key: keySchema.optional(),
        specialist: customSpecialistSchema,
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<SpecialistTrialView> => {
    const { fundId, caseId } = data;
    const assist = await loadAssistContext(context.supabase, context.userId, fundId, data.configId);
    const { set, candidate } = resolveWithCandidate(
      assist.rows,
      assist.overrides,
      data.key,
      data.specialist,
      requestLanguage(),
    );
    const { profile } = assist;
    const service = getServiceClient();

    const { data: caseRow, error: caseError } = await service
      .from("cases")
      .select("id, primary_origin, companies(name, website, stage)")
      .eq("id", caseId)
      .eq("fund_id", fundId)
      .maybeSingle();
    if (caseError) throw new Error(serverText("fundServer.common.caseNotLoaded"));
    if (!caseRow) throw new Error(serverText("fundServer.common.caseNotFound"));
    const rawCompany = caseRow["companies"] as unknown;
    const company = (Array.isArray(rawCompany) ? rawCompany[0] : rawCompany) as {
      name: string;
      website: string | null;
      stage: string;
    } | null;
    if (!company) throw new Error(serverText("fundServer.common.caseCompanyNotFound"));

    const { data: screeningRun, error: screeningError } = await service
      .from("analysis_runs")
      .select(
        "id, raw_response, input_evidence_ids, recommendations(overall_score, recommendation, rationale)",
      )
      .eq("fund_id", fundId)
      .eq("case_id", caseId)
      .eq("kind", "screening")
      .in("status", ["complete", "awaiting_approval"])
      .not("completed_at", "is", null)
      .order("completed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (screeningError) throw new Error(serverText("fundServer.common.caseScreeningNotLoaded"));
    if (!screeningRun) {
      throw new Error(serverText("fundServer.specialists.notScreened"));
    }

    const { data: evidence, error: evidenceError } = await loadPromptEvidenceRows(
      service,
      fundId,
      caseId,
    );
    if (evidenceError) throw new Error(serverText("fundServer.common.caseBasisNotLoaded"));
    if (!evidence?.length) throw new Error(serverText("fundServer.common.caseNoBasis"));
    const evidenceRows = selectPromptEvidence(
      evidence as Array<Record<string, unknown>>,
      DEEP_EVIDENCE_MAX,
    );
    const evidenceIds = evidenceRows.map((row) => row["id"] as string);

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
    const baseCaseInput = buildDeepCaseInput(
      caseId,
      company,
      caseRow["primary_origin"] as ScreeningCaseInput["intakeSources"][number],
      evidenceRows,
      [],
      identityHints.founders,
    );
    const promptInput = specialistPromptInput(
      screeningRun as Record<string, unknown>,
      financeScore?.score != null
        ? { ...baseCaseInput, financeCodeScore: financeScore.score }
        : baseCaseInput,
      computedFinancials,
    );

    // The same model and the same share of the specialist budget as one call in a run.
    const plan = await loadRunPlan(service, fundId, "deep", set.length);
    const capUsd = plan.budget.specialistsUsd / set.length;
    await recordAttempt(service, {
      fundId,
      userId: context.userId,
      action: TRIAL_AUDIT_ACTION,
      entity: "cases",
      entityId: caseId,
      payload: {
        configId: data.configId,
        specialistKey: data.key ?? null,
        specialistName: candidate.title,
        categories: candidate.categories,
        tier: plan.tier,
        model: plan.model,
      },
      perHour: TRIAL_RUNS_PER_HOUR,
      refusal: serverText("fundServer.specialists.rateLimited", { count: TRIAL_RUNS_PER_HOUR }),
    });
    const ledgerId = await reserveAssistCredits(service, {
      fundId,
      userId: context.userId,
      capUsd,
      model: plan.model,
    });
    const settle = (succeeded: boolean, completion: DeepGatewayCompletion | null) =>
      settleAssistCredits(service, ledgerId, {
        fundId,
        succeeded,
        costUsd: completion?.actualCostUsd ?? null,
        capUsd,
        model: plan.model,
        inputTokens: completion?.inputTokens ?? null,
        outputTokens: completion?.outputTokens ?? null,
      });

    let completion: DeepGatewayCompletion;
    try {
      const prompt = buildSpecialistPrompt(profile, promptInput, candidate);
      completion = await callDeepGateway(
        prompt.system,
        prompt.user,
        "pap_specialist_trial",
        specialistJsonSchema(profile, candidate, evidenceIds),
        outputTokenCap("specialist", plan.tier, plan.model),
        capUsd,
        DEEP_CALL_TIMEOUT_MS[plan.tier].specialist,
        "low",
        plan.model,
        await redactorForFund(fundId, "specialist_trial", service),
      );
    } catch (cause) {
      await settle(false, cause instanceof DeepGatewayError ? cause.completion : null);
      if (cause instanceof AiDataPolicyError) throw cause;
      console.error("[specialist-trial] call", cause instanceof Error ? cause.message : cause);
      // The budget message names dollars; the customer sees no prices (P13).
      if (cause instanceof BudgetExceededError) {
        throw new Error(serverText("fundServer.specialists.tooLarge"));
      }
      const cutOff =
        cause instanceof DeepGatewayError &&
        ["length", "timeout"].includes(cause.diagnostics?.finishReason ?? "");
      throw new Error(
        cutOff
          ? serverText("fundServer.specialists.unfinished")
          : serverText("fundServer.common.trialFailed"),
      );
    }

    let result: SpecialistOutput;
    try {
      const parsed = specialistOutputSchema.parse(JSON.parse(completion.content));
      result = {
        ...parsed,
        findings: withCategoryFallbacks(
          parsed.findings,
          candidate.categories,
          [],
          requestLanguage(),
        ).findings,
      };
      validateSpecialistPacket(result, candidate, profile, caseId, new Set(evidenceIds));
    } catch (cause) {
      await settle(false, completion);
      console.error("[specialist-trial] answer", cause instanceof Error ? cause.message : cause);
      throw new Error(serverText("fundServer.specialists.failedControl"));
    }
    await settle(true, completion);

    const cited = new Set([
      ...result.assessments.flatMap((item) =>
        item.citations.map((citation) => citation.evidenceId),
      ),
      ...result.findings.flatMap((item) => item.evidenceIds),
      ...result.risks.flatMap((item) => item.evidenceIds),
    ]);
    return {
      caseId,
      companyName: company.name,
      specialist: { title: candidate.title, categories: [...candidate.categories] },
      tier: plan.tier,
      result,
      criteria: profile.criteria
        .filter((criterion) => candidate.categories.includes(criterion.category))
        .map((criterion) => ({ key: criterion.key, label: criterion.label })),
      evidence: evidenceRows
        .filter((row) => cited.has(row["id"] as string))
        .map((row) => evidenceSummary(row)),
    };
  });

function evidenceSummary(row: Record<string, unknown>) {
  const one = <T>(value: unknown) => (Array.isArray(value) ? value[0] : value) as T | null;
  const source = one<{ title?: string | null; url?: string | null }>(row["sources"]);
  const document = one<{ file_name?: string | null }>(row["documents"]);
  const claim = String(row["claim"] ?? "");
  return {
    id: row["id"] as string,
    claim: claim.length > 240 ? `${claim.slice(0, 237)}…` : claim,
    source: source?.title ?? document?.file_name ?? null,
    url: source?.url ?? null,
  };
}
