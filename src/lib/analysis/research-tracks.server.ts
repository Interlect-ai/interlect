/** Keeping and reading back a run's finished research tracks (see `research-tracks.ts`). */
import type { getServiceClient } from "@/lib/supabase/admin.server";
import { PUBLIC_RESEARCH_MODEL, PUBLIC_RESEARCH_VERSION } from "./public-research";
import { deepTracksToReuse, type StoredResearchTrack } from "./research-tracks";

type ServiceClient = ReturnType<typeof getServiceClient>;

/**
 * The research tracks a deep run kept before its research stopped, so the next try takes
 * them over unpaid: this run's own (a retry of the phase) or, when `otherRun`, a run that stopped
 * at its limit. Empty when there are none or they no longer fit (see `deepTracksToReuse`).
 */
export async function loadReusableResearchTracks(
  service: ServiceClient,
  runId: string,
  otherRun: boolean,
): Promise<StoredResearchTrack[]> {
  const [step, run] = await Promise.all([
    service
      .from("analysis_run_steps")
      .select("output_json, model_name, prompt_version")
      .eq("run_id", runId)
      .eq("step_key", "public_research")
      .maybeSingle(),
    otherRun
      ? service
          .from("analysis_runs")
          .select("stop_reason, completed_at")
          .eq("id", runId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (step.error || run.error || (otherRun && !run.data)) return [];
  return deepTracksToReuse(step.data, otherRun ? run.data : null, {
    model: PUBLIC_RESEARCH_MODEL,
    version: PUBLIC_RESEARCH_VERSION,
    now: Date.now(),
  });
}

/**
 * Keeps the finished tracks on the run's research step while the research still runs,
 * beside what is already there (the research plan).
 */
export async function saveResearchTracksOnStep(
  service: ServiceClient,
  runId: string,
  stepKey: "public_research" | "screening_research",
  tracks: StoredResearchTrack[],
): Promise<void> {
  const { data: step, error: readError } = await service
    .from("analysis_run_steps")
    .select("output_json")
    .eq("run_id", runId)
    .eq("step_key", stepKey)
    .eq("status", "running")
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  if (!step) return;
  const before = step["output_json"];
  const kept = before && typeof before === "object" && !Array.isArray(before) ? before : {};
  const { error } = await service
    .from("analysis_run_steps")
    .update({ output_json: { ...kept, researchTracks: tracks } })
    .eq("run_id", runId)
    .eq("step_key", stepKey)
    .eq("status", "running");
  if (error) throw new Error(error.message);
}
