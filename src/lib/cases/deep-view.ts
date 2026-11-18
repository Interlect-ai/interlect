/**
 * The rules behind the Dyb analyse page (Case Dyb analyse v5; ticket, gap/R-6-dyb-analyse.md "Batch
 * 1" and "Selv valgt"). Pure and tested; only type imports and `screening-view.ts`, so
 * `node --test` can load the file.
 *
 * - Specialist groups: the fund's own criteria grouped by the specialist module that owns the
 *   criterion's category (the modules are passed in; never keywords). A criterion no module
 *   owns lands in "Øvrige kriterier".
 * - A specialist's score is the weighted average of its own criteria, calculated here in code
 *   (v3: "Specialistens score = vægtet gennemsnit af dens kriterier"), never by AI.
 * - Delta since screening: the same criteria, the same weights, screening score against deep
 *   score, only for criteria scored in both runs.
 * - The bridge from the screening score to the deep score, one step per specialist. There is
 *   no risk deduction (gap choice): risks do not change the score. What the criteria do
 *   not explain (a team answer recalculated the screening, a criterion only one run scored) is
 *   shown as its own "Øvrige ændringer" step, calculated as the remainder, never guessed.
 */
import type {
  FinancialMetric,
  FinancialMetricsReport,
  MetricPoint,
} from "../analysis/financial-metrics.ts";
import { LANGUAGE_TAGS, type Language } from "../i18n/language.ts";
import { translate, type MessageKey } from "../i18n/translate.ts";
import {
  ECONOMY_COLOR,
  OTHER_COLOR,
  RISKS_COLOR,
  STANDARD_SPECIALIST_COLORS,
  criterionColors,
  ownSpecialistColor,
} from "../charts/colors.ts";

export interface DeepCriterionInput {
  criterionKey: string;
  category: string;
  label: string;
  /** The fund's own description of the criterion ("Det vurderer vi"). */
  description?: string | undefined;
  score: number | null;
  weight: number;
  confidence: number | null;
  verdict: string | null;
  rationale: string;
  positiveDrivers: string[];
  negativeDrivers: string[];
  unknowns: string[];
  evidenceIds: string[];
}

export interface ScreeningCriterionInput {
  criterionKey: string;
  score: number | null;
}

/** The part of a specialist module the page needs (the rest is prompt text for the server). */
export interface SpecialistDef {
  id: string;
  title: string;
  categories: readonly string[];
}

/** The page's own tab keys; specialist ids (`people_team` …) are the other tab keys. */
export const CONCLUSION_TAB = "konklusion";
export const ECONOMY_TAB = "okonomi";
export const RISKS_TAB = "risici";
export const OTHER_GROUP_ID = "ovrige";

/** Short tab names from the prototype; an unknown module falls back to its own title. */
const SPECIALIST_LABEL_KEYS: Record<string, MessageKey> = {
  people_team: "deep.specialistNames.people_team",
  product_market_gtm: "deep.specialistNames.product_market_gtm",
  technology_risk: "deep.specialistNames.technology_risk",
  fund_finance_deal: "deep.specialistNames.fund_finance_deal",
};

/** The nine score categories' names (the keys of `deep.categories`) in the fund's language. */
const SCORE_CATEGORY_KEYS = {
  fund_thesis_fit: "deep.categories.fund_thesis_fit",
  founder_market_fit: "deep.categories.founder_market_fit",
  team_market_fit: "deep.categories.team_market_fit",
  product_market_fit: "deep.categories.product_market_fit",
  product_technology: "deep.categories.product_technology",
  market_timing: "deep.categories.market_timing",
  traction_gtm: "deep.categories.traction_gtm",
  financial_strength: "deep.categories.financial_strength",
  evidence_quality: "deep.categories.evidence_quality",
} as const satisfies Record<string, MessageKey>;

/** Category → name for `specialistTopics`, in the fund's language. */
export function categoryLabels(language: Language = "da"): Record<string, string> {
  return Object.fromEntries(
    Object.entries(SCORE_CATEGORY_KEYS).map(([category, key]) => [
      category,
      translate(language, key),
    ]),
  );
}

// The colours come from one source; re-exported for the pages that import them here.
export { ECONOMY_COLOR, RISKS_COLOR };

export interface CriterionRow extends DeepCriterionInput {
  /** The criterion's colour (--series-N in the fund's own order). */
  color: string;
  screeningScore: number | null;
  /** Deep score minus screening score (whole points); null when one of them is missing. */
  delta: number | null;
  /** weight × score / 100: the criterion's points in the deep score. */
  contribution: number;
}

/** A specialist's figure (the same names as `SpecialistKind` in the app's specialist-kind.ts). */
export type TabFigure =
  "team" | "market" | "tech" | "finance" | "deal" | "own1" | "own2" | "own3" | "own4";

const STANDARD_FIGURES: Record<string, TabFigure> = {
  people_team: "team",
  product_market_gtm: "market",
  technology_risk: "tech",
  fund_finance_deal: "deal",
};
const OWN_FIGURES = ["own1", "own2", "own3", "own4"] as const;

export interface SpecialistGroup {
  id: string;
  /** The specialist's figure (a fund's own specialist gets one of own1–own4 by its place); null for "Øvrige". */
  figure: TabFigure | null;
  /** Tab and card name ("Team"). */
  label: string;
  /** The module's own longer name ("Founder, ledelse og team"). */
  title: string;
  color: string;
  criteria: CriterionRow[];
  /** The score categories this specialist owns (its findings are grouped by them). */
  categories: string[];
  /** Sum of the criteria's weights in percent. */
  weight: number;
  /** Weighted average of the criteria, whole points; null when none is scored. */
  score: number | null;
  /** The same criteria's weighted screening average (criteria scored in both runs). */
  screeningScore: number | null;
  /** score − screeningScore over the criteria scored in both runs, whole points. */
  delta: number | null;
  /** Points this specialist added to (or took from) the total score since screening. */
  pointsDelta: number | null;
  /** Points the specialist's criteria hold in the deep score (weight × score / 100). */
  points: number;
  /** The specialist's short reading (verdicts of its criteria, else the first sentences). */
  summary: string;
  /** Its short point for the card on Konklusion; null before deep prompt v15. */
  headline: string | null;
  strengths: string[];
  weaknesses: string[];
  unknowns: string[];
  /** The specialist's own questions; shown on the tab of a specialist without criteria. */
  questions: string[];
  evidenceCount: number;
  /** 0–1, mean of the criteria's confidence; null when none is given. */
  confidence: number | null;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

/** Weighted average; a group with no positive weight falls back to the plain mean. */
export function weightedAverage(
  items: readonly { score: number | null; weight: number }[],
): number | null {
  const scored = items.filter(
    (item): item is { score: number; weight: number } => item.score !== null,
  );
  if (scored.length === 0) return null;
  const weight = scored.reduce((sum, item) => sum + Math.max(0, item.weight), 0);
  if (weight <= 0) return scored.reduce((sum, item) => sum + item.score, 0) / scored.length;
  return scored.reduce((sum, item) => sum + item.score * Math.max(0, item.weight), 0) / weight;
}

/** Sentence split that does not cut at "mio. kr." (needs a capital or digit after the full stop). */
export function firstSentences(value: string, count: number): string {
  const sentences = value
    .trim()
    .split(/(?<=[.!?])\s+(?=[A-ZÆØÅ0-9])/u)
    .filter(Boolean);
  return sentences.slice(0, count).join(" ") || value.trim();
}

/**
 * A criterion's reasoning as reading paragraphs (the prototype shows 3–4 short paragraphs): the
 * model's own paragraph breaks are kept, and a block of more than three sentences is split into
 * paragraphs of at most three.
 */
export function rationaleParagraphs(value: string): string[] {
  const blocks = value
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  return blocks.flatMap((block) => {
    const sentences = block.split(/(?<=[.!?])\s+(?=[A-ZÆØÅ0-9])/u).filter(Boolean);
    if (sentences.length <= 3) return [block];
    // Four sentences read better as two and two than as three and one.
    const size = sentences.length === 4 ? 2 : 3;
    const paragraphs: string[] = [];
    for (let index = 0; index < sentences.length; index += size) {
      paragraphs.push(sentences.slice(index, index + size).join(" "));
    }
    return paragraphs;
  });
}

function specialistSummary(criteria: readonly DeepCriterionInput[]): string {
  const verdicts = unique(criteria.flatMap((criterion) => criterion.verdict ?? []));
  if (verdicts.length > 0) return verdicts.join(" ");
  const rationale = unique(criteria.map((criterion) => criterion.rationale)).join(" ");
  return rationale ? firstSentences(rationale, 2) : "";
}

export function specialistLabel(module: SpecialistDef, language: Language = "da"): string {
  const key = SPECIALIST_LABEL_KEYS[module.id];
  return key ? translate(language, key) : module.title;
}

function round(value: number | null): number | null {
  return value === null ? null : Math.round(value);
}

function buildGroup(
  def: {
    id: string;
    figure: TabFigure | null;
    label: string;
    title: string;
    color: string;
    categories: string[];
  },
  criteria: CriterionRow[],
  ownSummary?: string | null,
  headline: string | null = null,
): SpecialistGroup {
  const common = criteria.filter((row) => row.score !== null && row.screeningScore !== null);
  const now = weightedAverage(common);
  const before = weightedAverage(
    common.map((row) => ({ score: row.screeningScore, weight: row.weight })),
  );
  const confidences = criteria
    .map((row) => row.confidence)
    .filter((value): value is number => value !== null);
  return {
    ...def,
    criteria,
    weight: criteria.reduce((sum, row) => sum + row.weight, 0),
    score: round(weightedAverage(criteria)),
    screeningScore: round(before),
    delta: now === null || before === null ? null : Math.round(now) - Math.round(before),
    pointsDelta: common.length
      ? common.reduce(
          (sum, row) => sum + (row.weight * (row.score! - row.screeningScore!)) / 100,
          0,
        )
      : null,
    points: criteria.reduce((sum, row) => sum + row.contribution, 0),
    // The specialist's own conclusion (prompt v10+); older runs fall back to the joined verdicts.
    summary: ownSummary?.trim() || specialistSummary(criteria),
    headline,
    strengths: unique(criteria.flatMap((row) => row.positiveDrivers)),
    weaknesses: unique(criteria.flatMap((row) => row.negativeDrivers)),
    unknowns: unique(criteria.flatMap((row) => row.unknowns)),
    questions: [],
    evidenceCount: unique(criteria.flatMap((row) => row.evidenceIds)).length,
    confidence:
      confidences.length === 0
        ? null
        : confidences.reduce((sum, value) => sum + value, 0) / confidences.length,
  };
}

/** What a specialist wrote itself (`raw_response.specialists`, see `parseSpecialistViews`). */
type SpecialistOutput = {
  moduleId: string;
  summary: string | null;
  headline?: string | null;
  strengths?: readonly string[];
  weaknesses?: readonly string[];
  questions?: readonly string[];
  unknowns?: readonly string[];
};

/**
 * The deep analysis's criteria grouped by the fund's specialist modules, in the modules' order.
 * A module without a criterion gets a group (and a tab) only when it wrote something itself: a
 * team's own specialist without criteria then shows its own summary, strengths,
 * weaknesses and questions, with no score. Criteria no module owns are collected last under
 * "Øvrige kriterier".
 */
export function specialistGroups(
  criteria: readonly DeepCriterionInput[],
  screeningCriteria: readonly ScreeningCriterionInput[],
  modules: readonly SpecialistDef[],
  specialists: readonly SpecialistOutput[] = [],
  language: Language = "da",
): SpecialistGroup[] {
  const outputByModule = new Map(specialists.map((item) => [item.moduleId, item]));
  const screeningByKey = new Map(screeningCriteria.map((row) => [row.criterionKey, row.score]));
  // The screening's order first, so a criterion keeps its colour from screening to deep analysis.
  const colors = criterionColors(
    screeningCriteria.map((row) => row.criterionKey),
    criteria.map((row) => row.criterionKey),
  );
  const rows: CriterionRow[] = criteria.map((criterion) => {
    const screeningScore = screeningByKey.get(criterion.criterionKey) ?? null;
    return {
      ...criterion,
      color: colors.of(criterion.criterionKey),
      screeningScore,
      delta:
        criterion.score !== null && screeningScore !== null
          ? Math.round(criterion.score - screeningScore)
          : null,
      contribution: ((criterion.score ?? 0) * criterion.weight) / 100,
    };
  });
  const owner = new Map<string, string>();
  for (const module of modules) {
    for (const category of module.categories)
      if (!owner.has(category)) owner.set(category, module.id);
  }
  const groups: SpecialistGroup[] = [];
  // A fund's own specialist gets its colour from its place among the run's own specialists, so it
  // stays the same when an earlier one wrote nothing and has no tab. (The editor counts switched-off
  // own specialists too; they only differ when one ahead of it is switched off.)
  const ownIndex = new Map(
    modules
      .filter((module) => !(module.id in STANDARD_SPECIALIST_COLORS))
      .map((module, index) => [module.id, index]),
  );
  for (const module of modules) {
    const own = rows.filter((row) => owner.get(row.category) === module.id);
    const output = outputByModule.get(module.id);
    const written = {
      strengths: unique(output?.strengths ?? []),
      weaknesses: unique(output?.weaknesses ?? []),
      questions: unique(output?.questions ?? []),
      unknowns: unique(output?.unknowns ?? []),
    };
    const wroteSomething =
      Boolean(output?.summary?.trim()) ||
      written.strengths.length +
        written.weaknesses.length +
        written.questions.length +
        written.unknowns.length >
        0;
    if (own.length === 0 && !wroteSomething) continue;
    const color =
      STANDARD_SPECIALIST_COLORS[module.id] ?? ownSpecialistColor(ownIndex.get(module.id) ?? 0);
    const group = buildGroup(
      {
        id: module.id,
        figure:
          STANDARD_FIGURES[module.id] ??
          OWN_FIGURES[(ownIndex.get(module.id) ?? 0) % OWN_FIGURES.length]!,
        label: specialistLabel(module, language),
        title: module.title,
        color,
        categories: [...module.categories],
      },
      own,
      output?.summary,
      output?.headline ?? null,
    );
    groups.push(own.length > 0 ? group : { ...group, ...written });
  }
  const rest = rows.filter((row) => !owner.has(row.category));
  if (rest.length > 0) {
    groups.push(
      buildGroup(
        {
          id: OTHER_GROUP_ID,
          figure: null,
          label: translate(language, "deep.specialistNames.other"),
          title: translate(language, "deep.specialistNames.other"),
          color: OTHER_COLOR,
          categories: unique(rest.map((row) => row.category)),
        },
        rest,
      ),
    );
  }
  return groups;
}

// ---------------------------------------------------------------------------
// The bridge: Screening → one step per specialist → Dyb analyse
// ---------------------------------------------------------------------------

export interface BridgeStep {
  key: string;
  label: string;
  kind: "total" | "delta";
  color: string;
  /** Start and end of the bar on the 0–100 scale (from ≤ to for a rise, from > to for a fall). */
  from: number;
  to: number;
  /** The total's value, or the step's signed points. */
  value: number;
}

export const REST_STEP_KEY = "ovrige-aendringer";

/**
 * Screening score → the points each specialist added since screening → Dyb analyse. The
 * remainder (what the criteria do not explain) gets its own step when it is half a point or
 * more. Null when either score is missing.
 */
export function scoreBridge(
  input: {
    screeningScore: number | null;
    deepScore: number | null;
    groups: readonly SpecialistGroup[];
  },
  language: Language = "da",
): BridgeStep[] | null {
  const { screeningScore, deepScore, groups } = input;
  if (screeningScore === null || deepScore === null) return null;
  const steps: BridgeStep[] = [
    {
      key: "screening",
      label: translate(language, "deep.bridge.screening"),
      kind: "total",
      color: "color-mix(in srgb, var(--ink-1) 28%, transparent)",
      from: 0,
      to: screeningScore,
      value: screeningScore,
    },
  ];
  let cursor = screeningScore;
  for (const group of groups) {
    if (group.pointsDelta === null) continue;
    steps.push({
      key: group.id,
      label: group.label,
      kind: "delta",
      color: group.pointsDelta >= 0 ? group.color : "var(--critical)",
      from: cursor,
      to: cursor + group.pointsDelta,
      value: group.pointsDelta,
    });
    cursor += group.pointsDelta;
  }
  const rest = deepScore - cursor;
  if (Math.abs(rest) >= 0.5) {
    steps.push({
      key: REST_STEP_KEY,
      label: translate(language, "deep.bridge.rest"),
      kind: "delta",
      color: rest >= 0 ? "var(--ink-3)" : "var(--critical)",
      from: cursor,
      to: cursor + rest,
      value: rest,
    });
  }
  steps.push({
    key: "deep",
    label: translate(language, "deep.bridge.deep"),
    kind: "total",
    color: "var(--ink-1)",
    from: 0,
    to: deepScore,
    value: deepScore,
  });
  return steps;
}

/**
 * The scale the bridge is drawn on: the smallest 5-step range that holds every bar and the
 * threshold (the prototype uses 60–85), at least 10 points wide, inside 0–100.
 */
export function bridgeDomain(
  steps: readonly BridgeStep[],
  threshold: number | null,
): { lo: number; hi: number } {
  const values = steps.flatMap((step) => [step.from, step.to]).filter((value) => value > 0);
  if (threshold !== null) values.push(threshold);
  if (values.length === 0) return { lo: 0, hi: 100 };
  let lo = Math.max(0, Math.floor((Math.min(...values) - 3) / 5) * 5);
  let hi = Math.min(100, Math.ceil((Math.max(...values) + 3) / 5) * 5);
  if (hi - lo < 10) {
    lo = Math.max(0, hi - 10);
    hi = Math.min(100, lo + 10);
  }
  return { lo, hi };
}

// ---------------------------------------------------------------------------
// Risks: one order for the matrix and the list
// ---------------------------------------------------------------------------

export interface RiskLike {
  level: "low" | "medium" | "high" | "critical";
  likelihood: number | null;
  impact: number | null;
}

const LEVEL_RANK: Record<RiskLike["level"], number> = { critical: 3, high: 2, medium: 1, low: 0 };

/** "Kritiske risici først" (gap choice 6): level, then likelihood × impact; the model's order breaks ties. */
export function sortRisks<T extends RiskLike>(risks: readonly T[]): T[] {
  const exposure = (risk: RiskLike) => (risk.likelihood ?? 0) * (risk.impact ?? 0);
  return risks
    .map((risk, index) => ({ risk, index }))
    .sort(
      (a, b) =>
        LEVEL_RANK[b.risk.level] - LEVEL_RANK[a.risk.level] ||
        exposure(b.risk) - exposure(a.risk) ||
        a.index - b.index,
    )
    .map((entry) => entry.risk);
}

export function hasRiskCoordinates(risk: RiskLike): boolean {
  return risk.likelihood !== null && risk.impact !== null;
}

/** Risks the model rated high or critical (the card's one sentence). */
export function highRiskCount(risks: readonly RiskLike[]): number {
  return risks.filter((risk) => risk.level === "high" || risk.level === "critical").length;
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

export interface DeepTab {
  key: string;
  label: string;
  /** The dot on the tab (the specialist's colour); null for Konklusion. */
  color: string | null;
  /** The specialist's figure in front of the name; null on Konklusion, Risici and "Øvrige". */
  figure: TabFigure | null;
  kind: "conclusion" | "specialist" | "economy" | "risks";
  /** "Specialist", "Regnet i kode" or "Risikoanalyse" (the prototype's card label). */
  caption: string | null;
}

/**
 * Konklusion, one tab per specialist group, Økonomi (only when the case has annual reports or
 * calculable figures; "Regnet i kode") and Risici (only when the run has risks).
 */
export function deepTabs(
  groups: readonly SpecialistGroup[],
  options: { economy: boolean; risks: boolean },
  language: Language = "da",
): DeepTab[] {
  return [
    {
      key: CONCLUSION_TAB,
      label: translate(language, "deep.tabs.conclusion"),
      color: null,
      figure: null,
      kind: "conclusion",
      caption: null,
    },
    ...groups.map((group): DeepTab => ({
      key: group.id,
      label: group.label,
      color: group.color,
      figure: group.figure,
      kind: "specialist",
      caption: translate(language, "deep.tabs.specialist"),
    })),
    ...(options.economy
      ? [
          {
            key: ECONOMY_TAB,
            label: translate(language, "deep.tabs.economy"),
            color: ECONOMY_COLOR,
            figure: "finance" as const,
            kind: "economy" as const,
            caption: translate(language, "deep.tabs.economyCaption"),
          },
        ]
      : []),
    ...(options.risks
      ? [
          {
            key: RISKS_TAB,
            label: translate(language, "deep.tabs.risks"),
            color: RISKS_COLOR,
            figure: null,
            kind: "risks" as const,
            caption: translate(language, "deep.tabs.risksCaption"),
          },
        ]
      : []),
  ];
}

/** The tab the URL asks for, or Konklusion when it does not exist on this case. */
export function resolveTab(tabs: readonly DeepTab[], spor: string | undefined): string {
  return tabs.some((tab) => tab.key === spor) ? spor! : CONCLUSION_TAB;
}

const SPOR_PATTERN = /^[a-z0-9_]{1,40}$/;

/** `spor=` from the URL: a tab key, or dropped (Konklusion is the default and has no value). */
export function parseSpor(value: unknown): string | undefined {
  return typeof value === "string" && value !== CONCLUSION_TAB && SPOR_PATTERN.test(value)
    ? value
    : undefined;
}

// ---------------------------------------------------------------------------
// Risks, batch 2: one numbering for the matrix and the list
// ---------------------------------------------------------------------------

export interface NumberedRisk<T> {
  risk: T;
  /** 1-based; the number on the matrix marker and in the list. */
  number: number;
}

/** Sorted (critical first) and numbered 1…n: the matrix and the list both use this. */
export function numberRisks<T extends RiskLike>(risks: readonly T[]): NumberedRisk<T>[] {
  return sortRisks(risks).map((risk, index) => ({ risk, number: index + 1 }));
}

export type HeatBand = "critical" | "high" | "medium" | "none";

/** The matrix cell's tone from likelihood × impact (the prototype: 16 / 10 / 5). */
export function heatBand(likelihood: number, impact: number): HeatBand {
  const severity = likelihood * impact;
  if (severity >= 16) return "critical";
  if (severity >= 10) return "high";
  if (severity >= 5) return "medium";
  return "none";
}

export interface MatrixCell<T> {
  likelihood: number;
  impact: number;
  band: HeatBand;
  entries: NumberedRisk<T>[];
}

/**
 * The 5 × 5 matrix as the prototype lays it out: the highest impact in the top row, the lowest
 * likelihood in the left column. Risks without both coordinates are not placed (they stay in
 * the list). Out-of-range ratings are clamped to 1–5 so a marker is never lost.
 */
export function matrixCells<T extends RiskLike>(
  entries: readonly NumberedRisk<T>[],
): MatrixCell<T>[] {
  const clamp = (value: number) => Math.min(5, Math.max(1, Math.round(value)));
  const placed = entries.filter((entry) => hasRiskCoordinates(entry.risk));
  const cells: MatrixCell<T>[] = [];
  for (let impact = 5; impact >= 1; impact -= 1) {
    for (let likelihood = 1; likelihood <= 5; likelihood += 1) {
      cells.push({
        likelihood,
        impact,
        band: heatBand(likelihood, impact),
        entries: placed.filter(
          (entry) =>
            clamp(entry.risk.likelihood as number) === likelihood &&
            clamp(entry.risk.impact as number) === impact,
        ),
      });
    }
  }
  return cells;
}

/**
 * What one matrix cell shows: a single risk keeps its own marker; two or more share one
 * marker so the numbers never lie on top of each other. Runs of numbers are written as ranges,
 * "2–5" or "1, 3–5"; with more than two runs the first two are shown and "…" says there are more
 * (`numbers` has them all, for the marker's title and label). The marker takes the colour of the
 * cell's worst risk, which is the first entry (the entries follow the sorted, numbered list).
 */
export function cellMarker<T extends RiskLike>(
  entries: readonly NumberedRisk<T>[],
): { label: string; numbers: number[]; risk: T } | null {
  const first = entries[0];
  if (!first) return null;
  const numbers = entries.map((entry) => entry.number).sort((a, b) => a - b);
  const runs: string[] = [];
  let start = numbers[0]!;
  for (let index = 1; index <= numbers.length; index += 1) {
    const previous = numbers[index - 1]!;
    if (numbers[index] === previous + 1) continue;
    runs.push(start === previous ? String(start) : `${start}–${previous}`);
    start = numbers[index]!;
  }
  const label = runs.length <= 2 ? runs.join(", ") : `${runs[0]}, ${runs[1]} …`;
  return { label, numbers, risk: first.risk };
}

/** How many of the four level steps are filled in the list's meter. */
export function riskLevelSteps(level: RiskLike["level"]): number {
  return { low: 1, medium: 2, high: 3, critical: 4 }[level];
}

// ---------------------------------------------------------------------------
// "Analyserne": a specialist's findings grouped by category
// ---------------------------------------------------------------------------

export interface FindingInput {
  category: string;
  findingType: string;
  statement: string;
  confidence: number | null;
  nature: string;
}

export interface AnalysisTopic {
  /** The score category (also the URL key after "analyse-"). */
  key: string;
  label: string;
  findings: FindingInput[];
  /** "Det trækker op" (strengths). */
  up: FindingInput[];
  /** "Det trækker ned" (weaknesses). */
  down: FindingInput[];
  /** Unknowns and questions ("Det er stadig åbent"). */
  open: FindingInput[];
  /** The specialist's own readings (finding type "assessment"). */
  assessments: FindingInput[];
  /** The card's one sentence: the first reading, else the first finding. */
  answer: string;
  /** 0–1, mean of the findings' confidence; null when none is given. */
  confidence: number | null;
}

/**
 * The findings of one specialist, one topic per category it owns (in its own order) that has at
 * least one finding. A category without findings gets no topic, so no card (gap: no invented
 * sub-headings). `labels` maps a category to its Danish name.
 */
export function specialistTopics(
  findings: readonly FindingInput[],
  categories: readonly string[],
  labels: Readonly<Record<string, string>>,
): AnalysisTopic[] {
  const topics: AnalysisTopic[] = [];
  for (const category of unique(categories)) {
    const own = findings.filter(
      (finding) => finding.category === category && finding.statement.trim() !== "",
    );
    if (own.length === 0) continue;
    const ofType = (...types: string[]) =>
      own.filter((finding) => types.includes(finding.findingType));
    const assessments = ofType("assessment");
    const lead = assessments[0] ?? own[0]!;
    const confidences = own
      .map((finding) => finding.confidence)
      .filter((value): value is number => value !== null && Number.isFinite(value));
    topics.push({
      key: category,
      label: labels[category] ?? category.replaceAll("_", " "),
      findings: own,
      up: ofType("strength"),
      down: ofType("weakness"),
      open: ofType("unknown", "question"),
      assessments,
      answer: firstSentences(lead.statement, 1),
      confidence:
        confidences.length === 0
          ? null
          : confidences.reduce((sum, value) => sum + value, 0) / confidences.length,
    });
  }
  return topics;
}

// ---------------------------------------------------------------------------
// Sub-pages in the URL (`fokus=`)
// ---------------------------------------------------------------------------

export const ANALYSIS_FOCUS_PREFIX = "analyse-";
/** The Økonomi tab's sub-pages. */
export const ECONOMY_FOCUS = {
  revenue: "omsaetning",
  cash: "likviditet",
  unit: "unit-economics",
  metrics: "noegletal",
} as const;
export type EconomyFocusKind = (typeof ECONOMY_FOCUS)[keyof typeof ECONOMY_FOCUS];
const FIXED_FOCUS: readonly string[] = ["hvorfor", ...Object.values(ECONOMY_FOCUS)];

export function isEconomyFocus(value: string): value is EconomyFocusKind {
  return (Object.values(ECONOMY_FOCUS) as string[]).includes(value);
}
const ANALYSIS_FOCUS_PATTERN = /^analyse-[a-z_]{1,40}$/;

export function analysisFocusKey(category: string): string {
  return `${ANALYSIS_FOCUS_PREFIX}${category}`;
}

/** `fokus=` on the deep analysis: a known sub-page, or dropped (the page checks it exists). */
export function parseDeepFocus(value: unknown): string | undefined {
  return typeof value === "string" &&
    (FIXED_FOCUS.includes(value) || ANALYSIS_FOCUS_PATTERN.test(value))
    ? value
    : undefined;
}

// ---------------------------------------------------------------------------
// Økonomi: which cards the real data supports
// ---------------------------------------------------------------------------

function metricOf(report: FinancialMetricsReport, key: string): FinancialMetric | null {
  return report.metrics.find((entry) => entry.key === key) ?? null;
}

function numberOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export interface EconomyKpi {
  key: "revenue" | "gross_margin" | "operating_burn" | "runway_today";
  label: string;
  metric: FinancialMetric;
  point: MetricPoint;
  /** The latest value; null = the code could not calculate it ("Kan ikke beregnes"). */
  value: number | null;
  /** The change shown under the figure: growth in percent, or margin change in points. */
  delta: { kind: "growth" | "points"; value: number } | null;
  /** The metric behind the delta ("Sådan er det regnet" shows it too). */
  deltaMetric: FinancialMetric | null;
}

export interface EconomyYear {
  periodEnd: string;
  year: string;
  revenue: number | null;
  grossProfit: number | null;
  margin: number | null;
  cash: number | null;
}

export interface RunwayProjection {
  /** Balance date and the cash then. */
  fromPeriodEnd: string;
  cash: number;
  /** Months from the balance date until the money is used up at the estimated burn. */
  months: number;
  /** Runway counted from today (runway_today), when it could be calculated. */
  monthsFromToday: number | null;
}

export interface EconomyView {
  kpis: EconomyKpi[];
  /** The last (up to six) years; every card reads from these. */
  years: EconomyYear[];
  /** Null = drop the card "Omsætning og bruttomargin". */
  revenueCard: { series: "revenue" | "gross_profit"; hasMargin: boolean } | null;
  /** Null = drop the card "Likviditet og runway". */
  cashCard: { projection: RunwayProjection | null } | null;
  /** The amounts' currency when it is not DKK (a foreign registry). */
  currency?: string;
}

const ECONOMY_YEARS = 6;

/**
 * What the Økonomi tab can show, from the annual-report figures the code calculated. A card
 * without real figures is dropped (gap "Selv valgt" 1); a figure the code could not calculate is
 * shown as "Kan ikke beregnes" (never a guess), and only when the company has a cash figure to
 * speak about (burn and runway).
 */
export function economyView(
  report: FinancialMetricsReport | null | undefined,
  language: Language = "da",
): EconomyView | null {
  if (!report || report.years.length === 0) return null;
  const revenue = metricOf(report, "revenue");
  const grossProfit = metricOf(report, "gross_profit");
  const margin = metricOf(report, "gross_margin");
  const cash = metricOf(report, "cash");
  const burn = metricOf(report, "operating_burn");
  const runwayNow = metricOf(report, "runway_today");
  const runwayAtBalance = metricOf(report, "runway_at_balance_date");

  const at = (entry: FinancialMetric | null, periodEnd: string) =>
    numberOrNull(entry?.series.find((point) => point.periodEnd === periodEnd)?.value);
  const years: EconomyYear[] = report.years.slice(-ECONOMY_YEARS).map((periodEnd) => ({
    periodEnd,
    year: periodEnd.slice(0, 4),
    revenue: at(revenue, periodEnd),
    grossProfit: at(grossProfit, periodEnd),
    margin: at(margin, periodEnd),
    cash: at(cash, periodEnd),
  }));

  const kpis: EconomyKpi[] = [];
  const lead = numberOrNull(revenue?.latest?.value) !== null ? revenue : grossProfit;
  if (lead?.latest && numberOrNull(lead.latest.value) !== null) {
    const growth = metricOf(report, lead === revenue ? "revenue_growth" : "gross_profit_growth");
    const growthValue = numberOrNull(growth?.latest?.value);
    kpis.push({
      key: "revenue",
      label: translate(
        language,
        lead === revenue ? "deep.economy.revenue" : "deep.economy.grossProfit",
      ),
      metric: lead,
      point: lead.latest,
      value: numberOrNull(lead.latest.value),
      delta: growthValue === null ? null : { kind: "growth", value: growthValue },
      deltaMetric: growthValue === null ? null : growth,
    });
  }
  if (margin?.latest && numberOrNull(margin.latest.value) !== null) {
    // The change is against the year right before the latest one in the report, never against
    // an older year that happens to have a figure (a gap year gives no change).
    const latestIndex = report.years.indexOf(margin.latest.periodEnd);
    const previousEnd = latestIndex > 0 ? report.years[latestIndex - 1] : undefined;
    const previous = previousEnd === undefined ? null : at(margin, previousEnd);
    const latest = numberOrNull(margin.latest.value)!;
    kpis.push({
      key: "gross_margin",
      label: translate(language, "deep.economy.grossMargin"),
      metric: margin,
      point: margin.latest,
      value: latest,
      delta:
        previous === null
          ? null
          : { kind: "points", value: Math.round((latest - previous) * 10) / 10 },
      deltaMetric: null,
    });
  }
  const hasCash = years.some((year) => year.cash !== null);
  if (hasCash) {
    for (const [key, label, entry] of [
      ["operating_burn", translate(language, "deep.economy.burn"), burn],
      ["runway_today", translate(language, "deep.economy.runway"), runwayNow],
    ] as const) {
      if (entry?.latest) {
        kpis.push({
          key,
          label,
          metric: entry,
          point: entry.latest,
          value: numberOrNull(entry.latest.value),
          delta: null,
          deltaMetric: null,
        });
      }
    }
  }

  const revenueSeries = years.some((year) => year.revenue !== null)
    ? "revenue"
    : years.some((year) => year.grossProfit !== null)
      ? "gross_profit"
      : null;
  const lastCash = [...years].reverse().find((year) => year.cash !== null);
  const months = numberOrNull(runwayAtBalance?.latest?.value);
  const projection: RunwayProjection | null =
    lastCash && lastCash.cash !== null && lastCash.cash > 0 && months !== null && months > 0
      ? {
          fromPeriodEnd: lastCash.periodEnd,
          cash: lastCash.cash,
          months,
          monthsFromToday: numberOrNull(runwayNow?.latest?.value),
        }
      : null;

  return {
    kpis,
    years,
    revenueCard: revenueSeries
      ? { series: revenueSeries, hasMargin: years.some((year) => year.margin !== null) }
      : null,
    cashCard: hasCash ? { projection } : null,
    ...(report.currency ? { currency: report.currency } : {}),
  };
}

export interface CalculationLike {
  metric: string;
  status: string;
  value: number | null;
  unit: string | null;
  missingInputs: string[];
  warnings: string[];
}

export interface UnitEconomicsRow {
  metric: "ltv" | "cac" | "cac_payback" | "ltv_cac";
  value: number;
  unit: string | null;
}

export interface UnitEconomicsView {
  rows: UnitEconomicsRow[];
  ltv: UnitEconomicsRow | null;
  cac: UnitEconomicsRow | null;
  /** LTV divided by CAC, when the code could calculate it. */
  ratio: number | null;
  /** Months until the CAC is paid back, when the code could calculate it. */
  payback: number | null;
}

const UNIT_ORDER = ["ltv", "cac", "cac_payback", "ltv_cac"] as const;

/**
 * Unit economics from the code's finance calculations (deck figures that have evidence). Only
 * figures the code could calculate; none calculable returns null, which drops the card.
 */
export function unitEconomics(calculations: readonly CalculationLike[]): UnitEconomicsView | null {
  const rows = UNIT_ORDER.flatMap((metric): UnitEconomicsRow[] => {
    const calc = calculations.find((entry) => entry.metric === metric);
    if (!calc || calc.status !== "ok") return [];
    const value = numberOrNull(calc.value);
    return value === null ? [] : [{ metric, value, unit: calc.unit }];
  });
  if (rows.length === 0) return null;
  const find = (metric: UnitEconomicsRow["metric"]) =>
    rows.find((row) => row.metric === metric) ?? null;
  return {
    rows,
    ltv: find("ltv"),
    cac: find("cac"),
    ratio: find("ltv_cac")?.value ?? null,
    payback: find("cac_payback")?.value ?? null,
  };
}

/**
 * Does an Økonomi sub-page have anything real to show? A link to one that does not (a stale or
 * hand-edited URL) is dropped by the page. `metrics` holds the annual reports and the finance
 * calculations, so it shows when either exists.
 */
export function economyFocusAvailable(
  kind: EconomyFocusKind,
  report: FinancialMetricsReport | null | undefined,
  calculations: readonly CalculationLike[],
): boolean {
  const view = economyView(report);
  if (kind === ECONOMY_FOCUS.revenue) return Boolean(view?.revenueCard);
  if (kind === ECONOMY_FOCUS.cash) return Boolean(view?.cashCard);
  if (kind === ECONOMY_FOCUS.unit) return unitEconomics(calculations) !== null;
  return view !== null || calculations.length > 0;
}

// ---------------------------------------------------------------------------
// Which screening a shown deep analysis can be compared with
// ---------------------------------------------------------------------------

export interface DeepBasis {
  /**
   * The case's latest screening is not the one the shown deep analysis was built on (a newer one
   * came after it). The change "since screening" is then shown against the analysis's own
   * screening when the page has it (`basisScreening`), else not at all (it would compare
   * two different screenings).
   */
  screeningIsNewer: boolean;
  /** The shown analysis is the last successful one; the newest deep run did not finish. */
  latestRunFailed: boolean;
  /** A quiet line above the analysis, or null when nothing needs saying. */
  note: string | null;
}

function basisDate(when: number, language: Language): string {
  return new Intl.DateTimeFormat(LANGUAGE_TAGS[language], {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(when));
}

/**
 * Pure rules for "Seneste vellykkede analyse" and the delta. `history` is newest first (the
 * case's analysis history). The deep run stores the screening it was built on
 * (`previous_run_id`, read as `basisScreeningId`); when both ids are known they decide.
 * Without them, a screening that began after the analysis is by definition not its own.
 * `basisScreeningLoaded`: the page has that earlier screening's numbers, so the change is shown
 * against it.
 */
export function deepBasis(
  input: {
    deepStartedAt: string;
    deepCompletedAt: string | null;
    screeningStartedAt: string | null;
    screeningId?: string | null;
    basisScreeningId?: string | null;
    basisScreeningLoaded?: boolean;
    history: ReadonlyArray<{ kind: string; status: string }>;
  },
  language: Language = "da",
): DeepBasis {
  const deepAt = Date.parse(input.deepStartedAt);
  const screeningAt = input.screeningStartedAt ? Date.parse(input.screeningStartedAt) : NaN;
  const screeningIsNewer =
    input.screeningId && input.basisScreeningId
      ? input.screeningId !== input.basisScreeningId
      : Number.isFinite(deepAt) && Number.isFinite(screeningAt) && screeningAt > deepAt;
  const against = screeningIsNewer && input.basisScreeningLoaded === true;
  const newestDeep = input.history.find((entry) => entry.kind === "deep");
  const latestRunFailed = newestDeep?.status === "failed" || newestDeep?.status === "cancelled";
  const when = Date.parse(input.deepCompletedAt ?? input.deepStartedAt);
  const date = Number.isFinite(when) ? basisDate(when, language) : null;
  const on = date ? translate(language, "deep.basis.onDate", { date }) : "";
  const from = date ? translate(language, "deep.basis.fromDate", { date }) : "";
  let note: string | null = null;
  if (latestRunFailed && screeningIsNewer) {
    note = translate(
      language,
      against ? "deep.basis.failedNewerAgainst" : "deep.basis.failedNewer",
      { on },
    );
  } else if (latestRunFailed) {
    note = translate(language, "deep.basis.failed", { on });
  } else if (screeningIsNewer) {
    note = translate(language, against ? "deep.basis.newerAgainst" : "deep.basis.newer", { from });
  }
  return { screeningIsNewer, latestRunFailed, note };
}

/**
 * The earlier screening a deep analysis was built on, when the case page loaded it (the case's
 * `basisScreenings`). null when the analysis was built on the latest screening, when it
 * does not say (older data) or when that screening could not be read.
 */
export function earlierBasisScreening<S extends { id: string | null }>(
  deep: { basisScreeningId: string | null },
  earlier: readonly S[],
): S | null {
  const id = deep.basisScreeningId;
  return id ? (earlier.find((screening) => screening.id === id) ?? null) : null;
}

/**
 * Whether "Kør dyb analyse" / "Prøv igen" can start, from the case's run history (newest first).
 * Same rule as the server (approveAndRunDeepAnalysis) as far as the page can see it: the newest
 * finished screening has not been sent yet. A deep run that failed or was cancelled can be retried
 * even when an older complete one exists (the re-run was allowed because that one was on another
 * prompt/config/model); the server still refuses with a clear message if it is not allowed.
 */
export function canStartDeepRun(history: readonly { kind: string; status: string }[]): boolean {
  const finishedScreening = (status: string) => ["complete", "awaiting_approval"].includes(status);
  if (!history.some((entry) => entry.kind === "screening" && finishedScreening(entry.status))) {
    return false;
  }
  for (const entry of history) {
    if (entry.kind === "screening" && finishedScreening(entry.status)) return true;
    if (entry.kind === "deep") {
      if (["failed", "cancelled"].includes(entry.status)) return true;
      if (["queued", "running", "complete"].includes(entry.status)) return false;
    }
  }
  return true;
}
