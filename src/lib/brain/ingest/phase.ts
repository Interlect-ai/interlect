/**
 * What the Kilder list shows for a source ("UI viser en fremdriftslinje"): one phase word and a
 * progress fraction from the row's own fields. Pure, so the list and its tests agree.
 */
import { translate, type MessageKey } from "../../i18n/translate.ts";
import type { Language } from "../../i18n/language.ts";

export type SourcePhase =
  "uploading" | "awaiting_approval" | "queued" | "working" | "review" | "ready" | "failed";

export interface PhaseInput {
  status: string;
  uploadCompletedAt: string | null;
  approvedAt: string | null;
}

const PROGRESS: Record<string, number> = {
  queued: 0,
  extracting: 0.1,
  classifying: 0.25,
  chunking: 0.4,
  embedding: 0.6,
  extracting_facts: 0.8,
  linking: 0.95,
  review: 1,
  ready: 1,
  failed: 0,
};

export function sourcePhase(input: PhaseInput): SourcePhase {
  if (!input.uploadCompletedAt) return "uploading";
  if (input.status === "failed") return "failed";
  if (input.status === "ready") return "ready";
  if (input.status === "review") return "review";
  if (!input.approvedAt) return "awaiting_approval";
  if (input.status === "queued") return "queued";
  return "working";
}

/** 0 to 1 for the progress bar. A failed source keeps the bar where it stopped (the caller passes the failed step's value). */
export function sourceProgress(status: string): number {
  return PROGRESS[status] ?? 0;
}

export const PHASE_KEYS: Record<SourcePhase, MessageKey> = {
  uploading: "brainKnowledge.ingest.phase.uploading",
  awaiting_approval: "brainKnowledge.ingest.phase.awaiting_approval",
  queued: "brainKnowledge.ingest.phase.queued",
  working: "brainKnowledge.ingest.phase.working",
  review: "brainKnowledge.ingest.phase.review",
  ready: "brainKnowledge.ingest.phase.ready",
  failed: "brainKnowledge.ingest.phase.failed",
};

export const STEP_KEYS: Record<string, MessageKey> = {
  extract: "brainKnowledge.ingest.step.extract",
  classify: "brainKnowledge.ingest.step.classify",
  chunk: "brainKnowledge.ingest.step.chunk",
  embed: "brainKnowledge.ingest.step.embed",
  facts: "brainKnowledge.ingest.step.facts",
  link: "brainKnowledge.ingest.step.link",
};

/** The phase word in a language (Danish by default). */
export const phaseLabel = (phase: SourcePhase, language: Language = "da"): string =>
  translate(language, PHASE_KEYS[phase]);

/** The step word in a language, or undefined for a step it does not know. */
export const stepLabel = (step: string, language: Language = "da"): string | undefined =>
  STEP_KEYS[step] ? translate(language, STEP_KEYS[step]) : undefined;

/** The Danish words (kept for callers that do not know the language). */
export const PHASE_LABELS: Record<SourcePhase, string> = Object.fromEntries(
  Object.entries(PHASE_KEYS).map(([phase, key]) => [phase, translate("da", key)]),
) as Record<SourcePhase, string>;

/** The step a source was in when it stopped, from its status (for "retry from the failed step"). */
export function failedStepForStatus(status: string): string | null {
  const steps: Record<string, string> = {
    extracting: "extract",
    classifying: "classify",
    chunking: "chunk",
    embedding: "embed",
    extracting_facts: "facts",
    linking: "link",
  };
  return steps[status] ?? null;
}
