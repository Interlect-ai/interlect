/**
 * Small pure rules for the Brain chat view: the @ context and what it means in a
 * request, the fixed suggestion cards, and the greeting. No React.
 */
import type { ChatMode, ChatRequest } from "./chat-contract.ts";
import type { Language } from "../i18n/language.ts";
import { translate, type MessageKey } from "../i18n/translate.ts";
import { greetingLine } from "../overview/dates.ts";

export type BrainContext =
  | { kind: "cases" }
  | { kind: "thesis" }
  | { kind: "case"; id: string; label: string }
  | { kind: "entity"; id: string; label: string };

export const ALL_CASES: BrainContext = { kind: "cases" };

export function contextLabel(context: BrainContext, language: Language = "da"): string {
  switch (context.kind) {
    case "cases":
      return translate(language, "brainChat.context.allCases");
    case "thesis":
      return translate(language, "brainChat.context.thesis");
    default:
      return context.label;
  }
}

/** The request fields for a context (the server checks that every id belongs to the fund). */
export function contextRequestFields(
  context: BrainContext,
): Pick<ChatRequest, "caseId" | "entityIds" | "scope"> {
  switch (context.kind) {
    case "thesis":
      return { caseId: null, entityIds: [], scope: "thesis" };
    case "case":
      return { caseId: context.id, entityIds: [], scope: "cases" };
    case "entity":
      return { caseId: null, entityIds: [context.id], scope: "cases" };
    default:
      return { caseId: null, entityIds: [], scope: "cases" };
  }
}

export function sameContext(a: BrainContext, b: BrainContext): boolean {
  if (a.kind !== b.kind) return false;
  if ("id" in a && "id" in b) return a.id === b.id;
  return true;
}

/** Fixed, general suggestions: no company names, nothing made up (gap doc, "Tom tilstand"). */
const BRAIN_SUGGESTION_KEYS: readonly { title: MessageKey; hint: MessageKey }[] = [
  { title: "brainChat.suggestions.1.title", hint: "brainChat.suggestions.1.hint" },
  { title: "brainChat.suggestions.2.title", hint: "brainChat.suggestions.2.hint" },
  { title: "brainChat.suggestions.3.title", hint: "brainChat.suggestions.3.hint" },
  { title: "brainChat.suggestions.4.title", hint: "brainChat.suggestions.4.hint" },
];

export function brainSuggestions(
  language: Language = "da",
): readonly { title: string; hint: string }[] {
  return BRAIN_SUGGESTION_KEYS.map(({ title, hint }) => ({
    title: translate(language, title),
    hint: translate(language, hint),
  }));
}

/** "God morgen, Maja": by Copenhagen time; no name gives just the greeting. */
export function greetingFor(
  now: Date,
  firstName: string | null,
  language: Language = "da",
): string {
  return greetingLine(now, firstName, language);
}

/**
 * Hurtig / Grundig in the composer. The price is shown before sending: what a question
 * typically costs (§chat) and the cap the engine enforces (`capDkk` in
 * chat/prompt.ts; chat-view.test.ts keeps the two equal). Web search adds 1 kr. to the cap.
 */
export const CHAT_MODE_CHOICES: Record<
  ChatMode,
  { labelKey: MessageKey; typicalDkk: string; capDkk: number; hintKey: MessageKey }
> = {
  fast: {
    labelKey: "brainChat.mode.fast",
    typicalDkk: "0,10",
    capDkk: 1,
    hintKey: "brainChat.mode.fastHint",
  },
  deep: {
    labelKey: "brainChat.mode.deep",
    typicalDkk: "0,60",
    capDkk: 4,
    hintKey: "brainChat.mode.deepHint",
  },
};

/** Web search raises the cap by this much (`capUsd(mode, true)` in the engine). */
export const WEB_EXTRA_DKK = 1;
/** The web search chip text (dictionary key). */
export const WEB_CHIP_KEY: MessageKey = "brainChat.web.chip";

export const SOURCES_FOLDED_KEY = "interlect.brain.sources.folded";
