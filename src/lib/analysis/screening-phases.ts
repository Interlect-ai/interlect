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
  };
}
