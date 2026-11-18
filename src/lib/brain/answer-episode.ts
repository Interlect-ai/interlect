/**
 * "Gem i Brain" (L8), pure: what is stored of an answer. Built from the STORED answer
 * (never text from the browser): the question, the answer without citation markers and its
 * sources by name, so the episode reads on its own when it is found again. About 4,000
 * characters (the same text as "Gem som note"), well under the episode's 8,000.
 */
import { createHash } from "node:crypto";
import { answerNoteBody, noteHeading } from "./answer-note.ts";
import type { ChatCitation } from "./chat-contract.ts";
import { serverText } from "../i18n/server-text.ts";

/** The episode's first line, in place of the note's own heading. */
export function answerHeading(): string {
  return serverText("brainServer.notes.answerHeading");
}
const TITLE_MAX = 200;

export interface AnswerEpisodeDraft {
  title: string;
  content: string;
  contentHash: string;
  tokenCount: number;
}

export function answerEpisodeDraft(input: {
  question: string | null;
  answer: string;
  citations: readonly ChatCitation[];
}): AnswerEpisodeDraft {
  const body = answerNoteBody(input);
  // answerNoteBody opens with its own heading ("Fra Brain"); the episode says what it is.
  const heading = noteHeading();
  const content = body.startsWith(heading)
    ? `${answerHeading()}${body.slice(heading.length)}`
    : body;
  const question = input.question?.trim().replace(/\s+/g, " ") ?? "";
  const title = (question || serverText("brainServer.notes.answerTitle")).slice(0, TITLE_MAX);
  return {
    title,
    content,
    contentHash: createHash("sha256").update(content).digest("hex"),
    tokenCount: Math.ceil(content.length / 4),
  };
}
