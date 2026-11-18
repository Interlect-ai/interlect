/**
 * Brain's chat commands (design): a message that starts with
 * `/forbered-møde`, `/sammenlign`, `/hvorfor`, `/tidslinje` or `/djævlens-advokat` gets a prompt addition and a preferred set of
 * tools. A command is no new engine: the same read-only tools, the same cap and the same citation
 * rules. Pure (tested in commands.test.ts); the engine reads the command from the message and the
 * system prompt adds its instruction. added `/tidslinje` and `/djævlens-advokat`.
 */
import { DEFAULT_LANGUAGE, type Language } from "../../i18n/language.ts";
import { translate, type MessageKey } from "../../i18n/translate.ts";

export type BrainCommandId = "prepare_meeting" | "compare" | "why" | "timeline" | "devils_advocate";

export type BrainCommand = {
  id: BrainCommandId;
  /** What the user types, first one is the one shown. Matched case-insensitively. */
  slashes: readonly string[];
  /** The usage hint in the team's language; the slash itself stays Danish. */
  usage: MessageKey;
  /** The subjects needed: the case the chat is on plus @-chosen entities. */
  minSubjects: number;
  /** Tools the instruction points to first. */
  tools: readonly string[];
  /** English instruction added to the system prompt; the answer follows the team's language. */
  instruction: string;
  /** A sentence the engine puts first in the answer itself (a small model skips it when asked). */
  answerPrefix?: MessageKey;
};

export const BRAIN_COMMANDS: readonly BrainCommand[] = [
  {
    id: "prepare_meeting",
    slashes: ["/forbered-møde", "/forbered-moede", "/forbered-mode"],
    usage: "brainServer.chat.command.usage.prepare_meeting",
    minSubjects: 1,
    tools: ["case_brief", "get_case", "similar_cases", "search_brain"],
    instruction:
      "Command /forbered-møde: the user is preparing a meeting with the founder of the case in context. Call case_brief first, then similar_cases once, and use search_brain only to fill a gap. Write (1) a short agenda of 3 to 5 points and (2) 8 to 12 questions for the founder. Build every question from an open gap, a contradiction between sources, a figure that is only stated by the company, or a lesson from a look-alike case; put the reason in one short line after the question, with its citation. Rank the questions by how much the answer would change the picture of the case. Never recommend a decision.",
  },
  {
    id: "compare",
    slashes: ["/sammenlign"],
    usage: "brainServer.chat.command.usage.compare",
    minSubjects: 2,
    tools: ["get_case", "case_brief", "find_cases", "search_brain"],
    instruction:
      "Command /sammenlign: compare the cases the user points to (the case in context and the entities chosen with @; entities are companies, so find their case with find_cases or get_case). Cover each case in the same order: what the company does, stage and sector, the latest screening and deep analysis (score and recommendation), the decisions made and why, open risks. Then one short list of the differences that matter. Write it side by side as one short list per case, never as a table, with a citation on every fact. Never say which case is better or which to choose.",
  },
  {
    id: "why",
    slashes: ["/hvorfor"],
    usage: "brainServer.chat.command.usage.why",
    minSubjects: 1,
    tools: ["get_case", "timeline", "search_brain", "case_brief"],
    instruction:
      "Command /hvorfor: explain why the case ended where it did. Call get_case first and read its movements (what was decided, when, the reasons and the written notes), then search_brain for the notes and sources behind the decision. Tell it in time order, quote the stated reasons, and separate what the team wrote from what Brain infers. When the case has no decision yet, say so and say where it stands. Never add reasons the sources do not give.",
  },
  {
    id: "timeline",
    slashes: ["/tidslinje"],
    usage: "brainServer.chat.command.usage.timeline",
    minSubjects: 1,
    tools: ["timeline", "search_brain", "get_case", "case_brief"],
    instruction:
      "Command /tidslinje: lay out everything Brain knows about the company in time order. Find the company's entity (the @-chosen entity, or search_brain on the company's name of the case in context and take the entity of type company), call timeline with its entityId, and add the case's movements from get_case. The timeline tool holds facts and relations only: also call case_brief, and put every dated figure of its evidence, analysis and note rows on the timeline too (a figure such as ARR is evidence, not a fact). Write one line per event, oldest first, with the date, what happened or what the figure was, whether it is verified, stated by the company or later replaced, and a citation. Show figures that changed as a series (for example 0,6, then 1,1, then 2,4). Never add events the sources do not give, and never leave out a later figure that replaced an earlier one.",
  },
  {
    id: "devils_advocate",
    slashes: ["/djævlens-advokat", "/djaevlens-advokat"],
    usage: "brainServer.chat.command.usage.devils_advocate",
    minSubjects: 1,
    tools: ["case_brief", "get_case", "similar_cases", "search_brain"],
    answerPrefix: "brainServer.chat.devilsAdvocate",
    instruction:
      'Command /djævlens-advokat: make the strongest argument against the way the team is leaning on the case in context. The leaning is the latest screening or deep analysis recommendation and the latest movement (get_case); when there is none, argue against going ahead. Call case_brief first, then similar_cases once, and build the argument only from what the sources show: the serious risks, the figures that are only stated by the company (for each figure say whether it is verified or only stated, and from which date or period; when only some periods of a figure are verified, name them, for example "only the September figure is reconciled"), contradictions, and look-alike cases that ended badly, each with its citation. The answer already begins with a sentence saying that this is a deliberately one-sided argument; do not repeat it. End with the two or three facts that would weaken the argument if they turned out to be true. Never recommend a decision and never say what the team should do.',
  },
];

export type ParsedCommand = {
  command: BrainCommand;
  /** What follows the command on the line, trimmed. */
  rest: string;
};

/** The command a message starts with, or null. A slash inside text is not a command. */
export function parseCommand(question: string): ParsedCommand | null {
  const text = question.trimStart();
  if (!text.startsWith("/")) return null;
  // "/hvorfor?" and "/sammenlign:" are commands too; é, ø and å are compared composed.
  const word = text.split(/\s/, 1)[0]!;
  const head = word
    .normalize("NFC")
    .replace(/[?!.,:;]+$/, "")
    .toLowerCase();
  for (const command of BRAIN_COMMANDS) {
    if (command.slashes.some((slash) => slash === head)) {
      return { command, rest: text.slice(word.length).trim() };
    }
  }
  return null;
}

/**
 * Why the command cannot run, in the team's language, or null. The engine answers with this
 * sentence itself: no model call is paid for it.
 */
export function commandProblem(
  command: BrainCommand,
  subjects: { hasCase: boolean; entityCount: number },
  language: Language | undefined = DEFAULT_LANGUAGE,
): string | null {
  const have = (subjects.hasCase ? 1 : 0) + subjects.entityCount;
  if (have >= command.minSubjects) return null;
  const lang = language ?? DEFAULT_LANGUAGE;
  const missing = command.minSubjects - have;
  return translate(
    lang,
    missing === 1 ? "brainServer.chat.command.missingOne" : "brainServer.chat.command.missingMany",
    {
      command: command.slashes[0]!,
      count: missing,
      usage: translate(lang, command.usage),
    },
  );
}

/** The text added to the system prompt for a command that can run. */
export function commandPromptSection(parsed: ParsedCommand): string {
  return `${parsed.command.instruction} Prefer these tools: ${parsed.command.tools.join(", ")}.${
    parsed.rest ? "" : " The user gave no further text: use the defaults of the command."
  }`;
}

/** The command's fixed opening in the fund's language, or null when it has none. */
export function commandAnswerPrefix(
  command: BrainCommand,
  language: Language | undefined,
): string | null {
  return command.answerPrefix
    ? translate(language ?? DEFAULT_LANGUAGE, command.answerPrefix)
    : null;
}

/** What the model reads as the user's message: the text after the command, or a default. */
export function commandQuestion(parsed: ParsedCommand, language?: Language): string {
  return (
    parsed.rest ||
    translate(language ?? DEFAULT_LANGUAGE, "brainServer.chat.command.run", {
      command: parsed.command.slashes[0]!,
    })
  );
}
