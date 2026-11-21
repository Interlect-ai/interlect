/**
 * The research tracks that finished before a run stopped (at its limit, or on a failed
 * track) are kept on the run's research step at once, and the next try takes them over unpaid, so
 * "Fortsæt" pays only for the tracks that are missing. Only the track's own answer and the URLs the
 * search grounded it in are kept: never a model name, a price or a token count.
 */
import type { RequestBudgetEstimate } from "./budgets.ts";

export type ResearchTrackMode = "screening" | "deep";

export interface StoredResearchTrack {
  moduleId: string;
  mode: ResearchTrackMode;
  /** The track's answer as the search returned it (JSON text). */
  content: string;
  groundedUrls: string[];
}

/** What a track's search returns, as the research reads it. */
export interface TrackCompletion {
  content: string;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  actualCostUsd: number | null;
  estimatedMaximumUsd: RequestBudgetEstimate;
  groundedUrls: Set<string>;
}

const NOTHING_PAID: RequestBudgetEstimate = {
  maxCostUsd: 0,
  maxInputTokens: 0,
  maxOutputTokens: 0,
};

/** A kept track as this run's completion: it costs nothing here, it was paid on the run before. */
export function reusedTrackCompletion(track: StoredResearchTrack): TrackCompletion {
  return {
    content: track.content,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    actualCostUsd: 0,
    estimatedMaximumUsd: NOTHING_PAID,
    groundedUrls: new Set(track.groundedUrls),
  };
}

/**
 * Runs every track: a track kept from an earlier try of the same mode is taken over, the rest are
 * searched (and paid). The result is in the order of `modules`, as `Promise.allSettled` gives it.
 */
export async function runResearchTracks<M extends { id: string }>(
  modules: readonly M[],
  mode: ResearchTrackMode,
  reuse: readonly StoredResearchTrack[] | null | undefined,
  search: (module: M) => Promise<TrackCompletion>,
): Promise<Array<PromiseSettledResult<TrackCompletion>>> {
  const kept = new Map(
    (reuse ?? []).filter((track) => track.mode === mode).map((track) => [track.moduleId, track]),
  );
  return Promise.allSettled(
    modules.map((module) => {
      const track = kept.get(module.id);
      return track ? Promise.resolve(reusedTrackCompletion(track)) : search(module);
    }),
  );
}

/** The tracks that finished on this try (taken over or new), as the run keeps them. */
export function finishedTracks<M extends { id: string }>(
  modules: readonly M[],
  mode: ResearchTrackMode,
  attempts: ReadonlyArray<PromiseSettledResult<TrackCompletion>>,
  /** Only an answer the research can use is kept; a kept bad answer would fail every retry. */
  usable: (module: M, completion: TrackCompletion) => boolean = () => true,
): StoredResearchTrack[] {
  return attempts.flatMap((attempt, index) =>
    attempt.status === "fulfilled" && usable(modules[index]!, attempt.value)
      ? [
          {
            moduleId: modules[index]!.id,
            mode,
            content: attempt.value.content,
            groundedUrls: [...attempt.value.groundedUrls],
          },
        ]
      : [],
  );
}

/** The kept tracks read back from a step's stored output; anything malformed is left out. */
export function readStoredResearchTracks(value: unknown): StoredResearchTrack[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): StoredResearchTrack[] => {
    if (!item || typeof item !== "object") return [];
    const track = item as Record<string, unknown>;
    if (
      typeof track["moduleId"] !== "string" ||
      (track["mode"] !== "screening" && track["mode"] !== "deep") ||
      typeof track["content"] !== "string" ||
      !Array.isArray(track["groundedUrls"])
    ) {
      return [];
    }
    return [
      {
        moduleId: track["moduleId"],
        mode: track["mode"],
        content: track["content"],
        groundedUrls: (track["groundedUrls"] as unknown[]).filter(
          (url): url is string => typeof url === "string",
        ),
      },
    ];
  });
}

/** Tracks this old are searched again, as a stopped screening's research. */
export const KEPT_TRACKS_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Deep analysis: the kept tracks the next try may take over. Only from the same research
 * model and version, and, from another run, only when that run stopped at its limit recently (a
 * retry of this run's own phase needs no such check).
 */
export function deepTracksToReuse(
  step: { output_json?: unknown; model_name?: unknown; prompt_version?: unknown } | null,
  otherRun: { stop_reason?: unknown; completed_at?: unknown } | null,
  current: { model: string; version: string; now: number },
): StoredResearchTrack[] {
  if (!step || step.model_name !== current.model || step.prompt_version !== current.version) {
    return [];
  }
  if (otherRun) {
    if (otherRun.stop_reason !== "price_limit") return [];
    const stoppedAt = Date.parse(String(otherRun.completed_at));
    if (!Number.isFinite(stoppedAt) || current.now - stoppedAt > KEPT_TRACKS_MAX_AGE_MS) return [];
  }
  const output = step.output_json as Record<string, unknown> | null | undefined;
  return readStoredResearchTracks(output?.["researchTracks"]).filter(
    (track) => track.mode === "deep",
  );
}
