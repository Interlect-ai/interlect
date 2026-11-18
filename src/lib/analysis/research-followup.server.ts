/** The ZDR call behind a follow-up reflection. The rules and the filter are in research-followup.ts. */
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
import type { AiRunKind, AiTier } from "./model-tiers";
import type { PricedModel } from "./budgets";
import type { TopicsBrief } from "./search-topics";
import { confidentialFundTexts, type PlanFundSetup, type ResearchPlan } from "./research-plan";
import {
  FOLLOWUP_MODULES_PER_ROUND,
  FOLLOWUP_QUESTIONS_PER_MODULE,
  REFLECTION_MAX_OUTPUT_TOKENS,
  REFLECTION_MODELS,
  REFLECTION_TIMEOUT_MS,
  reflectionPrompt,
  reflectionSchema,
  reflectionSystemPrompt,
  sanitizeReflection,
  type RawReflection,
  type ReflectionFinding,
  type SanitizedReflection,
} from "./research-followup";
import { serverText } from "@/lib/i18n/server-text";

export type ReflectionOutcome =
  | {
      status: "ok";
      reflection: SanitizedReflection;
      model: PricedModel;
      actualCostUsd: number | null;
      chargeUsd: number;
    }
  | { status: "skipped" | "failed"; reason: string; chargeUsd: number };

export interface ReflectionCallInput {
  service: SupabaseClient;
  fundId: string;
  kind: AiRunKind;
  tier: AiTier;
  round: number;
  maxRounds: number;
  setup: PlanFundSetup;
  brief: TopicsBrief;
  plan: ResearchPlan | null;
  modules: ReadonlyArray<{ id: string; categories: readonly string[] }>;
  findings: readonly ReflectionFinding[];
  gaps: readonly string[];
  askedQuestions: readonly string[];
  /** What this reflection may cost at most (its share of what the research budget has left). */
  availableUsd: number;
  /** Time left before the research's deadline; the call is cut off at the shorter limit. */
  timeLeftMs: number;
}

/**
 * Writes one reflection with a ZDR model. Never throws: a failure ends the follow-up rounds and
 * the research keeps what it has. The data rules (aiGatewayOptions) stop a model without ZDR
 * before anything is sent.
 */
export async function generateReflection(input: ReflectionCallInput): Promise<ReflectionOutcome> {
  const model = REFLECTION_MODELS[input.kind][input.tier];
  const { profile } = input.setup;
  const maxOutputTokens = REFLECTION_MAX_OUTPUT_TOKENS[input.kind];
  const moduleIds = input.modules.map((module) => module.id);
  const schema = reflectionSchema(moduleIds);
  const system = reflectionSystemPrompt();
  const prompt = reflectionPrompt({
    kind: input.kind,
    round: input.round,
    maxRounds: input.maxRounds,
    outputLanguage: outputLanguageTag(profile.language ?? DEFAULT_LANGUAGE),
    profile,
    screeningInstruction: input.setup.screeningInstruction,
    plan: input.plan,
    modules: input.modules,
    findings: input.findings,
    gaps: input.gaps,
    askedQuestions: input.askedQuestions,
  });
  const estimate: RequestBudgetEstimate = estimateRequestMaximumUsd({
    model,
    requestBody: { model, system, prompt, maxOutputTokens, schema },
    maxOutputTokens,
  });
  if (estimate.maxCostUsd > input.availableUsd) {
    return { status: "skipped", reason: "budget", chargeUsd: 0 };
  }
  const timeoutMs = Math.min(REFLECTION_TIMEOUT_MS[input.kind], input.timeLeftMs);
  try {
    const redactor = await redactorForFund(input.fundId, "research_plan", input.service);
    const gatewayOptions = aiGatewayOptions({ model, data: "confidential" });
    const result = await generateText({
      // An SDK retry would be a second paid call the price check never counts.
      maxRetries: 0,
      // Follow-up questions go to a public search engine: placeholders stay placeholders here,
      // and a question with one is dropped. Notes and founder questions are restored.
      model: maskedModel(model, redactor, { restore: false }),
      system,
      prompt,
      maxOutputTokens,
      providerOptions: { ...gatewayOptions, openai: { reasoningEffort: "low" } },
      abortSignal: AbortSignal.timeout(timeoutMs),
      output: Output.object({
        name: "interlect_research_reflection_v1",
        schema: jsonSchema<RawReflection>(schema as unknown as Parameters<typeof jsonSchema>[0]),
      }),
    });
    const actualCostUsd = extractGatewayCostUsd({ providerMetadata: result.providerMetadata });
    const raw = result.output;
    if (!raw || typeof raw !== "object") throw new Error("Refleksionen var tom.");
    const reflection = sanitizeReflection(raw, {
      profile,
      brief: input.brief,
      confidential: confidentialFundTexts(input.setup, input.plan),
      moduleIds,
      perModule: FOLLOWUP_QUESTIONS_PER_MODULE[input.kind],
      maxModules: FOLLOWUP_MODULES_PER_ROUND[input.kind],
      askedQuestions: input.askedQuestions,
      restore: (text) => redactor.restore(text),
    });
    return {
      status: "ok",
      reflection,
      model,
      actualCostUsd,
      chargeUsd: budgetCharge(actualCostUsd, estimate),
    };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    if (cause instanceof AiDataPolicyError) {
      console.error("[research-followup] blocked by the data rules", cause.code);
      return {
        status: "failed",
        reason: serverText("analysisServer.common.stoppedByDataRules"),
        chargeUsd: 0,
      };
    }
    const details = cause as { finishReason?: unknown; usage?: unknown } | null;
    console.error("[research-followup] reflection failed", message, {
      finishReason: details?.finishReason ?? null,
      usage: details?.usage ?? null,
    });
    // The call may have been billed even if the answer was lost: charge the maximum.
    return {
      status: "failed",
      reason: serverText("analysisServer.followup.failed", { reason: message.slice(0, 160) }),
      chargeUsd: estimate.maxCostUsd,
    };
  }
}
