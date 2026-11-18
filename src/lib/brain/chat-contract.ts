/**
 * The contract between the Brain chat UI (session A) and the chat engine (session B, `POST
 * /api/brain/chat`). Types and guards only; no runtime dependencies, so both the
 * browser and the server can import it and the rules are unit tested.
 *
 * STATUS: AGREED. Proposed by A, confirmed by B and built as the engine (PR #33, 4 Oct). A change
 * here is a change to both sides; the UI follows the file, never a guess about the engine.
 *
 * Request: `POST /api/brain/chat`, JSON body `ChatRequest`, the user's session cookie/bearer as
 * everywhere else. The server decides fund and role (`brain_chat`); the body's `fundId` is only
 * checked against the user's memberships. The model never sees or chooses `fundId`.
 *
 * Response: `200` with `content-type: application/x-ndjson`, ONE JSON object per line, each a
 * `ChatStreamEvent`. Order: `thread` (only for a new thread, first), then any number of `step`,
 * `delta` and (once, before `done`) `sources`, then exactly one `done` or `error`. Refusals
 * before the stream starts (not signed in, no role, bad body) are normal HTTP errors (401, 403,
 * 400); budget and Brain-off may be either an HTTP 409/429 with `{ code }` or an `error` event.
 *
 * Rules the UI relies on (principles):
 * - Brain never decides: no event changes a case, a score, a gate or the fund set-up.
 * - Only stored facts are cited: `[n]` in `delta` text is shown as a chip only when `sources`
 *   has an `n`; the server drops or marks claims without a source (`unsourcedClaims`).
 * - `delta.text` is model text and is always rendered as plain text (src/lib/brain/chat-text.ts).
 * - `error.message` is ignored by the UI; fixed Danish texts are shown (`chatErrorText`).
 */
import type { Language } from "../i18n/language.ts";
import { translate, type MessageKey } from "../i18n/translate.ts";

/** The engine `/api/brain/chat` is published (PR #33); the probe's `chat` still needs 0047. */
export const CHAT_ROUTE_READY = true;
export const BRAIN_CHAT_ENDPOINT = "/api/brain/chat";

export const CHAT_QUESTION_MAX = 4000;

/** Hurtig = chat_fast (gpt-5.4-mini), Grundig = chat_deep (gpt-5.4). */
export type ChatMode = "fast" | "deep";

export interface ChatRequest {
  fundId: string;
  /** null starts a new thread (the server creates it and answers with a `thread` event). */
  threadId: string | null;
  /** The case in context (a case thread, or an @ choice). Must belong to `fundId`. */
  caseId: string | null;
  /** @-chosen entities (brain_entities ids). */
  entityIds: string[];
  /** What Brain looks at: all the fund's cases (default) or the thesis (the active fund set-up). */
  scope: "cases" | "thesis";
  question: string;
  mode: ChatMode;
  /**
   * Web search: the queries the user approved. Absent or empty = no web search. The
   * server filters them again (src/lib/brain/web/queries.ts) and adds 1 kr to the question's cap.
   */
  webQueries?: string[] | undefined;
}

export type CitationKind = "chunk" | "fact" | "page" | "bullet" | "case" | "event" | "web";
export const CITATION_KINDS: readonly CitationKind[] = [
  "chunk",
  "fact",
  "page",
  "bullet",
  "case",
  "event",
  "web",
];

/** How much a source can be trusted; `company_claim` and `public_web` get a visible mark. */
export type CitationTrust = "verified" | "customer_doc" | "company_claim" | "public_web";
export const CITATION_TRUSTS: readonly CitationTrust[] = [
  "verified",
  "customer_doc",
  "company_claim",
  "public_web",
];

/** `brain_messages.citations[]` plus what the UI needs to open the source. */
export interface ChatCitation {
  n: number;
  kind: CitationKind;
  /** The id of the cited row (chunk, fact, page, case ...). */
  id: string;
  label: string;
  /** The verbatim quote (facts and chunks). */
  quote?: string | null;
  trust?: CitationTrust | null;
  /** The raw row it came from, "table:id" (episodes), used to find the target in the app. */
  ref?: string | null;
  /** The case it belongs to, when known. */
  caseId?: string | null;
  /** ISO date of the source. */
  at?: string | null;
  /** The source was forgotten ("Glem kilde"): shown as "[kilde slettet]". */
  deleted?: boolean;
}

export type ChatConfidence = "high" | "medium" | "low";

export type ChatErrorCode =
  | "budget_reached"
  | "disabled"
  | "forbidden"
  | "rate_limited"
  | "busy"
  | "failed"
  /** The data rules stopped the call before anything was sent (a model without ZDR). */
  | "blocked_by_policy"
  /** The browser's own code for HTTP 401 (no or expired session); the server never sends it. */
  | "signed_out";

export type ChatStreamEvent =
  | { type: "thread"; threadId: string; title: string | null }
  | { type: "step"; index: number; text: string }
  | { type: "delta"; text: string }
  | { type: "sources"; citations: ChatCitation[] }
  | {
      type: "done";
      messageId: string;
      confidence?: ChatConfidence | null;
      /** "Upload seneste statusrapport for at svare præcist". */
      missing?: string[];
      /** Some claims have no source (the server's citation check). */
      unsourcedClaims?: boolean;
    }
  | {
      type: "error";
      code: ChatErrorCode;
      message?: string;
      /**
       * Set by the browser's transport only (never by the server): the request was refused before
       * the stream started (HTTP 4xx), so the engine saved nothing.
       */
      beforeStream?: true;
    };

/** The browser's way to get a stream: the real one calls the route, the test engine is local. */
export type ChatTransport = (
  request: ChatRequest,
  signal: AbortSignal,
) => AsyncIterable<ChatStreamEvent>;

// ---------------------------------------------------------------------------------------
// Threads and messages as the UI reads them (server functions, RLS decides what is visible)
// ---------------------------------------------------------------------------------------

export type ThreadVisibility = "private" | "team";

export interface BrainThreadSummary {
  id: string;
  title: string | null;
  visibility: ThreadVisibility;
  caseId: string | null;
  /** The case's company name when the thread belongs to a case. */
  caseName: string | null;
  isMine: boolean;
  /** The owner's first name on team threads that are not mine. */
  ownerName: string | null;
  lastActivityAt: string;
}

/**
 * The user's own rating of an answer (`brain_feedback.rating`): 👍 = useful; 👎 = wrong, which
 * the reader may refine to "incomplete" (Mangler noget) or keep as "wrong" (Forkert, with the
 * sources that were wrong and a comment).
 */
export type BrainFeedbackRating = "useful" | "wrong" | "incomplete";

/** What 👎 may add: the cited sources that were wrong and a short comment. */
export interface BrainFeedbackDetails {
  wrongCitationNs: number[];
  comment: string;
}
export const FEEDBACK_COMMENT_MAX = 1000;

export interface BrainMessageDto {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations: ChatCitation[];
  usedWeb: boolean;
  createdAt: string;
  /** This user's own feedback on an answer (UI side only; the engine never reads it). */
  myFeedback?: BrainFeedbackRating | null;
}

export interface BrainThreadDetail {
  thread: BrainThreadSummary;
  messages: BrainMessageDto[];
}

// ---------------------------------------------------------------------------------------
// Guards: nothing from the network is trusted
// ---------------------------------------------------------------------------------------

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const str = (value: unknown, max = 100_000): string | null =>
  typeof value === "string" && value.length <= max ? value : null;

export function parseCitation(value: unknown): ChatCitation | null {
  if (!isRecord(value)) return null;
  const n = value["n"];
  if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > 999) return null;
  const kind = value["kind"];
  if (typeof kind !== "string" || !CITATION_KINDS.includes(kind as CitationKind)) return null;
  const id = str(value["id"], 200);
  const label = str(value["label"], 400);
  if (!id || label === null) return null;
  const trust = value["trust"];
  const optional = (key: string, max: number) => {
    const v = value[key];
    return typeof v === "string" && v.length <= max ? v : null;
  };
  // A forgotten source ("Glem kilde") must not stay readable through an old answer's quote.
  const deleted = value["deleted"] === true;
  return {
    n,
    kind: kind as CitationKind,
    id,
    label: label.trim() || "Kilde",
    quote: deleted ? null : optional("quote", 2000),
    trust:
      typeof trust === "string" && CITATION_TRUSTS.includes(trust as CitationTrust)
        ? (trust as CitationTrust)
        : null,
    ref: optional("ref", 300),
    caseId: optional("caseId", 100),
    at: optional("at", 40),
    deleted,
  };
}

const ERROR_CODES: readonly ChatErrorCode[] = [
  "budget_reached",
  "disabled",
  "forbidden",
  "rate_limited",
  "busy",
  "failed",
  "blocked_by_policy",
  "signed_out",
];

/** A parsed event, or null for anything that does not fit the contract (it is ignored). */
export function parseChatStreamEvent(value: unknown): ChatStreamEvent | null {
  if (!isRecord(value)) return null;
  switch (value["type"]) {
    case "thread": {
      const threadId = str(value["threadId"], 100);
      if (!threadId) return null;
      return { type: "thread", threadId, title: str(value["title"], 200) };
    }
    case "step": {
      const index = value["index"];
      const text = str(value["text"], 200);
      if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index > 20) {
        return null;
      }
      return text ? { type: "step", index, text } : null;
    }
    case "delta": {
      const text = str(value["text"]);
      return text ? { type: "delta", text } : null;
    }
    case "sources": {
      const raw = value["citations"];
      if (!Array.isArray(raw)) return null;
      const citations: ChatCitation[] = [];
      for (const item of raw.slice(0, 100)) {
        const parsed = parseCitation(item);
        if (parsed) citations.push(parsed);
      }
      return { type: "sources", citations };
    }
    case "done": {
      const messageId = str(value["messageId"], 100);
      if (!messageId) return null;
      const confidence = value["confidence"];
      const missing = Array.isArray(value["missing"])
        ? value["missing"]
            .filter((m): m is string => typeof m === "string" && m.length <= 300)
            .slice(0, 5)
        : [];
      return {
        type: "done",
        messageId,
        confidence:
          confidence === "high" || confidence === "medium" || confidence === "low"
            ? confidence
            : null,
        missing,
        unsourcedClaims: value["unsourcedClaims"] === true,
      };
    }
    case "error": {
      const code = value["code"];
      return {
        type: "error",
        code: ERROR_CODES.includes(code as ChatErrorCode) ? (code as ChatErrorCode) : "failed",
      };
    }
    default:
      return null;
  }
}

/** One NDJSON line to an event; empty, broken or unknown lines give null. */
export function parseChatStreamLine(line: string): ChatStreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    return parseChatStreamEvent(JSON.parse(trimmed));
  } catch {
    return null;
  }
}

/**
 * Splits a growing text buffer into complete lines and the unfinished rest, so a chunk that
 * ends mid-line is completed by the next chunk.
 */
export function splitNdjson(buffer: string): { lines: string[]; rest: string } {
  const parts = buffer.split("\n");
  const rest = parts.pop() ?? "";
  return { lines: parts, rest };
}

const CHAT_ERROR_KEYS: Record<ChatErrorCode, MessageKey> = {
  budget_reached: "brainChat.errors.budget_reached",
  disabled: "brainChat.errors.disabled",
  forbidden: "brainChat.errors.forbidden",
  signed_out: "brainChat.errors.signed_out",
  rate_limited: "brainChat.errors.rate_limited",
  busy: "brainChat.errors.busy",
  failed: "brainChat.errors.failed",
  blocked_by_policy: "brainChat.errors.blocked_by_policy",
};

/** Fixed texts for the errors the UI can show, in the fund's language; the server's own message is never shown. */
export function chatErrorText(code: ChatErrorCode, language: Language = "da"): string {
  return translate(language, CHAT_ERROR_KEYS[code]);
}

/** Mapping of an HTTP refusal before the stream starts to an error code. */
export function chatErrorFromStatus(status: number): ChatErrorCode {
  if (status === 401) return "signed_out";
  if (status === 403) return "forbidden";
  if (status === 409) return "disabled";
  if (status === 429) return "rate_limited";
  return "failed";
}

/**
 * What the server stores of a rating: wrong sources only for "wrong", and only numbers the
 * answer really cites; the comment is trimmed and dropped for 👍. Never trusts the browser.
 */
export function cleanFeedback(
  rating: BrainFeedbackRating,
  wrongCitationNs: readonly number[] | undefined,
  comment: string | undefined,
  citedNs: ReadonlySet<unknown>,
): { wrongCitationNs: number[]; comment: string | null } {
  const wrong =
    rating === "wrong"
      ? [...new Set(wrongCitationNs ?? [])].filter((n) => citedNs.has(n)).sort((a, b) => a - b)
      : [];
  const text = rating === "useful" ? "" : (comment ?? "").trim().slice(0, FEEDBACK_COMMENT_MAX);
  return { wrongCitationNs: wrong, comment: text || null };
}
