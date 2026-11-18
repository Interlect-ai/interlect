/**
 * Which tasks the Overblik Tasks sub-page lists and in what order. Pure.
 *
 * "Mine" are the open tasks assigned to you; "Alle" adds everyone else's and the ones assigned
 * to nobody (an AI task has no owner, and must not vanish). The order:
 * overdue first (the most overdue at the top), then by due date, tasks without a date last,
 * then the oldest first.
 */
import type { FundTask } from "./tasks.functions.ts";
import { daysUntil } from "./dates.ts";

export type TaskScope = "mine" | "all";

export function scopedTasks(tasks: readonly FundTask[], scope: TaskScope): FundTask[] {
  // Every fund member can read every task (row-level security), so "Alle" is a view choice
  // made here in the page, not something the server has to guard.
  return scope === "all" ? [...tasks] : tasks.filter((task) => task.mine);
}

export function isOverdue(task: Pick<FundTask, "dueOn">, now: Date): boolean {
  return task.dueOn !== null && daysUntil(task.dueOn, now) < 0;
}

export function sortTasks(tasks: readonly FundTask[], now: Date): FundTask[] {
  return [...tasks].sort((a, b) => {
    const lateA = isOverdue(a, now) ? 0 : 1;
    const lateB = isOverdue(b, now) ? 0 : 1;
    if (lateA !== lateB) return lateA - lateB;
    if (a.dueOn !== b.dueOn) {
      if (a.dueOn === null) return 1;
      if (b.dueOn === null) return -1;
      return a.dueOn < b.dueOn ? -1 : 1;
    }
    return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
  });
}
