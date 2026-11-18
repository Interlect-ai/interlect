/**
 * Time and token limits of the deep analysis per model (tiers: Let = gpt-5.4-mini, Middel =
 * gpt-5.4, Tung = gpt-5.5). The time budget itself (220 s per call inside a 300 s function) is
 * explained in `deep-text-rules.ts`. Pure and tested.
 *
 * The speeds are conservative assumptions, including reasoning tokens, to be calibrated from the
 * per-call log line (`[deep-gateway] … ms, in= out=`) after the first paid run on each tier.
 */
import type { PricedModel } from "./budgets.ts";
import { SPECIALIST_MAX_OUTPUT_TOKENS, SYNTHESIS_MAX_OUTPUT_TOKENS } from "./deep-text-rules.ts";
import type { AiTier } from "./model-tiers.ts";

/** Output tokens per second a model is assumed to deliver (reasoning included). */
export const OUTPUT_TOKENS_PER_SECOND: Partial<Record<PricedModel, number>> = {
  "openai/gpt-5.4-mini": 120,
  "openai/gpt-5.4": 70,
  "openai/gpt-5.5": 55,
};
const DEFAULT_TOKENS_PER_SECOND = 55;

export type DeepCallKind = "specialist" | "synthesis";

/**
 * The output cap of one call: the text-length design cap on every level (a cut-off call fails
 * the run after it is paid for, so the cap must never be smaller than what the answer needs; the
 * synthesis needs ~12.5k tokens plus reasoning). The TIMEOUT is the only time guard. The cost
 * side is checked separately before every call (`estimateRequestMaximumUsd` against the plan's
 * budget share), so a fund's own lower loft is still respected.
 */
export function outputTokenCap(kind: DeepCallKind, _tier: AiTier, _model: string): number {
  return kind === "specialist" ? SPECIALIST_MAX_OUTPUT_TOKENS : SYNTHESIS_MAX_OUTPUT_TOKENS;
}

/**
 * Seconds a model needs for `tokens` output tokens at its assumed speed, for tests and for
 * reading the call log. Not used to shrink a cap.
 */
export function expectedSeconds(tokens: number, model: string): number {
  const rate = OUTPUT_TOKENS_PER_SECOND[model as PricedModel] ?? DEFAULT_TOKENS_PER_SECOND;
  return tokens / rate;
}

/**
 * The synthesis assembles what the specialists found, so every level writes it with low reasoning
 * effort: the reasoning tokens would otherwise eat the output cap and the time limit (first paid
 * run on Middel: 16 000 tokens in 229 s with medium effort, cut off).
 */
export function synthesisReasoningEffort(_model: string): "low" | "medium" {
  return "low";
}
