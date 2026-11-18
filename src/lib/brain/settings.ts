/**
 * Brain · Indstillinger: the rules for what a fund may change, pure and
 * tested. Learning on/off, monthly budget per scope, and the model per role. A model switch needs
 * an evaluation run that approved exactly that switch (11: L7); without one it is refused.
 */
import { BUDGET_SCOPES, type BudgetScope } from "./jobs.ts";
import type { MessageKey } from "../i18n/translate.ts";

export const MODEL_ROLES = [
  "extractor",
  "resolver",
  "reflector",
  "curator",
  "page_writer",
  "community_writer",
  "anticipator",
  "chat_fast",
  "chat_deep",
  "query_writer",
  "judge",
  "embedding",
] as const;
export type ModelRole = (typeof MODEL_ROLES)[number];

/** Models with a price in code. Another model could never be reserved for, so it is refused. */
export const PRICED_BRAIN_MODELS = ["openai/gpt-5.4-mini", "openai/gpt-5.4"] as const;

export const MAX_MONTHLY_LIMIT_USD = 1_000;

export function isBudgetScope(value: string): value is BudgetScope {
  return (BUDGET_SCOPES as readonly string[]).includes(value);
}

export function validMonthlyLimitUsd(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= MAX_MONTHLY_LIMIT_USD;
}

export interface EvalRunRow {
  variant: string;
  scores: Record<string, unknown> | null;
}

/** The variant name an evaluation of a model switch must have. */
export function modelVariant(role: ModelRole, model: string): string {
  return `model:${role}:${model}`;
}

/**
 * A model switch is approved only by an evaluation run of exactly that switch that passed. No run
 * (or a run of something else, or a failed one) never approves.
 */
export function evalApprovesModelSwitch(
  run: EvalRunRow | null,
  role: ModelRole,
  model: string,
): boolean {
  if (!run) return false;
  return run.variant === modelVariant(role, model) && run.scores?.["passed"] === true;
}

export type ModelChangeRefusal = "unknown_model" | "no_eval" | "eval_not_passed";

export function checkModelChange(input: {
  role: ModelRole;
  model: string;
  run: EvalRunRow | null;
}): ModelChangeRefusal | null {
  if (input.role === "embedding") return "unknown_model"; // the embedding model is fixed (vector size)
  if (!(PRICED_BRAIN_MODELS as readonly string[]).includes(input.model)) return "unknown_model";
  if (!input.run) return "no_eval";
  return evalApprovesModelSwitch(input.run, input.role, input.model) ? null : "eval_not_passed";
}

/** The refusal's text for the person (a key into the dictionary's `brainServer.settings`). */
export const MODEL_REFUSAL_TEXT: Record<ModelChangeRefusal, MessageKey> = {
  unknown_model: "brainServer.settings.unknownModel",
  no_eval: "brainServer.settings.noEval",
  eval_not_passed: "brainServer.settings.evalNotPassed",
};
