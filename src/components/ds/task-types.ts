/**
 * Shared shapes, fixed texts and pure helpers for the "Skal afklares" components (TaskRow,
 * TaskComposer, TaskList). Kept out of the component files so they only export components
 * (react-refresh).
 *
 * The fields mirror `CaseTask` in src/lib/cases/tasks.functions.ts on the data branch
 * (data/r-3-datamodel), so a page maps a server row onto `TaskItem` field by field. Kind
 * labels and icons are the prototype's TYPES list (Case Screening v5), which is also
 * `caseTaskKindLabel` in src/lib/cases/tasks.ts on that branch. The texts follow the fund's
 * language (`tasks` in the i18n dictionaries).
 */
import {
  Calendar,
  CircleCheck,
  FileText,
  MessageCircle,
  Search,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { DEFAULT_LANGUAGE, LANGUAGE_TAGS, type Language } from "@/lib/i18n/language";
import { translate } from "@/lib/i18n/translate";

export type TaskKind = "task" | "question" | "verification" | "document" | "research" | "meeting";

/**
 * How the task is answered; "ai" means Interlect works on it (no editor, orb tile). "gate" is a
 * task linked to a mandate requirement: Opfyldt/Ikke opfyldt with a text and an optional file,
 * which recalculates the score (GateAnswerEditor).
 */
export type TaskAnswerKind = "text" | "number" | "select" | "file" | "ai" | "gate";

export type TaskStatus = "open" | "resolved";

/** The order of the composer's "Type" list (prototype TYPES). */
export const TASK_KIND_ORDER: readonly TaskKind[] = [
  "task",
  "question",
  "verification",
  "document",
  "research",
  "meeting",
];

export const TASK_KIND_ICON: Record<TaskKind, LucideIcon> = {
  task: CircleCheck,
  question: MessageCircle,
  verification: ShieldCheck,
  document: FileText,
  research: Search,
  meeting: Calendar,
};

/** The kind's label ("Opgave", "Spørgsmål til selskabet", …) in the fund's language. */
export function taskKindLabel(kind: TaskKind, language: Language = DEFAULT_LANGUAGE): string {
  return translate(language, `tasks.kind.${kind}`);
}

export interface TaskPerson {
  id: string;
  name: string;
  /** Second line in the choice lists, e.g. "Dig, Partner" or "Analytiker". */
  description?: string | undefined;
  /** The signed-in user: shown as "Dig" on the row and in the composer. */
  isMe?: boolean | undefined;
  /** Interlect itself: the task becomes an AI task (orb on --ai-wash, no editor). */
  isInterlect?: boolean | undefined;
}

/** Interlect's line in the "Ansvarlig" lists when the page gives none (prototype WHO). */
export function interlectDescription(language: Language = DEFAULT_LANGUAGE): string {
  return translate(language, "tasks.interlectDescription");
}

/** A gate or criterion the task is linked to ("Knyttet til"). */
export interface TaskLink {
  kind: "gate" | "criterion";
  key: string;
  /** As shown on the row, e.g. "Mandatfit, Ejerandel mindst 10 %" or "Traction". */
  label: string;
  /** The source colour as a token: var(--action) for Mandatfit, var(--series-N) for criteria. */
  color: string;
  /** Second line in the composer's list; defaults to "Knyttes til en gate" / "Kriterie". */
  description?: string | undefined;
}

/** Colour of tasks linked to nothing ("Generelt"). */
export const TASK_UNLINKED_COLOR = "var(--ink-4)";
export function taskUnlinkedLabel(language: Language = DEFAULT_LANGUAGE): string {
  return translate(language, "tasks.unlinked");
}

/** The saved answer (CaseTask answerText / answerValue / the uploaded file's name). */
export interface TaskAnswer {
  text?: string | null | undefined;
  number?: number | null | undefined;
  option?: string | null | undefined;
  fileName?: string | null | undefined;
  /** A gate task's answer: the requirement is met (true) or not (false). */
  gatePassed?: boolean | null | undefined;
  /** An Admin or Lead overrode a requirement assessed as not met. */
  override?: boolean | undefined;
}

/** What the editor hands to `onAnswer`. The page uploads a file itself. */
export type TaskAnswerInput =
  | { kind: "text"; text: string }
  | { kind: "number"; number: number }
  | { kind: "select"; option: string }
  | { kind: "file"; file: File }
  | { kind: "gate"; passed: boolean; text: string; file: File | null; override: boolean };

/** What a gate task's editor needs to know about the requirement now. */
export interface TaskGateState {
  /** The requirement's status now (null = unknown), with the team's answers applied. */
  passedNow: boolean | null;
  /** The user may override a requirement that is not met (Admin/Lead). */
  canOverride: boolean;
}

export interface TaskItem {
  id: string;
  kind: TaskKind;
  title: string;
  description?: string | null | undefined;
  why?: string | null | undefined;
  answerKind: TaskAnswerKind;
  /** Choices for answerKind "select". */
  answerOptions?: readonly string[] | undefined;
  /** Unit after a number answer, e.g. "mio. kr." */
  answerUnit?: string | null | undefined;
  /** Label above the number field, e.g. "Pre-money i mio. kr." (falls back to the unit). */
  answerLabel?: string | null | undefined;
  answerPlaceholder?: string | null | undefined;
  assignee?: TaskPerson | null | undefined;
  /** ISO date (YYYY-MM-DD), CaseTask.dueOn. Shown as "Tors. 2. okt". */
  dueOn?: string | null | undefined;
  link?: TaskLink | null | undefined;
  status: TaskStatus;
  answer?: TaskAnswer | null | undefined;
  /** Who created it (CaseTask.origin). The AI look follows the assignee, not the origin. */
  source?: "ai" | "user" | undefined;
  /** Written by the deep analysis: "Fra dyb analyse" next to the title. */
  fromDeepAnalysis?: boolean | undefined;
  /** For answerKind "gate". */
  gate?: TaskGateState | undefined;
}

/**
 * A task another part of the page asks "Ny opgave" to open with ("Udfyld" on a card on Konklusion).
 * Nothing is saved until the person presses "Opret opgave".
 */
export interface TaskPrefill {
  /** New for every request, so the same gap can be asked for again. */
  id: number;
  title: string;
  description: string | null;
  kind: TaskKind;
  link: TaskLink | null;
}

/** What "Opret opgave" hands to `onCreate`. */
export interface TaskDraft {
  kind: TaskKind;
  title: string;
  description: string | null;
  assignee: TaskPerson | null;
  dueOn: string | null;
  link: TaskLink | null;
  /** "ai" when Interlect is the assignee, otherwise "text" (the prototype's rule). */
  answerKind: "text" | "ai";
}

/** One choice in the composer's "Frist" list; `value` is an ISO date or null. */
export interface TaskDueChoice {
  label: string;
  value: string | null;
}

/** An AI task: Interlect is working on it (the prototype's type "ai"). */
export function isAiTask(task: Pick<TaskItem, "answerKind" | "assignee">): boolean {
  return task.answerKind === "ai" || task.assignee?.isInterlect === true;
}

/** The 14 % tone of a source colour behind a tile (v0.4). */
export function taskTint(color: string): string {
  return `color-mix(in srgb, ${color} 14%, transparent)`;
}

const DUE_FORMATS = new Map<Language, Intl.DateTimeFormat>();

function dueFormat(language: Language): Intl.DateTimeFormat {
  let format = DUE_FORMATS.get(language);
  if (!format) {
    format = new Intl.DateTimeFormat(LANGUAGE_TAGS[language], {
      weekday: "short",
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    });
    DUE_FORMATS.set(language, format);
  }
  return format;
}

/**
 * "2026-10-02" → "Fre. 2. okt" (the prototype's due format; English "Fri 2 Oct"). Read as a
 * calendar date in UTC, so server and browser always print the same day.
 */
export function formatDueLabel(
  iso: string | null | undefined,
  language: Language = DEFAULT_LANGUAGE,
): string | null {
  if (!iso) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (Number.isNaN(date.getTime())) return null;
  const tag = LANGUAGE_TAGS[language];
  const parts = dueFormat(language).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? "";
  const weekday = part("weekday");
  return translate(language, "tasks.due.format", {
    weekday: `${weekday.charAt(0).toLocaleUpperCase(tag)}${weekday.slice(1)}`,
    day: part("day"),
    month: part("month").replace(/\.$/, ""),
  });
}

function localIsoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/**
 * The composer's default "Frist" list (prototype DUES): Ingen frist, I dag, I morgen, the
 * coming Friday as a date, Næste uge (next Monday). Built from the user's local calendar when
 * the composer opens (never during server rendering).
 */
export function defaultDueChoices(
  today: Date,
  language: Language = DEFAULT_LANGUAGE,
): TaskDueChoice[] {
  const weekday = today.getDay(); // 0 = Sunday
  const untilFriday = (5 - weekday + 7) % 7 || 7;
  const friday = localIsoDate(addDays(today, untilFriday));
  const untilMonday = (8 - weekday) % 7 || 7;
  const choices: TaskDueChoice[] = [
    { label: translate(language, "tasks.due.none"), value: null },
    { label: translate(language, "tasks.due.today"), value: localIsoDate(today) },
    { label: translate(language, "tasks.due.tomorrow"), value: localIsoDate(addDays(today, 1)) },
  ];
  if (untilFriday > 1) {
    choices.push({ label: formatDueLabel(friday, language) ?? friday, value: friday });
  }
  choices.push({
    label: translate(language, "tasks.due.nextWeek"),
    value: localIsoDate(addDays(today, untilMonday)),
  });
  return choices;
}

const NUMBER_FORMATS = new Map<Language, Intl.NumberFormat>();

function numberFormat(language: Language): Intl.NumberFormat {
  let format = NUMBER_FORMATS.get(language);
  if (!format) {
    format = new Intl.NumberFormat(LANGUAGE_TAGS[language]);
    NUMBER_FORMATS.set(language, format);
  }
  return format;
}

/** The saved answer as one line ("120 mio. kr.", "Ansøgt", "captable_2026.xlsx"). */
export function formatTaskAnswer(
  task: Pick<TaskItem, "answer" | "answerKind" | "answerUnit">,
  language: Language = DEFAULT_LANGUAGE,
) {
  const answer = task.answer;
  if (!answer) return "";
  const number =
    typeof answer.number === "number" && Number.isFinite(answer.number)
      ? `${numberFormat(language).format(answer.number)}${task.answerUnit ? ` ${task.answerUnit}` : ""}`
      : null;
  const gate =
    typeof answer.gatePassed === "boolean"
      ? [translate(language, answer.gatePassed ? "tasks.gateMet" : "tasks.gateNotMet"), answer.text]
          .filter(Boolean)
          .join(", ")
      : null;
  const byKind: Record<TaskAnswerKind, string | null | undefined> = {
    number,
    select: answer.option,
    file: answer.fileName,
    text: answer.text,
    ai: answer.text,
    gate,
  };
  return byKind[task.answerKind] || answer.text || answer.option || number || answer.fileName || "";
}
