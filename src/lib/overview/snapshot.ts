/**
 * Overblik v2: the numbers. `buildOverview` is pure: the server function reads the rows
 * (all pages, see paginate.ts) and hands them over, so every rule is tested without a database.
 *
 * Rules (gap doc, rule 2 "tal skal passe med Cases"):
 * - "Aktive cases" are the cases that are not in phase Besluttet, the same as the Cases list's
 *   "N aktive cases". Geografi, Sektor og fase and Stadie count those, by `cases.phase`.
 * - The period (4 uger / Kvartal / År) governs Pipeline, Tilgang and Scorefordeling.
 * - Each card carries the ids behind its number, so "Cases bag tallet" is exactly the number.
 * - Unknown country, sector and stage are counted as unknown, never guessed.
 */
import type { CasePhase, CaseStatus } from "../cases/lifecycle.ts";
import { stageKey, stageText } from "../funds/basis-labels.ts";
import { DEFAULT_LANGUAGE, type Language } from "../i18n/language.ts";
import { translate } from "../i18n/translate.ts";
import { copenhagenDate, inPeriod, type OverviewPeriod } from "./dates.ts";
import {
  funnelCounts,
  intakeBars,
  reachFromEvents,
  type FunnelFacts,
  type FunnelResult,
  type IntakeResult,
  type TransitionEvent,
} from "./funnel.ts";
import { compareWaiting, waitingReason, type WaitingReason } from "./waiting.ts";

// -- input rows -------------------------------------------------------------------------------

export interface CaseRow {
  id: string;
  name: string;
  phase: CasePhase;
  status: CaseStatus;
  createdAt: string;
  lastActionAt: string;
  country: string | null;
  sector: string | null;
  /** companies.stage: "seed", "pre_seed", ... or null. */
  stage: string | null;
}

export interface RunRow {
  id: string;
  caseId: string;
  kind: "screening" | "deep";
  status: string;
  previousRunId: string | null;
  createdAt: string;
  completedAt: string | null;
  overallScore: number | null;
  evidenceConfidence: number | null;
}

export interface RecalcRow {
  runId: string;
  overallScore: number | null;
  createdAt: string;
}

export interface OpenTaskRow {
  caseId: string;
  assigneeId: string | null;
  dueOn: string | null;
}

export interface BuildInput {
  now: Date;
  /** The fund's language for the labels the snapshot builds (stage columns, "Ikke klassificeret"). */
  language?: Language;
  period: OverviewPeriod;
  threshold: number;
  /** fund_mandates.stages: keys ("seed") or the fund's own text. */
  fundStages: readonly string[];
  viewerId: string;
  cases: readonly CaseRow[];
  /** Runs of the fund's active setup version. */
  runs: readonly RunRow[];
  recalcs: readonly RecalcRow[];
  events: readonly TransitionEvent[];
  openTasks: readonly OpenTaskRow[];
  /** Cases with a queued or running screening or deep analysis (any setup version). */
  runningCaseIds: ReadonlySet<string>;
  /** Cases with a finished screening under an OLDER setup version of the fund. */
  olderVersionScreenedIds?: ReadonlySet<string>;
}

// -- output -----------------------------------------------------------------------------------

export type CaseView = "screening" | "deep";

/** What "Cases bag tallet" and the Venter rows show about a case. */
export interface CaseRef {
  id: string;
  name: string;
  sector: string | null;
  stageLabel: string | null;
  country: string | null;
  phase: CasePhase;
  status: CaseStatus;
  /** The score a case row shows: the deep analysis once past screening, else the screening. */
  score: number | null;
  /** The latest screening's score only (what the score distribution and the funnel count). */
  screeningScore: number | null;
  view: CaseView;
}

export interface WaitingRowData {
  caseId: string;
  name: string;
  score: number | null;
  reason: WaitingReason;
  openTasks: number;
  phase: CasePhase;
  status: CaseStatus;
  lastActionAt: string;
  hasScreening: boolean;
  canRunDeep: boolean;
  hasDeep: boolean;
  running: boolean;
  view: CaseView;
}

export interface GeoRow {
  code: string;
  total: number;
  screening: number;
  deep_analysis: number;
  committee: number;
}

export interface HeatColumn {
  key: string;
  label: string;
}

export interface HeatRow {
  label: string;
  total: number;
  /** One count per column. */
  cells: number[];
}

export const SCORE_BINS: ReadonlyArray<{ label: string; from: number; to: number }> = [
  { label: "<50", from: 0, to: 50 },
  { label: "50", from: 50, to: 60 },
  { label: "60", from: 60, to: 70 },
  { label: "70", from: 70, to: 80 },
  { label: "80+", from: 80, to: 101 },
];

export interface ScoreBin {
  label: string;
  from: number;
  to: number;
  count: number;
}

export interface StageSlice {
  key: string;
  label: string;
  count: number;
}

export interface TaskSummary {
  /** Open tasks assigned to the viewer on cases that are still open (nobody's are not counted). */
  open: number;
  overdue: number;
  cases: number;
}

export interface OverviewCore {
  period: OverviewPeriod;
  threshold: number;
  /** Danish calendar date of "today" (what the weeks are counted from). */
  today: string;
  activeCases: number;
  /** All the fund's cases, decided included (0 = the fund has no cases yet). */
  totalCases: number;
  /**
   * Cases screened under an older setup version that have no screening under the active one:
   * they look unscreened here until they are screened again.
   */
  olderVersionCases: number;
  /** Ids behind the numbers on each card. */
  lists: {
    pipeline: string[];
    geo: string[];
    sector: string[];
    intake: string[];
    score: string[];
    stage: string[];
  };
  cases: Record<string, CaseRef>;
  waitingTotal: number;
  waiting: WaitingRowData[];
  /** The longest "Afventer komitéens beslutning" among all waiting cases. */
  longestCommitteeWait: { name: string; days: number } | null;
  funnel: FunnelResult;
  geo: { rows: GeoRow[]; noCountry: number };
  heat: { columns: HeatColumn[]; rows: HeatRow[] };
  intake: IntakeResult;
  scores: { bins: ScoreBin[]; count: number; overThreshold: number; median: number | null };
  stages: StageSlice[];
  tasks: TaskSummary;
}

export const MAX_WAITING_ROWS = 8;
/** Fewer active cases than this is too few for a heat map. */
export const MIN_HEAT_CASES = 5;

// -- stages -----------------------------------------------------------------------------------

/** Canonical order of the company stages (earliest first); unknown last. */
export const STAGE_ORDER = [
  "pre_seed",
  "seed",
  "series_a",
  "series_b",
  "growth",
  "buyout",
  "later",
  "unknown",
] as const;

const DEFAULT_COLUMNS = ["pre_seed", "seed", "series_a", "series_b"];

const normalize = (text: string) => text.toLowerCase().replace(/[^a-zæøå0-9]/g, "");

/** Stage keys a column stands for: "Series B+" is counted under Series B. */
const COLUMN_OF: Readonly<Record<string, string>> = { series_b_plus: "series_b" };

/** A stage key from the fund's stage list: either a key already, or its Danish/English name. */
export function stageKeyFromText(text: string): string | null {
  const key = stageKey(text);
  const column = COLUMN_OF[key] ?? key;
  if (column !== "unknown" && (STAGE_ORDER as readonly string[]).includes(column)) return column;
  const wanted = normalize(text);
  for (const key of STAGE_ORDER) {
    if (key === "unknown") continue;
    if (normalize(key) === wanted || normalize(stageText(key)) === wanted) return key;
  }
  return null;
}

export const stageName = (key: string, language: Language = DEFAULT_LANGUAGE) =>
  key === "unknown" ? translate(language, "overview.stagePhase.unknown") : stageText(key, language);

const stageRank = (key: string) => {
  const index = (STAGE_ORDER as readonly string[]).indexOf(key);
  return index < 0 ? STAGE_ORDER.length - 1 : index;
};

/**
 * The heat map's columns: the fund's own stages (more or fewer than four), plus any
 * stage an active case has that the fund does not list, plus "Ukendt" only when a case has it.
 */
export function stageColumns(
  fundStages: readonly string[],
  presentKeys: readonly string[],
  language: Language = DEFAULT_LANGUAGE,
): HeatColumn[] {
  const keys = new Set<string>();
  for (const text of fundStages) {
    const key = stageKeyFromText(text);
    if (key) keys.add(key);
  }
  for (const key of presentKeys) keys.add(key);
  if (keys.size === 0) for (const key of DEFAULT_COLUMNS) keys.add(key);
  return [...keys]
    .sort((a, b) => stageRank(a) - stageRank(b))
    .map((key) => ({ key, label: stageName(key, language) }));
}

// -- helpers ----------------------------------------------------------------------------------

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/** Where the threshold's dashed line stands on the five equal-width score bars (0 to 1). */
export function thresholdPosition(threshold: number): number {
  const bins = SCORE_BINS.length;
  if (threshold <= 0) return 0;
  if (threshold >= 100) return 1;
  for (let index = 0; index < bins; index += 1) {
    const { from, to } = SCORE_BINS[index]!;
    const end = index === bins - 1 ? 100 : to;
    if (threshold < end) return (index + (threshold - from) / (end - from)) / bins;
  }
  return 1;
}

const isFinished = (status: string) => status === "complete" || status === "awaiting_approval";

const byNewest = (a: { createdAt: string }, b: { createdAt: string }) =>
  a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0;

function compareRefs(a: CaseRef, b: CaseRef): number {
  return (b.score ?? -1) - (a.score ?? -1) || a.name.localeCompare(b.name, "da");
}

// -- the build --------------------------------------------------------------------------------

export function buildOverview(input: BuildInput): OverviewCore {
  const language = input.language ?? DEFAULT_LANGUAGE;
  const { now, period, threshold } = input;

  const runsByCase = new Map<string, RunRow[]>();
  for (const run of input.runs) {
    const list = runsByCase.get(run.caseId) ?? [];
    list.push({ ...run });
    runsByCase.set(run.caseId, list);
  }
  const recalcByRun = new Map<string, number | null>();
  for (const recalc of [...input.recalcs].sort((a, b) => byNewest(a, b))) {
    if (!recalcByRun.has(recalc.runId)) recalcByRun.set(recalc.runId, recalc.overallScore);
  }
  const reach = reachFromEvents(input.events);
  const openTasksByCase = new Map<string, number>();
  for (const task of input.openTasks) {
    openTasksByCase.set(task.caseId, (openTasksByCase.get(task.caseId) ?? 0) + 1);
  }

  interface Derived {
    row: CaseRow;
    active: boolean;
    hasScreening: boolean;
    screeningRunId: string | null;
    screeningDoneAt: string | null;
    screeningScore: number | null;
    hasDeep: boolean;
    deepScore: number | null;
    canRunDeep: boolean;
    reachedDeep: boolean;
    reachedCommittee: boolean;
    reachedInvested: boolean;
    committeeSince: string | null;
  }

  const derived: Derived[] = input.cases.map((row) => {
    const runs = (runsByCase.get(row.id) ?? []).sort(byNewest);
    const screening = runs.find((run) => run.kind === "screening" && isFinished(run.status));
    const deep = runs.find((run) => run.kind === "deep" && run.status === "complete");
    const fromLog = reach.get(row.id);
    const screeningScore = screening
      ? recalcByRun.has(screening.id)
        ? recalcByRun.get(screening.id)!
        : screening.overallScore
      : null;
    const reachedInvested = row.status === "invested" || fromLog?.invested === true;
    const reachedCommittee =
      row.phase === "committee" || fromLog?.committee === true || reachedInvested;
    const reachedDeep =
      deep !== undefined ||
      row.phase === "deep_analysis" ||
      fromLog?.deep === true ||
      reachedCommittee;
    return {
      row,
      active: row.phase !== "decided",
      hasScreening: screening !== undefined,
      screeningRunId: screening?.id ?? null,
      screeningDoneAt: screening ? (screening.completedAt ?? screening.createdAt) : null,
      screeningScore: Number.isFinite(screeningScore) ? screeningScore : null,
      hasDeep: deep !== undefined,
      deepScore: deep?.overallScore ?? null,
      // The server's own rule: no deep run has been started from this screening yet.
      canRunDeep:
        screening !== undefined &&
        !runs.some(
          (run) =>
            run.kind === "deep" &&
            run.previousRunId === screening.id &&
            ["queued", "running", "complete"].includes(run.status),
        ),
      reachedDeep,
      reachedCommittee,
      reachedInvested,
      committeeSince: fromLog?.committeeSince ?? null,
    };
  });

  // The score a row shows: the deep analysis once there is one (Cases list), else the screening.
  const displayScore = (entry: Derived) =>
    entry.hasDeep && entry.row.phase !== "screening" && entry.deepScore !== null
      ? entry.deepScore
      : entry.screeningScore;
  const viewOf = (entry: Derived): CaseView =>
    entry.hasDeep && entry.row.phase !== "screening" ? "deep" : "screening";

  const refs: Record<string, CaseRef> = {};
  for (const entry of derived) {
    refs[entry.row.id] = {
      id: entry.row.id,
      name: entry.row.name,
      sector: entry.row.sector,
      stageLabel: entry.row.stage ? stageName(entry.row.stage, language) : null,
      country: entry.row.country,
      phase: entry.row.phase,
      status: entry.row.status,
      score: displayScore(entry),
      screeningScore: entry.screeningScore,
      view: viewOf(entry),
    };
  }
  const sortedIds = (entries: readonly Derived[]) =>
    entries
      .map((entry) => refs[entry.row.id]!)
      .sort(compareRefs)
      .map((ref) => ref.id);

  const active = derived.filter((entry) => entry.active);

  // Pipeline and Tilgang: the cohort of cases created in the period.
  const factsOf = (entry: Derived): FunnelFacts => ({
    caseId: entry.row.id,
    createdAt: entry.row.createdAt,
    hasScreening: entry.hasScreening,
    screeningScore: entry.screeningScore,
    reachedDeep: entry.reachedDeep,
    reachedCommittee: entry.reachedCommittee,
    reachedInvested: entry.reachedInvested,
  });
  const funnel = funnelCounts(derived.map(factsOf), threshold, period, now);
  const intake = intakeBars(
    derived.map((entry) => ({ createdAt: entry.row.createdAt, forwarded: entry.reachedDeep })),
    period,
    now,
  );
  const cohortSet = new Set(funnel.cohortIds);
  const cohort = derived.filter((entry) => cohortSet.has(entry.row.id));

  // Geografi: active cases by head-office country and phase.
  const geoMap = new Map<string, GeoRow>();
  let noCountry = 0;
  for (const entry of active) {
    const code = entry.row.country?.toUpperCase() ?? "";
    if (!/^[A-Z]{2}$/.test(code)) {
      noCountry += 1;
      continue;
    }
    const row = geoMap.get(code) ?? {
      code,
      total: 0,
      screening: 0,
      deep_analysis: 0,
      committee: 0,
    };
    row.total += 1;
    if (entry.row.phase !== "decided") row[entry.row.phase] += 1;
    geoMap.set(code, row);
  }
  const geoRows = [...geoMap.values()].sort(
    (a, b) => b.total - a.total || a.code.localeCompare(b.code),
  );

  // Sektor og fase: active cases, sector × stage.
  const stageKeyOf = (entry: Derived) => entry.row.stage ?? "unknown";
  const columns = stageColumns(input.fundStages, [...new Set(active.map(stageKeyOf))], language);
  const columnIndex = new Map(columns.map((column, index) => [column.key, index]));
  const heatMap = new Map<string, HeatRow>();
  for (const entry of active) {
    const label = entry.row.sector ?? translate(language, "overview.shared.unclassified");
    const row = heatMap.get(label) ?? { label, total: 0, cells: columns.map(() => 0) };
    row.total += 1;
    const index = columnIndex.get(stageKeyOf(entry));
    if (index !== undefined) row.cells[index]! += 1;
    heatMap.set(label, row);
  }
  const heatRows = [...heatMap.values()].sort(
    (a, b) => b.total - a.total || a.label.localeCompare(b.label, "da"),
  );

  // Stadie: active cases by stage.
  const stageCounts = new Map<string, number>();
  for (const entry of active) {
    stageCounts.set(stageKeyOf(entry), (stageCounts.get(stageKeyOf(entry)) ?? 0) + 1);
  }
  const stages = [...stageCounts.entries()]
    .sort((a, b) => stageRank(a[0]) - stageRank(b[0]))
    .map(([key, count]) => ({ key, label: stageName(key, language), count }));

  // Scorefordeling: the latest screening score of every case screened in the period.
  const scored = derived.filter(
    (entry) =>
      entry.screeningScore !== null &&
      entry.screeningDoneAt !== null &&
      inPeriod(entry.screeningDoneAt, period, now),
  );
  const scoreValues = scored.map((entry) => entry.screeningScore!);
  const bins: ScoreBin[] = SCORE_BINS.map((bin) => ({
    ...bin,
    count: scoreValues.filter((value) => value >= bin.from && value < bin.to).length,
  }));

  // Venter på jer.
  const waitingAll = derived.flatMap((entry) => {
    const reason = waitingReason(
      {
        phase: entry.row.phase,
        status: entry.row.status,
        lastActionAt: entry.row.lastActionAt,
        running: input.runningCaseIds.has(entry.row.id),
        hasScreening: entry.hasScreening,
        screeningScore: entry.screeningScore,
        canRunDeep: entry.canRunDeep,
        hasDeep: entry.hasDeep,
        committeeSince: entry.committeeSince,
      },
      threshold,
      now,
    );
    if (!reason) return [];
    const data: WaitingRowData = {
      caseId: entry.row.id,
      name: entry.row.name,
      score: displayScore(entry),
      reason,
      openTasks: openTasksByCase.get(entry.row.id) ?? 0,
      phase: entry.row.phase,
      status: entry.row.status,
      lastActionAt: entry.row.lastActionAt,
      hasScreening: entry.hasScreening,
      canRunDeep: entry.canRunDeep,
      hasDeep: entry.hasDeep,
      running: input.runningCaseIds.has(entry.row.id),
      view: viewOf(entry),
    };
    return [data];
  });
  waitingAll.sort(compareWaiting);
  const committeeWaits = waitingAll.filter((row) => row.reason.kind === "committee");
  const longest = committeeWaits.reduce<WaitingRowData | null>(
    (best, row) => (best === null || row.reason.days > best.reason.days ? row : best),
    null,
  );

  // The tasks line: open tasks on open cases that are the viewer's or nobody's.
  const activeIds = new Set(active.map((entry) => entry.row.id));
  const today = copenhagenDate(now);
  const mine = input.openTasks.filter(
    (task) => activeIds.has(task.caseId) && task.assigneeId === input.viewerId,
  );

  return {
    period,
    threshold,
    today,
    activeCases: active.length,
    totalCases: derived.length,
    olderVersionCases: derived.filter(
      (entry) => !entry.hasScreening && input.olderVersionScreenedIds?.has(entry.row.id),
    ).length,
    lists: {
      pipeline: sortedIds(cohort),
      geo: sortedIds(active),
      sector: sortedIds(active),
      intake: sortedIds(cohort),
      score: sortedIds(scored),
      stage: sortedIds(active),
    },
    cases: refs,
    waitingTotal: waitingAll.length,
    waiting: waitingAll.slice(0, MAX_WAITING_ROWS),
    longestCommitteeWait: longest ? { name: longest.name, days: longest.reason.days } : null,
    funnel,
    geo: { rows: geoRows, noCountry },
    heat: { columns, rows: heatRows },
    intake,
    scores: {
      bins,
      count: scoreValues.length,
      overThreshold: scoreValues.filter((value) => value >= threshold).length,
      median: median(scoreValues),
    },
    stages,
    tasks: {
      open: mine.length,
      overdue: mine.filter((task) => task.dueOn !== null && task.dueOn.slice(0, 10) < today).length,
      cases: new Set(mine.map((task) => task.caseId)).size,
    },
  };
}
