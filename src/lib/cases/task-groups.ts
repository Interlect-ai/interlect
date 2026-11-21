/**
 * Display rules for a LONG "Skal afklares" list (batch 3; Pleo's screening alone has 84 open
 * tasks). Pure and display-only: it never changes, drops or re-labels a task, it only decides the
 * order and the grouping. Mandate requirements (gates) come first, then criteria, then tasks
 * linked to nothing; inside a group the order the page gave is kept.
 */

import { translate } from "../i18n/translate.ts";
import type { Language } from "../i18n/language.ts";

interface Linked {
  link?:
    { kind: "gate" | "criterion"; key: string; label: string; color: string } | null | undefined;
  /** "user" = a task the team made itself; those sort last among the unlinked ones. */
  source?: string | undefined;
}

/**
 * (TS-12, the product owner 3 Nov: "max. 4"): the box shows at most 4 open tasks of the whole list
 * (the model's, the gates' and the research's) and folds the rest behind "Vis N flere". Old cases
 * keep every task; only the first view is shorter.
 */
export const TASK_FOLD_THRESHOLD = 4;
/** How many open tasks show before the fold. */
export const TASK_PREVIEW_COUNT = 4;
/** Unfolded, a list longer than this is grouped by gate and criterion (batch 3). */
export const TASK_GROUP_THRESHOLD = 8;

export interface TaskGroup<T> {
  /** "gate:key", "criterion:key" or "general". */
  id: string;
  label: string;
  color: string | null;
  tasks: T[];
}

const rank = (task: Linked) =>
  task.link?.kind === "gate" ? 0 : task.link ? 1 : task.source === "user" ? 3 : 2;

/** Gates, criteria, unlinked deep tasks, then the team's own unlinked tasks; stable inside each. */
export function prioritizeTasks<T extends Linked>(tasks: readonly T[]): T[] {
  return tasks
    .map((task, index) => ({ task, index }))
    .sort((a, b) => rank(a.task) - rank(b.task) || a.index - b.index)
    .map((entry) => entry.task);
}

/** One group per linked gate/criterion (in priority order), tasks without a link last. */
export function groupTasksByLink<T extends Linked>(
  tasks: readonly T[],
  language: Language = "da",
): TaskGroup<T>[] {
  const groups = new Map<string, TaskGroup<T>>();
  for (const task of prioritizeTasks(tasks)) {
    const id = task.link ? `${task.link.kind}:${task.link.key}` : "general";
    let group = groups.get(id);
    if (!group) {
      group = {
        id,
        label: task.link?.label ?? translate(language, "caseView.tasks.groupOther"),
        color: task.link?.color ?? null,
        tasks: [],
      };
      groups.set(id, group);
    }
    group.tasks.push(task);
  }
  return [...groups.values()];
}

/**
 * The tasks to show before "Vis N flere". Short lists show everything; a long list shows the first
 * PREVIEW_COUNT in priority order plus every task that must stay visible (being answered or just
 * resolved), so a row never vanishes under the user's hands.
 */
export function previewTasks<T extends Linked & { id: string }>(
  tasks: readonly T[],
  mustShow: (task: T) => boolean,
): T[] {
  if (tasks.length <= TASK_FOLD_THRESHOLD) return [...tasks];
  const ordered = prioritizeTasks(tasks);
  const keep = new Set(ordered.slice(0, TASK_PREVIEW_COUNT).map((task) => task.id));
  for (const task of tasks) if (mustShow(task)) keep.add(task.id);
  return ordered.filter((task) => keep.has(task.id));
}
