import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildAiTasks,
  isBindingGateAnswer,
  MAX_AI_TASKS_PER_RUN,
  normalizeTaskText,
} from "./tasks.ts";

const base = {
  gates: [
    { key: "ownership", label: "Ejerandel mindst 10 %" },
    { key: "geo", label: "Nordisk selskab" },
  ],
  criteria: [
    { key: "team", label: "Team" },
    { key: "traction", label: "Traction" },
  ],
  unresolvedGateKeys: [] as string[],
  missingCriterionKeys: [] as string[],
  assessments: [] as Array<{ criterionKey: string; unknowns: string[] }>,
  openQuestions: [] as string[],
};

test("unknown gates become questions linked to the gate", () => {
  const tasks = buildAiTasks({ ...base, unresolvedGateKeys: ["ownership"] });
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0]?.title, "Afklar: Ejerandel mindst 10 %");
  assert.equal(tasks[0]?.kind, "question");
  assert.equal(tasks[0]?.linkedKind, "gate");
  assert.equal(tasks[0]?.linkedKey, "ownership");
});

test("criteria without evidence become research tasks", () => {
  const [task] = buildAiTasks({ ...base, missingCriterionKeys: ["traction"] });
  assert.equal(task?.title, "Find dokumentation: Traction");
  assert.equal(task?.kind, "research");
  assert.equal(task?.linkedKey, "traction");
});

test("at most two unknowns per criterion, as verification tasks", () => {
  const tasks = buildAiTasks({
    ...base,
    assessments: [{ criterionKey: "team", unknowns: ["A", "B", "C"] }],
  });
  assert.deepEqual(
    tasks.map((task) => task.title),
    ["Afklar: A", "Afklar: B"],
  );
  assert.ok(tasks.every((task) => task.kind === "verification" && task.linkedKey === "team"));
});

test("open questions and deep findings of type question/unknown", () => {
  const tasks = buildAiTasks({
    ...base,
    openQuestions: ["Hvad er runway?"],
    findings: [
      { findingType: "question", statement: "Hvem er CTO?" },
      { findingType: "strength", statement: "Stærkt team" },
    ],
  });
  assert.deepEqual(
    tasks.map((task) => [task.kind, task.title]),
    [
      ["question", "Hvad er runway?"],
      ["research", "Hvem er CTO?"],
    ],
  );
});

test("the same gap has the same key, even with other spacing or punctuation", () => {
  const first = buildAiTasks({ ...base, openQuestions: ["Hvad er  runway?"] })[0];
  const second = buildAiTasks({ ...base, openQuestions: ["hvad er runway"] })[0];
  assert.equal(first?.dedupeKey, second?.dedupeKey);
  assert.equal(normalizeTaskText("  Hvad ER runway?! "), "hvad er runway");
});

test("duplicates within one run are dropped, and a run writes at most 15", () => {
  const questions = Array.from({ length: 30 }, (_, index) => `Spørgsmål ${index}`);
  const tasks = buildAiTasks({ ...base, openQuestions: [...questions, "Spørgsmål 0"] });
  assert.equal(tasks.length, MAX_AI_TASKS_PER_RUN);
  assert.equal(new Set(tasks.map((task) => task.dedupeKey)).size, tasks.length);
});

test("unknown keys (not in the fund's configuration) are ignored", () => {
  const tasks = buildAiTasks({
    ...base,
    unresolvedGateKeys: ["removed_gate"],
    missingCriterionKeys: ["removed_criterion"],
    assessments: [{ criterionKey: "removed_criterion", unknowns: ["X"] }],
  });
  assert.equal(tasks.length, 0);
});

test("a resolved 'Ikke opfyldt' or an override is a binding gate answer (harden F1)", () => {
  const gate = (answerValue: Record<string, unknown> | null, status = "resolved") => ({
    linkedKind: "gate",
    status,
    answerValue,
  });
  assert.equal(isBindingGateAnswer(gate({ gatePassed: false })), true);
  assert.equal(isBindingGateAnswer(gate({ gatePassed: true, override: true })), true);
  assert.equal(isBindingGateAnswer(gate({ gatePassed: true })), false);
  assert.equal(isBindingGateAnswer(gate({ gatePassed: false }, "open")), false);
  assert.equal(isBindingGateAnswer(gate(null)), false);
  assert.equal(
    isBindingGateAnswer({
      linkedKind: "criterion",
      status: "resolved",
      answerValue: { gatePassed: false },
    }),
    false,
  );
});

test("a gate task is asked again under a new setup version; criteria tasks are not (harden S4R2-1)", () => {
  const source = (configVersionId: string | null) => ({
    configVersionId,
    gates: [{ key: "stage_fit", label: "Stadie passer" }],
    criteria: [{ key: "team", label: "Team" }],
    unresolvedGateKeys: ["stage_fit"],
    missingCriterionKeys: ["team"],
    assessments: [],
    openQuestions: [],
  });
  const keys = (version: string | null) =>
    new Map(buildAiTasks(source(version)).map((task) => [task.linkedKind, task.dedupeKey]));
  const v1 = keys("v1");
  const v2 = keys("v2");
  assert.notEqual(v1.get("gate"), v2.get("gate"));
  assert.equal(v1.get("criterion"), v2.get("criterion"));
  assert.equal(keys("v1").get("gate"), v1.get("gate"));
});

test("an English fund's tasks are written in English; the gaps compare the same (T-614b4c2a)", () => {
  const tasks = buildAiTasks({
    ...base,
    language: "en",
    unresolvedGateKeys: ["ownership"],
    missingCriterionKeys: ["traction"],
    assessments: [{ criterionKey: "team", unknowns: ["Obtain the CTO's contract", "the board"] }],
  });
  assert.deepEqual(
    tasks.map((task) => [task.title, task.why]),
    [
      [
        "Clarify: Ejerandel mindst 10 %",
        "Interlect could not decide the requirement from the material. An unknown requirement holds the case back.",
      ],
      [
        "Find documentation: Traction",
        "The criterion is scored with a cautious stage-adjusted base value because evidence is missing.",
      ],
      ["Obtain the CTO's contract", "Unknown in the assessment of Team."],
      ["Clarify: the board", "Unknown in the assessment of Team."],
    ],
  );
  // A Danish fund (no language) is unchanged.
  assert.equal(
    buildAiTasks({ ...base, unresolvedGateKeys: ["ownership"] })[0]?.title,
    "Afklar: Ejerandel mindst 10 %",
  );
});
