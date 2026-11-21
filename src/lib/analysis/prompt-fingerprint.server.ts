import type { SupabaseClient } from "@supabase/supabase-js";
import { runPromptFingerprint } from "./prompt-fingerprint";

/*
 * The fingerprints are only traceability. They are written in their own updates, never
 * inside the ones that save a paid result: a failed write (a column the database does not have
 * yet while 0129 waits for the migration workflow, a network error) is logged and never loses or
 * fails the analysis.
 */

/** The fingerprint of one step's call (and the run's, when the run has only that call). */
export async function storePromptFingerprint(
  service: SupabaseClient,
  target: { runId: string; stepKey: string; alsoRun?: boolean },
  fingerprint: string | null,
): Promise<void> {
  if (!fingerprint) return;
  try {
    const writes = [
      service
        .from("analysis_run_steps")
        .update({ prompt_fingerprint: fingerprint })
        .eq("run_id", target.runId)
        .eq("step_key", target.stepKey),
      ...(target.alsoRun
        ? [
            service
              .from("analysis_runs")
              .update({ prompt_fingerprint: fingerprint })
              .eq("id", target.runId),
          ]
        : []),
    ];
    const results = await Promise.all(writes);
    if (results.some((result) => result.error)) {
      console.warn(`[prompt-fingerprint] run ${target.runId} ${target.stepKey}: not saved`);
    }
  } catch {
    console.warn(`[prompt-fingerprint] run ${target.runId} ${target.stepKey}: not saved`);
  }
}

/** The deep run's fingerprint from its specialists' and the synthesis' fingerprints. */
export async function storeRunPromptFingerprint(
  service: SupabaseClient,
  runId: string,
): Promise<void> {
  try {
    const { data, error } = await service
      .from("analysis_run_steps")
      .select("step_key, prompt_fingerprint")
      .eq("run_id", runId);
    if (error) {
      console.warn(`[prompt-fingerprint] run ${runId}: step fingerprints not read`);
      return;
    }
    const fingerprint = runPromptFingerprint(
      ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
        stepKey: String(row["step_key"]),
        fingerprint: (row["prompt_fingerprint"] as string | null) ?? null,
      })),
    );
    if (!fingerprint) return;
    const { error: updateError } = await service
      .from("analysis_runs")
      .update({ prompt_fingerprint: fingerprint })
      .eq("id", runId);
    if (updateError) console.warn(`[prompt-fingerprint] run ${runId}: not saved`);
  } catch {
    console.warn(`[prompt-fingerprint] run ${runId}: not saved`);
  }
}
