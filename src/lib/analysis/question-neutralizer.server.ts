/** The ZDR call behind the neutral search questions. The rules are in question-neutralizer.ts. */
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
import {
  applyNeutralization,
  NEUTRALIZER_MAX_OUTPUT_TOKENS,
  NEUTRALIZER_MODEL,
  NEUTRALIZER_SCHEMA,
  NEUTRALIZER_SYSTEM_PROMPT,
  NEUTRALIZER_TIMEOUT_MS,
  neutralizerPrompt,
  type NeutralCandidate,
  type NeutralizedQuestions,
  type RawNeutralization,
} from "./question-neutralizer";
import type { TopicsBrief } from "./search-topics";

export type NeutralizerOutcome = NeutralizedQuestions & {
  status: "ok" | "skipped" | "failed";
  /** Why nothing was sent (logs and the research step's output, never shown to the person). */
  reason: string | null;
  actualCostUsd: number | null;
  chargeUsd: number;
};

/** Nothing is sent: every candidate is dropped. */
function noneSent(
  candidates: readonly NeutralCandidate[],
  status: "skipped" | "failed",
  reason: string,
  chargeUsd: number,
): NeutralizerOutcome {
  return {
    status,
    reason,
    questions: candidates.map(() => null),
    kept: 0,
    rewritten: 0,
    dropped: candidates.length,
    actualCostUsd: null,
    chargeUsd,
  };
}

/**
 * Keeps, rewrites or drops each question with a ZDR model. Never throws, and fails closed: when
 * the call is skipped or fails, no question is sent. The data rules (aiGatewayOptions) stop a
 * model without ZDR before anything is sent. No candidates: no call.
 */
export async function neutralizeSearchQuestions(input: {
  service: SupabaseClient;
  /** The fund whose dictionary masks the call. */
  fundId: string;
  companyName: string;
  brief: TopicsBrief;
  /** The other confidential text (instruction, specialists, plan) the questions may not reveal. */
  confidential: readonly string[];
  candidates: readonly NeutralCandidate[];
  availableUsd: number;
  timeoutMs?: number;
}): Promise<NeutralizerOutcome> {
  if (input.candidates.length === 0) {
    return {
      status: "ok",
      reason: null,
      questions: [],
      kept: 0,
      rewritten: 0,
      dropped: 0,
      actualCostUsd: 0,
      chargeUsd: 0,
    };
  }
  const prompt = neutralizerPrompt(input);
  const estimate: RequestBudgetEstimate = estimateRequestMaximumUsd({
    model: NEUTRALIZER_MODEL,
    requestBody: {
      model: NEUTRALIZER_MODEL,
      system: NEUTRALIZER_SYSTEM_PROMPT,
      prompt,
      maxOutputTokens: NEUTRALIZER_MAX_OUTPUT_TOKENS,
      schema: NEUTRALIZER_SCHEMA,
    },
    maxOutputTokens: NEUTRALIZER_MAX_OUTPUT_TOKENS,
  });
  if (estimate.maxCostUsd > input.availableUsd) {
    console.warn(
      "[question-neutralizer] skipped: over its budget, no fund-derived question is sent",
    );
    return noneSent(input.candidates, "skipped", "budget", 0);
  }
  try {
    const gatewayOptions = aiGatewayOptions({ model: NEUTRALIZER_MODEL, data: "confidential" });
    const result = await generateText({
      // An SDK retry would be a second paid call the price check never counts.
      maxRetries: 0,
      // The questions go to a public search engine: a placeholder stays a placeholder, and the
      // code filter drops a question with one, so a masked name never reaches a search.
      model: maskedModel(
        NEUTRALIZER_MODEL,
        await redactorForFund(input.fundId, "question_neutralizer", input.service),
        { restore: false },
      ),
      system: NEUTRALIZER_SYSTEM_PROMPT,
      prompt,
      maxOutputTokens: NEUTRALIZER_MAX_OUTPUT_TOKENS,
      providerOptions: { ...gatewayOptions, openai: { reasoningEffort: "low" } },
      abortSignal: AbortSignal.timeout(input.timeoutMs ?? NEUTRALIZER_TIMEOUT_MS),
      output: Output.object({
        name: "interlect_question_neutralizer_v1",
        schema: jsonSchema<RawNeutralization>(
          NEUTRALIZER_SCHEMA as unknown as Parameters<typeof jsonSchema>[0],
        ),
      }),
    });
    const actualCostUsd = extractGatewayCostUsd({ providerMetadata: result.providerMetadata });
    const neutral = applyNeutralization(
      result.output,
      input.candidates,
      input.brief,
      input.confidential,
    );
    return {
      status: "ok",
      reason: null,
      ...neutral,
      actualCostUsd,
      chargeUsd: budgetCharge(actualCostUsd, estimate),
    };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    if (cause instanceof AiDataPolicyError) {
      // Stopped by the data rules before anything was sent: nothing to charge.
      console.error("[question-neutralizer] blocked by the data rules", cause.code);
      return noneSent(input.candidates, "failed", "blocked by the data rules", 0);
    }
    const details = cause as { finishReason?: unknown; usage?: unknown } | null;
    console.error("[question-neutralizer] failed, no fund-derived question is sent", message, {
      finishReason: details?.finishReason ?? null,
      usage: details?.usage ?? null,
    });
    // The call may have been billed even if the answer was lost: charge the maximum.
    return noneSent(
      input.candidates,
      "failed",
      `model call failed: ${message.slice(0, 160)}`,
      estimate.maxCostUsd,
    );
  }
}
