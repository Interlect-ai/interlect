import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildAiTaskDrafts,
  buildAiTasks,
  classifyTaskKind,
  isNearDuplicateTitle,
  isSystemRetired,
  isUntouchedAiTask,
  MAX_AI_TASKS_PER_DEEP_RUN,
  MAX_AI_TASKS_PER_RUN,
  planAiTaskWrites,
  resolveTaskSource,
  type AiTaskDraft,
  type AiTaskSource,
  type ExistingTaskRow,
} from "./tasks.ts";
import { deepTaskSource } from "./deep-tasks.ts";

const base: AiTaskSource = {
  gates: [
    { key: "geo", label: "Nordisk selskab", treatment: "review" },
    { key: "ownership", label: "Ejerandel mindst 10 %", treatment: "hard" },
  ],
  criteria: [
    {
      key: "team",
      label: "Team og founders",
      description: "Founderens erfaring og komplementaritet",
    },
    { key: "tech", label: "Teknologi", description: "Produktets tekniske fundament og IP" },
    { key: "traction", label: "Traction" },
  ],
  unresolvedGateKeys: [],
  missingCriterionKeys: [],
  assessments: [],
  openQuestions: [],
};

const risk = (
  level: string,
  label: string,
  mitigation: string | null = "Indhent kontrakten. Gennemgå vilkårene.",
) => ({
  riskKey: label,
  label,
  level,
  rationale: "Kundekoncentrationen kan vælte salget. Der er kun to betalende kunder.",
  mitigation,
});

test("priority order: binding gates, other gates, critical risks, high risks, then the rest", () => {
  const drafts = buildAiTaskDrafts({
    ...base,
    unresolvedGateKeys: ["geo", "ownership"],
    openQuestions: ["Hvad er runway?"],
    missingCriterionKeys: ["traction"],
    risks: [
      risk("high", "Platformafhængighed"),
      risk("critical", "Kundekoncentration"),
      risk("low", "Støj"),
    ],
  });
  assert.deepEqual(
    drafts.map((draft) => draft.title),
    [
      "Afklar: Ejerandel mindst 10 %",
      "Afklar: Nordisk selskab",
      "Afklar kritisk risiko: Kundekoncentration",
      "Reducer risikoen: Platformafhængighed",
      "Find dokumentation: Traction",
      "Hvad er runway?",
    ],
  );
});

test("a high or critical risk becomes a task with the mechanism as why and the plan as text", () => {
  const [task] = buildAiTaskDrafts({ ...base, risks: [risk("critical", "Kundekoncentration")] });
  assert.equal(task?.why, "Kundekoncentrationen kan vælte salget.");
  assert.equal(task?.description, "Indhent kontrakten. Gennemgå vilkårene.");
  assert.equal(task?.kind, "document");
  assert.equal(task?.linkedKind, null);
});

test("low and medium risks, and risks without a plan, make no task", () => {
  const drafts = buildAiTaskDrafts({
    ...base,
    risks: [risk("medium", "A"), risk("low", "B"), risk("high", "C", null)],
  });
  assert.equal(drafts.length, 0);
});

test("specialist questions link to the only criterion, else to the best word match, else none", () => {
  const tasks = buildAiTaskDrafts({
    ...base,
    specialists: [
      {
        moduleId: "tech",
        label: "Teknologi og IP",
        criterionKeys: ["tech"],
        questions: ["Hvem ejer koden?"],
        unknowns: [],
      },
      {
        moduleId: "people_team",
        label: "Team",
        criterionKeys: ["team", "tech"],
        questions: ["Hvilken erfaring har founderen med salg?", "Hvad er lønniveauet?"],
        unknowns: ["Vesting for founders"],
      },
    ],
  });
  const byTitle = new Map(tasks.map((task) => [task.title, task]));
  assert.equal(byTitle.get("Hvem ejer koden?")?.linkedKey, "tech");
  assert.equal(byTitle.get("Hvilken erfaring har founderen med salg?")?.linkedKey, "team");
  assert.equal(byTitle.get("Hvad er lønniveauet?")?.linkedKey, null);
  assert.equal(byTitle.get("Afklar: Vesting for founders")?.kind, "research");
  assert.ok(
    tasks.every((task) => task.why?.startsWith("Rejst af") || task.why?.startsWith("Ukendt")),
  );
});

test("at most two questions and one unknown per specialist", () => {
  const tasks = buildAiTaskDrafts({
    ...base,
    specialists: [
      {
        moduleId: "tech",
        label: "Teknologi",
        criterionKeys: ["tech"],
        questions: ["Spørgsmål a", "Spørgsmål b", "Spørgsmål c"],
        unknowns: ["Ukendt a", "Ukendt b"],
      },
    ],
  });
  assert.equal(tasks.length, 3);
});

test("the investment condition is NOT a task; the counter-thesis check is one task", () => {
  const tasks = buildAiTaskDrafts({
    ...base,
    investmentCondition: "Founderen skal have en aftale med CTO om vesting før closing.",
    contraryCase: "Den stærkeste modfortolkning er, at væksten alene skyldes en enkelt pilotkunde.",
  });
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0]!.title, "Afprøv den stærkeste modfortolkning af casen");
  // A very short counter-thesis is not worth a task.
  assert.equal(buildAiTaskDrafts({ ...base, contraryCase: "Kort." }).length, 0);
});

test("the same gap in other words is one task, also across specialists and findings", () => {
  const tasks = buildAiTaskDrafts({
    ...base,
    openQuestions: ["Hvem er de betalende kunder og hvor stor er deres årlige omsætning?"],
    specialists: [
      {
        moduleId: "product",
        label: "Produkt og marked",
        criterionKeys: ["traction"],
        questions: ["Hvor stor er årlig omsætning og hvem er de betalende kunder"],
        unknowns: [],
      },
    ],
  });
  assert.equal(tasks.length, 1);
  assert.equal(isNearDuplicateTitle("Spørgsmål 1", "Spørgsmål 2"), false);
});

test("the run's cap is respected, and the cap cuts the least important tasks", () => {
  const questions = Array.from(
    { length: 40 },
    (_, index) => `Åbent spørgsmål nummer ${index} om noget`,
  );
  const source: AiTaskSource = {
    ...base,
    unresolvedGateKeys: ["ownership"],
    risks: [risk("critical", "Kritisk risiko")],
    openQuestions: questions,
  };
  const screening = buildAiTasks(source);
  assert.equal(screening.length, MAX_AI_TASKS_PER_RUN);
  assert.equal(screening[0]?.linkedKey, "ownership");
  assert.match(screening[1]!.title, /Kritisk risiko/);
  const deep = buildAiTasks({ ...source, maxTasks: MAX_AI_TASKS_PER_DEEP_RUN });
  assert.equal(deep.length, MAX_AI_TASKS_PER_DEEP_RUN);
  assert.equal(new Set(deep.map((task) => task.dedupeKey)).size, deep.length);
  // The uncapped list still has everything (used to decide what a newer run no longer raises).
  assert.equal(buildAiTaskDrafts(source).length, 42);
});

test("classifyTaskKind picks the kind of work from the words", () => {
  assert.equal(classifyTaskKind("Tag referencer hos tidligere arbejdsgivere."), "meeting");
  assert.equal(classifyTaskKind("Indhent cap table og aftaler."), "document");
  assert.equal(classifyTaskKind("Verificér kundeforholdet."), "verification");
  assert.equal(classifyTaskKind("Hvad er runway?"), "question");
  assert.equal(classifyTaskKind("Kortlæg konkurrenterne"), "research");
});

test("deepTaskSource hands the specialists, risks, condition and the deep cap to the builder", () => {
  const source = deepTaskSource({
    configVersionId: "v1",
    profile: {
      gates: base.gates,
      criteria: [
        { key: "team", label: "Team og founders", category: "founder_market_fit" },
        { key: "tech", label: "Teknologi", category: "product_technology" },
      ],
    },
    modules: [
      { id: "people_team", title: "Founder, ledelse og team", categories: ["founder_market_fit"] },
      { id: "technology_risk", title: "Teknologi", categories: ["product_technology"] },
    ],
    unresolvedGateKeys: ["ownership"],
    missingCriterionKeys: [],
    output: {
      assessments: [{ criterionKey: "team", unknowns: ["A", "B"] }],
      openQuestions: [],
      risks: [risk("high", "Nøgleperson")],
      contraryCase: null,
      investmentCondition: "Sikr vesting.",
    },
    specialists: [
      { moduleId: "people_team", questions: ["Hvem er CTO?"], unknowns: [] },
      { moduleId: "gone", questions: ["Ignoreret?"], unknowns: [] },
    ],
  });
  assert.equal(source.maxTasks, MAX_AI_TASKS_PER_DEEP_RUN);
  assert.equal(source.specialists?.length, 1);
  assert.equal(source.specialists?.[0]?.label, "Team");
  assert.deepEqual(source.specialists?.[0]?.criterionKeys, ["team"]);
  const titles = buildAiTasks(source).map((task) => task.title);
  assert.equal(titles[0], "Afklar: Ejerandel mindst 10 %");
  assert.ok(titles.includes("Hvem er CTO?"));
  // One unknown per criterion in a deep run.
  assert.equal(titles.filter((title) => title === "Afklar: A" || title === "Afklar: B").length, 1);
});

// --- a newer run and the tasks the case already has -----------------------------------

const row = (over: Partial<ExistingTaskRow>): ExistingTaskRow => ({
  id: "t1",
  dedupeKey: "criterion:team:hvem er cto",
  title: "Hvem er CTO?",
  description: null,
  origin: "ai",
  status: "open",
  assigneeId: null,
  dueOn: null,
  answerText: null,
  answerValue: null,
  answerDocumentId: null,
  answerEvidenceId: null,
  resolvedAt: null,
  createdAt: "2026-09-30T10:00:00.000000+00:00",
  updatedAt: "2026-09-30T10:00:00.000000+00:00",
  deletedAt: null,
  deletedBy: null,
  sourceRunId: "run-old",
  sourceRunKind: "screening",
  linkedKind: "criterion",
  linkedKey: "team",
  ...over,
});

const draft = (over: Partial<AiTaskDraft>): AiTaskDraft => ({
  matchText: over.title ?? "Hvem er CTO?",
  dueInDays: 14,
  kind: "question",
  title: "Hvem er CTO?",
  why: null,
  linkedKind: "criterion",
  linkedKey: "team",
  dedupeKey: "criterion:team:hvem er cto",
  ...over,
});

const plan = (
  existing: ExistingTaskRow[],
  raised: AiTaskDraft[],
  runKind: "screening" | "deep" = "screening",
  cap = 99,
) => planAiTaskWrites({ runId: "run-new", runKind, raised, cap, existing });

/** A gap unrelated to the test's own rows: a run that raises something, so retirement applies. */
const other = draft({
  title: "Et helt andet hul",
  dedupeKey: "other-gap",
  linkedKind: null,
  linkedKey: null,
});

test("untouched means open, unanswered and never edited", () => {
  assert.equal(isUntouchedAiTask(row({})), true);
  // An AI task is written with its responsible person and deadline; that alone is untouched.
  assert.equal(isUntouchedAiTask(row({ assigneeId: "u1", dueOn: "2026-10-10" })), true);
  // A person who changes them moves updated_at.
  assert.equal(
    isUntouchedAiTask(row({ assigneeId: "u2", updatedAt: "2026-09-30T12:00:00.000000+00:00" })),
    false,
  );
  assert.equal(isUntouchedAiTask(row({ answerText: "Svar" })), false);
  assert.equal(isUntouchedAiTask(row({ answerValue: { number: 1 } })), false);
  assert.equal(isUntouchedAiTask(row({ status: "resolved", resolvedAt: "x" })), false);
  assert.equal(isUntouchedAiTask(row({ updatedAt: "2026-09-30T11:00:00.000000+00:00" })), false);
  assert.equal(isUntouchedAiTask(row({ origin: "user" })), false);
});

test("a gap the run no longer raises is retired, but only when nobody touched it", () => {
  const existing = [
    row({ id: "untouched", dedupeKey: "k1", title: "Gammelt hul om markedet" }),
    // Written with a responsible person, then reassigned by a person (updated_at moved).
    row({
      id: "assigned",
      dedupeKey: "k2",
      title: "Andet hul",
      assigneeId: "u1",
      updatedAt: "2026-09-30T11:30:00.000000+00:00",
    }),
    row({
      id: "answered",
      dedupeKey: "k3",
      title: "Tredje hul",
      answerText: "x",
      status: "resolved",
      resolvedAt: "x",
    }),
    row({
      id: "edited",
      dedupeKey: "k4",
      title: "Fjerde hul",
      updatedAt: "2026-09-30T12:00:00.000000+00:00",
    }),
    row({
      id: "mine",
      dedupeKey: null,
      title: "Min opgave",
      origin: "user",
      sourceRunId: null,
      sourceRunKind: null,
    }),
    row({
      id: "already-deleted",
      dedupeKey: "k5",
      title: "Slettet",
      deletedAt: "2026-09-30T13:00:00Z",
      deletedBy: "u1",
      updatedAt: "2026-09-30T13:00:00.000000+00:00",
    }),
  ];
  const result = plan(existing, [other]);
  assert.deepEqual(result.retire, ["untouched"]);
  assert.deepEqual(result.insert, [other]);
});

test("a gap the run raises again is kept, not duplicated, in the same or other words", () => {
  const same = plan([row({})], [draft({})]);
  assert.deepEqual([same.insert.length, same.retire.length, same.restore.length], [0, 0, 0]);
  const reworded = plan(
    [
      row({
        title: "Hvem er virksomhedens tekniske direktør og hvad er baggrunden?",
        dedupeKey: "old",
      }),
    ],
    [
      draft({
        title: "Hvad er baggrunden for virksomhedens tekniske direktør, og hvem er det?",
        dedupeKey: "new",
      }),
    ],
  );
  assert.deepEqual([reworded.insert.length, reworded.retire.length], [0, 0]);
});

test("a gap cut by the cap is still raised, so its older task is kept", () => {
  const cut = draft({
    title: "Et hul uden for loftet",
    dedupeKey: "cut",
    linkedKind: null,
    linkedKey: null,
  });
  const result = plan(
    [row({ dedupeKey: "cut", title: "Et hul uden for loftet", linkedKind: null, linkedKey: null })],
    [other, cut],
    "screening",
    1,
  );
  assert.deepEqual(result.insert, [other]);
  assert.deepEqual(result.retire, []);
});

test("only new gaps count against the cap; covered ones do not, and the order decides", () => {
  const covered = row({
    dedupeKey: "covered",
    title: "Dækket hul om teamet",
    linkedKind: null,
    linkedKey: null,
  });
  const deleted = row({
    id: "gone",
    dedupeKey: "deleted",
    title: "Slettet hul om markedet",
    linkedKind: null,
    linkedKey: null,
    deletedAt: "2026-09-30T13:00:00Z",
    deletedBy: "u1",
    updatedAt: "2026-09-30T13:00:00.000000+00:00",
  });
  const gap = (key: string) =>
    draft({ title: key, dedupeKey: key, linkedKind: null, linkedKey: null });
  const result = plan(
    [covered, deleted],
    [
      gap("Dækket hul om teamet"),
      gap("Slettet hul om markedet"),
      gap("Nyt hul et"),
      gap("Nyt hul to"),
      gap("Nyt hul tre"),
    ],
    "screening",
    2,
  );
  // covered ones are free, so two real new gaps fit; the third is cut (lowest importance last).
  assert.deepEqual(
    result.insert.map((item) => item.title),
    ["Nyt hul et", "Nyt hul to"],
  );
  assert.deepEqual(result.retire, []);
});

test("a run that raised nothing retires nothing", () => {
  assert.deepEqual(plan([row({})], []).retire, []);
});

test("two drafts for one retired task: the second is inserted, not dropped", () => {
  const retired = row({ deletedAt: "2026-09-30T13:00:00Z" });
  const first = draft({ dedupeKey: "a" });
  const second = draft({ dedupeKey: "b", title: "Hvem er CTO?" });
  const result = plan([retired], [first, second]);
  assert.deepEqual(
    result.restore.map((item) => item.id),
    ["t1"],
  );
  assert.deepEqual(result.insert, [second]);
});

test("the fixed risk prefixes are not compared: a risk that turns critical is the same gap", () => {
  assert.equal(
    isNearDuplicateTitle(
      "Reducer risikoen: Kundekoncentration",
      "Afklar kritisk risiko: Kundekoncentration",
    ),
    true,
  );
  assert.equal(
    isNearDuplicateTitle(
      "Reducer risikoen: Kundekoncentration",
      "Reducer risikoen: Platformafhængighed",
    ),
    false,
  );
  // Long labels: the prefix words alone must not make two different risks look alike.
  assert.equal(
    isNearDuplicateTitle(
      "Reducer risikoen: Manglende dokumenteret retention i betalende kundegrupper",
      "Reducer risikoen: Afhængighed af enkelt underleverandør til produktionen",
    ),
    false,
  );
});

test("never recreates what the team deleted or resolved", () => {
  const byPerson = row({
    deletedAt: "2026-09-30T13:00:00Z",
    deletedBy: "u1",
    updatedAt: "2026-09-30T13:00:00.000000+00:00",
  });
  const resolved = row({
    id: "t2",
    status: "resolved",
    resolvedAt: "x",
    answerText: "Svar",
    dedupeKey: "other",
    title: "Andet spørgsmål om teamet",
  });
  const result = plan(
    [byPerson, resolved],
    [draft({}), draft({ title: "Andet spørgsmål om teamet", dedupeKey: "other" })],
  );
  assert.deepEqual([result.insert.length, result.restore.length, result.retire.length], [0, 0, 0]);
});

test("a user delete whose person later vanished (deleted_by null) is still not undone", () => {
  // The delete set updated_at, so the row is not 'untouched' and not system-retired.
  const gone = row({
    deletedAt: "2026-09-30T13:00:00Z",
    deletedBy: null,
    updatedAt: "2026-09-30T13:00:00.000000+00:00",
  });
  assert.equal(isSystemRetired(gone), false);
  assert.deepEqual(plan([gone], [draft({})]).restore, []);
});

test("a gap the system retired earlier comes back when a newer run raises it", () => {
  const retired = row({ deletedAt: "2026-09-30T13:00:00Z" });
  assert.equal(isSystemRetired(retired), true);
  const result = plan([retired], [draft({ why: "Ny begrundelse" })]);
  assert.equal(result.insert.length, 0);
  assert.deepEqual(
    result.restore.map((item) => item.id),
    ["t1"],
  );
  assert.equal(result.restore[0]?.draft.why, "Ny begrundelse");
});

test("a run retires only tasks of its own kind (a deep run never retires screening tasks)", () => {
  const existing = [
    row({ id: "s", dedupeKey: "s", title: "Screening-hul", sourceRunKind: "screening" }),
    row({
      id: "d",
      dedupeKey: "d",
      title: "Dyb-hul",
      sourceRunKind: "deep",
      sourceRunId: "run-deep",
    }),
    row({
      id: "orphan",
      dedupeKey: "o",
      title: "Uden kørsel",
      sourceRunKind: null,
      sourceRunId: null,
    }),
  ];
  assert.deepEqual(plan(existing, [other], "screening").retire, ["s"]);
  assert.deepEqual(plan(existing, [other], "deep").retire, ["d"]);
});

test("a gate still unresolved under a new setup version is asked again; the old untouched one is retired", () => {
  const old = row({
    id: "g",
    dedupeKey: "gate@v1:ownership:afklar: ejer",
    title: "Afklar: Ejer",
    linkedKind: "gate",
    linkedKey: "ownership",
  });
  const next = draft({
    dedupeKey: "gate@v2:ownership:afklar: ejer",
    title: "Afklar: Ejer",
    linkedKind: "gate",
    linkedKey: "ownership",
  });
  const result = plan([old], [next]);
  assert.equal(result.insert.length, 1);
  assert.deepEqual(result.retire, ["g"]);
});

test("a task's source run kind comes from its run, null when the run is unknown", () => {
  const kinds = new Map([["r1", "deep" as const]]);
  assert.deepEqual(resolveTaskSource("r1", kinds), { sourceRunId: "r1", sourceRunKind: "deep" });
  assert.deepEqual(resolveTaskSource("gone", kinds), { sourceRunId: "gone", sourceRunKind: null });
  assert.deepEqual(resolveTaskSource(null, kinds), { sourceRunId: null, sourceRunKind: null });
});
