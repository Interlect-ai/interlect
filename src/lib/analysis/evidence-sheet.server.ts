/** The ZDR call behind the evidence sheet. The rules are in evidence-sheet.ts. */
import type { SupabaseClient } from "@supabase/supabase-js";
import { jsonSchema, Output } from "ai";
import { AiDataPolicyError, aiGatewayOptions } from "@/lib/ai/gateway-options";
import { generateText, maskedModel } from "@/lib/ai/model-call";
import { redactorForFund } from "@/lib/ai/redact-dictionary.server";
import {
  budgetCharge,
  estimateRequestMaximumUsd,
  type RequestBudgetEstimate,
} from "@/lib/analysis/budgets";
import { extractGatewayCostUsd } from "@/lib/analysis/gateway-response";
import { outputLanguageTag } from "@/lib/i18n/ai-language";
import { DEFAULT_LANGUAGE } from "@/lib/i18n/language";
import type { FundProfile } from "@/lib/funds/profiles";
import type { AiRunKind, AiTier } from "./model-tiers";
import type { PricedModel } from "./budgets";
import type { ScreeningEvidenceInput } from "./prompt";
import { readStoredResearchPlan, type ResearchPlan } from "./research-plan";
import { readStoredResearchFollowUp, type ResearchFollowUp } from "./research-followup";
import { isCaseOwnEvidence, toPromptEvidence, withCardFigureEvidence } from "./evidence-selection";
import {
  EVIDENCE_SHEET_BUDGET_USD,
  EVIDENCE_SHEET_MAX_OUTPUT_TOKENS,
  EVIDENCE_SHEET_MIN_MS,
  EVIDENCE_SHEET_MODELS,
  EVIDENCE_SHEET_STEP,
  EVIDENCE_SHEET_TIMEOUT_MS,
  evidenceBesideSheet,
  evidenceRef,
  evidenceSheetPrompt,
  evidenceSheetSchema,
  evidenceSheetSystemPrompt,
  hasEvidence,
  readStoredEvidenceSheet,
  sanitizeEvidenceSheet,
  type EvidenceSheet,
  type EvidenceSheetSkipReason,
  type RawEvidenceSheet,
} from "./evidence-sheet";
import { serverText } from "@/lib/i18n/server-text";

export interface EvidenceSheetUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
}

export type EvidenceSheetOutcome =
  | {
      status: "ok";
      sheet: EvidenceSheet;
      model: PricedModel;
      actualCostUsd: number | null;
      chargeUsd: number;
      usage: EvidenceSheetUsage;
    }
  | {
      status: "skipped" | "failed";
      reason: EvidenceSheetSkipReason;
      /** What the call may have cost (0 when nothing was sent). */
      actualCostUsd: number | null;
      chargeUsd: number;
      usage: EvidenceSheetUsage;
    };

export interface EvidenceSheetCallInput {
  service: SupabaseClient;
  fundId: string;
  kind: AiRunKind;
  tier: AiTier;
  profile: FundProfile;
  plan: ResearchPlan | null;
  followUp: ResearchFollowUp | null;
  /** The evidence the prompts would get, in their order (newest first). */
  evidence: readonly ScreeningEvidenceInput[];
  /** What the sheet may cost at most. */
  availableUsd: number;
  /** Time left for the sheet; the call is cut off at the shorter of this and its own limit. */
  timeLeftMs: number;
}

const NO_USAGE: EvidenceSheetUsage = { inputTokens: null, outputTokens: null, totalTokens: null };

/**
 * Writes the run's evidence sheet with a ZDR model. Never throws: without a sheet the prompts get
 * the evidence as before. The data rules (aiGatewayOptions) stop a model without ZDR before
 * anything is sent.
 */
export async function writeEvidenceSheet(
  input: EvidenceSheetCallInput,
): Promise<EvidenceSheetOutcome> {
  const skipped = (reason: EvidenceSheetSkipReason): EvidenceSheetOutcome => ({
    status: "skipped",
    reason,
    actualCostUsd: 0,
    chargeUsd: 0,
    usage: NO_USAGE,
  });
  if (!input.evidence.length) return skipped("no_evidence");
  if (input.timeLeftMs < EVIDENCE_SHEET_MIN_MS[input.kind]) return skipped("time");
  const model = EVIDENCE_SHEET_MODELS[input.kind][input.tier];
  const language = input.profile.language ?? DEFAULT_LANGUAGE;
  const maxOutputTokens = EVIDENCE_SHEET_MAX_OUTPUT_TOKENS[input.kind];
  const refs = input.evidence.map((_, index) => evidenceRef(index));
  const schema = evidenceSheetSchema(input.kind, refs);
  const system = evidenceSheetSystemPrompt();
  const prompt = evidenceSheetPrompt({
    kind: input.kind,
    outputLanguage: outputLanguageTag(language),
    profile: input.profile,
    plan: input.plan,
    followUp: input.followUp,
    evidence: input.evidence,
  });
  const estimate: RequestBudgetEstimate = estimateRequestMaximumUsd({
    model,
    requestBody: { model, system, prompt, maxOutputTokens, schema },
    maxOutputTokens,
  });
  if (estimate.maxCostUsd > input.availableUsd) return skipped("budget");
  const timeoutMs = Math.min(EVIDENCE_SHEET_TIMEOUT_MS[input.kind], input.timeLeftMs);
  try {
    const redactor = await redactorForFund(input.fundId, "evidence_sheet", input.service);
    const gatewayOptions = aiGatewayOptions({ model, data: "confidential" });
    const result = await generateText({
      // An SDK retry would be a second paid call the price check never counts.
      maxRetries: 0,
      // The sheet stays on the confidential side (the run's prompts and the research log), so
      // placeholders are restored to the real names in what comes back.
      model: maskedModel(model, redactor),
      system,
      prompt,
      maxOutputTokens,
      providerOptions: { ...gatewayOptions, openai: { reasoningEffort: "low" } },
      abortSignal: AbortSignal.timeout(timeoutMs),
      output: Output.object({
        name: "interlect_evidence_sheet_v1",
        schema: jsonSchema<RawEvidenceSheet>(schema as unknown as Parameters<typeof jsonSchema>[0]),
      }),
    });
    const actualCostUsd = extractGatewayCostUsd({ providerMetadata: result.providerMetadata });
    const chargeUsd = budgetCharge(actualCostUsd, estimate);
    const usage: EvidenceSheetUsage = {
      inputTokens: result.usage?.inputTokens ?? null,
      outputTokens: result.usage?.outputTokens ?? null,
      totalTokens: result.usage?.totalTokens ?? null,
    };
    const raw = result.output;
    if (!raw || typeof raw !== "object") throw new Error("Bevisarket var tomt.");
    const sheet = sanitizeEvidenceSheet(raw, {
      kind: input.kind,
      profile: input.profile,
      evidenceIds: input.evidence.map((item) => item.id),
      model,
      language,
    });
    if (!hasEvidence(sheet)) {
      // Paid, but no better than the raw evidence: the prompts get the evidence as before.
      return { status: "failed", reason: "no_evidence", actualCostUsd, chargeUsd, usage };
    }
    return { status: "ok", sheet, model, actualCostUsd, chargeUsd, usage };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    if (cause instanceof AiDataPolicyError) {
      console.error("[evidence-sheet] blocked by the data rules", cause.code);
      return {
        status: "failed",
        reason: "failed",
        actualCostUsd: 0,
        chargeUsd: 0,
        usage: NO_USAGE,
      };
    }
    const details = cause as { finishReason?: unknown; usage?: unknown } | null;
    console.error("[evidence-sheet] sheet failed", message, {
      finishReason: details?.finishReason ?? null,
      usage: details?.usage ?? null,
    });
    // The call may have been billed even if the answer was lost: charge the maximum, and leave
    // the actual cost unknown so the run's total says so.
    return {
      status: "failed",
      reason: "failed",
      actualCostUsd: null,
      chargeUsd: estimate.maxCostUsd,
      usage: NO_USAGE,
    };
  }
}

/** The deep analysis's sheet as stored on its own step; null without one. */
export async function loadRunEvidenceSheet(
  service: SupabaseClient,
  runId: string,
): Promise<EvidenceSheet | null> {
  const { data, error } = await service
    .from("analysis_run_steps")
    .select("status, output_json")
    .eq("run_id", runId)
    .eq("step_key", EVIDENCE_SHEET_STEP)
    .maybeSingle();
  if (error) throw new Error(serverText("analysisServer.evidence.notLoaded"));
  if (data?.["status"] !== "complete") return null;
  return readStoredEvidenceSheet(
    (data["output_json"] as { evidenceSheet?: unknown } | null)?.evidenceSheet,
  );
}

/**
 * The deep analysis's evidence sheet step, run once between the research and the
 * specialists: reuses the sheet of the failed run before it when it cites only evidence this run
 * has, otherwise writes one, saves the step and narrows the run's evidence to what the
 * specialists get next to the sheet (input_evidence_ids). Without a sheet the step is "skipped"
 * and the evidence stays as it is. Throws only when the database cannot be written.
 */
export async function runDeepEvidenceSheetStep(input: {
  service: SupabaseClient;
  fundId: string;
  runId: string;
  tier: AiTier;
  profile: FundProfile;
  evidenceRows: ReadonlyArray<Record<string, unknown>>;
  /** The public research step's output (its plan and follow-up steer the sheet). */
  researchOutput: unknown;
  priorFailedRunId: string | null;
  /** The sheet's share of the run's budget; 0 when the planner left it out. */
  availableUsd: number;
  timeLeftMs: number;
}): Promise<{ sheet: EvidenceSheet | null; evidenceRows: Array<Record<string, unknown>> }> {
  const { service, runId } = input;
  const evidence = input.evidenceRows.map(toPromptEvidence);
  const evidenceIds = new Set(evidence.map((item) => item.id));
  const prior = input.priorFailedRunId
    ? await loadRunEvidenceSheet(service, input.priorFailedRunId)
    : null;
  const reusable =
    prior && prior.citedEvidenceIds.every((id) => evidenceIds.has(id)) && hasEvidence(prior)
      ? prior
      : null;
  const research = (input.researchOutput ?? {}) as {
    researchPlan?: unknown;
    researchFollowUp?: unknown;
  };
  const outcome: EvidenceSheetOutcome = reusable
    ? {
        status: "ok",
        sheet: reusable,
        model: reusable.model as PricedModel,
        actualCostUsd: 0,
        chargeUsd: 0,
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      }
    : await writeEvidenceSheet({
        service,
        fundId: input.fundId,
        kind: "deep",
        tier: input.tier,
        profile: input.profile,
        plan: readStoredResearchPlan(research.researchPlan),
        followUp: readStoredResearchFollowUp(research.researchFollowUp),
        evidence,
        availableUsd: input.availableUsd,
        timeLeftMs: input.timeLeftMs,
      });
  const completedAt = new Date().toISOString();
  const usage = {
    input_tokens: outcome.usage.inputTokens,
    output_tokens: outcome.usage.outputTokens,
    total_tokens: outcome.usage.totalTokens,
    actual_cost: outcome.actualCostUsd,
    // What the sheet charged against the budget: the run's bound when its price is unknown.
    charged_cost: outcome.chargeUsd,
  };
  if (outcome.status !== "ok") {
    const { error } = await service
      .from("analysis_run_steps")
      .update({
        status: "skipped",
        ...usage,
        output_json: { evidenceSheet: null, evidenceSheetStatus: outcome.reason },
        error_message: serverText("analysisServer.evidence.none", { reason: outcome.reason }),
        completed_at: completedAt,
      })
      .eq("run_id", runId)
      .eq("step_key", EVIDENCE_SHEET_STEP);
    if (error) throw new Error(serverText("analysisServer.evidence.notSaved"));
    return { sheet: null, evidenceRows: [...input.evidenceRows] };
  }
  // The research's card figures go along too, so a specialist can draw what was found.
  const evidenceRows = withCardFigureEvidence(
    evidenceBesideSheet(input.evidenceRows, outcome.sheet, isCaseOwnEvidence),
    input.evidenceRows,
  );
  const [stepResult, runResult] = await Promise.all([
    service
      .from("analysis_run_steps")
      .update({
        status: "complete",
        model_name: outcome.model,
        ...usage,
        output_json: {
          evidenceSheet: outcome.sheet,
          evidenceSheetStatus: "ok",
          ...(reusable ? { reusedFromRunId: input.priorFailedRunId } : {}),
        },
        error_message: null,
        completed_at: completedAt,
      })
      .eq("run_id", runId)
      .eq("step_key", EVIDENCE_SHEET_STEP),
    service
      .from("analysis_runs")
      .update({ input_evidence_ids: evidenceRows.map((row) => row["id"] as string) })
      .eq("id", runId),
  ]);
  if (stepResult.error || runResult.error)
    throw new Error(serverText("analysisServer.evidence.notSaved"));
  return { sheet: outcome.sheet, evidenceRows };
}
