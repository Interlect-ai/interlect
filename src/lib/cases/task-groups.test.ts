import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  groupTasksByLink,
  previewTasks,
  prioritizeTasks,
  TASK_FOLD_THRESHOLD,
  TASK_PREVIEW_COUNT,
} from "./task-groups.ts";

const gate = {
  kind: "gate" as const,
  key: "g1",
  label: "Mandatfit, Ticket",
  color: "var(--action)",
};
const crit = {
  kind: "criterion" as const,
  key: "team",
  label: "Team",
  color: "var(--series-1)",
};
const make = (id: string, link: typeof gate | typeof crit | null) => ({ id, link });

describe("task groups", () => {
  it("puts gates first, then criteria, then general, keeping the given order inside", () => {
    const tasks = [
      make("a", null),
      make("b", crit),
      make("c", gate),
      make("d", crit),
      make("e", gate),
    ];
    assert.deepEqual(
      prioritizeTasks(tasks).map((t) => t.id),
      ["c", "e", "b", "d", "a"],
    );
  });

  it("groups by link and puts unlinked tasks in Øvrige last", () => {
    const groups = groupTasksByLink([
      make("a", null),
      make("b", crit),
      make("c", gate),
      make("d", crit),
    ]);
    assert.deepEqual(
      groups.map((g) => [g.id, g.tasks.map((t) => t.id)]),
      [
        ["gate:g1", ["c"]],
        ["criterion:team", ["b", "d"]],
        ["general", ["a"]],
      ],
    );
    assert.equal(groups.at(-1)?.label, "Øvrige");
  });

  it("orders the team's own unlinked tasks after the other unlinked ones", () => {
    const own = { id: "own", link: null, source: "user" };
    const groups = groupTasksByLink([own, make("x", null), make("y", crit)]);
    assert.deepEqual(
      groups.map((g) => g.tasks.map((t) => t.id)),
      [["y"], ["x", "own"]],
    );
  });

  it("T-1025: shows at most 4 open tasks of the whole list (0, 4, 5 and 8 tasks)", () => {
    const list = (count: number) => Array.from({ length: count }, (_, i) => make(`s${i}`, null));
    assert.equal(TASK_FOLD_THRESHOLD, 4);
    assert.equal(TASK_PREVIEW_COUNT, 4);
    assert.equal(previewTasks(list(0), () => false).length, 0);
    assert.equal(previewTasks(list(4), () => false).length, 4);
    assert.equal(previewTasks(list(5), () => false).length, 4);
    assert.equal(previewTasks(list(8), () => false).length, 4);
    const long = Array.from({ length: 84 }, (_, i) => make(`t${i}`, i % 2 ? crit : null));
    assert.equal(previewTasks(long, () => false).length, 4);
  });

  it("T-1025: the 4 shown are the most important, in priority order (gates, criteria, the rest)", () => {
    const tasks = [
      make("a", null),
      make("b", crit),
      { id: "own", link: null, source: "user" },
      make("c", gate),
      make("d", null),
      make("e", crit),
      make("f", gate),
    ];
    assert.deepEqual(
      previewTasks(tasks, () => false).map((t) => t.id),
      ["c", "f", "b", "e"],
    );
  });

  it("never hides a task that is being edited or just resolved", () => {
    const long = Array.from({ length: 30 }, (_, i) => make(`t${i}`, null));
    const shown = previewTasks(long, (t) => t.id === "t25");
    assert.equal(shown.length, 5);
    assert.ok(shown.some((t) => t.id === "t25"));
  });
});
