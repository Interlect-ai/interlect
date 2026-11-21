import { getServiceClient } from "@/lib/supabase/admin.server";
import { serverText } from "@/lib/i18n/server-text";
import { loadReusablePublicResearch } from "./deep.functions";
import { hasEvidence } from "./evidence-sheet";
import { loadRunEvidenceSheet } from "./evidence-sheet.server";
import { specialistOutputSchema } from "./specialist.contracts";
import { DEEP_PROMPT_VERSION } from "./specialist-prompts";
import { specialistsTakenOver, type StoppedRunProgress } from "./run-continuation";

/**
 * What a deep run that stopped at its price limit finished, as a continuation takes it over:
 * the research and the evidence sheet as the worker reuses them, the specialists by
 * `specialistsTakenOver`. The start and every worker phase read it the same, so the run reserves and
 * may use the same parts. A failed read throws: money is at stake, and a guess would either reserve
 * the whole run again or give a finished part nothing.
 */
export async function loadStoppedRunProgress(
  service: ReturnType<typeof getServiceClient>,
  stoppedRunId: string,
  input: { specialistIds: readonly string[]; model: string },
): Promise<StoppedRunProgress> {
  const [research, sheet, steps] = await Promise.all([
    loadReusablePublicResearch(service, stoppedRunId, true),
    loadRunEvidenceSheet(service, stoppedRunId),
    service
      .from("analysis_run_steps")
      .select("step_key, status, model_name, prompt_version, output_json")
      .eq("run_id", stoppedRunId)
      .in("step_key", [...input.specialistIds]),
  ]);
  if (steps.error) throw new Error(serverText("analysisServer.deep.stepsNotLoaded"));
  return {
    researchDone: research !== null,
    evidenceSheetDone: sheet !== null && hasEvidence(sheet),
    specialistsDone: specialistsTakenOver(steps.data ?? [], {
      specialistIds: input.specialistIds,
      model: input.model,
      promptVersion: DEEP_PROMPT_VERSION,
      isPacket: (output) => specialistOutputSchema.safeParse(output).success,
    }),
  };
}
