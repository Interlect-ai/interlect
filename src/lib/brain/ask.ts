/**
 * Small pure rules for Spørg Interlect ("Spørg Interlect"): what the page
 * tells the pill about itself, the texts and fixed suggestions for that context, and the
 * remembered "Skjul" choice. No React.
 *
 * The texts only promise what Brain does today: it answers from the fund's own cases, notes
 * and decisions and shows its sources. A question does not teach Brain by itself: only the
 * reader's click on "Gem i Brain" stores an answer, and the texts here do not say more.
 */
import { ALL_CASES, type BrainContext } from "./chat-view.ts";
import type { Language } from "../i18n/language.ts";
import { translate, type MessageKey } from "../i18n/translate.ts";

/** What the page is about: one case, or all the fund's cases (every other page). */
export type AskContext =
  | { kind: "cases" }
  | {
      kind: "case";
      id: string;
      name: string;
      /** Where in the case the reader is, e.g. "dyb analyse". */
      phase?: string | null | undefined;
    };

export const ASK_ALL_CASES: AskContext = { kind: "cases" };

/** A new key is a new conversation: another case, or leaving a case for the whole fund. */
export function askKey(context: AskContext): string {
  return context.kind === "case" ? `case:${context.id}` : "cases";
}

/** The context Brain is asked in: a case thread (bound to the case) or all cases. */
export function askBrainContext(context: AskContext): BrainContext {
  return context.kind === "case"
    ? { kind: "case", id: context.id, label: context.name }
    : ALL_CASES;
}

/** "Kender Havbrug Nord, dyb analyse" under the panel title. */
export function askKnows(context: AskContext, language: Language = "da"): string {
  if (context.kind === "cases") return translate(language, "brainChat.ask.knowsAll");
  return context.phase
    ? translate(language, "brainChat.ask.knowsCasePhase", {
        name: context.name,
        phase: context.phase,
      })
    : translate(language, "brainChat.ask.knowsCase", { name: context.name });
}

export function askHeading(context: AskContext, language: Language = "da"): string {
  return context.kind === "case"
    ? translate(language, "brainChat.ask.headingCase", { name: context.name })
    : translate(language, "brainChat.ask.headingAll");
}

export function askIntro(context: AskContext, language: Language = "da"): string {
  return translate(
    language,
    context.kind === "case" ? "brainChat.ask.introCase" : "brainChat.ask.introAll",
  );
}

export function askPlaceholder(context: AskContext, language: Language = "da"): string {
  return translate(
    language,
    context.kind === "case" ? "brainChat.ask.placeholderCase" : "brainChat.ask.placeholderAll",
  );
}

/**
 * Fixed, general suggestions (no company names, nothing made up). The pill rotates them in
 * one line, so they stay short.
 */
const CASE_SUGGESTIONS: readonly MessageKey[] = [
  "brainChat.ask.caseSuggestion1",
  "brainChat.ask.caseSuggestion2",
  "brainChat.ask.caseSuggestion3",
  "brainChat.ask.caseSuggestion4",
];

const ALL_CASES_SUGGESTIONS: readonly MessageKey[] = [
  "brainChat.ask.allSuggestion1",
  "brainChat.ask.allSuggestion2",
  "brainChat.ask.allSuggestion3",
  "brainChat.ask.allSuggestion4",
];

export function askSuggestions(context: AskContext, language: Language = "da"): readonly string[] {
  return (context.kind === "case" ? CASE_SUGGESTIONS : ALL_CASES_SUGGESTIONS).map((key) =>
    translate(language, key),
  );
}

/** "Skjul" is remembered per browser; storage can be missing or blocked (then: shown). */
export const ASK_HIDDEN_KEY = "interlect.ask.hidden";

export function readAskHidden(storage: Pick<Storage, "getItem"> | undefined): boolean {
  try {
    return storage?.getItem(ASK_HIDDEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeAskHidden(storage: Pick<Storage, "setItem"> | undefined, hidden: boolean) {
  try {
    storage?.setItem(ASK_HIDDEN_KEY, hidden ? "1" : "0");
  } catch {
    /* blocked storage: the choice lasts until the page is left */
  }
}

/**
 * What survives a page change. Every page has its own `AppShell`, so the corner panel
 * is mounted again on each navigation: whether it was open and the id of the last thread per
 * context (askKey) are kept in sessionStorage, per fund, and the thread is loaded again. Only
 * ids and a flag are stored, never content. Storage can be missing or blocked: then the panel
 * starts closed and empty, as before.
 */
export type AskSession = { open: boolean; threads: Record<string, string> };

export const askSessionKey = (fundId: string) => `interlect.ask.session.${fundId}`;

export function readAskSession(
  storage: Pick<Storage, "getItem"> | undefined,
  fundId: string,
): AskSession {
  const empty: AskSession = { open: false, threads: {} };
  try {
    const raw = storage?.getItem(askSessionKey(fundId));
    if (!raw) return empty;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return empty;
    const { open, threads } = parsed as { open?: unknown; threads?: unknown };
    const kept: Record<string, string> = {};
    if (typeof threads === "object" && threads !== null) {
      for (const [key, id] of Object.entries(threads)) {
        if (typeof id === "string") kept[key] = id;
      }
    }
    return { open: open === true, threads: kept };
  } catch {
    return empty;
  }
}

export function writeAskSession(
  storage: Pick<Storage, "getItem" | "setItem"> | undefined,
  fundId: string,
  change: { open?: boolean; thread?: { key: string; id: string | null } },
) {
  try {
    const next = readAskSession(storage, fundId);
    if (change.open !== undefined) next.open = change.open;
    if (change.thread) {
      if (change.thread.id) next.threads[change.thread.key] = change.thread.id;
      else delete next.threads[change.thread.key];
    }
    storage?.setItem(askSessionKey(fundId), JSON.stringify(next));
  } catch {
    /* blocked storage: the conversation lasts until the page is left */
  }
}

/**
 * "Spørg Brain" on the case sheet opens the Spørg Interlect panel, which already knows
 * the case. The two live in different parts of the page, so the request is a window event.
 * "Afklar med Brain" on a card that lacks information also hands over the question: it
 * stands ready in the composer, and nothing is sent (or paid for) until the person sends it.
 */
export const ASK_OPEN_EVENT = "interlect:ask-open";

export interface AskOpenDetail {
  question?: string;
}

export function requestAskOpen(
  target: Pick<EventTarget, "dispatchEvent"> | undefined,
  question?: string,
) {
  const detail: AskOpenDetail = question?.trim() ? { question: question.trim() } : {};
  target?.dispatchEvent(new CustomEvent<AskOpenDetail>(ASK_OPEN_EVENT, { detail }));
}

/** The question an open request carries, if any. */
export function askOpenQuestion(event: Event): string | null {
  const detail = (event as CustomEvent<AskOpenDetail | null>).detail;
  return detail?.question?.trim() || null;
}
