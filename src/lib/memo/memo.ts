/**
 * The committee memo's stored data (spec): the
 * proposer's input, the answers to "Mangler før komiteen" and the memo's versions (migration 0132).
 * Pure rules and shapes, no I/O, so they are tested on their own and shared by the server
 * functions (`memo.functions.ts`) and the sheet. The limits match the database's checks.
 */
import { z } from "zod";
import type { Capability } from "../domain/workflow.ts";
import { OVERRIDE_REASON_MIN } from "../cases/gate-answer.ts";

/** Admin, Lead and Medlem write (they move a case to the committee); Læser only reads. */
export const MEMO_WRITE_CAPABILITY: Capability = "move_process_stage";

export const MEMO_RATIONALE_MAX = 8000;
export const MEMO_BELIEF_COMMENTS_MAX = 50;
export const MEMO_BELIEF_KEY_MAX = 120;
export const MEMO_BELIEF_COMMENT_MAX = 2000;
/** "Ikke nødvendigt" needs a reason this long, the same rule as a mandate answer (gate-answer.ts). */
export const MEMO_GAP_REASON_MIN = OVERRIDE_REASON_MIN;
export const MEMO_GAP_REASON_MAX = 2000;
export const MEMO_SECTIONS_MAX = 40;
export const MEMO_SECTION_MAX = 20000;
/** A gap's key from `memoGaps`, e.g. "customer_references". */
export const MEMO_GAP_KEY = /^[a-z0-9][a-z0-9_.:-]{0,119}$/;
/** A section's key in a version, e.g. "recommendation" or "thesis". */
export const MEMO_SECTION_KEY = /^[a-z0-9_]{1,60}$/;

export const memoGapStates = ["filled", "not_needed"] as const;
export type MemoGapState = (typeof memoGapStates)[number];
export type MemoVersionStatus = "draft" | "approved";

export interface MemoInput {
  id: string;
  rationale: string;
  /** One optional comment per belief in "Thesis and what must be believed", by the belief's key. */
  beliefComments: Record<string, string>;
  /** Who last saved the proposal (null when that person was deleted). */
  authorId: string | null;
  updatedAt: string;
}

export interface MemoGapAnswer {
  id: string;
  gapKey: string;
  state: MemoGapState;
  reason: string | null;
  answeredBy: string | null;
  answeredAt: string;
}

export interface MemoVersion {
  id: string;
  /** The deep analysis the memo is built on. */
  analysisRunId: string;
  version: number;
  /** Prose per section (numbers and charts come from code, never from here). */
  sections: Record<string, string>;
  /** "approved" is frozen: the database refuses any later change. */
  status: MemoVersionStatus;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
}

const text = (value: unknown): string => (typeof value === "string" ? value : "");
const textOrNull = (value: unknown): string | null => (typeof value === "string" ? value : null);

/** Only string values survive: anything else in a stored object is not the memo's text. */
function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

export const MEMO_INPUT_COLUMNS = "id, rationale, belief_comments, author_id, updated_at";
export const MEMO_GAP_COLUMNS = "id, gap_key, state, reason, answered_by, answered_at";
export const MEMO_VERSION_COLUMNS =
  "id, analysis_run_id, version, sections, status, created_by, created_at, updated_at, approved_by, approved_at";

export function memoInputFrom(row: Record<string, unknown>): MemoInput {
  return {
    id: text(row["id"]),
    rationale: text(row["rationale"]),
    beliefComments: stringRecord(row["belief_comments"]),
    authorId: textOrNull(row["author_id"]),
    updatedAt: text(row["updated_at"]),
  };
}

export function memoGapAnswerFrom(row: Record<string, unknown>): MemoGapAnswer {
  return {
    id: text(row["id"]),
    gapKey: text(row["gap_key"]),
    state: row["state"] === "not_needed" ? "not_needed" : "filled",
    reason: textOrNull(row["reason"]),
    answeredBy: textOrNull(row["answered_by"]),
    answeredAt: text(row["answered_at"]),
  };
}

export function memoVersionFrom(row: Record<string, unknown>): MemoVersion {
  return {
    id: text(row["id"]),
    analysisRunId: text(row["analysis_run_id"]),
    version: Number(row["version"]),
    sections: stringRecord(row["sections"]),
    status: row["status"] === "approved" ? "approved" : "draft",
    createdBy: textOrNull(row["created_by"]),
    createdAt: text(row["created_at"]),
    updatedAt: text(row["updated_at"]),
    approvedBy: textOrNull(row["approved_by"]),
    approvedAt: textOrNull(row["approved_at"]),
  };
}

/** Comments trimmed, empty ones dropped (an emptied comment is removed, not stored as ""). */
export function cleanBeliefComments(comments: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(comments)
      .map(([key, comment]) => [key.trim(), comment.trim()] as const)
      .filter(([key, comment]) => key.length > 0 && comment.length > 0),
  );
}

/** The reason is enough for the answer: "not needed" needs MEMO_GAP_REASON_MIN code points. */
export function gapReasonOk(state: MemoGapState, reason: string | null | undefined): boolean {
  if (state !== "not_needed") return true;
  return Array.from((reason ?? "").trim()).length >= MEMO_GAP_REASON_MIN;
}

const ids = { fundId: z.guid(), caseId: z.guid() };

export const memoCaseSchema = z.object(ids);

export const memoInputSchema = z.object({
  ...ids,
  rationale: z.string().max(MEMO_RATIONALE_MAX),
  beliefComments: z
    .record(z.string().min(1).max(MEMO_BELIEF_KEY_MAX), z.string().max(MEMO_BELIEF_COMMENT_MAX))
    .refine((comments) => Object.keys(comments).length <= MEMO_BELIEF_COMMENTS_MAX)
    .default({}),
});

export const memoGapAnswerSchema = z.object({
  ...ids,
  gapKey: z.string().regex(MEMO_GAP_KEY),
  state: z.enum(memoGapStates),
  reason: z.string().max(MEMO_GAP_REASON_MAX).nullish(),
});

export const memoDraftSchema = z.object({
  ...ids,
  analysisRunId: z.guid(),
  sections: z
    .record(z.string().regex(MEMO_SECTION_KEY), z.string().max(MEMO_SECTION_MAX))
    .refine((sections) => Object.keys(sections).length <= MEMO_SECTIONS_MAX),
});

export const memoApproveSchema = z.object({ ...ids, versionId: z.guid() });

/**
 * The person's message for a refusal from the memo functions in the database (0132), which raise
 * Danish text starting "Komitémemo:"; null for anything else (the caller shows its general message).
 */
export type MemoRefusal =
  | "notFound"
  | "writeOnly"
  | "rationaleTooLong"
  | "beliefCommentsInvalid"
  | "gapKeyInvalid"
  | "gapStateInvalid"
  | "reasonTooShort"
  | "gapReasonTooLong"
  | "analysisNotOnCase"
  | "analysisNotComplete"
  | "sectionsInvalid"
  | "versionNotFound"
  | "alreadyApproved"
  | "frozen";

// i18n-keep: the database's own Danish refusals (0132), matched to a key, never shown as is.
const REFUSALS: ReadonlyArray<[string, MemoRefusal]> = [
  ["casen blev ikke fundet", "notFound"],
  ["kun Admin, Lead og Medlem", "writeOnly"],
  ["begrundelsen for manglen er for lang", "gapReasonTooLong"],
  ["begrundelsen er for lang", "rationaleTooLong"],
  ["kommentarerne til teserne", "beliefCommentsInvalid"],
  ["manglens nøgle", "gapKeyInvalid"],
  ["ukendt svar på en mangel", "gapStateInvalid"],
  ["begrundelse på mindst 10 tegn", "reasonTooShort"],
  ["analysen hører ikke til casen", "analysisNotOnCase"],
  ["færdig dyb analyse", "analysisNotComplete"],
  ["afsnittene skal være tekst", "sectionsInvalid"],
  ["versionen blev ikke fundet", "versionNotFound"],
  ["allerede godkendt", "alreadyApproved"],
  ["godkendt version kan ikke ændres", "frozen"],
];

export function memoRefusal(message: string | null | undefined): MemoRefusal | null {
  if (!message || !message.includes("Komitémemo:")) return null;
  return REFUSALS.find(([needle]) => message.includes(needle))?.[1] ?? null;
}
