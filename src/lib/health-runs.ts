/**
 * Whether an analysis run has been left standing, for /api/health. A run that is queued or
 * running with no new step for `STALE_DEEP_MS` has lost its queue delivery (the kind of stop),
 * so the installation reports "degraded" instead of up. Pure; tested with node --test.
 */
import { deepRunReleasable } from "./cases/run-stall.ts";

export interface OpenRun {
  id: string;
  created_at: string;
}

export interface RunStep {
  run_id: string;
  started_at: string | null;
  completed_at: string | null;
}

/** The ids of the open runs that show no life for longer than a run may stand still. */
export function stalledRunIds(
  runs: ReadonlyArray<OpenRun>,
  steps: ReadonlyArray<RunStep>,
  nowMs: number,
): string[] {
  return runs
    .filter((run) =>
      deepRunReleasable(
        {
          startedAt: run.created_at,
          steps: steps
            .filter((step) => step.run_id === run.id)
            .map((step) => ({ startedAt: step.started_at, completedAt: step.completed_at })),
        },
        nowMs,
      ),
    )
    .map((run) => run.id);
}
