/**
 * The browser's side of `POST /api/fund-setup/draft`: reads the NDJSON stream,
 * keeps the waiting screen's progress, and turns a refusal or a broken stream into a fixed code
 * (the page has the words, never a raw error). Pure apart from `streamSetupDraft`'s fetch, which
 * takes its transport as an argument, so everything is tested without a browser.
 *
 * The waiting screen (prototype `busy`, `Teamopsaetning v3.dc.html`): first three steps for the
 * whole run ("Læser jeres tese", "Søger på nettet ...", "Samler det, I selv har skrevet"), then
 * five steps per stage, one stage on show at a time. The orb is `searching` while the draft
 * reads and searches, then `searching → solving → composing` through each stage's steps.
 */
import type { OrbState } from "thinking-orbs";
import type { SetupStage } from "../analysis/setup-stage.ts";
import { splitNdjson } from "../brain/chat-contract.ts";
import type { SetupDraftEvent } from "./setup-draft.server.ts";
import type { SetupDraftRequest, StageDraft } from "./setup-draft.ts";

export type SetupDraftRefusal =
  "forbidden" | "bad_request" | "no_stage" | "draft_not_found" | "credits" | "limit" | "failed";

export type SetupDraftClientEvent =
  | SetupDraftEvent
  | { type: "error"; code: "failed" }
  | { type: "refused"; code: SetupDraftRefusal };

const REFUSALS: readonly SetupDraftRefusal[] = [
  "forbidden",
  "bad_request",
  "no_stage",
  "draft_not_found",
  "credits",
  "limit",
  "failed",
];

function refusalFrom(status: number, body: unknown): SetupDraftRefusal {
  const code =
    body && typeof body === "object" && "code" in body
      ? (body as { code?: unknown }).code
      : undefined;
  const known = REFUSALS.find((candidate) => candidate === code);
  if (known) return known;
  return status === 401 || status === 403 ? "forbidden" : "failed";
}

const EVENT_TYPES = new Set([
  "start",
  "step",
  "stage_done",
  "stage_failed",
  "done",
  "stopped",
  "error",
]);

/** One line of the stream; a broken or unknown line is skipped (null). */
export function parseDraftLine(line: string): SetupDraftClientEvent | null {
  if (!line.trim()) return null;
  try {
    const event: unknown = JSON.parse(line);
    if (
      event &&
      typeof event === "object" &&
      typeof (event as { type?: unknown }).type === "string" &&
      EVENT_TYPES.has((event as { type: string }).type)
    ) {
      return event as SetupDraftClientEvent;
    }
  } catch {
    // skipped below
  }
  return null;
}

export const SETUP_DRAFT_ENDPOINT = "/api/fund-setup/draft";

/**
 * Starts the draft and yields its events. A refusal before the stream, a network failure or a
 * stream that ends without `done`, `stopped` or `error` ends with one `refused`/`error` event;
 * aborting ends quietly.
 */
export async function* streamSetupDraft(
  request: SetupDraftRequest,
  options: {
    getToken: () => Promise<string | null>;
    signal: AbortSignal;
    fetchImpl?: typeof fetch;
  },
): AsyncGenerator<SetupDraftClientEvent> {
  const doFetch = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    const token = await options.getToken();
    response = await doFetch(SETUP_DRAFT_ENDPOINT, {
      method: "POST",
      signal: options.signal,
      headers: {
        "content-type": "application/json",
        accept: "application/x-ndjson",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(request),
    });
  } catch {
    if (!options.signal.aborted) yield { type: "refused", code: "failed" };
    return;
  }
  if (!response.ok || !response.body) {
    const body: unknown = await response.json().catch(() => null);
    yield { type: "refused", code: refusalFrom(response.status, body) };
    return;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finished = false;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const { lines, rest } = splitNdjson(buffer);
      buffer = rest;
      for (const line of lines) {
        const event = parseDraftLine(line);
        if (!event) continue;
        yield event;
        if (event.type === "done" || event.type === "stopped" || event.type === "error") {
          finished = true;
        }
      }
      if (finished) return;
    }
    const last = parseDraftLine(buffer + decoder.decode());
    if (last) {
      yield last;
      if (last.type === "done" || last.type === "stopped" || last.type === "error") return;
    }
  } catch {
    if (options.signal.aborted) return;
  } finally {
    reader.cancel().catch(() => undefined);
  }
  if (!options.signal.aborted && !finished) yield { type: "error", code: "failed" };
}

// ---------------------------------------------------------------------------------------------
// What the waiting screen shows.
// ---------------------------------------------------------------------------------------------

export const PREPARE_STEPS = 3;
export const STAGE_STEPS = 5;

export interface DraftProgress {
  /** The stages being drafted, in the team's order. */
  stages: SetupStage[];
  /** How many of the three first steps are done; the next one is the current (3 = all done). */
  prepare: number;
  /** The stage being written now, and its current step (0-4). */
  current: SetupStage | null;
  step: number;
  /** Finished stages, with what the card says ("6 kriterier, 11 tal, 4 specialister"). */
  done: Partial<Record<SetupStage, { criteria: number; points: number; specialists: number }>>;
  failed: SetupStage[];
}

export function startProgress(stages: readonly SetupStage[]): DraftProgress {
  return { stages: [...stages], prepare: 0, current: null, step: 0, done: {}, failed: [] };
}

export function reduceProgress(
  progress: DraftProgress,
  event: SetupDraftClientEvent,
): DraftProgress {
  switch (event.type) {
    case "start":
      return { ...startProgress(event.stages) };
    case "step":
      if (event.phase === "prepare") {
        return { ...progress, prepare: Math.max(progress.prepare, event.step) };
      }
      return { ...progress, prepare: PREPARE_STEPS, current: event.stage, step: event.step };
    case "stage_done":
      return {
        ...progress,
        prepare: PREPARE_STEPS,
        done: { ...progress.done, [event.stage]: event.summary },
        current: progress.current === event.stage ? null : progress.current,
        step: 0,
      };
    case "stage_failed":
      return {
        ...progress,
        failed: progress.failed.includes(event.stage)
          ? progress.failed
          : [...progress.failed, event.stage],
        current: progress.current === event.stage ? null : progress.current,
        step: 0,
      };
    default:
      return progress;
  }
}

/** The orb's state: searching while it reads and searches, then through each stage's steps. */
export function orbStateOf(progress: DraftProgress): OrbState {
  if (progress.prepare < PREPARE_STEPS) return "searching";
  const states: OrbState[] = ["searching", "solving", "composing", "composing", "solving"];
  return states[progress.step] ?? "searching";
}

/** The finished drafts out of a run's events, in the order they arrived. */
export function collectDrafts(events: readonly SetupDraftClientEvent[]): StageDraft[] {
  const drafts: StageDraft[] = [];
  for (const event of events) {
    if (event.type === "stage_done") drafts.push(event.draft);
  }
  return drafts;
}
