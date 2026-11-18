/** Shared types for the Opret case flow. */
import type { IntakeStage } from "@/lib/cases/intake-mandate";
import type { MessageKey } from "@/lib/i18n/translate";

/** What the user has typed and attached on the first screen. Held in the browser only. */
export interface IntakeDraft {
  /** Company name or CVR, as typed. */
  query: string;
  /** Website, as typed (normalised only when the server uses it). */
  website: string;
  notes: string;
  /** Pitch decks: kept in the browser until the case exists, then uploaded per case. */
  files: File[];
}

export const EMPTY_DRAFT: IntakeDraft = { query: "", website: "", notes: "", files: [] };

export type IntakeStep = "start" | "find" | "confirm" | "run";

export const INTAKE_STEPS: readonly IntakeStep[] = ["start", "find", "confirm", "run"];

/** Dictionary keys for the step labels; translate at render. */
export const INTAKE_STEP_LABEL_KEYS: Record<IntakeStep, MessageKey> = {
  start: "intake.steps.start",
  find: "intake.steps.find",
  confirm: "intake.steps.confirm",
  run: "intake.steps.run",
};

/**
 * The facts on Bekræft (prefilled from the verified match, editable). Stage and sector are
 * "Ukendt" until the screening has read the material; nothing is guessed.
 */
export interface ConfirmFacts {
  /** Only asked for when no company was picked (the typed text is a CVR or empty). */
  name: string;
  sector: string;
  stage: IntakeStage;
  country: string;
  website: string;
}

/** What survives going back and forth between steps, and "Opret en til" (except the note). */
export interface ConfirmExtras {
  /** The theses (funds) to screen against; one isolated case each. */
  fundIds: string[];
  sourceKind: string | null;
  assignedTo: string | null;
  /** "Hvorfor kigger I på selskabet?" */
  sourceNote: string;
}

/** The split button's three actions. `screen_then_review` starts ONLY the screening. */
export type StartAction = "screen" | "screen_then_review" | "create";

export const SOURCE_KINDS: ReadonlyArray<{ key: string; labelKey: MessageKey }> = [
  { key: "inbound", labelKey: "intake.sourceKind.inbound" },
  { key: "network", labelKey: "intake.sourceKind.network" },
  { key: "event", labelKey: "intake.sourceKind.event" },
  { key: "outbound", labelKey: "intake.sourceKind.outbound" },
  { key: "co_investor", labelKey: "intake.sourceKind.co_investor" },
];
