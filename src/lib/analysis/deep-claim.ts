/**
 * Whether a queue delivery may claim a step of a deep analysis. A queued step is claimed; a
 * running step is taken over only when it is stale (the function that started it can no longer
 * be running). A failed step fails the run (before, it answered "busy" for ever and the run stood "running" with no way out); it is not taken again, so its paid
 * attempt is never
 * overwritten by a second one, and starting the run again reuses what it got done. Every claim of a step that has already been started once may pay for the model
 * call a second time, so the number of attempts per step is capped: after that the run fails
 * instead of paying again. Pure and tested.
 *
 * Money: the budget check reserves one call's worst case against the step's own ceiling, but the
 * cost of an earlier attempt that never reported back is not known, so with `MAX_STEP_ATTEMPTS`
 * 2 one step can at most be paid twice (the run's own ceiling is still checked when it is saved).
 */
export const MAX_STEP_ATTEMPTS = 2;

export type StepClaimDecision = "claim" | "busy" | "attempts_exhausted" | "step_failed";

export function decideStepClaim(
  current: { status: string; attempt_count: number | null; started_at: string | null },
  nowMs: number,
  staleAfterMs: number,
): StepClaimDecision {
  if (current.status === "queued") return "claim";
  if (current.status === "failed") return "step_failed";
  const startedAt = current.started_at ? Date.parse(current.started_at) : Number.NaN;
  const stale =
    current.status === "running" && Number.isFinite(startedAt) && startedAt < nowMs - staleAfterMs;
  if (!stale) return "busy";
  return Number(current.attempt_count ?? 0) >= MAX_STEP_ATTEMPTS ? "attempts_exhausted" : "claim";
}
