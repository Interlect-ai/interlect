/**
 * A run that has stood still for a long time: instead of an orb forever, the page shows
 * a calm message. Pure, so the case page and the tests share it.
 */

/** No new step for this long: the run is shown as stalled. */
export const RUN_STALL_MS = 15 * 60 * 1000;

/**
 * En screening, der stadig "kører" efter så lang tid, er afbrudt. Den kører i to funktioner med
 * hver sit loft på 300 s (research, så analyse via køen), og køen kan genlevere analysen.
 * Worst case with one take-over: research 300 s + stale wait 330 s + retry 30 s + analysis 300 s.
 * The server releases it then (runInitialScreening), so the page offers "Prøv igen" from then.
 */
export const STALE_SCREENING_MS = 18 * 60 * 1000;

interface RunTimes {
  /** When the run was created (the view calls it `startedAt`). */
  startedAt: string;
  steps: ReadonlyArray<{ startedAt: string | null; completedAt: string | null }>;
}

/** The last time the run showed life: its start or a step that started or finished. */
export function lastRunActivity(run: RunTimes): number {
  let last = Date.parse(run.startedAt);
  for (const step of run.steps) {
    for (const value of [step.startedAt, step.completedAt]) {
      const time = value ? Date.parse(value) : Number.NaN;
      if (Number.isFinite(time) && !(time <= last)) last = time;
    }
  }
  return last;
}

/** No new step for `RUN_STALL_MS`. An unreadable start never counts as stalled. */
export function runStalled(run: RunTimes, nowMs: number): boolean {
  const last = lastRunActivity(run);
  return Number.isFinite(last) && nowMs - last > RUN_STALL_MS;
}

/**
 * A stalled screening can be started again once the server would release it (its start is
 * past `STALE_SCREENING_MS`, with a minute's margin for the gap between creating and starting it).
 */
export function screeningRetryable(run: RunTimes, nowMs: number): boolean {
  const created = Date.parse(run.startedAt);
  return runStalled(run, nowMs) && nowMs - created > STALE_SCREENING_MS + 60_000;
}

/**
 * A deep analysis with no new step for this long is released by the server when the
 * team starts it again. A phase runs at most 300 s and a dead step is taken over after 6 min
 * (`STEP_STALE_AFTER_MS`), so 20 quiet minutes means no delivery is coming any more.
 */
export const STALE_DEEP_MS = 20 * 60 * 1000;

/** A stalled deep analysis the server would release, so the page offers "Prøv igen". */
export function deepRunReleasable(run: RunTimes, nowMs: number): boolean {
  const last = lastRunActivity(run);
  return Number.isFinite(last) && nowMs - last > STALE_DEEP_MS;
}
