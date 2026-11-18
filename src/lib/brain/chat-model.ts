/**
 * The conversation as the UI holds it, pure: turns, how a stream event changes the
 * running answer, how stored messages become turns, and where a citation chip leads. No React,
 * no network; unit tested in `chat-model.test.ts`.
 */
import {
  chatErrorText,
  type BrainFeedbackRating,
  type BrainMessageDto,
  type ChatCitation,
  type ChatConfidence,
  type ChatErrorCode,
  type ChatStreamEvent,
} from "./chat-contract.ts";
import { safeExternalHref } from "./chat-text.ts";

export interface QuestionTurn {
  kind: "question";
  id: string;
  body: string;
  /** The @ context line, e.g. "Pleo". */
  context?: string | undefined;
}

export type AnswerStatus = "thinking" | "streaming" | "done" | "error";

export interface AnswerTurn {
  kind: "answer";
  id: string;
  status: AnswerStatus;
  steps: string[];
  activeStep: number;
  text: string;
  citations: ChatCitation[];
  messageId: string | null;
  confidence: ChatConfidence | null;
  missing: string[];
  unsourcedClaims: boolean;
  errorCode: ChatErrorCode | null;
  /** A stream event arrived (the engine is working on the question). */
  started: boolean;
  /**
   * Refused before the stream started (HTTP 4xx): the engine saved nothing, so "Prøv igen" may
   * replace the pair. Any other failure may have saved the question (the engine saves it before
   * the model runs), so a retry is added after it instead of duplicating it in the thread.
   */
  refused: boolean;
  /** The user pressed Stop: the server saves the shown text with the same note (STOPPED_NOTE). */
  stopped: boolean;
  /** This user's 👍/👎 (saved per answer and user). */
  feedback: BrainFeedbackRating | null;
  /** The case the answer is about (@ context or the thread's case): "Gem som note" goes there. */
  noteCase: NoteCase | null;
  /** The case name once "Gem som note" has saved it ("Gemt på Pleo"). */
  savedOn: string | null;
  /** "Gem i Brain" has saved the answer (this session; a loaded thread does not know). */
  savedToBrain?: boolean;
}

export interface NoteCase {
  id: string;
  name: string;
}

export type Turn = QuestionTurn | AnswerTurn;

export function newAnswerTurn(id: string): AnswerTurn {
  return {
    kind: "answer",
    id,
    status: "thinking",
    steps: [],
    activeStep: 0,
    text: "",
    citations: [],
    messageId: null,
    confidence: null,
    missing: [],
    unsourcedClaims: false,
    errorCode: null,
    started: false,
    refused: false,
    stopped: false,
    feedback: null,
    noteCase: null,
    savedOn: null,
  };
}

/** The result of one event. `threadId` is set by a `thread` event (a new thread was created). */
export function applyStreamEvent(
  turn: AnswerTurn,
  event: ChatStreamEvent,
): { turn: AnswerTurn; threadId?: { id: string; title: string | null } } {
  // Nothing after the end of an answer changes it.
  if (turn.status === "done" || turn.status === "error") return { turn };
  if (event.type !== "error" && event.type !== "done" && !turn.started) {
    turn = { ...turn, started: true };
  }
  switch (event.type) {
    case "thread":
      return { turn, threadId: { id: event.threadId, title: event.title } };
    case "step": {
      const steps = [...turn.steps];
      steps[event.index] = event.text;
      // A step that arrives after text has started is ignored for the orb but kept in order.
      const activeStep = turn.status === "thinking" ? event.index : turn.activeStep;
      return { turn: { ...turn, steps: steps.filter((s) => s !== undefined), activeStep } };
    }
    case "delta":
      return { turn: { ...turn, status: "streaming", text: turn.text + event.text } };
    case "sources":
      return { turn: { ...turn, citations: event.citations } };
    case "done":
      return {
        turn: {
          ...turn,
          status: "done",
          messageId: event.messageId,
          confidence: event.confidence ?? null,
          missing: event.missing ?? [],
          unsourcedClaims: event.unsourcedClaims === true,
        },
      };
    case "error":
      return {
        turn: {
          ...turn,
          status: "error",
          errorCode: event.code,
          refused: event.beforeStream === true && !turn.started,
        },
      };
  }
}

/** The stream ended or broke without a `done` or `error`: treat as a failed answer. */
export function failTurn(turn: AnswerTurn, code: ChatErrorCode = "failed"): AnswerTurn {
  if (turn.status === "done" || turn.status === "error") return turn;
  return { ...turn, status: "error", errorCode: code };
}

/** The user pressed Stop: keep what was written, marked as stopped (never a whole answer). */
export function stopTurn(turn: AnswerTurn): AnswerTurn {
  if (turn.status === "done" || turn.status === "error") return turn;
  return {
    ...turn,
    status: "done",
    stopped: true,
    unsourcedClaims: turn.citations.length === 0 && turn.text.length > 0,
  };
}

/**
 * Stored messages as turns (a loaded thread). Masked or empty messages stay readable. A thread
 * bound to a case (Spørg Interlect) gives every answer that case for "Gem som note"; the @ case
 * of a single question is not stored, so older answers in an unbound thread have none.
 */
export function turnsFromMessages(
  messages: readonly BrainMessageDto[],
  threadCase: NoteCase | null = null,
): Turn[] {
  return messages.map((message): Turn => {
    if (message.role === "user") return { kind: "question", id: message.id, body: message.content };
    return {
      ...newAnswerTurn(message.id),
      status: "done",
      started: true,
      text: message.content,
      citations: message.citations,
      messageId: message.id,
      feedback: message.myFeedback ?? null,
      noteCase: threadCase,
    };
  });
}

/** Actions are offered on a whole, saved answer only (never while it streams or after an error). */
export function answerIsActionable(turn: AnswerTurn): boolean {
  return turn.status === "done" && turn.messageId !== null && turn.text.trim().length > 0;
}

export function citationNumbers(citations: readonly ChatCitation[]): Set<number> {
  return new Set(citations.map((citation) => citation.n));
}

/**
 * The number each source is shown with: the order of first appearance in the answer,
 * from 1. The stored numbers stay as the server gave them (feedback and the answer episode use
 * them), but tools number every row they return, so an answer that cites only the fifth row
 * would otherwise start at [5]. Sources the text never cites follow in their stored order.
 */
export function citationDisplayNumbers(
  text: string,
  citations: readonly ChatCitation[],
): Map<number, number> {
  const stored = new Set(citations.map((citation) => citation.n));
  const shown = new Map<number, number>();
  for (const match of text.matchAll(/\[(\d{1,3}(?:\s*,\s*\d{1,3})*)\]/g)) {
    for (const part of (match[1] ?? "").split(",")) {
      const n = Number(part.trim());
      if (stored.has(n) && !shown.has(n)) shown.set(n, shown.size + 1);
    }
  }
  for (const citation of citations) {
    if (!shown.has(citation.n)) shown.set(citation.n, shown.size + 1);
  }
  return shown;
}

/** The line shown under an error turn (never the server's own text). */
export function errorLine(turn: AnswerTurn): string | null {
  return turn.status === "error" ? chatErrorText(turn.errorCode ?? "failed") : null;
}

// ---------------------------------------------------------------------------------------
// Citations → chips
// ---------------------------------------------------------------------------------------

export type CitationIcon = "case" | "note" | "fact" | "chunk" | "page" | "web" | "mandate";

export interface CitationTarget {
  n: number;
  label: string;
  icon: CitationIcon;
  /** An internal route or a safe external URL; null when the source opens as a quote card. */
  href: string | null;
  /** The source is shown as a card (quote and date) in the source dialog. */
  card: boolean;
  deleted: boolean;
}

export const DELETED_SOURCE_LABEL = "[kilde slettet]";

function caseHref(citation: ChatCitation, caseId: string): string {
  const table = citation.ref?.split(":")[0] ?? "";
  if (table === "case_notes") return `/cases/${caseId}?fane=noter`;
  if (table === "case_messages") return `/cases/${caseId}?fane=beskeder`;
  return `/cases/${caseId}`;
}

/** Where a chip leads. Only stored ids go into URLs; ids are checked to be uuids. */
export function citationTarget(citation: ChatCitation): CitationTarget {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const deleted = citation.deleted === true;
  const base = {
    n: citation.n,
    label: deleted ? DELETED_SOURCE_LABEL : citation.label,
    deleted,
  };
  if (deleted) return { ...base, icon: "chunk", href: null, card: false };
  if (citation.kind === "case" && uuid.test(citation.id)) {
    return { ...base, icon: "case", href: `/cases/${citation.id}`, card: false };
  }
  if (citation.kind === "event" && citation.caseId && uuid.test(citation.caseId)) {
    const note = citation.ref?.startsWith("case_notes:") === true;
    return {
      ...base,
      icon: note ? "note" : "case",
      href: caseHref(citation, citation.caseId),
      card: false,
    };
  }
  if (citation.kind === "web") {
    return { ...base, icon: "web", href: safeExternalHref(citation.ref), card: true };
  }
  if (citation.kind === "fact") return { ...base, icon: "fact", href: null, card: true };
  if (citation.kind === "page" || citation.kind === "bullet") {
    return { ...base, icon: "page", href: null, card: true };
  }
  return { ...base, icon: "chunk", href: null, card: true };
}
