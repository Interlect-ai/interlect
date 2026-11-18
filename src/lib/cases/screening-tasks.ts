/**
 * "Skal afklares" between the server (CaseTask, tasks.functions.ts) and the list's shapes
 * (TaskItem, components/ds/task-types.ts). Pure (tested); only type imports.
 *
 * - A task linked to a mandate requirement is answered "Opfyldt"/"Ikke opfyldt" (answer kind
 *   "gate"), because only that recalculates the score.
 * - Nobody can hand a task to Interlect yet (no engine answers tasks), so a stored "ai" task is
 *   shown as an ordinary task for the team (gap/R-5-screening.md, choice 4).
 */
import type {
  TaskAnswerInput,
  TaskDraft,
  TaskGateState,
  TaskItem,
  TaskLink,
  TaskPerson,
} from "../../components/ds/task-types";
import type { CaseTask, TaskAssignee } from "./tasks.functions";
import { DEFAULT_LANGUAGE, type Language } from "../i18n/language.ts";
import { translate } from "../i18n/translate.ts";
import { criterionColors } from "../charts/colors.ts";

/** The team as choices ("Dig, Lead" for the signed-in user). */
export function taskPeople(
  assignees: readonly TaskAssignee[],
  language: Language = DEFAULT_LANGUAGE,
): TaskPerson[] {
  return assignees.map((assignee) => ({
    id: assignee.userId,
    name: assignee.name,
    description: assignee.isMe
      ? translate(language, "screening.tasks.you", { role: assignee.roleLabel })
      : assignee.roleLabel,
    isMe: assignee.isMe,
  }));
}

/** "Knyt til": the gates first (as "Mandatfit, …"), then the criteria in the fund's order. */
export function taskLinks(
  input: {
    gates: readonly { key: string; label: string }[];
    criteria: readonly { criterionKey: string; label: string }[];
  },
  language: Language = DEFAULT_LANGUAGE,
): TaskLink[] {
  const colors = criterionColors(input.criteria.map((criterion) => criterion.criterionKey));
  return [
    ...input.gates.map((gate) => ({
      kind: "gate" as const,
      key: gate.key,
      label: translate(language, "screening.tasks.gateLink", { label: gate.label }),
      color: "var(--action)",
      description: translate(language, "screening.tasks.gateLinkDescription"),
    })),
    ...input.criteria.map((criterion) => ({
      kind: "criterion" as const,
      key: criterion.criterionKey,
      label: criterion.label,
      color: colors.of(criterion.criterionKey),
      description: translate(language, "screening.tasks.criterionLink"),
    })),
  ];
}

/** "Fra dyb analyse": the task remembers which kind of run wrote it. */
function fromDeepRun(task: CaseTask): boolean {
  return task.sourceRunKind === "deep";
}

export function taskItem(
  task: CaseTask,
  context: {
    people: readonly TaskPerson[];
    links: readonly TaskLink[];
    /** The requirement's state for a gate task (from the case's gates). */
    gateState: (gateKey: string) => TaskGateState | undefined;
  },
  language: Language = DEFAULT_LANGUAGE,
): TaskItem {
  const link =
    task.linkedKind && task.linkedKey
      ? (context.links.find(
          (entry) => entry.kind === task.linkedKind && entry.key === task.linkedKey,
        ) ?? null)
      : null;
  const person = task.assigneeId
    ? (context.people.find((entry) => entry.id === task.assigneeId) ?? {
        id: task.assigneeId,
        name: task.assigneeName ?? translate(language, "screening.tasks.formerMember"),
      })
    : null;
  const isGate = task.linkedKind === "gate" && task.linkedKey !== null;
  const value = task.answerValue;
  return {
    id: task.id,
    kind: task.kind,
    title: task.title,
    description: task.description,
    why: task.why,
    answerKind: isGate ? "gate" : task.answerKind === "ai" ? "text" : task.answerKind,
    answerOptions: task.answerOptions,
    answerUnit: task.answerUnit,
    assignee: person,
    dueOn: task.dueOn,
    link,
    status: task.status,
    answer:
      task.status === "resolved"
        ? {
            text: task.answerText,
            number: value?.number ?? null,
            option: value?.option ?? null,
            fileName: task.answerFileName,
            gatePassed: typeof value?.gatePassed === "boolean" ? value.gatePassed : null,
            override: value?.override === true,
          }
        : null,
    source: task.origin,
    fromDeepAnalysis: fromDeepRun(task),
    ...(isGate ? { gate: context.gateState(task.linkedKey!) } : {}),
  };
}

/** "Opret opgave" → createCaseTask. */
export function createTaskInput(draft: TaskDraft): {
  kind: TaskDraft["kind"];
  title: string;
  description: string | null;
  assigneeId: string | null;
  dueOn: string | null;
  linkedKind: "gate" | "criterion" | null;
  linkedKey: string | null;
} {
  return {
    kind: draft.kind,
    title: draft.title.trim(),
    description: draft.description?.trim() || null,
    // Interlect cannot take a task yet; the list never offers it (choice 4).
    assigneeId: draft.assignee && !draft.assignee.isInterlect ? draft.assignee.id : null,
    dueOn: draft.dueOn,
    linkedKind: draft.link?.kind ?? null,
    linkedKey: draft.link?.key ?? null,
  };
}

/**
 * "Gem svar" / "Gem og genberegn" → answerCaseTask. A file is uploaded first by the page and
 * comes in as `documentId`. `revise` for "Redigér" on an answered task.
 */
export function answerTaskInput(
  answer: TaskAnswerInput,
  options: { revise: boolean; documentId: string | null },
): {
  text: string;
  number: number | null;
  option: string | null;
  documentId: string | null;
  gatePassed: boolean | null;
  override: boolean;
  revise: boolean;
} {
  const base = {
    text: "",
    number: null,
    option: null,
    documentId: options.documentId,
    gatePassed: null,
    override: false,
    revise: options.revise,
  };
  switch (answer.kind) {
    case "text":
      return { ...base, text: answer.text.trim() };
    case "number":
      return { ...base, number: answer.number };
    case "select":
      return { ...base, option: answer.option };
    case "file":
      return base;
    case "gate":
      return {
        ...base,
        text: answer.text.trim(),
        gatePassed: answer.passed,
        override: answer.override,
      };
  }
}

/** The file to upload before the answer is saved, if any. */
export function answerFile(answer: TaskAnswerInput): File | null {
  if (answer.kind === "file") return answer.file;
  if (answer.kind === "gate") return answer.file;
  return null;
}
