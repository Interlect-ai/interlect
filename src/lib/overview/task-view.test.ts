import { test } from "node:test";
import assert from "node:assert/strict";
import { isOverdue, scopedTasks, sortTasks } from "./task-view.ts";
import type { FundTask } from "./tasks.functions.ts";

const NOW = new Date("2026-10-01T10:00:00Z");

const task = (id: string, over: Partial<FundTask> = {}): FundTask => ({
  id,
  caseId: "c",
  caseName: "Selskab",
  caseView: "screening",
  title: id,
  description: null,
  why: null,
  kind: "question",
  assigneeId: null,
  assigneeName: null,
  mine: false,
  dueOn: null,
  linkedKind: null,
  linkedKey: null,
  createdAt: "2026-09-20T10:00:00Z",
  ...over,
});

test("'Mine' are only the tasks assigned to you; 'Alle' adds nobody's and others'", () => {
  const all = [
    task("mine", { mine: true, assigneeId: "me" }),
    task("nobody"),
    task("other", { assigneeId: "other", assigneeName: "Maja" }),
  ];
  assert.deepEqual(
    scopedTasks(all, "mine").map((entry) => entry.id),
    ["mine"],
  );
  assert.deepEqual(
    scopedTasks(all, "all").map((entry) => entry.id),
    ["mine", "nobody", "other"],
  );
});

test("overdue is the day before today in Denmark (due today is not overdue)", () => {
  assert.equal(isOverdue(task("a", { dueOn: "2026-09-30" }), NOW), true);
  assert.equal(isOverdue(task("b", { dueOn: "2026-10-01" }), NOW), false);
  assert.equal(isOverdue(task("c", { dueOn: null }), NOW), false);
});

test("overdue first (most overdue at the top), then by date, undated last, then oldest", () => {
  const sorted = sortTasks(
    [
      task("undated-new", { createdAt: "2026-09-25T10:00:00Z" }),
      task("later", { dueOn: "2026-10-09" }),
      task("late-a-bit", { dueOn: "2026-09-30" }),
      task("undated-old", { createdAt: "2026-09-10T10:00:00Z" }),
      task("today", { dueOn: "2026-10-01" }),
      task("late-a-lot", { dueOn: "2026-09-20" }),
    ],
    NOW,
  );
  assert.deepEqual(
    sorted.map((entry) => entry.id),
    ["late-a-lot", "late-a-bit", "today", "later", "undated-old", "undated-new"],
  );
});
