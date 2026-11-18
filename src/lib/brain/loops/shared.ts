import { jsonSchema, NoObjectGeneratedError, NoOutputGeneratedError, Output } from "ai";
import { estimateRequestMaximumUsd, type PricedModel } from "@/lib/analysis/budgets";
import { extractGatewayCostUsd } from "@/lib/analysis/gateway-response";
import { AiDataPolicyError, aiGatewayOptions } from "@/lib/ai/gateway-options";
import { generateText, maskedModel } from "@/lib/ai/model-call";
import type { Redactor } from "@/lib/ai/redact";
import { redactorForFund } from "@/lib/ai/redact-dictionary.server";
import { BrainModelOutputError } from "../errors";
import type { BudgetScope } from "../jobs";
import type { LoopContext } from "../worker.server";
import { backfillRunId, backfillStopKey, type BackfillLevel } from "../backfill";
import { EMBEDDING_MODEL, embeddingCostUsd, estimateEmbeddingUsd } from "../capture";
import type { BrainEmbedder } from "../embeddings.server";

/**
 * What the loops share: every model call is masked with the fund's dictionary, reserves
 * its maximum in the fund's budget first and books the actual price after (rule 3), and a
 * backfill's jobs skip once it is stopped.
 */

/** The AI log's flow of a loop's calls, e.g. "brain_l1_extract". */
export function loopFlow(ctx: Pick<LoopContext, "loop">): string {
  return `brain_${ctx.loop.toLowerCase()}`;
}

/** Reserves the maximum before the call, then books the actual price. */
export async function embedWithBudget(
  ctx: LoopContext,
  texts: string[],
  refId: string,
  embed: BrainEmbedder,
  scope: BudgetScope = "learning",
  /** The caller's masking, so a batch keeps one; the fund's is loaded when it is not given. */
  redactor?: Redactor,
): Promise<{ embeddings: number[][]; tokens: number; costUsd: number }> {
  const masking = redactor ?? (await redactorForFund(ctx.fundId, loopFlow(ctx), ctx.service));
  const usageId = await ctx.reserve(scope, estimateEmbeddingUsd(texts), {
    model: EMBEDDING_MODEL,
    refId,
  });
  let result: { embeddings: number[][]; tokens: number };
  try {
    result = await embed(texts, masking);
  } catch (cause) {
    try {
      await ctx.release(usageId);
    } catch (releaseCause) {
      console.error("[brain] embedding reservation not released", releaseCause);
    }
    throw cause;
  }
  const costUsd = embeddingCostUsd(result.tokens);
  await ctx.finalize(usageId, costUsd, { input: result.tokens });
  if (result.embeddings.length !== texts.length) {
    throw new Error(`embedding count ${result.embeddings.length} != ${texts.length}`);
  }
  return { ...result, costUsd };
}

export type StructuredCall = {
  model: PricedModel;
  name: string;
  system: string;
  prompt: string;
  schema: object;
  maxOutputTokens: number;
  /** The call's masking; structuredWithBudget loads the fund's when it is not given. */
  redactor?: Redactor;
  /**
   * False: the output keeps the placeholders, for a caller that checks it against the masked
   * text and restores it itself (L1's quote check, point 3).
   */
  restore?: boolean;
};

export type StructuredResult = {
  output: unknown;
  /** The AI Gateway's price; null when the response did not carry it. */
  costUsd: number | null;
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
};

/** One model call. Injected in tests; the default goes through the AI Gateway. */
export type StructuredCaller = (
  call: StructuredCall & { redactor: Redactor },
) => Promise<StructuredResult>;

export const MODEL_TIMEOUT_MS = 90_000;

/** Through the AI Gateway with the same data rules as the analyses (no training, ZDR flag). */
export const callWithGateway: StructuredCaller = async (call) => {
  let result: Awaited<ReturnType<typeof generateText>>;
  try {
    result = await generateText({
      model: maskedModel(call.model, call.redactor, { restore: call.restore ?? true }),
      system: call.system,
      prompt: call.prompt,
      maxOutputTokens: call.maxOutputTokens,
      providerOptions: {
        ...aiGatewayOptions({ model: call.model, data: "confidential" }),
        openai: { reasoningEffort: "low" },
      },
      abortSignal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
      output: Output.object({
        name: call.name,
        schema: jsonSchema<unknown>(call.schema as Parameters<typeof jsonSchema>[0]),
      }),
    });
  } catch (cause) {
    // Cut off at the output limit, empty, or not parseable: an answer, just not a usable one.
    if (NoObjectGeneratedError.isInstance(cause)) {
      throw new BrainModelOutputError(cause.message, cause.finishReason ?? null);
    }
    if (NoOutputGeneratedError.isInstance(cause)) {
      throw new BrainModelOutputError(cause.message, null);
    }
    throw cause;
  }
  if (result.output === null || result.output === undefined) {
    throw new BrainModelOutputError("The model returned no object.", result.finishReason ?? null);
  }
  return {
    output: result.output,
    costUsd: extractGatewayCostUsd({ providerMetadata: result.providerMetadata }),
    inputTokens: result.totalUsage.inputTokens,
    outputTokens: result.totalUsage.outputTokens,
  };
};

/** The most one call can cost: measured input plus the full output allowance. */
export function structuredCallMaximumUsd(call: StructuredCall): number {
  return estimateRequestMaximumUsd({
    model: call.model,
    requestBody: { system: call.system, prompt: call.prompt, schema: call.schema },
    maxOutputTokens: call.maxOutputTokens,
  }).maxCostUsd;
}

/**
 * Reserves the call's maximum, calls, and books the Gateway's price. A failed call may have
 * been billed although the answer was lost, so it is booked at the reserved maximum.
 */
export async function structuredWithBudget(
  ctx: LoopContext,
  caller: StructuredCaller,
  call: StructuredCall,
  refId: string,
  scope: BudgetScope = "learning",
): Promise<{ output: unknown; costUsd: number }> {
  const redactor = call.redactor ?? (await redactorForFund(ctx.fundId, loopFlow(ctx), ctx.service));
  const maxUsd = structuredCallMaximumUsd(call);
  const usageId = await ctx.reserve(scope, maxUsd, { model: call.model, refId });
  let result: StructuredResult;
  try {
    result = await caller({ ...call, redactor });
  } catch (cause) {
    // Stopped by the data rules before anything was sent: nothing to book.
    if (cause instanceof AiDataPolicyError) {
      try {
        await ctx.release(usageId);
      } catch (releaseCause) {
        console.error("[brain] blocked call's reservation not released", releaseCause);
      }
      throw cause;
    }
    await ctx.finalize(usageId, maxUsd);
    if (cause instanceof BrainModelOutputError) cause.bookedUsd = maxUsd;
    throw cause;
  }
  const costUsd = result.costUsd ?? maxUsd;
  await ctx.finalize(usageId, costUsd, {
    ...(result.inputTokens !== undefined ? { input: result.inputTokens } : {}),
    ...(result.outputTokens !== undefined ? { output: result.outputTokens } : {}),
  });
  return { output: result.output, costUsd };
}

/** A backfill's L0 and L1 jobs skip once its run has been stopped. */
export async function backfillStopped(
  ctx: LoopContext,
  level: BackfillLevel,
  startedAt: Date,
): Promise<boolean> {
  const { data, error } = await ctx.service
    .from("brain_jobs")
    .select("id")
    .eq("fund_id", ctx.fundId)
    .eq("loop", "BACKFILL")
    .eq("key", backfillStopKey(level, backfillRunId(startedAt)))
    .maybeSingle();
  if (error) throw new Error(`backfill stop lookup: ${error.message}`);
  return data !== null;
}
