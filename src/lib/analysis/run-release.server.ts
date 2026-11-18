import type { SupabaseClient } from "@supabase/supabase-js";
import { stepRunCosts } from "./gateway-response.ts";

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
