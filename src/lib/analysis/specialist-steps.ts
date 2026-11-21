/**
 * The deep analysis's specialist steps (behaviour test F2): each specialist is
 * one step. A step finished on an earlier try, or by the stopped run before this one, is taken over
 * unpaid; the rest are called. When a call stops at the price limit, the steps that finished stay
 * finished, and the run stops at its limit (not as an error) so the next try pays only for what is
 * missing. The database and the gateway come in through `store` and `call`, so the rule is tested
 * with a stub gateway.
 */
import {
  assertActualSpendWithinBudget,
  BudgetLimitError,
  budgetCharge,
  stopReasonOf,
  type RequestBudgetEstimate,
} from "./budgets.ts";
import type { Language } from "../i18n/language.ts";

export interface SpecialistCompletion {
  actualCostUsd: number | null;
  estimatedMaximumUsd: RequestBudgetEstimate;
}

export interface SpecialistStepStore<P, C extends SpecialistCompletion> {
  /** Marks a step as taken over from the stopped run: finished, at no cost. */
  takeOver(stepKey: string, packet: P): Promise<void>;
  /** The run's steps as they stand now. */
  load(): Promise<Map<string, { status: string; output_json?: unknown }>>;
  /** Claims a step for this delivery; false when another delivery has it. */
  claim(stepKey: string): Promise<boolean>;
  complete(stepKey: string, packet: P, completion: C): Promise<void>;
  /** Saves the failed step and returns the message the run fails with. */
  fail(stepKey: string, cause: unknown, completion: C | null): Promise<string>;
}

export async function runSpecialistSteps<
  M extends { id: string },
  P,
  C extends SpecialistCompletion,
>(input: {
  specialists: readonly M[];
  /** The steps as they were when the phase started. */
  initialSteps: ReadonlyMap<string, { status: string }>;
  /** Packets the stopped (or failed) run before this one finished, by step key. */
  reusable: ReadonlyMap<string, P>;
  store: SpecialistStepStore<P, C>;
  /** Reads back and checks a finished step's packet. */
  stored: (module: M, output: unknown) => P;
  /** The paid call (the gateway). */
  call: (module: M) => Promise<C>;
  /** Turns the call's answer into a checked packet; throws when it does not hold. */
  toPacket: (module: M, completion: C) => P;
  /** Recovers what a failed call was charged, when it was sent. */
  failedCompletion: (cause: unknown) => C | null;
  specialistsUsd: number;
  language: Language;
  fallbackMessage: string;
}): Promise<boolean> {
  const { specialists, store } = input;
  for (const module of specialists) {
    const packet = input.reusable.get(module.id);
    if (input.initialSteps.get(module.id)?.status !== "complete" && packet) {
      await store.takeOver(module.id, packet);
    }
  }

  const steps = await store.load();
  const results = await Promise.all(
    specialists.map(async (module) => {
      const existing = steps.get(module.id);
      if (existing?.status === "complete") {
        const packet = input.stored(module, existing.output_json);
        return { packet, completion: null, busy: false, error: null, stopped: false };
      }
      if (!(await store.claim(module.id))) {
        return { packet: null, completion: null, busy: true, error: null, stopped: false };
      }
      let completion: C | null = null;
      try {
        completion = await input.call(module);
        const packet = input.toPacket(module, completion);
        await store.complete(module.id, packet, completion);
        return { packet, completion, busy: false, error: null, stopped: false };
      } catch (cause) {
        // A call cut off by the token cap was still paid for: keep its usage on the step.
        completion = completion ?? input.failedCompletion(cause);
        const error = await store.fail(module.id, cause, completion);
        return {
          packet: null,
          completion,
          busy: false,
          error,
          stopped: stopReasonOf(cause) !== null,
        };
      }
    }),
  );

  // A failure is looked at before "busy": a failed specialist beside one another
  // delivery still runs would otherwise answer "busy" and leave the run running for ever.
  const failed = results.find((result) => result.error !== null);
  if (failed) {
    const message = failed.error ?? input.fallbackMessage;
    // The specialists that finished are saved on their steps and reused on the next try.
    // A real error beside a stop is still a real error.
    const onlyStops = results.every((result) => result.error === null || result.stopped);
    throw onlyStops ? new BudgetLimitError(message) : new Error(message);
  }
  if (results.some((result) => result.busy)) return false;
  const charged = results.reduce(
    (sum, result) =>
      sum +
      (result.completion
        ? budgetCharge(result.completion.actualCostUsd, result.completion.estimatedMaximumUsd)
        : 0),
    0,
  );
  assertActualSpendWithinBudget(
    charged,
    input.specialistsUsd,
    "Specialistanalyserne",
    input.language,
  );
  return true;
}
