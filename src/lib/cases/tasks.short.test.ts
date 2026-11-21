/** Short titles, the question as description, a deadline. Kør: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildAiTaskDrafts,
  MAX_SCREENING_NEXT_STEPS,
  planAiTaskWrites,
  sanitizeNextSteps,
  shortTaskTitle,
  TASK_DUE_DAYS,
  type AiTaskSource,
  type ExistingTaskRow,
} from "./tasks.ts";

const gates = [
  { key: "geo", label: "Nordisk selskab", treatment: "review" },
  { key: "ownership", label: "Ejerandel mindst 10 %", treatment: "hard" },
];
const criteria = [
  { key: "team", label: "Team og founders" },
  { key: "traction", label: "Traction" },
];
const keys = { gates: ["geo", "ownership"], criteria: ["team", "traction"] };

/** A screening with its own curated list (prompt v12). */
const screening = (over: Partial<AiTaskSource> = {}): AiTaskSource => ({
  gates,
  criteria,
  unresolvedGateKeys: [],
  missingCriterionKeys: [],
  assessments: [{ criterionKey: "team", unknowns: ["Arbejdsdelingen mellem founderne"] }],
  openQuestions: ["Hvad er den månedlige churn?"],
  nextSteps: sanitizeNextSteps(
    [
      {
        title: "Værdiansættelse før runden",
        question: "Bed CEO om pre-money-værdiansættelsen for den kommende runde.",
        why: "Uden den kan ejerandelen ikke vurderes.",
        kind: "question",
        linkedKind: "criterion",
        linkedKey: "traction",
        priority: 1,
      },
      {
        title: "Churn pr. kohorte",
        question: "Indhent månedlig churn pr. kundekohorte for de seneste 12 måneder.",
        why: "Retention bærer traction-scoren.",
        kind: "document",
        linkedKind: null,
        linkedKey: null,
        priority: 2,
      },
    ],
    keys,
    MAX_SCREENING_NEXT_STEPS,
  ),
  ...over,
});

const words = (text: string) => text.replace("…", "").trim().split(/\s+/).length;

test("shortTaskTitle keeps six words, cuts longer at a word and never ends on a joining word", () => {
  assert.deepEqual(shortTaskTitle("Licensstatus i Norge"), {
    title: "Licensstatus i Norge",
    cut: false,
  });
  const cut = shortTaskTitle("Indhent dokumentation for de tre største kunders kontrakter i 2025");
  assert.equal(cut.cut, true);
  assert.ok(cut.title.endsWith("…"));
  assert.ok(words(cut.title) <= 6);
  assert.doesNotMatch(cut.title, /\b(for|de|i|og)…$/);
  // A text over the length limit is cut even with few words.
  assert.ok(shortTaskTitle(`${"a".repeat(70)} b`).title.length <= 60);
});

test("sanitizeNextSteps keeps the question, and a long title becomes the question when none is given", () => {
  const [kept, cut] = sanitizeNextSteps(
    [
      {
        title: "Cap table efter konvertering",
        question: "Indhent cap table efter konverteringen af lånet i 2025.",
        kind: "document",
        priority: 1,
      },
      {
        title: "Indhent kontrakterne med de tre største kunder og tal med dem",
        kind: "document",
        priority: 2,
      },
    ],
    keys,
  );
  assert.equal(kept!.title, "Cap table efter konvertering");
  assert.equal(kept!.question, "Indhent cap table efter konverteringen af lånet i 2025.");
  assert.ok(words(cut!.title) <= 6);
  assert.equal(cut!.question, "Indhent kontrakterne med de tre største kunder og tal med dem");
  // The screening's list has its own cap.
  const many = Array.from({ length: 12 }, (_, index) => ({
    title: `Opgave nummer ${index}`,
    kind: "task",
    priority: 2,
  }));
  assert.equal(sanitizeNextSteps(many, keys, MAX_SCREENING_NEXT_STEPS).length, 4);
});

test("T-1025: the screening's list holds at most 4 steps (0, 4, 5 and 8 in), most important first", () => {
  assert.equal(MAX_SCREENING_NEXT_STEPS, 4);
  const steps = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      title: `Opgave ${index}`,
      kind: "task",
      // Every third is priority 1, the rest 2 and 3: the order is by priority, then as written.
      priority: index % 3 === 2 ? 1 : index % 2 ? 3 : 2,
    }));
  const titles = (count: number) =>
    sanitizeNextSteps(steps(count), keys, MAX_SCREENING_NEXT_STEPS).map((step) => step.title);
  assert.deepEqual(titles(0), []);
  assert.deepEqual(titles(4), ["Opgave 2", "Opgave 0", "Opgave 1", "Opgave 3"]);
  assert.deepEqual(titles(5), ["Opgave 2", "Opgave 0", "Opgave 4", "Opgave 1"]);
  // 8 in: both priority-1 steps first, then priority 2 in the model's order; priority 3 is cut.
  assert.deepEqual(titles(8), ["Opgave 2", "Opgave 5", "Opgave 0", "Opgave 4"]);
  // The screening's own tasks are built from the capped list only.
  const drafts = buildAiTaskDrafts(
    screening({ nextSteps: sanitizeNextSteps(steps(8), keys, MAX_SCREENING_NEXT_STEPS) }),
  );
  assert.equal(drafts.length, 4);
});

test("a screening with a curated list: short titles, the question as description, no raw questions", () => {
  const drafts = buildAiTaskDrafts(screening());
  assert.deepEqual(
    drafts.map((draft) => draft.title),
    ["Værdiansættelse før runden", "Churn pr. kohorte"],
  );
  assert.equal(
    drafts[0]!.description,
    "Bed CEO om pre-money-værdiansættelsen for den kommende runde.",
  );
  // Priority 1 is urgent (one week), priority 2 gets two weeks.
  assert.deepEqual(
    drafts.map((draft) => draft.dueInDays),
    [TASK_DUE_DAYS.urgent, TASK_DUE_DAYS.normal],
  );
  // The gap is keyed on the question, not the short title.
  assert.match(drafts[0]!.dedupeKey, /bed ceo om pre-money-værdiansættelsen/);
});

test("an unknown gate and a criterion without evidence get a short title, a question and a deadline", () => {
  const drafts = buildAiTaskDrafts(
    screening({ unresolvedGateKeys: ["geo"], missingCriterionKeys: ["team"], nextSteps: [] }),
  );
  const gate = drafts.find((draft) => draft.linkedKind === "gate")!;
  assert.equal(gate.title, "Afklar: Nordisk selskab");
  assert.match(gate.description ?? "", /Opfylder casen kravet «Nordisk selskab»\?/);
  assert.equal(gate.dueInDays, TASK_DUE_DAYS.urgent);
  const missing = drafts.find((draft) => draft.linkedKey === "team")!;
  assert.equal(missing.title, "Find dokumentation: Team og founders");
  assert.match(missing.description ?? "", /hvordan selskabet står på Team og founders/);
  assert.equal(missing.dueInDays, TASK_DUE_DAYS.normal);
  for (const draft of drafts) assert.ok(words(draft.title) <= 6, draft.title);
});

test("English teams get the builder's own wording in English", () => {
  const [gate] = buildAiTaskDrafts(
    screening({ language: "en", unresolvedGateKeys: ["geo"], nextSteps: [] }),
  );
  assert.equal(gate!.title, "Clarify: Nordisk selskab");
  assert.match(gate!.description ?? "", /^Does the case meet the requirement/);
});

const existingRow = (over: Partial<ExistingTaskRow>): ExistingTaskRow => ({
  id: "old",
  dedupeKey: "criterion:traction:something else",
  title: "Bed CEO om pre-money-værdiansættelsen for den kommende runde",
  description: null,
  origin: "ai",
  status: "open",
  assigneeId: "u1",
  dueOn: null,
  answerText: null,
  answerValue: null,
  answerDocumentId: null,
  answerEvidenceId: null,
  resolvedAt: null,
  createdAt: "2026-10-01T10:00:00Z",
  updatedAt: "2026-10-02T10:00:00Z",
  deletedAt: null,
  deletedBy: null,
  sourceRunId: "run-old",
  sourceRunKind: "deep",
  linkedKind: "criterion",
  linkedKey: "traction",
  ...over,
});

test("an older task whose title was the whole question is the same gap as a new short-titled task", () => {
  const raised = buildAiTaskDrafts(screening());
  const plan = planAiTaskWrites({
    runId: "run-new",
    runKind: "screening",
    raised,
    cap: 15,
    existing: [existingRow({})],
  });
  // The touched older task covers the first step; only the second is new.
  assert.deepEqual(
    plan.insert.map((draft) => draft.title),
    ["Churn pr. kohorte"],
  );
  // And a new-style task (short title, question as description) is recognised by its question.
  const again = planAiTaskWrites({
    runId: "run-newer",
    runKind: "screening",
    raised,
    cap: 15,
    existing: [
      existingRow({
        title: "Pre-money før runden",
        description: "Bed CEO om pre-money-værdiansættelsen for den kommende runde.",
      }),
    ],
  });
  assert.deepEqual(
    again.insert.map((draft) => draft.title),
    ["Churn pr. kohorte"],
  );
});

test("review: a requirement the team answered is not asked again when a step names it (same version)", () => {
  const first = buildAiTaskDrafts(
    screening({ configVersionId: "v1", unresolvedGateKeys: ["geo"], nextSteps: [] }),
  );
  const gateKey = first.find((draft) => draft.linkedKind === "gate")!.dedupeKey;
  // The team answered "Opfyldt": the gate is no longer unresolved, but the model still writes a
  // step on it (or it is a finance gate the code decides).
  const again = buildAiTaskDrafts(
    screening({
      configVersionId: "v1",
      nextSteps: sanitizeNextSteps(
        [
          {
            title: "Hovedsæde i Norden",
            question: "Bekræft selskabets hovedsæde i CVR.",
            kind: "verification",
            linkedKind: "gate",
            linkedKey: "geo",
            priority: 1,
          },
        ],
        keys,
      ),
    }),
  );
  const step = again.find((draft) => draft.linkedKind === "gate")!;
  assert.equal(step.dedupeKey, gateKey, "keyed on the requirement, not the step's wording");
  const plan = planAiTaskWrites({
    runId: "run-2",
    runKind: "screening",
    raised: again,
    cap: 15,
    existing: [
      existingRow({
        id: "answered",
        dedupeKey: gateKey,
        title: "Afklar: Nordisk selskab",
        status: "resolved",
        resolvedAt: "2026-10-03T10:00:00Z",
        answerValue: { gatePassed: true },
        linkedKind: "gate",
        linkedKey: "geo",
        sourceRunKind: "screening",
      }),
    ],
  });
  assert.equal(plan.insert.filter((draft) => draft.linkedKind === "gate").length, 0);
});

test("review: different founder questions on one criterion are different gaps", () => {
  const ask = (question: string) =>
    buildAiTaskDrafts(
      screening({
        nextSteps: [],
        researchQuestions: [{ kind: "criterion", key: "traction", question, note: "" }],
      }),
    ).find((draft) => draft.linkedKey === "traction")!;
  const mrr = ask("Hvad er jeres MRR pr. måned i 2026?");
  const renewals = ask("Hvor mange kontrakter er fornyet i år?");
  assert.equal(mrr.title, renewals.title, "the same template title");
  const plan = planAiTaskWrites({
    runId: "run-2",
    runKind: "screening",
    raised: [renewals],
    cap: 15,
    existing: [
      existingRow({
        title: mrr.title,
        description: mrr.description ?? null,
        dedupeKey: mrr.dedupeKey,
        status: "resolved",
        resolvedAt: "2026-10-03T10:00:00Z",
        answerText: "40.000 kr.",
      }),
    ],
  });
  assert.deepEqual(
    plan.insert.map((draft) => draft.description),
    ["Hvor mange kontrakter er fornyet i år?"],
  );
});

test("review: a requirement with a quote keeps the key an older run stored", () => {
  const quoted = buildAiTaskDrafts(
    screening({
      configVersionId: "v1",
      gates: [{ key: "sector", label: 'Sektor: "klima"', treatment: "hard" }],
      unresolvedGateKeys: ["sector"],
      nextSteps: [],
    }),
  )[0]!;
  // Before the key came from the cleaned title (the trailing quote stripped).
  assert.equal(quoted.dedupeKey, 'gate@v1:sector:afklar: sektor: "klima');
});

test("T-1025: five unknown gates and a full list of 4: every gate still gets its task", () => {
  const fiveGates = Array.from({ length: 5 }, (_, index) => ({
    key: `g${index}`,
    label: `Krav ${index}`,
    treatment: "review",
  }));
  const gateKeys = { gates: fiveGates.map((gate) => gate.key), criteria: keys.criteria };
  const nextSteps = sanitizeNextSteps(
    [
      { title: "Churn pr. kohorte", kind: "document", priority: 2 },
      ...fiveGates.map((gate) => ({
        title: `Afklar ${gate.label}`,
        kind: "question",
        linkedKind: "gate",
        linkedKey: gate.key,
        priority: 1,
      })),
    ],
    gateKeys,
    MAX_SCREENING_NEXT_STEPS,
  );
  // The list keeps 4, all of them gate steps (priority 1 first).
  assert.equal(nextSteps.length, 4);
  assert.ok(nextSteps.every((step) => step.linkedKind === "gate"));
  const drafts = buildAiTaskDrafts(
    screening({
      gates: fiveGates,
      unresolvedGateKeys: fiveGates.map((gate) => gate.key),
      nextSteps,
    }),
  );
  // Code makes the fifth gate's task itself; no gate is left without one.
  const gateTasks = drafts.filter((draft) => draft.linkedKind === "gate");
  assert.deepEqual(gateTasks.map((draft) => draft.linkedKey).sort(), [
    "g0",
    "g1",
    "g2",
    "g3",
    "g4",
  ]);
});
