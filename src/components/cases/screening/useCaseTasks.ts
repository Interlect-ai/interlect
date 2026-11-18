/**
 * "Skal afklares" on a case:'s task functions behind the TaskList callbacks (Case Screening
 * v5). One list per case, the same in screening and deep analysis.
 *
 * An answer to a requirement recalculates the code score on the server; the page shows
 * "Genberegner" until the case has been read again, and the score then counts to its new value
 * (no "+N point"). Errors are shown as the server's own Danish message (userMessage) and the
 * editor keeps its draft.
 */
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { showToast } from "@/components/ds/Toast";
import type {
  TaskAnswerInput,
  TaskDraft,
  TaskGateState,
  TaskItem,
  TaskPerson,
} from "@/components/ds/task-types";
import {
  answerCaseTask,
  createCaseTask,
  deleteCaseTask,
  listCaseTasks,
  listTaskAssignees,
  restoreCaseTask,
  updateCaseTask,
  type CaseTask,
} from "@/lib/cases/tasks.functions";
import {
  answerFile,
  answerTaskInput,
  createTaskInput,
  taskItem,
  taskLinks,
  taskPeople,
} from "@/lib/cases/screening-tasks";
import { userMessage } from "@/lib/errors/user-message";
import { useLanguage, useT } from "@/lib/i18n/useT";
import type { GateView, CriterionView } from "@/lib/cases/view-model";
import { CASE_PANEL_STALE_MS } from "./case-tab-data";
import { useCaseFileUpload } from "./useCaseFileUpload";

export function caseTasksKey(caseId: string, fundId: string) {
  return ["case-tasks", caseId, fundId] as const;
}

export function useCaseTasks({
  fundId,
  caseId,
  gates,
  criteria,
  capabilities,
}: {
  fundId: string;
  caseId: string;
  /** The latest screening's gates, with the team's answers applied. */
  gates: readonly GateView[];
  criteria: readonly CriterionView[];
  capabilities: readonly string[] | undefined;
}) {
  const t = useT();
  const language = useLanguage();
  const queryClient = useQueryClient();
  const load = useServerFn(listCaseTasks);
  const loadTeam = useServerFn(listTaskAssignees);
  const create = useServerFn(createCaseTask);
  const update = useServerFn(updateCaseTask);
  const remove = useServerFn(deleteCaseTask);
  const restore = useServerFn(restoreCaseTask);
  const answer = useServerFn(answerCaseTask);
  const upload = useCaseFileUpload(fundId, caseId);
  const [recalculating, setRecalculating] = useState(false);
  // A file already in Filer is reused when the same answer is saved again after an error, so a
  // retry never adds the file twice.
  const uploaded = useRef(new WeakMap<File, string>());

  const canManage = capabilities?.includes("manage_tasks") ?? false;
  const canOverride = capabilities?.includes("override_mandate_gate") ?? false;

  const tasksQuery = useQuery({
    queryKey: caseTasksKey(caseId, fundId),
    queryFn: () => load({ data: { fundId, caseId } }),
    staleTime: CASE_PANEL_STALE_MS,
  });
  const teamQuery = useQuery({
    queryKey: ["task-assignees", fundId],
    queryFn: () => loadTeam({ data: { fundId } }),
    staleTime: 5 * 60_000,
    enabled: canManage,
  });

  const people: TaskPerson[] = taskPeople(teamQuery.data ?? [], language);
  const links = taskLinks({ gates, criteria }, language);
  const gateState = (key: string): TaskGateState | undefined => {
    const gate = gates.find((entry) => entry.key === key);
    return gate ? { passedNow: gate.passed, canOverride } : undefined;
  };
  const raw: CaseTask[] = tasksQuery.data ?? [];
  const items: TaskItem[] = raw.map((task) =>
    taskItem(task, { people, links, gateState }, language),
  );

  const refresh = async (options: { case?: boolean; files?: boolean } = {}) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: caseTasksKey(caseId, fundId) }),
      queryClient.invalidateQueries({ queryKey: ["case-messages", caseId, fundId] }),
      queryClient.invalidateQueries({ queryKey: ["cases", fundId] }),
      options.files
        ? queryClient.invalidateQueries({ queryKey: ["case-files", caseId, fundId] })
        : null,
      options.case ? queryClient.invalidateQueries({ queryKey: ["case", caseId, fundId] }) : null,
    ]);
  };

  const fail =
    (fallback: string) =>
    (cause: unknown): never => {
      showToast({ message: userMessage(cause, fallback, language), tone: "error" });
      throw cause;
    };

  const warnIfNotRecalculated = (result: { recalculationFailed: boolean }) => {
    if (!result.recalculationFailed) return;
    showToast({
      message: t("caseView.tasks.recalcFailed"),
      tone: "error",
    });
  };

  const createMutation = useMutation({
    mutationFn: (draft: TaskDraft) =>
      create({ data: { fundId, caseId, answerKind: "text", ...createTaskInput(draft) } }),
    onSuccess: () => refresh(),
  });

  /** Saves an answer (a new one, or "Redigér" on an answered task), uploading a file first. */
  const saveAnswer = async (taskId: string, input: TaskAnswerInput, revise: boolean) => {
    const file = answerFile(input);
    const gate = input.kind === "gate";
    if (gate) setRecalculating(true);
    try {
      let documentId = file ? (uploaded.current.get(file) ?? null) : null;
      if (file && !documentId) {
        documentId = (await upload(file)).documentId;
        uploaded.current.set(file, documentId);
      }
      const result = await answer({
        data: { fundId, taskId, ...answerTaskInput(input, { revise, documentId }) },
      });
      await refresh({ case: gate, files: Boolean(file) });
      warnIfNotRecalculated(result);
      return result;
    } finally {
      if (gate) setRecalculating(false);
    }
  };

  const onAnswer = (task: TaskItem, input: TaskAnswerInput) =>
    saveAnswer(task.id, input, task.status === "resolved").catch(
      fail(t("caseView.tasks.answerFailed")),
    );

  const onRename = (task: TaskItem, title: string) =>
    update({ data: { fundId, taskId: task.id, title } })
      .then(() => refresh())
      .catch(fail(t("caseView.tasks.renameFailed")));

  const onReassign = (task: TaskItem, person: TaskPerson) =>
    update({
      data: { fundId, taskId: task.id, assigneeId: person.isInterlect ? null : person.id },
    })
      .then(() => refresh())
      .catch(fail(t("caseView.tasks.reassignFailed")));

  // Deleting or restoring an answered requirement recalculates the score on the server.
  const onDelete = (task: TaskItem) =>
    remove({ data: { fundId, taskId: task.id } })
      .then(async (result) => {
        await refresh({ case: task.status === "resolved" });
        warnIfNotRecalculated(result);
      })
      .catch(fail(t("caseView.tasks.deleteFailed")));

  const onRestore = (task: TaskItem) =>
    restore({ data: { fundId, taskId: task.id } })
      .then(async (result) => {
        await refresh({ case: task.status === "resolved" });
        warnIfNotRecalculated(result);
      })
      .catch(fail(t("caseView.tasks.restoreFailed")));

  /**
   * Answers a requirement from the Mandatfit page. A gate without a task (a breach the
   * screening found, which an Admin or Lead overrides) gets one first, linked to the gate, so
   * the answer is audited like any other.
   */
  const answerGate = async (
    gate: { key: string; label: string },
    task: CaseTask | null,
    input: Extract<TaskAnswerInput, { kind: "gate" }>,
  ) => {
    try {
      let taskId = task?.id ?? null;
      if (!taskId) {
        const created = await create({
          data: {
            fundId,
            caseId,
            kind: "verification",
            title: t("caseView.tasks.resolveGate", { label: gate.label }),
            answerKind: "text",
            linkedKind: "gate",
            linkedKey: gate.key,
          },
        });
        taskId = created.id;
      }
      return await saveAnswer(taskId, input, task?.status === "resolved");
    } catch (cause) {
      // A task made above stays open in "Skal afklares", where it can be answered again.
      await refresh();
      return fail(t("caseView.tasks.answerFailed"))(cause);
    }
  };

  return {
    raw,
    items,
    people,
    links,
    isLoading: tasksQuery.isLoading,
    isError: tasksQuery.isError,
    refetch: tasksQuery.refetch,
    canManage,
    canOverride,
    recalculating,
    answerGate,
    listProps: canManage
      ? {
          onCreate: (draft: TaskDraft) =>
            createMutation.mutateAsync(draft).catch(fail(t("caseView.tasks.createFailed"))),
          creating: createMutation.isPending,
          onAnswer,
          onRename,
          onReassign,
          onDelete,
          onRestore,
        }
      : {},
  };
}
