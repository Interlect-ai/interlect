/**
 * The screening runs in two functions, the research phase (the request's waitUntil) and the
 * analysis phase (the hosted queue, topic interlect-screening). This module holds the pure parts of
 * the hand-off: what the research phase leaves on its step for the analysis phase, and when the
 * analysis phase may claim its step. The phases themselves are in screening.functions.ts.
 */
import { MAX_STEP_ATTEMPTS } from "./deep-claim.ts";
import { FUNCTION_MAX_DURATION_SECONDS } from "./deep-text-rules.ts";
import { readStoredEvidenceSheet, type EvidenceSheet } from "./evidence-sheet.ts";
import { readStoredResearchFollowUp, type ResearchFollowUp } from "./research-followup.ts";
import { readStoredResearchTracks, type StoredResearchTrack } from "./research-tracks.ts";
import { readSetupStageChoice, type SetupStageChoice } from "./setup-stage.ts";

/** A delivery after a crash may take over a step that has been "running" longer than this. */
export const SCREENING_ANALYSIS_STALE_MS = (FUNCTION_MAX_DURATION_SECONDS + 30) * 1_000;

export type ScreeningClaim =
  /** Queued: this delivery runs the phase. */
  | "claim"
  /** Running past any function's lifetime: the function that had it is gone. */
  | "take_over"
  /** Running inside a live function's lifetime: deliver again later. */
  | "busy"
  /** Missing, complete or failed: nothing to do. */
  | "done"
  /**
   * Gone, but already started MAX_STEP_ATTEMPTS times: every start may pay for the fund-fit call,
   * so a crash loop fails the run instead of paying again (as decideStepClaim in the deep worker).
   */
  | "exhausted";

export function screeningClaimDecision(
  step: { status: string; startedAt: string | null; attemptCount: number | null } | null,
  nowMs: number,
): ScreeningClaim {
  if (!step) return "done";
  if (step.status === "queued") return "claim";
  if (step.status !== "running") return "done";
  const startedAt = Date.parse(step.startedAt ?? "");
  // A running step without a start time cannot be judged; treat it as gone.
  const gone = Number.isNaN(startedAt) || nowMs - startedAt > SCREENING_ANALYSIS_STALE_MS;
  if (!gone) return "busy";
  return Number(step.attemptCount ?? 0) >= MAX_STEP_ATTEMPTS ? "exhausted" : "take_over";
}

export interface PromptFounder {
  name: string;
  role: string;
  linkedinUrl: string | null;
}

export function readPromptFounders(value: unknown): PromptFounder[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const founder = item as { name?: unknown; role?: unknown; linkedinUrl?: unknown } | null;
    if (!founder || typeof founder.name !== "string" || !founder.name.trim()) return [];
    return [
      {
        name: founder.name,
        role: typeof founder.role === "string" ? founder.role : "",
        linkedinUrl: typeof founder.linkedinUrl === "string" ? founder.linkedinUrl : null,
      },
    ];
  });
}

/** What the analysis phase reads back from the research step. */
export interface ResearchHandOff {
  actualCostUsd: number | null;
  /** What the research and the sheet charged against the budget. */
  chargeUsd: number;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  founders: PromptFounder[];
  followUp: ResearchFollowUp | null;
  evidenceSheet: EvidenceSheet | null;
  /** The stage the research was planned for (null for a version with nothing per stage). */
  setupStage: SetupStageChoice | null;
}

const numberOrNull = (value: unknown) => {
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

/**
 * The research step as the analysis phase reads it. A step without the saved charge (it cannot
 * happen, but a row is data) counts the whole research budget, never 0.
 */
export function readResearchHandOff(
  step: {
    output_json: unknown;
    actual_cost: unknown;
    input_tokens: unknown;
    output_tokens: unknown;
    total_tokens: unknown;
  },
  researchBudgetUsd: number,
): ResearchHandOff {
  const stored = (step.output_json ?? {}) as Record<string, unknown>;
  const charge = numberOrNull(stored["researchChargeUsd"]);
  return {
    actualCostUsd: numberOrNull(step.actual_cost),
    chargeUsd: charge != null && charge >= 0 ? charge : researchBudgetUsd,
    inputTokens: numberOrNull(step.input_tokens),
    outputTokens: numberOrNull(step.output_tokens),
    totalTokens: numberOrNull(step.total_tokens),
    founders: readPromptFounders(stored["promptFounders"]),
    followUp: readStoredResearchFollowUp(stored["researchFollowUp"]),
    evidenceSheet: readStoredEvidenceSheet(stored["evidenceSheet"]),
    setupStage: readSetupStageChoice(stored["setupStage"]),
  };
}

/** The research of a screening that stopped at its limit, as the next try takes it over. */
export interface StoppedResearch {
  output: Record<string, unknown>;
  evidenceIds: string[];
}

/** Research this old is searched again: a stopped run is continued soon, or not at all. */
const STOPPED_RESEARCH_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

type StoppedRun = {
  status?: unknown;
  stop_reason?: unknown;
  config_version_id?: unknown;
  prompt_template_version?: unknown;
  input_evidence_ids?: unknown;
  completed_at?: unknown;
};
type StoppedStep = {
  status?: unknown;
  output_json?: unknown;
  prompt_version?: unknown;
  model_name?: unknown;
} | null;
type StoppedCurrent = {
  configVersionId: string;
  promptVersion: string;
  researchVersion: string;
  researchModel: string;
  /** Evidence or documents added to the case since the run stopped. */
  newerMaterial: boolean;
  now: number;
};

/** The newest run stopped at its limit, recently, on the same setup, and nothing came since. */
function stoppedRunCarriesOver(run: StoppedRun, step: StoppedStep, current: StoppedCurrent) {
  if (run.status !== "failed" || run.stop_reason !== "price_limit") return false;
  if (run.config_version_id !== current.configVersionId) return false;
  if (run.prompt_template_version !== current.promptVersion) return false;
  if (current.newerMaterial) return false;
  const stoppedAt = Date.parse(String(run.completed_at));
  if (!Number.isFinite(stoppedAt) || current.now - stoppedAt > STOPPED_RESEARCH_MAX_AGE_MS) {
    return false;
  }
  if (!step) return false;
  if (step.prompt_version !== current.researchVersion) return false;
  return step.model_name === current.researchModel;
}

/**
 * The research is reused only from the newest run, when that run stopped at its limit, on the same
 * setup, prompt and research version, and its research was finished and handed over. Nothing may
 * have come to the case since: the old research never read a deck or a note added after the stop.
 * Any other failure runs the research again, as before.
 */
export function stoppedResearchToReuse(
  run: StoppedRun,
  step: StoppedStep,
  current: StoppedCurrent,
): StoppedResearch | null {
  if (!stoppedRunCarriesOver(run, step, current) || step?.status !== "complete") return null;
  const output = step.output_json as Record<string, unknown> | null;
  if (!output || numberOrNull(output["researchChargeUsd"]) === null) return null;
  const evidenceIds = Array.isArray(run.input_evidence_ids)
    ? (run.input_evidence_ids as string[]).filter(Boolean)
    : [];
  return evidenceIds.length > 0 ? { output, evidenceIds } : null;
}

/**
 * The run stopped inside its research. The tracks it finished before the stop are taken
 * over by the next try on the same terms as a finished research, so only the missing ones are paid.
 */
export function stoppedTracksToReuse(
  run: StoppedRun,
  step: StoppedStep,
  current: StoppedCurrent,
): StoredResearchTrack[] {
  if (!stoppedRunCarriesOver(run, step, current) || step?.status === "complete") return [];
  const output = step?.output_json as Record<string, unknown> | null | undefined;
  return readStoredResearchTracks(output?.["researchTracks"]);
}

/**
 * The research step as the next try keeps it: it costs nothing there, and a failed deck reading is
 * counted once, on the run that made the call, so a later research still tries the deck's pages.
 */
export function reusedResearchOutput(output: Record<string, unknown>): Record<string, unknown> {
  const deckOcr = output["deckOcr"] as Record<string, unknown> | null | undefined;
  return {
    ...output,
    researchChargeUsd: 0,
    ...(deckOcr ? { deckOcr: { ...deckOcr, callFailed: false } } : {}),
  };
}
