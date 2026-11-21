import type { SupabaseClient } from "@supabase/supabase-js";
import { stepRunCosts } from "./gateway-response.ts";
import {
  deepRunReleasable,
  runStalled,
  STALE_DEEP_MS,
  STALE_SCREENING_MS,
} from "../cases/run-stall.ts";
import { serverText } from "../i18n/server-text.ts";

/**
 * Closes a run that stalled without reaching its own error handling (the function was stopped),
 * so a new run can start. Only a run that is still queued or running is closed, and
 * the run keeps what its steps reported they paid and charged against the budget, so the
 * settlement (0114) books that instead of 0 kr. A call cut off with the function is not known
 * and not booked. Returns false when the run had already moved on (finished, failed or released).
 */
export async function releaseStalledRun(
  service: SupabaseClient,
  input: {
    fundId: string;
    runId: string;
    message: string;
    /** Set for a deep analysis: the case is no longer "in progress" while nothing runs. */
    caseId?: string;
    logTag: string;
  },
): Promise<boolean> {
  const { fundId, runId, message } = input;
  const [{ data: steps, error: stepsError }, { data: current, error: currentError }] =
    await Promise.all([
      service
        .from("analysis_run_steps")
        .select("actual_cost, charged_cost, input_tokens, output_tokens, total_tokens")
        .eq("run_id", runId)
        .eq("fund_id", fundId),
      service
        .from("analysis_runs")
        .select("validation_result")
        .eq("id", runId)
        .eq("fund_id", fundId)
        .maybeSingle(),
    ]);
  if (stepsError) throw new Error(stepsError.message);
  if (currentError) throw new Error(currentError.message);
  const rows = steps ?? [];
  const costs = stepRunCosts(rows);
  const validation = current?.["validation_result"];
  const validationRecord =
    validation && typeof validation === "object" && !Array.isArray(validation)
      ? (validation as Record<string, unknown>)
      : {};
  const budget = validationRecord["budget"];
  const sum = (key: "input_tokens" | "output_tokens" | "total_tokens") =>
    rows.reduce((total, row) => total + Number(row[key] ?? 0), 0);
  const releasedAt = new Date().toISOString();

  const { data: released, error: runError } = await service
    .from("analysis_runs")
    .update({
      status: "failed",
      error_message: message,
      actual_cost: costs.actualUsd,
      // The settlement (0114) books this when the price is unknown.
      ...(costs.chargedUsd === null
        ? {}
        : {
            validation_result: {
              ...validationRecord,
              ok: false,
              costCurrency: "USD",
              budget: {
                ...(budget && typeof budget === "object" && !Array.isArray(budget) ? budget : {}),
                chargedUsd: costs.chargedUsd,
                actualUsd: costs.actualUsd,
              },
            },
          }),
      input_tokens: sum("input_tokens") || null,
      output_tokens: sum("output_tokens") || null,
      token_usage: sum("total_tokens") || null,
      completed_at: releasedAt,
    })
    .eq("id", runId)
    .eq("fund_id", fundId)
    .in("status", ["queued", "running"])
    .select("id")
    .maybeSingle();
  if (runError) throw new Error(runError.message);
  if (!released) return false;

  const writes = await Promise.all([
    service
      .from("analysis_jobs")
      .update({
        status: "failed",
        last_error: message,
        locked_at: null,
        locked_by: null,
        updated_at: releasedAt,
      })
      .eq("run_id", runId)
      .eq("fund_id", fundId),
    service
      .from("analysis_run_steps")
      .update({ status: "failed", error_message: message, completed_at: releasedAt })
      .eq("run_id", runId)
      .eq("fund_id", fundId)
      .in("status", ["queued", "running"]),
    input.caseId
      ? service
          .from("cases")
          .update({ execution_status: "failed", updated_at: releasedAt })
          .eq("id", input.caseId)
          .eq("fund_id", fundId)
      : Promise.resolve({ error: null }),
  ]);
  const writeError = writes.find((write) => write.error)?.error;
  if (writeError) {
    console.error(
      `[${input.logTag}] stale job/steps not released (run ${runId})`,
      writeError.message,
    );
  }
  console.warn(`[${input.logTag}] stale run released (fund ${fundId}, run ${runId})`);
  return true;
}

/** What `releaseStalledFundRuns` reads of a run. */
export interface OpenRunRow {
  id: string;
  kind: string;
  case_id: string | null;
  created_at: string;
  started_at: string | null;
}

/** A run's step times (`deepRunReleasable`, `runStalled`). */
export interface OpenRunStepRow {
  run_id: string;
  started_at: string | null;
  completed_at: string | null;
}

/**
 * The open runs that stand still: a screening started more than `STALE_SCREENING_MS` ago (the rule
 * of a new start on the same case, screening.functions.ts) and with no new step for
 * `RUN_STALL_MS`, so a late but living run on another case is never closed; a deep analysis with no
 * new step for `STALE_DEEP_MS` (`deepRunReleasable`). `steps` is null when the steps could not be
 * read: then no run is judged. An unreadable time never counts as stalled.
 */
export function stalledRuns(
  runs: readonly OpenRunRow[],
  steps: readonly OpenRunStepRow[] | null,
  nowMs: number,
): OpenRunRow[] {
  if (steps === null) return [];
  return runs.filter((run) => {
    const times = {
      startedAt: run.created_at,
      steps: steps
        .filter((step) => step.run_id === run.id)
        .map((step) => ({ startedAt: step.started_at, completedAt: step.completed_at })),
    };
    if (run.kind === "screening") {
      return (
        nowMs - Date.parse(run.started_at ?? run.created_at) > STALE_SCREENING_MS &&
        runStalled(times, nowMs)
      );
    }
    return run.kind === "deep" && deepRunReleasable(times, nowMs);
  });
}

/**
 * (C4-8): closes the team's runs that stand still, on every case, before a new run is
 * planned against the team's monthly limit. A run that stands still keeps its whole reservation,
 * and the database lets it go only after 24 hours (0077), so one dead run on another case could
 * refuse every new run for a day. Which runs stand still is `stalledRuns`. A closed run is settled
 * with what its steps paid (0114, 0131), and a deep one becomes case knowledge like any failed run
 * .
 *
 * Returns how many runs were closed. Never throws: a run that could not be read or closed is
 * logged, and the month is then read as it is (the new run may be refused, as before).
 */
export async function releaseStalledFundRuns(
  service: SupabaseClient,
  fundId: string,
  nowMs: number = Date.now(),
): Promise<number> {
  let candidates: OpenRunRow[];
  try {
    // A run cannot have stood still for longer than it has existed.
    const quietSince = new Date(nowMs - Math.min(STALE_SCREENING_MS, STALE_DEEP_MS)).toISOString();
    const { data, error } = await service
      .from("analysis_runs")
      .select("id, kind, case_id, created_at, started_at")
      .eq("fund_id", fundId)
      .in("kind", ["screening", "deep"])
      .in("status", ["queued", "running"])
      .lt("created_at", quietSince);
    if (error) throw new Error(error.message);
    candidates = (data ?? []) as OpenRunRow[];
  } catch (cause) {
    console.error(`[run-release] open runs not read (fund ${fundId})`, errorText(cause));
    return 0;
  }
  if (candidates.length === 0) return 0;

  // The runs' steps in one read; without them no run is judged.
  let steps: OpenRunStepRow[] | null;
  try {
    const { data, error } = await service
      .from("analysis_run_steps")
      .select("run_id, started_at, completed_at")
      .eq("fund_id", fundId)
      .in(
        "run_id",
        candidates.map((run) => run.id),
      );
    if (error) throw new Error(error.message);
    steps = (data ?? []) as OpenRunStepRow[];
  } catch (cause) {
    console.error(`[run-release] steps not read (fund ${fundId})`, errorText(cause));
    steps = null;
  }

  let released = 0;
  for (const run of stalledRuns(candidates, steps, nowMs)) {
    const deep = run.kind === "deep";
    try {
      const closed = await releaseStalledRun(service, {
        fundId,
        runId: run.id,
        message: serverText(
          deep ? "analysisServer.deep.released" : "analysisServer.screening.released",
        ),
        ...(deep && run.case_id ? { caseId: run.case_id } : {}),
        logTag: deep ? "deep" : "screening",
      });
      if (!closed) continue;
      released += 1;
      if (deep) await captureReleasedRun(run.id);
    } catch (cause) {
      console.error(`[run-release] stalled run ${run.id} not released`, errorText(cause));
    }
  }
  return released;
}

/** Like a deep run released on its own case (deep.functions.ts). Never throws. */
async function captureReleasedRun(runId: string): Promise<void> {
  try {
    const { enqueueBrainCaptureForRun } = await import("../brain/queue.server");
    await enqueueBrainCaptureForRun(runId);
  } catch (cause) {
    console.error(`[run-release] capture for run ${runId} not queued`, errorText(cause));
  }
}

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
