/**
 * (C4-7): a deep analysis that continues after a stop at the price limit takes over
 * what the stopped run finished, unpaid. It reserves, against the team's month and
 * the balance, only the parts that are missing, and each part may use only its own share of the
 * plan, so the run never spends more than it reserved (0131 books at most the reservation).
 *
 * Pure: the start (`approveAndRunDeepAnalysis`) and every worker phase work it out the same from the
 * stopped run's steps. A part that turns out not to be reusable after all gets nothing and stops at
 * the limit again (never more than reserved); the next continuation then reserves it.
 */
import { reserveOf, type RunPlan, type RunReserve } from "./model-tiers.ts";
import { EVIDENCE_SHEET_BUDGET_USD } from "./evidence-sheet.ts";

/** What the stopped run finished that the continuation takes over. */
export interface StoppedRunProgress {
  /** Its research step finished and is taken over whole (`loadReusablePublicResearch`). */
  researchDone: boolean;
  /** Its evidence sheet finished with a sheet. */
  evidenceSheetDone: boolean;
  /** The specialists it finished, by step key (`specialistsTakenOver`). */
  specialistsDone: readonly string[];
}

/** What each part of a deep run may use, in dollars. */
export interface DeepRunShares {
  /** The research's own calls, the evidence sheet's share set aside. */
  researchUsd: number;
  evidenceSheetUsd: number;
  /** One specialist's call, by step key. */
  specialistUsd: (stepKey: string) => number;
  /** The specialist phase in all. */
  specialistsUsd: number;
  synthesisUsd: number;
  /** The run in all: what it reserves and may spend. */
  totalUsd: number;
}

function ceil4(value: number): number {
  return Math.ceil(value * 10_000 - 1e-9) / 10_000;
}

/**
 * The shares of a deep run on `plan`. Without a stopped run, or when the research has to be done
 * again, the plan's own shares (the whole run). Otherwise a finished part gets nothing and a
 * missing one its full share; the synthesis is never taken over.
 */
export function deepRunShares(
  plan: RunPlan,
  specialistIds: readonly string[],
  progress: StoppedRunProgress | null,
): DeepRunShares {
  const sheetUsd = plan.scope.evidenceSheet ? EVIDENCE_SHEET_BUDGET_USD.deep : 0;
  const perSpecialistUsd =
    specialistIds.length > 0 ? plan.budget.specialistsUsd / specialistIds.length : 0;
  if (!progress?.researchDone) {
    return {
      researchUsd: plan.budget.researchUsd - sheetUsd,
      evidenceSheetUsd: sheetUsd,
      specialistUsd: () => perSpecialistUsd,
      specialistsUsd: plan.budget.specialistsUsd,
      synthesisUsd: plan.budget.synthesisUsd,
      totalUsd: plan.budget.usd,
    };
  }
  const done = new Set(progress.specialistsDone.filter((id) => specialistIds.includes(id)));
  const missing = specialistIds.length - done.size;
  const evidenceSheetUsd = progress.evidenceSheetDone ? 0 : sheetUsd;
  const specialistsUsd =
    missing === specialistIds.length ? plan.budget.specialistsUsd : perSpecialistUsd * missing;
  return {
    researchUsd: 0,
    evidenceSheetUsd,
    specialistUsd: (stepKey) => (done.has(stepKey) ? 0 : perSpecialistUsd),
    specialistsUsd,
    synthesisUsd: plan.budget.synthesisUsd,
    // Rounded up, so the reservation always covers the parts it is the sum of.
    totalUsd: Math.min(
      plan.budget.usd,
      ceil4(evidenceSheetUsd + specialistsUsd + plan.budget.synthesisUsd),
    ),
  };
}

/** What a continuation reserves; undefined when it is the whole run (the research is missing). */
export function continuationReserve(
  plan: RunPlan,
  specialistIds: readonly string[],
  progress: StoppedRunProgress,
): RunReserve | undefined {
  const { totalUsd } = deepRunShares(plan, specialistIds, progress);
  return totalUsd < plan.budget.usd ? reserveOf(plan, totalUsd) : undefined;
}

/**
 * The specialists a stopped run finished that a continuation takes over: a finished step on the
 * same model and prompt version with a whole packet, as `loadReusableSpecialists` takes them (it
 * also checks the packet's sources against the new run's evidence, which is only known later).
 */
export function specialistsTakenOver(
  steps: ReadonlyArray<{
    step_key: unknown;
    status: unknown;
    model_name: unknown;
    prompt_version: unknown;
    output_json: unknown;
  }>,
  input: {
    specialistIds: readonly string[];
    model: string;
    promptVersion: string;
    isPacket: (output: unknown) => boolean;
  },
): string[] {
  return steps
    .filter(
      (step) =>
        typeof step.step_key === "string" &&
        input.specialistIds.includes(step.step_key) &&
        step.status === "complete" &&
        step.model_name === input.model &&
        step.prompt_version === input.promptVersion &&
        input.isPacket(step.output_json),
    )
    .map((step) => step.step_key as string);
}
