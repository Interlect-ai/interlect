import { test } from "node:test";
import assert from "node:assert/strict";
import {
  actionTitle,
  isNearDuplicateTitle,
  topicOverlap,
  buildAiTaskDrafts,
  buildAiTasks,
  MAX_AI_TASKS_PER_CURATED_RUN,
  planAiTaskWrites,
  sanitizeNextSteps,
  splitJsonishTitles,
  type AiTaskDraft,
  type AiTaskSource,
  type ExistingTaskRow,
} from "./tasks.ts";
import { deepTaskSource } from "./deep-tasks.ts";

const gates = [
  { key: "geo", label: "Nordisk selskab", treatment: "review" },
  { key: "ownership", label: "Ejerandel mindst 10 %", treatment: "hard" },
];
const criteria = [
  { key: "team", label: "Team og founders" },
  { key: "traction", label: "Traction og retention" },
];
const keys = { gates: ["geo", "ownership"], criteria: ["team", "traction"] };

const base: AiTaskSource = {
  gates,
  criteria,
  unresolvedGateKeys: [],
  missingCriterionKeys: [],
  assessments: [{ criterionKey: "team", unknowns: ["Arbejdsdeling mellem founderne"] }],
  openQuestions: ["Hvad er retention?"],
};

test("a JSON-ish list in a title becomes separate, clean titles (the Pleo bug)", () => {
  assert.deepEqual(
    splitJsonishTitles('Hvad er cash-position, burn og runway?","Hvordan er rollefordelingen?'),
    ["Hvad er cash-position, burn og runway?", "Hvordan er rollefordelingen?"],
  );
  assert.deepEqual(splitJsonishTitles('["Første spørgsmål?","Andet spørgsmål?"]'), [
    "Første spørgsmål?",
    "Andet spørgsmål?",
  ]);
  assert.deepEqual(splitJsonishTitles('"Et enkelt spørgsmål?"'), ["Et enkelt spørgsmål?"]);
  assert.deepEqual(splitJsonishTitles("Almindelig titel"), ["Almindelig titel"]);
  const tasks = buildAiTaskDrafts({
    ...base,
    openQuestions: [
      'Hvad er cash-position og runway nu?","Hvordan er rollefordelingen mellem founderne?',
    ],
  });
  const titles = tasks.map((task) => task.title);
  assert.ok(titles.includes("Hvad er cash-position og runway nu?"));
  assert.ok(titles.includes("Hvordan er rollefordelingen mellem founderne?"));
  assert.ok(titles.every((title) => !title.includes('"')));
});

test("statements become actions; verbs and questions stay", () => {
  assert.equal(
    actionTitle("Der er ikke dokumenteret en aktiv kapitalrunde nu"),
    "Indhent dokumentation for en aktiv kapitalrunde nu",
  );
  assert.equal(
    actionTitle("Retention er ikke dokumenteret."),
    "Indhent dokumentation for Retention",
  );
  assert.equal(actionTitle("Indhent fuld cap table"), "Indhent fuld cap table");
  assert.equal(actionTitle("Hvem er CTO?"), "Hvem er CTO?");
  assert.equal(actionTitle("Vesting for founders"), "Afklar: Vesting for founders");
});

test("nextSteps are validated in code: keys, kinds, length, empties, order", () => {
  const steps = sanitizeNextSteps(
    [
      { title: "", why: "x", kind: "document", priority: 1 },
      {
        title: "Bed om opdateret cap table",
        why: "Kapitalen er uklar",
        kind: "document",
        linkedKind: "criterion",
        linkedKey: "traction",
        priority: 2,
      },
      {
        title: "Verificér ejerandel i CVR",
        why: "Krav",
        kind: "verification",
        linkedKind: "gate",
        linkedKey: "ownership",
        priority: 1,
      },
      {
        title: "Book reference",
        why: "",
        kind: "banana",
        linkedKind: "criterion",
        linkedKey: "finns-ikke",
        priority: 9,
      },
      { title: "x".repeat(300), why: "", kind: "research", priority: 3 },
    ],
    keys,
  );
  assert.equal(steps.length, 4);
  assert.equal(steps[0]?.title, "Verificér ejerandel i CVR");
  assert.equal(steps[0]?.linkedKey, "ownership");
  const book = steps.find((step) => step.title === "Book reference")!;
  assert.equal(book.kind, "task");
  assert.equal(book.linkedKey, null);
  assert.equal(book.priority, 2);
  assert.ok(steps.every((step) => step.title.length <= 120));
  const many = sanitizeNextSteps(
    Array.from({ length: 30 }, (_, index) => ({
      title: `Handling ${index} nummer`,
      kind: "task",
      priority: 2,
    })),
    keys,
  );
  assert.equal(many.length, 10);
});

test("with nextSteps the raw questions, unknowns and mitigations are NOT tasks", () => {
  const drafts = buildAiTaskDrafts({
    ...base,
    unresolvedGateKeys: ["ownership"],
    nextSteps: sanitizeNextSteps(
      [
        {
          title: "Indhent retention-tal pr. kohorte",
          why: "Retention mangler",
          kind: "document",
          linkedKind: "criterion",
          linkedKey: "traction",
          priority: 1,
        },
        {
          title: "Bed om rollefordeling mellem founderne",
          why: "Uklar",
          kind: "question",
          linkedKind: "criterion",
          linkedKey: "team",
          priority: 2,
        },
      ],
      keys,
    ),
    specialists: [
      {
        moduleId: "p",
        label: "Produkt",
        criterionKeys: ["traction"],
        questions: ["Rå spørgsmål?"],
        unknowns: ["Rå ukendt"],
      },
    ],
    risks: [
      {
        label: "Kundekoncentration",
        level: "high",
        rationale: "Det er farligt. Mere.",
        mitigation: "Gør noget konkret.",
      },
    ],
    findings: [{ findingType: "unknown", statement: "Rå fund" }],
  });
  assert.deepEqual(
    drafts.map((draft) => draft.title),
    [
      "Afklar: Ejerandel mindst 10 %",
      "Indhent retention-tal pr. kohorte",
      "Bed om rollefordeling mellem founderne",
    ],
  );
});

test("a critical risk gets a fallback task only when no step covers it", () => {
  const critical = {
    label: "Kundekoncentration og kontraktafhængighed",
    level: "critical",
    rationale: "Alt hænger på to kunder. Mere.",
    mitigation: "Indhent kontrakterne og tal med kunderne.",
  };
  const covered = buildAiTaskDrafts({
    ...base,
    nextSteps: sanitizeNextSteps(
      [
        {
          title: "Gennemgå kundekoncentration og kontraktafhængighed hos de to kunder",
          why: "",
          kind: "document",
          priority: 1,
        },
      ],
      keys,
    ),
    risks: [critical],
  });
  assert.equal(covered.length, 1);
  const uncovered = buildAiTaskDrafts({ ...base, nextSteps: [], risks: [critical] });
  assert.equal(uncovered.length, 1);
  assert.equal(uncovered[0]!.title, "Indhent kontrakterne og tal med kunderne");
  assert.match(uncovered[0]!.why ?? "", /^Risiko: Kundekoncentration og kontraktafhængighed\./);
});

test("old stored output without nextSteps uses the older builder (backwards compatible)", () => {
  const source = deepTaskSource({
    configVersionId: "v1",
    profile: { gates, criteria: criteria.map((c) => ({ ...c, category: "x" })) },
    modules: [],
    unresolvedGateKeys: [],
    missingCriterionKeys: [],
    output: { assessments: [], openQuestions: ["Hvad er runway?"], risks: [] },
    specialists: [],
  });
  assert.equal(source.nextSteps, undefined);
  assert.deepEqual(
    buildAiTasks(source).map((task) => task.title),
    ["Hvad er runway?"],
  );
  const curated = deepTaskSource({
    configVersionId: "v1",
    profile: { gates, criteria: criteria.map((c) => ({ ...c, category: "x" })) },
    modules: [],
    unresolvedGateKeys: [],
    missingCriterionKeys: [],
    output: {
      assessments: [],
      openQuestions: ["Hvad er runway?"],
      risks: [],
      nextSteps: [{ title: "Indhent regnskab", kind: "document", priority: 1 }],
    },
    specialists: [],
  });
  assert.equal(curated.maxTasks, MAX_AI_TASKS_PER_CURATED_RUN);
  assert.deepEqual(
    buildAiTasks(curated).map((task) => task.title),
    ["Indhent regnskab"],
  );
});

test("the curated list is capped, and priority 1 comes before 2 before 3", () => {
  const drafts = buildAiTasks({
    ...base,
    maxTasks: 3,
    nextSteps: sanitizeNextSteps(
      [
        { title: "Tredje handling om noget helt tredje", kind: "task", priority: 3 },
        { title: "Første handling om det vigtigste punkt", kind: "task", priority: 1 },
        { title: "Anden handling om et andet emne", kind: "task", priority: 2 },
        { title: "Fjerde handling om en fjerde ting nu", kind: "task", priority: 3 },
      ],
      keys,
    ),
  });
  assert.deepEqual(
    drafts.map((draft) => draft.title),
    [
      "Første handling om det vigtigste punkt",
      "Anden handling om et andet emne",
      "Tredje handling om noget helt tredje",
    ],
  );
});

// --- cross-run duplicates -------------------------------------------------------------------

const row = (over: Partial<ExistingTaskRow>): ExistingTaskRow => ({
  id: "s1",
  dedupeKey: "k",
  title: "Indhent opdateret cap table og kapitalrunde",
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
  createdAt: "2026-10-01T10:00:00.000000+00:00",
  updatedAt: "2026-10-01T10:00:00.000000+00:00",
  deletedAt: null,
  deletedBy: null,
  sourceRunId: "run-screening",
  sourceRunKind: "screening",
  linkedKind: null,
  linkedKey: null,
  ...over,
});
const draft = (over: Partial<AiTaskDraft>): AiTaskDraft => ({
  matchText: over.title ?? "Indhent en opdateret cap table og kapitalrunde",
  dueInDays: 14,
  kind: "document",
  title: "Indhent en opdateret cap table og kapitalrunde",
  why: null,
  linkedKind: "criterion",
  linkedKey: "traction",
  dedupeKey: "d1",
  ...over,
});

test("a deep task that nearly duplicates an open screening task is not created (the screening task wins)", () => {
  const plan = planAiTaskWrites({
    runId: "run-deep",
    runKind: "deep",
    raised: [
      draft({}),
      draft({ title: "Bed om rollefordeling mellem founderne", dedupeKey: "d2" }),
    ],
    cap: 18,
    existing: [row({})],
  });
  assert.deepEqual(
    plan.insert.map((item) => item.dedupeKey),
    ["d2"],
  );
  // The deep run does not retire the screening task.
  assert.deepEqual(plan.retire, []);
});

test("an older untouched task of the same kind is replaced, not a reason to skip the new one", () => {
  const old = row({ id: "old", sourceRunId: "run-old-deep", sourceRunKind: "deep" });
  const plan = planAiTaskWrites({
    runId: "run-deep",
    runKind: "deep",
    raised: [draft({ linkedKey: "team" })],
    cap: 18,
    existing: [old],
  });
  assert.equal(plan.insert.length, 1);
  assert.deepEqual(plan.retire, ["old"]);
});

test("a gap a person deleted is not recreated under another wording or link", () => {
  const gone = row({
    deletedAt: "2026-10-01T11:00:00Z",
    deletedBy: "u1",
    updatedAt: "2026-10-01T11:00:00.000000+00:00",
  });
  const plan = planAiTaskWrites({
    runId: "run-deep",
    runKind: "deep",
    raised: [draft({})],
    cap: 18,
    existing: [gone],
  });
  assert.equal(plan.insert.length, 0);
});

test("a critical risk already covered by a gate or criterion task gets no fallback", () => {
  const risk = {
    label: "Mandatbrud på stadie",
    level: "critical",
    rationale: "Selskabet ligger uden for stadiet. Mere.",
    mitigation: "Bekræft selskabets stadie mod mandatet.",
  };
  const stageGate = [{ key: "stage_fit", label: "Stadie passer til mandatet", treatment: "hard" }];
  const withGate = buildAiTaskDrafts({
    ...base,
    gates: stageGate,
    unresolvedGateKeys: ["stage_fit"],
    nextSteps: [],
    risks: [risk],
  });
  assert.deepEqual(
    withGate.map((draft) => draft.linkedKind),
    ["gate"],
  );
  // Not covered by anything: the fallback is created, with the plan's own action as title.
  const alone = buildAiTaskDrafts({ ...base, nextSteps: [], risks: [risk] });
  assert.equal(alone.length, 1);
  assert.equal(alone[0]!.title, "Bekræft selskabets stadie mod mandatet");
  assert.equal(alone[0]!.topic, "Mandatbrud på stadie");
  // The planner also skips it when the case already has a gate or criterion task on the topic.
  const plan = planAiTaskWrites({
    runId: "r",
    runKind: "deep",
    raised: alone,
    cap: 18,
    existing: [
      {
        id: "g",
        dedupeKey: "g",
        title: "Afklar: Stadie passer til mandatet",
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
        createdAt: "t",
        updatedAt: "t",
        deletedAt: null,
        deletedBy: null,
        sourceRunId: "s",
        sourceRunKind: "screening",
        linkedKind: "gate",
        linkedKey: "stage_fit",
      },
    ],
  });
  assert.equal(plan.insert.length, 0);
});

test("titles are clipped at a word or sentence boundary with an ellipsis, never mid-word", () => {
  const long =
    "Indhent de seneste tre månedsrapporter fra bestyrelsen og gennemgå kapitaltabellen sammen med revisoren inden mødet i næste uge hos selskabet i København";
  const [task] = buildAiTaskDrafts({
    ...base,
    nextSteps: sanitizeNextSteps([{ title: long, kind: "document", priority: 1 }], keys),
  });
  const title = task!.title;
  assert.ok(title.endsWith("…"));
  assert.ok(title.length <= 121);
  const last = title.slice(0, -1).split(" ").at(-1)!;
  assert.ok(long.split(" ").includes(last), `"${last}" is a whole word`);
  // A long unbroken string is still cut (hard) rather than kept whole.
  const [hard] = buildAiTaskDrafts({ ...base, openQuestions: ["x".repeat(400)] });
  assert.ok(hard!.title.length <= 200);
});

test("a curated step on a gate with its own task is folded into that task, not a second task (#1)", () => {
  const drafts = buildAiTaskDrafts({
    ...base,
    unresolvedGateKeys: ["ownership"],
    nextSteps: sanitizeNextSteps(
      [
        {
          title: "Ejerandel efter runden",
          question: "Verificér ejerandelen i CVR og vedtægter.",
          why: "Kravet er afgørende",
          kind: "verification",
          linkedKind: "gate",
          linkedKey: "ownership",
          priority: 1,
        },
        {
          title: "Cap table",
          question: "Indhent cap table efter konverteringen.",
          kind: "document",
          linkedKind: "gate",
          linkedKey: "ownership",
          priority: 2,
        },
        { title: "Indhent retention-tal pr. kohorte", kind: "document", priority: 2 },
      ],
      keys,
    ),
  });
  assert.equal(drafts.filter((draft) => draft.linkedKey === "ownership").length, 1);
  const gate = drafts.find((draft) => draft.linkedKey === "ownership")!;
  // The first step gives the gate task its short title and question; the key stays on the
  // requirement, so an answer under this setup version is never asked again in other words.
  assert.equal(gate.title, "Ejerandel efter runden");
  assert.equal(gate.description, "Verificér ejerandelen i CVR og vedtægter.");
  assert.match(gate.why ?? "", /Kravet er afgørende/);
  assert.match(gate.dedupeKey, /afklar: ejerandel mindst 10 %$/);
  // A second step on the same requirement joins the why.
  assert.match(gate.why ?? "", /Næste skridt: Indhent cap table efter konverteringen/);
  assert.equal(drafts.length, 2);
  // A gate step for a gate that is NOT unresolved stays a task of its own.
  const own = buildAiTaskDrafts({
    ...base,
    nextSteps: sanitizeNextSteps(
      [
        {
          title: "Verificér ejerandelen i CVR",
          kind: "verification",
          linkedKind: "gate",
          linkedKey: "ownership",
          priority: 1,
        },
      ],
      keys,
    ),
  });
  assert.equal(own.length, 1);
});

test("a critical-risk task is not suppressed by one common word (#9)", () => {
  const risk = {
    label: "Kundekoncentration i få kunder",
    level: "critical",
    rationale: "Alt hænger på to kunder. Mere.",
    mitigation: "Indhent kontrakterne og tal med kunderne.",
  };
  const withStep = buildAiTaskDrafts({
    ...base,
    nextSteps: sanitizeNextSteps(
      [{ title: "Book møde med kunder om deres behov", kind: "meeting", priority: 1 }],
      keys,
    ),
    risks: [risk],
  });
  // Only "kunder" is shared: not covered, so the critical risk keeps its task.
  assert.equal(withStep.length, 2);
  assert.equal(topicOverlap("Mandatbrud på stadie", "Stadie passer til mandatet"), true);
  assert.equal(topicOverlap("Kundekoncentration", "Kundekoncentration og kontrakter"), false);
});

test("action verbs match whole words only, and old wording equals new wording (#10)", () => {
  assert.equal(actionTitle("Aftaler med kunder er uklare"), "Afklar: Aftaler med kunder er uklare");
  assert.equal(actionTitle("Aftal møde med revisoren"), "Aftal møde med revisoren");
  assert.equal(actionTitle("Erfaring med salg mangler"), "Afklar: Erfaring med salg mangler");
  assert.equal(actionTitle("Er der en aktiv runde?"), "Er der en aktiv runde?");
  // An old (touched) screening task "Der er ikke dokumenteret X" blocks the new wording.
  const old = {
    id: "o",
    dedupeKey: "old",
    title: "Der er ikke dokumenteret en aktiv kapitalrunde",
    origin: "ai",
    status: "open",
    assigneeId: "u1",
    dueOn: null,
    answerText: null,
    answerValue: null,
    answerDocumentId: null,
    answerEvidenceId: null,
    resolvedAt: null,
    createdAt: "a",
    updatedAt: "b",
    deletedAt: null,
    deletedBy: null,
    sourceRunId: "s",
    sourceRunKind: "screening" as const,
    linkedKind: null,
    linkedKey: null,
    description: null,
  };
  const plan = planAiTaskWrites({
    runId: "r",
    runKind: "screening",
    raised: [
      {
        kind: "research",
        title: "Indhent dokumentation for en aktiv kapitalrunde",
        why: null,
        linkedKind: null,
        linkedKey: null,
        dedupeKey: "new",
        matchText: "Indhent dokumentation for en aktiv kapitalrunde",
        dueInDays: 14,
      },
    ],
    cap: 15,
    existing: [old],
  });
  assert.equal(plan.insert.length, 0);
  assert.equal(
    isNearDuplicateTitle(old.title, "Indhent dokumentation for en aktiv kapitalrunde"),
    true,
  );
});

test("T-1093: missing economy figures are one task after the requirements, keyed on its title", () => {
  const economyTask = {
    title: "Skaf økonomitallene",
    question: "Skaf økonomitallene: burn og runway, brugen af pengene.",
    why: "Interlect kunne ikke finde disse tal i casens materiale eller i registrene.",
  };
  const drafts = buildAiTaskDrafts({
    ...base,
    unresolvedGateKeys: ["ownership"],
    economyTask,
    nextSteps: sanitizeNextSteps(
      [{ title: "Kundereferencer", kind: "verification", priority: 1 }],
      keys,
      3,
    ),
  });
  assert.deepEqual(
    drafts.map((draft) => draft.title),
    ["Afklar: Ejerandel mindst 10 %", "Skaf økonomitallene", "Kundereferencer"],
  );
  const economy = drafts[1]!;
  assert.equal(economy.description, economyTask.question);
  assert.equal(economy.why, economyTask.why);
  assert.equal(economy.linkedKind, null);
  assert.equal(economy.kind, "document");
  const again = buildAiTaskDrafts({ ...base, economyTask: { ...economyTask, question: "Andet." } });
  assert.equal(
    again.find((draft) => draft.title === "Skaf økonomitallene")?.dedupeKey,
    economy.dedupeKey,
    "a new screening updates the same task",
  );
  assert.ok(!buildAiTaskDrafts(base).some((draft) => draft.title === "Skaf økonomitallene"));
});

test("T-1093: an untouched economy task from an earlier screening gets the new list", () => {
  const [draft] = buildAiTaskDrafts({
    ...base,
    assessments: [],
    openQuestions: [],
    economyTask: {
      title: "Skaf økonomitallene",
      question: "Skaf økonomitallene: burn og runway.",
      why: "Interlect kunne ikke finde disse tal.",
    },
  });
  const row: ExistingTaskRow = {
    id: "task-1",
    dedupeKey: draft!.dedupeKey,
    title: draft!.title,
    description: "Skaf økonomitallene: omsætning og vækst, burn og runway.",
    origin: "ai",
    status: "open",
    assigneeId: null,
    dueOn: null,
    answerText: null,
    answerValue: null,
    answerDocumentId: null,
    answerEvidenceId: null,
    resolvedAt: null,
    createdAt: "2026-11-01T00:00:00Z",
    updatedAt: "2026-11-01T00:00:00Z",
    deletedAt: null,
    deletedBy: null,
    sourceRunId: "run-old",
    sourceRunKind: "screening",
    linkedKind: null,
    linkedKey: null,
  };
  const plan = (existing: ExistingTaskRow[]) =>
    planAiTaskWrites({
      runId: "run-new",
      runKind: "screening",
      raised: [draft!],
      cap: 4,
      existing,
    });
  assert.deepEqual(plan([row]), {
    insert: [],
    restore: [],
    retire: [],
    refresh: [{ id: "task-1", draft }],
  });
  const touched = { ...row, updatedAt: "2026-11-02T00:00:00Z" };
  assert.deepEqual(plan([touched]).refresh, [], "a task a person changed keeps its text");
  const same = { ...row, description: draft!.description ?? null };
  assert.deepEqual(plan([same]).refresh, [], "nothing to refresh");
  assert.deepEqual(plan([same]).insert, []);
});
