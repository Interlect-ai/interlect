/**
 * Typed Brain errors. Callers branch on instanceof, never on message text
 * ("Tekst-match på fejlbeskeder knækker lydløst").
 */
import type { BudgetScope } from "./jobs.ts";

/** The fund's monthly budget for the scope cannot cover the next model call. */
export class BrainBudgetReachedError extends Error {
  readonly scope: BudgetScope;
  constructor(scope: BudgetScope) {
    super(`Brain budget reached for scope ${scope}.`);
    this.name = "BrainBudgetReachedError";
    this.scope = scope;
  }
}

/** Another worker took over the job (the lease expired); this attempt must stop writing. */
export class BrainLeaseLostError extends Error {
  constructor(jobId: string) {
    super(`Brain job ${jobId}: the lease was taken over by another worker.`);
    this.name = "BrainLeaseLostError";
  }
}

/**
 * A model call failed after the provider billed it. Carries the actual cost so the budget
 * ledger records it instead of releasing the reservation.
 */
export class BrainBilledCallError extends Error {
  readonly costUsd: number;
  constructor(message: string, costUsd: number) {
    super(message);
    this.name = "BrainBilledCallError";
    this.costUsd = costUsd;
  }
}

/**
 * A refusal meant for the user, in Danish (e.g. "Læring er slået fra for fonden"). Server
 * functions pass its message on; any other error is logged and replaced by a generic text.
 */
export class BrainUserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrainUserError";
  }
}

/**
 * The model answered, but not with a usable object: cut off at the output limit, empty, or not
 * the schema. L1 splits the batch and finally marks an unreadable episode as failed, so one bad
 * answer never blocks a case or is paid for on every retry. `bookedUsd` is what the call cost.
 */
export class BrainModelOutputError extends Error {
  readonly finishReason: string | null;
  bookedUsd = 0;
  constructor(message: string, finishReason: string | null = null) {
    super(message);
    this.name = "BrainModelOutputError";
    this.finishReason = finishReason;
  }
}
