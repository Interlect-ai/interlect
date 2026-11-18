/**
 * "Gem som note" (batch 2), pure: a Brain answer as the body of a case note. The server
 * builds it from the STORED message (never text from the browser), so the note says exactly
 * what Brain answered, marked as Brain's, with its sources by name and no citation markers.
 * Case notes hold at most 4000 characters (`caseNoteBodySchema`); a longer answer is cut at a
 * paragraph or sentence and says so.
 */
import type { ChatCitation } from "./chat-contract.ts";
import { plainTextOf } from "./chat-text.ts";
import { serverText } from "../i18n/server-text.ts";

export const NOTE_MAX = 4000;
/** The note's first line, in the team's language (the caller sets it, d). */
export function noteHeading(): string {
  return serverText("brainServer.notes.noteHeading");
}

export interface AnswerNoteInput {
  question: string | null;
  answer: string;
  citations: readonly ChatCitation[];
}

function sourceLine(citations: readonly ChatCitation[]): string | null {
  const labels: string[] = [];
  for (const citation of [...citations].sort((a, b) => a.n - b.n)) {
    const label = citation.deleted
      ? serverText("brainServer.notes.deletedSource")
      : citation.label.trim();
    if (label && !labels.includes(label)) labels.push(label);
  }
  return labels.length
    ? serverText("brainServer.notes.sources", { sources: labels.join("; ") })
    : null;
}

/** Cuts at the last paragraph, line or sentence end that fits; never mid-word if avoidable. */
function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max);
  for (const mark of ["\n\n", "\n", ". "]) {
    const at = head.lastIndexOf(mark);
    if (at > max * 0.5) return head.slice(0, at + (mark === ". " ? 1 : 0)).trimEnd();
  }
  const space = head.lastIndexOf(" ");
  return (space > max * 0.5 ? head.slice(0, space) : head).trimEnd() + " …";
}

export function answerNoteBody(input: AnswerNoteInput): string {
  const numbers = new Set(input.citations.map((citation) => citation.n));
  const answer = plainTextOf(input.answer, numbers);
  const question = input.question?.trim().replace(/\s+/g, " ") ?? "";
  const head = [
    noteHeading(),
    question ? serverText("brainServer.notes.question", { question: cut(question, 300) }) : null,
  ]
    .filter(Boolean)
    .join("\n");
  const sources = sourceLine(input.citations);
  const tail = sources ? cut(sources, 600) : null;
  const whole = [head, answer, tail].filter(Boolean).join("\n\n");
  if (whole.length <= NOTE_MAX) return whole;
  const cutNote = serverText("brainServer.notes.cut");
  const room = NOTE_MAX - head.length - (tail ? tail.length + 2 : 0) - cutNote.length - 6;
  return [head, `${cut(answer, Math.max(room, 200))}\n\n${cutNote}`, tail]
    .filter(Boolean)
    .join("\n\n");
}
