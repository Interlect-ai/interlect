import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatWholeScore,
  wholeScore,
  companyProfileSections,
  farthestFromThreshold,
  findingBalance,
  findingColumns,
  fitSummary,
  formatPoints,
  formatScore,
  scoreChange,
  liftsMost,
  mandatGroups,
  profileRows,
  recommendationLine,
  weightedScore,
} from "./screening-view.ts";
import {
  answerFile,
  answerTaskInput,
  createTaskInput,
  taskItem,
  taskLinks,
  taskPeople,
} from "./screening-tasks.ts";
import { needsOverride, overrideReasonOk } from "./gate-answer.ts";
import type { CaseTask } from "./tasks.functions";

// Pleo's real screening on staging (E2E Testfond A): eight criteria, weights from the fund.
const PLEO = [
  { criterionKey: "thesis_fit", label: "Fondsfit", weight: 20, score: 72 },
  { criterionKey: "founder_market_fit", label: "Founder-market fit", weight: 15, score: 68 },
  { criterionKey: "team", label: "Team", weight: 10, score: 74 },
  { criterionKey: "product_market_fit", label: "Produkt-market fit", weight: 15, score: 81 },
  { criterionKey: "market_timing", label: "Marked og timing", weight: 10, score: 77 },
  { criterionKey: "traction_gtm", label: "Traction", weight: 15, score: 86 },
  { criterionKey: "technology", label: "Teknologi", weight: 10, score: 66 },
  { criterionKey: "evidence_quality", label: "Evidens", weight: 5, score: 84 },
];

test("contributions add up to the weighted score, as scoring.ts calculates it", () => {
  const rows = profileRows(PLEO);
  const expected =
    Math.round(PLEO.reduce((sum, c) => sum + (c.weight * c.score) / 100, 0) * 10) / 10;
  assert.equal(weightedScore(rows), expected);
  assert.equal(rows[0]!.color, "var(--series-1)");
  assert.equal(rows[7]!.color, "var(--series-8)");
});

test("a criterion without a score gives no points and is never 'løfter mest'", () => {
  const rows = profileRows([
    { criterionKey: "a", label: "A", weight: 60, score: null },
    { criterionKey: "b", label: "B", weight: 40, score: 50 },
  ]);
  assert.equal(rows[0]!.contribution, 0);
  assert.equal(liftsMost(rows)?.key, "b");
});

test("løfter mest is the most points; længst fra tesen weighs the distance to the threshold", () => {
  const rows = profileRows(PLEO);
  assert.equal(liftsMost(rows)?.key, "thesis_fit"); // 20 % × 72 = 14,4
  // Below 72: founder-market fit (15 % × 4 = 0,6) and teknologi (10 % × 6 = 0,6): first wins.
  const far = farthestFromThreshold(rows, 72);
  assert.equal(far?.row.key, "founder_market_fit");
  assert.equal(Math.round(far!.shortfall * 10) / 10, 0.6);
  assert.equal(farthestFromThreshold(rows, 60), null);
  assert.equal(farthestFromThreshold(rows, null), null);
});

test("points and scores are written the Danish way", () => {
  assert.equal(formatPoints(14.4), "+14,4 p");
  assert.equal(formatPoints(-2), "−2,0 p");
  assert.equal(formatScore(72), "72");
  assert.equal(formatScore(46.54), "46,5");
  assert.equal(formatScore(null), "–");
});

const task = (over: Partial<CaseTask>): CaseTask => ({
  id: "t",
  kind: "question",
  title: "Afklar: Ticket",
  description: null,
  why: null,
  answerKind: "text",
  answerOptions: [],
  answerUnit: null,
  assigneeId: null,
  assigneeName: null,
  dueOn: null,
  linkedKind: null,
  linkedKey: null,
  origin: "ai",
  sourceRunId: null,
  sourceRunKind: null,
  status: "open",
  answerText: null,
  answerValue: null,
  answerDocumentId: null,
  answerFileName: null,
  resolvedAt: null,
  resolvedByName: null,
  newAnswer: false,
  createdAt: "2026-09-30T10:00:00Z",
  ...over,
});

test("Mandatfit groups: unknown, breach, met; each gate gets its open task first", () => {
  const gates = [
    { key: "stage_fit", label: "Stadie", passed: false, rationale: "Senere fase" },
    { key: "geography_fit", label: "Geografi", passed: true, rationale: "København" },
    { key: "ticket_fit", label: "Ticket", passed: null, rationale: "Ikke oplyst" },
  ];
  const tasks = [
    task({
      id: "old",
      linkedKind: "gate",
      linkedKey: "ticket_fit",
      status: "resolved",
      resolvedAt: "2026-09-29T10:00:00Z",
    }),
    task({ id: "open", linkedKind: "gate", linkedKey: "ticket_fit" }),
    task({ id: "crit", linkedKind: "criterion", linkedKey: "ticket_fit" }),
  ];
  const groups = mandatGroups(gates, tasks);
  assert.deepEqual(
    [groups.missing, groups.failed, groups.passed].map((g) => g.map((row) => row.gate.key)),
    [["ticket_fit"], ["stage_fit"], ["geography_fit"]],
  );
  assert.equal(groups.missing[0]!.task?.id, "open");
  assert.equal(groups.failed[0]!.task, null);
});

test("an answered gate shows its newest answer", () => {
  const groups = mandatGroups(
    [{ key: "g", label: "G", passed: true, rationale: null, teamAnswered: true }],
    [
      task({
        id: "a",
        linkedKind: "gate",
        linkedKey: "g",
        status: "resolved",
        resolvedAt: "2026-09-29T10:00:00Z",
      }),
      task({
        id: "b",
        linkedKind: "gate",
        linkedKey: "g",
        status: "resolved",
        resolvedAt: "2026-09-30T10:00:00Z",
      }),
    ],
  );
  assert.equal(groups.passed[0]!.task?.id, "b");
});

test("key findings tied to criteria come first by importance; older runs fall back", () => {
  const criteria = PLEO.map(({ criterionKey, label }) => ({ criterionKey, label }));
  const tied = findingColumns({
    keyFindings: [
      { statement: "Lille", direction: "up", criterionKey: "team", importance: 1 },
      { statement: "Stor", direction: "up", criterionKey: "traction_gtm", importance: 3 },
      { statement: "Stadie", direction: "down", criterionKey: "thesis_fit", importance: 3 },
      { statement: "Ukendt kriterie", direction: "down", criterionKey: "nope", importance: 2 },
    ],
    criteria,
    strengths: ["S"],
    weaknesses: ["W"],
  });
  assert.deepEqual(
    tied.up.map((row) => [row.statement, row.criterionLabel, row.color, row.importance]),
    [
      ["Stor", "Traction", "var(--series-6)", 3],
      ["Lille", "Team", "var(--series-3)", 1],
    ],
  );
  assert.deepEqual(
    tied.down.map((row) => row.statement),
    ["Stadie"],
  );
  assert.deepEqual(findingBalance(tied), { up: 4, down: 3 });

  const old = findingColumns({
    keyFindings: undefined,
    criteria,
    strengths: ["1", "2", "3", "4", "5"],
    weaknesses: ["a"],
  });
  assert.equal(old.up.length, 4);
  assert.deepEqual(old.down[0], {
    statement: "a",
    criterionLabel: null,
    color: null,
    importance: null,
  });
  assert.deepEqual(findingBalance(old), { up: 4, down: 1 });
});

test("the recommendation line and the company profile sections", () => {
  assert.equal(recommendationLine("go_forward"), "Interlect anbefaler dyb analyse.");
  assert.equal(recommendationLine(null), null);
  assert.deepEqual(
    companyProfileSections({
      business: "B",
      productModel: " ",
      market: "M",
      team: "T",
      economyCapital: "Ø",
      status: "S",
    }).map((section) => section.heading),
    ["Forretningen", "Marked", "Team", "Økonomi og kapital", "Hvor står casen"],
  );
  assert.deepEqual(companyProfileSections(null), []);
});

test("a gate task is answered Opfyldt/Ikke opfyldt and carries the gate's state", () => {
  const people = taskPeople([
    { userId: "me", name: "Maja Holm", roleLabel: "Lead", isMe: true },
    { userId: "jonas", name: "Jonas Berg", roleLabel: "Medlem", isMe: false },
  ]);
  assert.equal(people[0]!.description, "Dig, Lead");
  const links = taskLinks({
    gates: [{ key: "ticket_fit", label: "Ticket" }],
    criteria: [{ criterionKey: "team", label: "Team" }],
  });
  assert.deepEqual(
    links.map((link) => [link.kind, link.label, link.color]),
    [
      ["gate", "Mandatfit, Ticket", "var(--action)"],
      ["criterion", "Team", "var(--series-1)"],
    ],
  );
  const gateTask = taskItem(
    task({ linkedKind: "gate", linkedKey: "ticket_fit", assigneeId: "jonas" }),
    { people, links, gateState: () => ({ passedNow: null, canOverride: false }) },
  );
  assert.equal(gateTask.answerKind, "gate");
  assert.equal(gateTask.assignee?.name, "Jonas Berg");
  assert.equal(gateTask.link?.label, "Mandatfit, Ticket");
  assert.deepEqual(gateTask.gate, { passedNow: null, canOverride: false });

  const gone = taskItem(task({ assigneeId: "x", assigneeName: null, answerKind: "ai" }), {
    people,
    links,
    gateState: () => undefined,
  });
  assert.equal(gone.assignee?.name, "Tidligere medlem");
  assert.equal(gone.answerKind, "text");
  assert.equal(gone.gate, undefined);
});

test("a resolved task keeps its answer, including the gate answer and the file", () => {
  const item = taskItem(
    task({
      status: "resolved",
      linkedKind: "gate",
      linkedKey: "g",
      answerText: "Cap table modtaget",
      answerValue: { gatePassed: true, override: true },
      answerFileName: "captable.pdf",
      resolvedAt: "2026-09-30T10:00:00Z",
    }),
    { people: [], links: [], gateState: () => ({ passedNow: true, canOverride: true }) },
  );
  assert.deepEqual(item.answer, {
    text: "Cap table modtaget",
    number: null,
    option: null,
    fileName: "captable.pdf",
    gatePassed: true,
    override: true,
  });
});

test("drafts and answers become the server's input", () => {
  assert.deepEqual(
    createTaskInput({
      kind: "document",
      title: "  Cap table  ",
      description: " ",
      assignee: { id: "i", name: "Interlect", isInterlect: true },
      dueOn: "2026-10-02",
      link: { kind: "gate", key: "owner", label: "Mandatfit, Ejer", color: "var(--action)" },
      answerKind: "ai",
    }),
    {
      kind: "document",
      title: "Cap table",
      description: null,
      assigneeId: null,
      dueOn: "2026-10-02",
      linkedKind: "gate",
      linkedKey: "owner",
    },
  );
  const file = { name: "x.pdf" } as File;
  const gate = { kind: "gate" as const, passed: true, text: " fordi ", file, override: true };
  assert.deepEqual(answerTaskInput(gate, { revise: true, documentId: "d" }), {
    text: "fordi",
    number: null,
    option: null,
    documentId: "d",
    gatePassed: true,
    override: true,
    revise: true,
  });
  assert.equal(answerFile(gate), file);
  assert.equal(
    answerTaskInput({ kind: "number", number: 4 }, { revise: false, documentId: null }).number,
    4,
  );
  assert.equal(answerFile({ kind: "text", text: "x" }), null);
});

test("an Opfyldt overrides a requirement that is not met, and a revised override stays one", () => {
  assert.equal(needsOverride({ passed: true, passedNow: false, previousOverride: false }), true);
  assert.equal(needsOverride({ passed: true, passedNow: null, previousOverride: false }), false);
  assert.equal(needsOverride({ passed: false, passedNow: false, previousOverride: false }), false);
  assert.equal(needsOverride({ passed: true, passedNow: true, previousOverride: true }), true);
  assert.equal(overrideReasonOk("for kort"), false);
  assert.equal(overrideReasonOk("  lang nok grund  "), true);
});

test("the fit summary reads the numbers on the page", () => {
  const rows = profileRows([
    { criterionKey: "a", label: "Team", weight: 50, score: 80 },
    { criterionKey: "b", label: "Traction", weight: 50, score: 60, isStagePrior: true },
  ]);
  assert.equal(
    fitSummary(rows, 72),
    "Den vægtede score er 70 af 100, 2 point under jeres tærskel på 72. Scoren bæres især af team (80), mens traction (60) er den tydeligste begrænsning.",
  );
  assert.equal(fitSummary(profileRows([]), 72), null);
});

test("a stray open task does not shadow a live team answer", () => {
  const groups = mandatGroups(
    [{ key: "g", label: "G", passed: false, rationale: null, teamAnswered: true }],
    [
      task({
        id: "answered",
        linkedKind: "gate",
        linkedKey: "g",
        status: "resolved",
        resolvedAt: "2026-09-29T10:00:00Z",
      }),
      task({ id: "stray", linkedKind: "gate", linkedKey: "g" }),
    ],
  );
  assert.equal(groups.failed[0]!.task?.id, "answered");
});

test("scoreChange is the difference of the scores as shown, to one decimal", () => {
  assert.equal(scoreChange(69.2, 69.6), -0.4);
  assert.equal(scoreChange(78, 70), 8);
  assert.equal(scoreChange(69.24, 69.2), 0);
});

test("S05: the surface score is a whole number, rounded down so it never passes the threshold", () => {
  assert.equal(formatWholeScore(81.4, "da"), "81");
  assert.equal(formatWholeScore(66.8, "da"), "66");
  assert.equal(formatWholeScore(69.96, "da"), "70");
  assert.equal(wholeScore(69.6), 69);
  assert.equal(formatWholeScore(null, "da"), "–");
});
