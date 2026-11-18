import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildOverview,
  median,
  stageColumns,
  stageKeyFromText,
  thresholdPosition,
  type BuildInput,
  type CaseRow,
  type RunRow,
} from "./snapshot.ts";
import { waitingReason, type WaitingFacts } from "./waiting.ts";
import {
  geoMeaning,
  intakeMeaning,
  pipelineMeaning,
  scoreMeaning,
  sectorMeaning,
  stageMeaning,
  tasksMeaning,
} from "./meaning.ts";

const NOW = new Date("2026-10-01T10:00:00Z");
const day = (daysBack: number) => new Date(NOW.getTime() - daysBack * 86_400_000).toISOString();

const caseRow = (id: string, over: Partial<CaseRow> = {}): CaseRow => ({
  id,
  name: `Selskab ${id}`,
  phase: "screening",
  status: "active",
  createdAt: day(5),
  lastActionAt: day(1),
  country: "DK",
  sector: "Software",
  stage: "seed",
  ...over,
});

const screening = (caseId: string, score: number, over: Partial<RunRow> = {}): RunRow => ({
  id: `s-${caseId}`,
  caseId,
  kind: "screening",
  status: "complete",
  previousRunId: null,
  createdAt: day(4),
  completedAt: day(4),
  overallScore: score,
  evidenceConfidence: 0.6,
  ...over,
});

const deepRun = (caseId: string, over: Partial<RunRow> = {}): RunRow => ({
  id: `d-${caseId}`,
  caseId,
  kind: "deep",
  status: "complete",
  previousRunId: `s-${caseId}`,
  createdAt: day(2),
  completedAt: day(2),
  overallScore: 77,
  evidenceConfidence: 0.7,
  ...over,
});

const base = (over: Partial<BuildInput> = {}): BuildInput => ({
  now: NOW,
  period: "4w",
  threshold: 70,
  fundStages: [],
  viewerId: "me",
  cases: [],
  runs: [],
  recalcs: [],
  events: [],
  openTasks: [],
  runningCaseIds: new Set(),
  ...over,
});

// -- the numbers reconcile with the Cases list ----------------------------------------------

test("active cases are the cases not in Besluttet (the Cases list's own 'aktive cases')", () => {
  const core = buildOverview(
    base({
      cases: [
        caseRow("a"),
        caseRow("b", { phase: "deep_analysis" }),
        caseRow("c", { phase: "committee" }),
        caseRow("d", { status: "on_hold" }),
        caseRow("e", { phase: "decided", status: "closed" }),
        caseRow("f", { phase: "decided", status: "invested" }),
      ],
    }),
  );
  assert.equal(core.activeCases, 4);
  // Every number that counts active cases adds up to the same four.
  assert.equal(core.lists.geo.length, 4);
  assert.equal(core.lists.sector.length, 4);
  assert.equal(core.lists.stage.length, 4);
  assert.equal(core.geo.rows.reduce((sum, row) => sum + row.total, 0) + core.geo.noCountry, 4);
  assert.equal(
    core.heat.rows.reduce((sum, row) => sum + row.cells.reduce((a, b) => a + b, 0), 0),
    4,
  );
  assert.equal(
    core.stages.reduce((sum, slice) => sum + slice.count, 0),
    4,
  );
});

test("every card's number equals the length of the list behind it", () => {
  const core = buildOverview(
    base({
      cases: [caseRow("a"), caseRow("b", { createdAt: day(40) }), caseRow("c", { country: null })],
      runs: [screening("a", 74), screening("b", 52, { completedAt: day(30) })],
    }),
  );
  assert.equal(core.funnel.cohort, core.lists.pipeline.length);
  assert.equal(core.intake.total, core.lists.intake.length);
  assert.equal(core.scores.count, core.lists.score.length);
  assert.equal(core.scores.count, 1); // b's screening is 30 days old: outside 4 weeks
  assert.equal(core.geo.noCountry, 1);
  // Every id in a list has a case to show.
  for (const ids of Object.values(core.lists)) for (const id of ids) assert.ok(core.cases[id]);
});

test("a team answer's recalculated score replaces the screening score (as in Cases)", () => {
  const core = buildOverview(
    base({
      cases: [caseRow("a")],
      runs: [screening("a", 66)],
      recalcs: [
        { runId: "s-a", overallScore: 69, createdAt: day(3) },
        { runId: "s-a", overallScore: 73, createdAt: day(1) },
      ],
    }),
  );
  assert.equal(core.cases["a"]!.score, 73);
  assert.equal(core.scores.overThreshold, 1);
});

test("only a finished screening counts (a failed or running one does not)", () => {
  const core = buildOverview(
    base({
      cases: [caseRow("a"), caseRow("b")],
      runs: [
        screening("a", 80, { status: "failed" }),
        screening("b", 75, { status: "awaiting_approval" }),
      ],
    }),
  );
  assert.equal(core.scores.count, 1);
  assert.equal(core.cases["a"]!.score, null);
  assert.equal(core.cases["b"]!.score, 75);
});

test("the newest finished screening decides the score", () => {
  const core = buildOverview(
    base({
      cases: [caseRow("a")],
      runs: [
        screening("a", 50, { id: "old", createdAt: day(20), completedAt: day(20) }),
        screening("a", 68, { id: "new", createdAt: day(3), completedAt: day(3) }),
      ],
    }),
  );
  assert.equal(core.cases["a"]!.score, 68);
});

test("a deep analysis' score shows once the case is past screening; the link opens the deep view", () => {
  const core = buildOverview(
    base({
      cases: [caseRow("a", { phase: "deep_analysis" }), caseRow("b", { phase: "screening" })],
      runs: [screening("a", 70), deepRun("a"), screening("b", 71), deepRun("b", { id: "d-b" })],
    }),
  );
  assert.equal(core.cases["a"]!.score, 77);
  assert.equal(core.cases["a"]!.view, "deep");
  // Back in screening: the screening score, the screening view.
  assert.equal(core.cases["b"]!.score, 71);
  assert.equal(core.cases["b"]!.view, "screening");
});

test("the score distribution has five bins and every score lands in exactly one", () => {
  const scores = [12, 49.9, 50, 59, 60, 69.9, 70, 79, 80, 100];
  const core = buildOverview(
    base({
      cases: scores.map((_, index) => caseRow(`c${index}`)),
      runs: scores.map((score, index) => screening(`c${index}`, score)),
    }),
  );
  assert.deepEqual(
    core.scores.bins.map((bin) => bin.count),
    [2, 2, 2, 2, 2],
  );
  assert.equal(
    core.scores.bins.reduce((sum, bin) => sum + bin.count, 0),
    core.scores.count,
  );
  assert.equal(core.scores.overThreshold, 4);
});

test("the score period follows the screening date, not the creation date", () => {
  const input = base({
    cases: [caseRow("a", { createdAt: day(100) })],
    runs: [screening("a", 66, { completedAt: day(3), createdAt: day(3) })],
  });
  assert.equal(buildOverview({ ...input, period: "4w" }).scores.count, 1);
  assert.equal(
    buildOverview({ ...input, period: "4w", runs: [screening("a", 66, { completedAt: day(60) })] })
      .scores.count,
    0,
  );
});

test("median and the dashed threshold position", () => {
  assert.equal(median([]), null);
  assert.equal(median([5]), 5);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  // The five bars are equally wide: <50, 50, 60, 70, 80+.
  assert.equal(thresholdPosition(70), 0.6);
  assert.equal(thresholdPosition(60), 0.4);
  assert.equal(thresholdPosition(75), 0.7);
  assert.equal(thresholdPosition(50), 0.2);
  assert.equal(thresholdPosition(25), 0.1);
  assert.equal(thresholdPosition(90), 0.9);
  assert.equal(thresholdPosition(0), 0);
  assert.equal(thresholdPosition(100), 1);
});

// -- the funnel uses the log and the run history --------------------------------------------

test("the funnel is a cohort of new cases and uses the log for Komité and Investeret", () => {
  const core = buildOverview(
    base({
      cases: [
        caseRow("a"),
        caseRow("b", { phase: "committee" }),
        caseRow("c", { phase: "decided", status: "invested" }),
        caseRow("d", { phase: "decided", status: "closed" }),
        caseRow("old", { createdAt: day(90), phase: "committee" }),
      ],
      runs: [
        screening("a", 72),
        screening("b", 80),
        deepRun("b"),
        screening("c", 85),
        deepRun("c"),
      ],
      events: [
        {
          id: "e1",
          caseId: "c",
          field: "phase",
          toPhase: "committee",
          toStatus: null,
          occurredAt: day(2),
          undoOf: null,
        },
      ],
    }),
  );
  const steps = Object.fromEntries(core.funnel.steps.map((step) => [step.key, step.count]));
  assert.deepEqual(steps, { in: 4, screened: 3, over: 3, deep: 2, committee: 2, invested: 1 });
  assert.equal(core.funnel.overNotForwarded, 1);
  // The same cases in a year include the old one.
  const year = buildOverview(
    base({ period: "52w", cases: [caseRow("old", { createdAt: day(90), phase: "committee" })] }),
  );
  assert.equal(year.funnel.cohort, 1);
});

test("a case sent to Komité and brought back (Fortryd) has not reached Komité", () => {
  const core = buildOverview(
    base({
      cases: [caseRow("a", { phase: "deep_analysis" })],
      runs: [screening("a", 80), deepRun("a")],
      events: [
        {
          id: "1",
          caseId: "a",
          field: "phase",
          toPhase: "committee",
          toStatus: null,
          occurredAt: day(2),
          undoOf: null,
        },
        {
          id: "2",
          caseId: "a",
          field: "phase",
          toPhase: "deep_analysis",
          toStatus: null,
          occurredAt: day(2),
          undoOf: "1",
        },
      ],
    }),
  );
  assert.equal(core.funnel.steps.find((step) => step.key === "committee")!.count, 0);
  assert.equal(core.funnel.steps.find((step) => step.key === "deep")!.count, 1);
});

// -- Venter på jer ---------------------------------------------------------------------------

const waitFacts = (over: Partial<WaitingFacts> = {}): WaitingFacts => ({
  phase: "screening",
  status: "active",
  lastActionAt: day(1),
  running: false,
  hasScreening: true,
  screeningScore: 60,
  canRunDeep: true,
  hasDeep: false,
  committeeSince: null,
  ...over,
});

test("waiting reasons are worked out from the case's real state", () => {
  const committee = waitingReason(
    waitFacts({ phase: "committee", committeeSince: day(9), lastActionAt: day(2) }),
    70,
    NOW,
  );
  assert.equal(committee?.text, "Afventer komitéens beslutning i 9 dage");
  assert.equal(committee?.kind, "committee");
  // No log row for the move: since the last action.
  assert.equal(
    waitingReason(waitFacts({ phase: "committee", lastActionAt: day(1) }), 70, NOW)?.text,
    "Afventer komitéens beslutning i 1 dag",
  );
  assert.equal(
    waitingReason(waitFacts({ phase: "deep_analysis", hasDeep: true }), 70, NOW)?.text,
    "Dyb analyse færdig, klar til vurdering",
  );
  assert.equal(
    waitingReason(waitFacts({ screeningScore: 71 }), 70, NOW)?.text,
    "Over tærsklen, klar til dyb analyse",
  );
  assert.equal(
    waitingReason(waitFacts({ lastActionAt: day(12) }), 70, NOW)?.text,
    "Ingen handling i 12 dage",
  );
});

test("a case that does not need anyone does not wait", () => {
  // Recently touched, under the threshold.
  assert.equal(waitingReason(waitFacts(), 70, NOW), null);
  // On hold, decided, or a run going: nobody has to act, however long it has been.
  assert.equal(
    waitingReason(waitFacts({ status: "on_hold", lastActionAt: day(40) }), 70, NOW),
    null,
  );
  assert.equal(
    waitingReason(
      waitFacts({ phase: "decided", status: "closed", lastActionAt: day(40) }),
      70,
      NOW,
    ),
    null,
  );
  assert.equal(waitingReason(waitFacts({ running: true, lastActionAt: day(40) }), 70, NOW), null);
  // Over the threshold but a deep analysis was already started from this screening.
  assert.equal(waitingReason(waitFacts({ screeningScore: 90, canRunDeep: false }), 70, NOW), null);
  // Deep analysis not finished yet.
  assert.equal(waitingReason(waitFacts({ phase: "deep_analysis", hasDeep: false }), 70, NOW), null);
});

test("seven idle days nudge the button whatever the reason (the Cases list's rule)", () => {
  const six = waitingReason(waitFacts({ screeningScore: 75, lastActionAt: day(6) }), 70, NOW);
  const seven = waitingReason(waitFacts({ screeningScore: 75, lastActionAt: day(7) }), 70, NOW);
  assert.equal(six?.nudge, false);
  assert.equal(seven?.nudge, true);
  assert.equal(seven?.kind, "over_threshold");
});

test("the list: most serious first, the longest wait first, then score; at most eight rows", () => {
  const cases: CaseRow[] = [];
  const runs: RunRow[] = [];
  for (let index = 0; index < 11; index += 1) {
    const id = `i${index}`;
    cases.push(caseRow(id, { lastActionAt: day(8 + index) }));
    runs.push(screening(id, 40));
  }
  cases.push(caseRow("com", { phase: "committee", lastActionAt: day(3) }));
  cases.push(caseRow("deep", { phase: "deep_analysis" }));
  runs.push(screening("deep", 70), deepRun("deep"));
  cases.push(caseRow("over"));
  runs.push(screening("over", 90));
  const core = buildOverview(base({ cases, runs }));
  assert.equal(core.waitingTotal, 14);
  assert.equal(core.waiting.length, 8);
  assert.deepEqual(
    core.waiting.slice(0, 3).map((row) => row.caseId),
    ["com", "deep", "over"],
  );
  // Idle cases: the longest idle first.
  assert.equal(core.waiting[3]!.caseId, "i10");
  assert.equal(core.longestCommitteeWait?.name, "Selskab com");
  assert.equal(core.longestCommitteeWait?.days, 3);
});

test("the rows carry the case's own open tasks; running cases are left out", () => {
  const core = buildOverview(
    base({
      cases: [caseRow("a", { lastActionAt: day(9) }), caseRow("b", { lastActionAt: day(9) })],
      openTasks: [
        { caseId: "a", assigneeId: "me", dueOn: null },
        { caseId: "a", assigneeId: "other", dueOn: null },
        { caseId: "b", assigneeId: null, dueOn: null },
      ],
      runningCaseIds: new Set(["b"]),
    }),
  );
  assert.deepEqual(
    core.waiting.map((row) => [row.caseId, row.openTasks]),
    [["a", 2]],
  );
});

test("a fund with nothing waiting is 'Alt er fulgt op' (an empty list, not an error)", () => {
  const core = buildOverview(base({ cases: [caseRow("a")], runs: [screening("a", 40)] }));
  assert.equal(core.waitingTotal, 0);
  assert.deepEqual(core.waiting, []);
  const empty = buildOverview(base());
  assert.equal(empty.activeCases, 0);
  assert.equal(empty.funnel.cohort, 0);
  assert.equal(empty.scores.median, null);
});

// -- tasks line ------------------------------------------------------------------------------

test("the tasks line counts only my tasks (not nobody's), on open cases, overdue by the Danish date", () => {
  const core = buildOverview(
    base({
      cases: [caseRow("a"), caseRow("b"), caseRow("done", { phase: "decided", status: "closed" })],
      openTasks: [
        { caseId: "a", assigneeId: "me", dueOn: "2026-09-30" }, // overdue
        { caseId: "a", assigneeId: null, dueOn: "2026-10-01" }, // due today: not overdue
        { caseId: "b", assigneeId: "other", dueOn: "2026-09-01" }, // someone else's
        { caseId: "b", assigneeId: "me", dueOn: null },
        { caseId: "done", assigneeId: "me", dueOn: "2026-09-01" }, // the case is closed
      ],
    }),
  );
  assert.deepEqual(core.tasks, { open: 2, overdue: 1, cases: 2 });
});

test("an empty fund has no cases at all; screened-under-an-older-version cases are counted", () => {
  assert.equal(buildOverview(base()).totalCases, 0);
  const core = buildOverview(
    base({
      cases: [caseRow("a"), caseRow("b"), caseRow("c")],
      runs: [screening("c", 70)],
      olderVersionScreenedIds: new Set(["a", "c", "unknown"]),
    }),
  );
  // a has no screening under the active version but one under an older: counted.
  // c has one under the active version: not counted. b never had one.
  assert.equal(core.olderVersionCases, 1);
  assert.equal(core.totalCases, 3);
});

test("a case row carries both the shown score and the screening score", () => {
  const core = buildOverview(
    base({
      cases: [caseRow("a", { phase: "deep_analysis" })],
      runs: [screening("a", 70), deepRun("a")],
    }),
  );
  assert.equal(core.cases["a"]!.score, 77);
  assert.equal(core.cases["a"]!.screeningScore, 70);
});

// -- heat map and stages ---------------------------------------------------------------------

test("sector × stage: columns are the fund's own stages, extras and unknown only when present", () => {
  assert.equal(stageKeyFromText("Series A"), "series_a");
  assert.equal(stageKeyFromText("pre-seed"), "pre_seed");
  assert.equal(stageKeyFromText("Vækst"), "growth");
  // The editor's keys, and Series B+ counted under Series B.
  assert.equal(stageKeyFromText("series_b_plus"), "series_b");
  assert.equal(stageKeyFromText("Series B+"), "series_b");
  assert.equal(stageKeyFromText("Serie A"), "series_a");
  assert.equal(stageKeyFromText("later"), "later");
  assert.equal(stageKeyFromText("listed"), null);
  assert.equal(stageKeyFromText("noget andet"), null);
  assert.deepEqual(
    stageColumns(["Seed", "Series A", "Vækst", "ukendt tekst"], []).map((column) => column.key),
    ["seed", "series_a", "growth"],
  );
  // A stage with active cases the fund does not list gets a column; "unknown" only when present.
  assert.deepEqual(
    stageColumns(["seed"], ["seed", "series_b", "unknown"]).map((column) => column.key),
    ["seed", "series_b", "unknown"],
  );
  // Nothing at all: the four default columns.
  assert.deepEqual(
    stageColumns([], []).map((column) => column.key),
    ["pre_seed", "seed", "series_a", "series_b"],
  );
});

test("the heat map counts unknown sector and stage honestly", () => {
  const core = buildOverview(
    base({
      fundStages: ["seed"],
      cases: [
        caseRow("a", { sector: null, stage: null }),
        caseRow("b", { sector: "Software", stage: "seed" }),
        caseRow("c", { sector: "Software", stage: "series_a" }),
      ],
    }),
  );
  const keys = core.heat.columns.map((column) => column.key);
  assert.deepEqual(keys, ["seed", "series_a", "unknown"]);
  const software = core.heat.rows.find((row) => row.label === "Software")!;
  assert.deepEqual(software.cells, [1, 1, 0]);
  const unclassified = core.heat.rows.find((row) => row.label === "Ikke klassificeret")!;
  assert.deepEqual(unclassified.cells, [0, 0, 1]);
  assert.equal(core.stages.find((slice) => slice.key === "unknown")?.label, "Ukendt");
});

test("geography counts per phase, and countries without a valid ISO code are 'uden land'", () => {
  const core = buildOverview(
    base({
      cases: [
        caseRow("a", { country: "dk" }),
        caseRow("b", { country: "DK", phase: "committee" }),
        caseRow("c", { country: "SE", phase: "deep_analysis" }),
        caseRow("d", { country: "Danmark" }),
        caseRow("e", { country: null }),
      ],
    }),
  );
  assert.deepEqual(core.geo.rows[0], {
    code: "DK",
    total: 2,
    screening: 1,
    deep_analysis: 0,
    committee: 1,
  });
  assert.equal(core.geo.noCountry, 2);
});

// -- texts -----------------------------------------------------------------------------------

test("meaning texts are built from the numbers, or left out when there is not enough data", () => {
  const empty = buildOverview(base());
  for (const text of [
    pipelineMeaning(empty),
    geoMeaning(empty),
    sectorMeaning(empty),
    intakeMeaning(empty),
    scoreMeaning(empty),
    stageMeaning(empty),
    tasksMeaning(empty),
  ]) {
    assert.deepEqual(text, []);
  }
});

test("meaning texts say what is true, with Danish plural and number format", () => {
  const cases: CaseRow[] = [];
  const runs: RunRow[] = [];
  for (let index = 0; index < 6; index += 1) {
    cases.push(
      caseRow(`c${index}`, { country: index < 4 ? "DK" : "SE", createdAt: day(index * 4) }),
    );
    runs.push(screening(`c${index}`, [72, 75, 61, 64, 66, 55][index]!));
  }
  cases.push(caseRow("wait", { phase: "committee", lastActionAt: day(9) }));
  const core = buildOverview(base({ cases, runs, period: "12w" }));
  const pipeline = pipelineMeaning(core);
  // The case in Komité counts as screened too (it has got past screening).
  assert.match(pipeline[0]!, /^7 af 7 cases i perioden er screenet, og 1 er sendt videre/);
  assert.match(pipeline.join(" "), /2 cases over tærsklen \(70\) er endnu ikke sendt videre/);
  assert.match(pipeline.join(" "), /Selskab wait har ventet på komitéens beslutning i 9 dage/);
  assert.match(
    geoMeaning(core)[0]!,
    /^71 % af de aktive cases med kendt hovedsæde ligger i Danmark/,
  );
  assert.match(scoreMeaning(core)[0]!, /Medianen er 65, og 2 af 6 screenede cases/);
  assert.match(intakeMeaning(core)[0]!, /^I perioden er der kommet 7 cases/);
  assert.match(stageMeaning(core)[0]!, /^Seed er det hyppigste stadie med 7 af 7 aktive cases/);
  assert.match(sectorMeaning(core)[0]!, /^Software er den største sektor med 7 af 7 aktive cases/);
});

test("the heat map's stage columns follow the fund's language (T-614b1)", () => {
  const labels = (language?: "da" | "en") =>
    stageColumns(["seed"], ["later", "unknown"], language).map((column) => column.label);
  assert.deepEqual(labels(), ["Seed", "Senere", "Ukendt"]);
  assert.deepEqual(labels("en"), ["Seed", "Later stage", "Unknown"]);
});
