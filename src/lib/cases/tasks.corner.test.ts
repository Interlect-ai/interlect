/** Corner case from /harden (run 20260929-2217-4e3c4eb, finding S4-18). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAiTasks } from "./tasks.ts";

/** No lone surrogate (String.prototype.isWellFormed is ES2024; the project targets older libs). */
const wellFormed = (text: string) =>
  !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(text);

const source = (question: string) => ({
  gates: [],
  criteria: [],
  unresolvedGateKeys: [],
  missingCriterionKeys: [],
  assessments: [],
  openQuestions: [question],
});

// S4-18: clip() slices UTF-16 code units, so a 200-unit title can end in half an emoji
// (a lone surrogate). One malformed title can make the whole AI-task upsert for the run fail
// (writeAiTasks swallows the error and returns 0), or store U+FFFD, depending on PostgREST.
test("S4-18: clipped AI task titles and dedupe keys are well-formed Unicode", () => {
  const question = `${"a".repeat(198)}\u{1F680} og resten af et langt spørgsmål fra modellen`;
  const [task] = buildAiTasks(source(question));
  assert.ok(task, "a task is built");
  assert.ok(
    wellFormed(task.title),
    `title ends with a lone surrogate: ${JSON.stringify(task.title.slice(-3))}`,
  );
  assert.ok(wellFormed(task.dedupeKey), "dedupe key is well-formed");
});
