/**
 * The committee memo's data model (spec): one
 * object with everything the memo shows (sections 1–13, key figures, chart data and a status per
 * field), built from the case's view model, the proposer's input and the team's mandate answers.
 * The sheet, the AI draft and the layout read only from it, so the memo
 * cannot drift from the analysis, and a number in the AI's prose can be checked against it.
 *
 * The product owner's rules: the model never holds Interlect's recommendation, threshold or
 * confidence (section 1 is the proposer's own rationale); the score is the analysis's own and is
 * never recalculated here; every label is a dictionary key (`memo.*`), so the memo follows the
 * team's language. "Not provided" everywhere is avoided by a status per field: `found` (the
 * analysis has it), `missing` (it could have it, but does not) or `human_only` (only a person can
 * give it, e.g. customer calls); `memoGaps` (memo-gaps.ts) lists what is missing.
 *
 * Pure: no I/O, only type imports and the pure helpers it reuses unchanged (gate-marks.ts,
 * gate-answers.ts, financial-gates.ts, finance-summary.ts, deep-view.ts, specialist-catalog.ts),
 * so it is tested with node --test.
 */
import { financeGateTreatment, isFinanceGate } from "../analysis/financial-gates.ts";
import type { FinancialMetricsReport } from "../analysis/financial-metrics.ts";
import {
  effectiveGateAnswers,
  gateAnswerFromTask,
  type StoredGateAnswer,
} from "../analysis/gate-answers.ts";
import { specialistCatalog } from "../analysis/specialist-catalog.ts";
import type { AnalysisView, CaseViewModel, CriterionView, GateView } from "../cases/view-model.ts";
import { gateMarks, type GateMark } from "../cases/gate-marks.ts";
import { financeSummary, type FinanceSummary } from "../cases/finance-summary.ts";
import {
  numberRisks,
  specialistGroups,
  unitEconomics,
  type UnitEconomicsView,
} from "../cases/deep-view.ts";
import { DEFAULT_LANGUAGE, type Language } from "../i18n/language.ts";
import type { MessageKey } from "../i18n/translate.ts";
import type { MemoGapAnswer, MemoGapState, MemoInput } from "./memo.ts";

export type MemoFieldStatus = "found" | "missing" | "human_only";

/** The memo's thirteen sections in their fixed order (memo-v5), each in one of four groups. */
export const MEMO_SECTIONS = [
  { key: "recommendation", text: "recommendation", group: "decision" },
  { key: "thesis", text: "thesis", group: "decision" },
  { key: "company", text: "company", group: "company" },
  { key: "market", text: "market", group: "company" },
  { key: "competition", text: "competition", group: "company" },
  { key: "product", text: "product", group: "company" },
  { key: "team", text: "team", group: "company" },
  { key: "traction", text: "traction", group: "company" },
  { key: "economics", text: "economics", group: "numbers" },
  { key: "deal", text: "deal", group: "numbers" },
  { key: "risks", text: "risks", group: "ahead" },
  { key: "diligence", text: "diligence", group: "ahead" },
  { key: "next_steps", text: "nextSteps", group: "ahead" },
] as const;

export type MemoSectionKey = (typeof MEMO_SECTIONS)[number]["key"];
export type MemoGroupKey = (typeof MEMO_SECTIONS)[number]["group"];

/** What each section shows, field by field (the memo's "Not yet known" box lists the open ones). */
export const MEMO_SECTION_FIELDS = {
  recommendation: ["proposer_rationale", "investment_condition", "mandate"],
  thesis: ["thesis_text", "criteria"],
  company: ["company_description"],
  market: ["market_size"],
  competition: ["competitor_map"],
  product: ["product_scores", "tech_benchmarks"],
  team: ["team_people", "founder_references"],
  traction: ["traction_figures", "customer_references"],
  economics: ["financial_statements", "cash_runway", "unit_economics"],
  deal: ["funding_history", "cap_table", "round_terms"],
  risks: ["risks", "counter_argument"],
  diligence: ["specialist_work", "legal_review", "management_interview"],
  next_steps: ["next_steps"],
} as const satisfies Record<MemoSectionKey, readonly string[]>;

export type MemoFieldKey = (typeof MEMO_SECTION_FIELDS)[MemoSectionKey][number];

const FIELD_TEXT = {
  proposer_rationale: "proposerRationale",
  investment_condition: "investmentCondition",
  mandate: "mandate",
  thesis_text: "thesisText",
  criteria: "criteria",
  company_description: "companyDescription",
  market_size: "marketSize",
  competitor_map: "competitorMap",
  product_scores: "productScores",
  tech_benchmarks: "techBenchmarks",
  team_people: "teamPeople",
  founder_references: "founderReferences",
  traction_figures: "tractionFigures",
  customer_references: "customerReferences",
  financial_statements: "financialStatements",
  cash_runway: "cashRunway",
  unit_economics: "unitEconomics",
  funding_history: "fundingHistory",
  cap_table: "capTable",
  round_terms: "roundTerms",
  risks: "risks",
  counter_argument: "counterArgument",
  specialist_work: "specialistWork",
  legal_review: "legalReview",
  management_interview: "managementInterview",
  next_steps: "nextSteps",
} as const satisfies Record<MemoFieldKey, string>;

/** Which criteria (by their score category) each section draws; the rest only appear in section 2. */
const SECTION_CATEGORIES: Partial<Record<MemoSectionKey, readonly string[]>> = {
  market: ["market_timing"],
  product: ["product_market_fit", "product_technology"],
  team: ["founder_market_fit", "team_market_fit"],
  traction: ["traction_gtm"],
  economics: ["financial_strength"],
};

/**
 * "What must be believed" (memo-v5, approved 9 Nov): one belief per criterion of the thesis, read
 * from the criterion's own score in fixed bands. These are the prototype's bands, not the team's
 * threshold, which the memo never shows.
 */
export const BELIEF_HOLDS_FROM = 70;
export const BELIEF_PARTLY_FROM = 55;

export type MemoBeliefVerdict = "holds" | "partly" | "not_shown" | "not_established";

const BELIEF_TEXT = {
  holds: "holds",
  partly: "partly",
  not_shown: "notShown",
  not_established: "notEstablished",
} as const satisfies Record<MemoBeliefVerdict, string>;

export type MemoNextStepPhase = "before_signing" | "diligence" | "after_closing";

const PHASE_TEXT = {
  before_signing: "beforeSigning",
  diligence: "diligence",
  after_closing: "afterClosing",
} as const satisfies Record<MemoNextStepPhase, string>;

export interface MemoField {
  key: MemoFieldKey;
  labelKey: MessageKey;
  status: MemoFieldStatus;
}

export interface MemoSection {
  key: MemoSectionKey;
  /** 1–13, the fixed order. */
  number: number;
  group: MemoGroupKey;
  groupKey: MessageKey;
  titleKey: MessageKey;
  questionKey: MessageKey;
  fields: MemoField[];
}

/** A number the memo shows, as the code has it (the layout formats it in the team's language). */
export interface MemoFigure {
  key: string;
  value: number;
  unit: "amount" | "percent" | "months" | "ratio" | "count" | "persons" | "days";
  /** For amounts: the currency (DKK when the report states none). */
  currency: string | null;
  /** The period the figure is for (YYYY-MM-DD period end), when it has one. */
  period: string | null;
  /** The code's estimate from the report (burn, runway), not a figure the company reported. */
  estimate: boolean;
}

export interface MemoCriterion {
  key: string;
  label: string;
  category: string;
  /** 0–100, the analysis's own score; null when not scored. */
  score: number | null;
  /** Percent of the thesis. */
  weight: number;
  /** True when the score is a stage prior, not something the analysis found. */
  isStagePrior: boolean;
  /** The analysis's short verdict on the criterion. */
  note: string | null;
}

export interface MemoBelief {
  /** The criterion's key; also the key of the proposer's comment (`beliefComments`). */
  key: string;
  label: string;
  score: number | null;
  weight: number;
  verdict: MemoBeliefVerdict;
  verdictKey: MessageKey;
  /** The proposer's own comment on the belief, when written. */
  comment: string | null;
}

export interface MemoGateAnswer {
  passed: boolean | null;
  reason: string | null;
  /** An Admin or Lead turned a requirement that was not met into met (written reason). */
  override: boolean;
  answeredAt: string | null;
}

export interface MemoGate {
  key: string;
  label: string;
  description: string;
  /** Hard (binding) requirement, or one a person reviews (finance gates have a fixed treatment). */
  binding: boolean;
  /** The requirement's state now: the team's answer when it has one, else the analysis's. */
  mark: GateMark;
  /** The analysis's own reading; null when the team's answer replaced it. */
  analysisNote: string | null;
  answer: MemoGateAnswer | null;
  /** Not met by the analysis and not answered by the team: blocks the memo. */
  needsAnswer: boolean;
}

export interface MemoMandate {
  gates: MemoGate[];
  met: number;
  total: number;
  /** Requirements that still need an answer before the case goes to the committee. */
  open: number;
}

/**
 * The part of a case task (tasks.functions.ts `CaseTask`) the memo reads for a mandate answer:
 * a resolved task linked to a gate with "Opfyldt" or "Ikke opfyldt" is the team's answer to that
 * requirement. Which answer counts follows the case page (gate-answers.ts).
 */
export interface MemoGateTask {
  linkedKind: string | null;
  linkedKey: string | null;
  status: string;
  answerText: string | null;
  answerValue: {
    gatePassed?: boolean | undefined;
    override?: boolean | undefined;
    configVersionId?: string | null | undefined;
  } | null;
  resolvedAt: string | null;
}

export interface MemoMarket {
  label: string;
  scope: string;
  geography: string;
  currency: string;
  unit: "million" | "billion";
  points: { year: number; value: number; forecast: boolean }[];
}

export interface MemoPerson {
  name: string;
  role: string;
  /** 0–10 per axis (domain, execution, commercial, technical, leadership); null = not known. */
  scores: Record<string, number | null>;
}

export interface MemoBenchmark {
  metric: string;
  unit: string;
  company: number | null;
  industry: number | null;
  higherIsBetter: boolean;
}

export interface MemoHighlight {
  /** The specialist that found it. */
  moduleId: string;
  label: string;
  value: number;
  unit: string;
  period: string | null;
}

export interface MemoRound {
  name: string;
  date: string | null;
  amount: number | null;
  currency: string | null;
  investors: string[];
}

export interface MemoHolder {
  holder: string;
  holderType: "founder" | "investor" | "employee_pool" | "other";
  percent: number;
  asOf: string | null;
}

export interface MemoRisk {
  /** 1-based, critical first: the number on the matrix and in the list. */
  number: number;
  level: "low" | "medium" | "high" | "critical";
  title: string | null;
  category: string;
  likelihood: number | null;
  impact: number | null;
  statement: string;
  mitigation: string | null;
}

export interface MemoNextStep {
  phase: MemoNextStepPhase;
  phaseKey: MessageKey;
  riskNumber: number;
  level: MemoRisk["level"];
  /** What closes the risk (the analysis's mitigation); null when it gave none. */
  action: string | null;
}

export interface MemoSpecialist {
  id: string;
  /** Short name ("Team"). */
  label: string;
  /** The module's longer name. */
  title: string;
  /** Weighted average of its criteria; null for a specialist without criteria. */
  score: number | null;
  headline: string | null;
  summary: string;
}

export interface MemoFinance {
  /** Currency of every amount (DKK when the report states none). */
  currency: string;
  /** The last four report years, oldest first ("2025"). */
  years: string[];
  /** The screening's four key figures and revenue chart (finance-summary.ts), in the team's language. */
  summary: FinanceSummary | null;
  /** One value per year in `years` (null = not in the report). */
  series: {
    revenue: (number | null)[];
    grossProfit: (number | null)[];
    operatingResult: (number | null)[];
    netResult: (number | null)[];
    cash: (number | null)[];
  };
  latest: {
    revenue: MemoFigure | null;
    revenueGrowth: MemoFigure | null;
    grossMargin: MemoFigure | null;
    operatingResult: MemoFigure | null;
    netResult: MemoFigure | null;
    cash: MemoFigure | null;
    equityRatio: MemoFigure | null;
    /** Estimated operating burn per month. */
    burnPerMonth: MemoFigure | null;
    runwayAtBalanceDate: MemoFigure | null;
    runwayToday: MemoFigure | null;
  };
  /** LTV, CAC and payback when the code could calculate them; null when none could be. */
  unitEconomics: UnitEconomicsView | null;
  /** The code's finance calculations it could not make (metric keys, e.g. "cac"). */
  notCalculable: string[];
  /** Their missing inputs, each once (e.g. "mrr", "sales_marketing_spend"). */
  missingInputs: string[];
  /** The inputs missing for LTV, CAC and payback only (the gap "Input til enhedsøkonomi"). */
  unitEconomicsInputs: string[];
}

export interface MemoEvidenceCount {
  status: string;
  count: number;
}

export interface MemoModel {
  caseId: string;
  /** The finished deep analysis the memo is built on; null when the case has none (no memo). */
  analysisId: string | null;
  /** The team's language: the memo's labels, dates and number formats follow it. */
  language: Language;
  cover: {
    companyName: string;
    stage: string;
    sector: string | null;
    geography: string | null;
    website: string | null;
    thesisName: string;
    thesisVersion: string;
    analysisCompletedAt: string | null;
  };
  proposal: {
    rationale: string;
    authorId: string | null;
    updatedAt: string | null;
  };
  /** The analysis's own score, 0–100 (never recalculated here). */
  score: number | null;
  sections: MemoSection[];
  mandate: MemoMandate;
  thesis: { text: string | null; criteria: MemoCriterion[]; beliefs: MemoBelief[] };
  company: {
    description: string | null;
    business: string | null;
    productModel: string | null;
    customers: string | null;
  };
  market: { criteria: MemoCriterion[]; size: MemoMarket | null };
  product: { criteria: MemoCriterion[]; benchmarks: MemoBenchmark[] };
  team: { criteria: MemoCriterion[]; people: MemoPerson[] };
  traction: { criteria: MemoCriterion[]; highlights: MemoHighlight[] };
  finance: MemoFinance;
  deal: { rounds: MemoRound[]; holders: MemoHolder[] };
  conclusion: {
    /** The one condition the analysis puts on an investment. */
    condition: string | null;
    /** The analysis's overall reading (without the score's context). */
    reading: string | null;
    /** The strongest case against the reading. */
    counterArgument: string | null;
  };
  risks: MemoRisk[];
  diligence: {
    specialists: MemoSpecialist[];
    evidence: MemoEvidenceCount[];
    evidenceTotal: number;
    documents: { kind: string; fileName: string }[];
  };
  nextSteps: MemoNextStep[];
  /** The cover's numbers: revenue, growth, operating result and cash of the latest report year, where that year has them. */
  keyFigures: MemoFigure[];
  /** The team's stored answers to "Mangler før komiteen" (case_memo_gap_answers). */
  gapAnswers: { gapKey: string; state: MemoGapState; reason: string | null; answeredAt: string }[];
}

export interface BuildMemoOptions {
  /** The team's language (default Danish). */
  language?: Language | undefined;
  /** The case's annual-report figures (`listFinancialStatements`); null when it has none. */
  financials?: FinancialMetricsReport | null | undefined;
  /** The stored answers to the gaps (`case_memo_gap_answers`). */
  gapAnswers?: readonly MemoGapAnswer[] | undefined;
  /**
   * The setup version the analysis ran under (`analysis_runs.config_version_id`): a team answer
   * only counts under the version it was given against (gate-answers.ts). Left out, the version
   * is not checked.
   */
  configVersionId?: string | null | undefined;
}

/** The analysis the memo is built on: the last FINISHED deep analysis (as the old pack). */
export function memoAnalysis(model: CaseViewModel): AnalysisView | null {
  return model.committeeDeep ?? (model.deep?.status === "complete" ? model.deep : null);
}

const text = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

function toCriterion(criterion: CriterionView): MemoCriterion {
  return {
    key: criterion.criterionKey,
    label: criterion.label,
    category: String(criterion.category),
    score: criterion.score,
    weight: criterion.weight,
    isStagePrior: criterion.isStagePrior === true,
    note: text(criterion.verdict),
  };
}

const isScored = (criterion: MemoCriterion) => criterion.score !== null && !criterion.isStagePrior;

export function beliefVerdict(criterion: MemoCriterion): MemoBeliefVerdict {
  if (!isScored(criterion)) return "not_established";
  const score = criterion.score!;
  if (score >= BELIEF_HOLDS_FROM) return "holds";
  if (score >= BELIEF_PARTLY_FROM) return "partly";
  return "not_shown";
}

/**
 * The team's answers that count now, per gate, read from the case's gate tasks with the case
 * page's own rules (gate-answers.ts): only "Opfyldt" or "Ikke opfyldt" is an answer (a task
 * resolved with text only is not), the latest answer wins, and "Opfyldt" does not lift a breach
 * the analysis found unless an Admin or Lead overrode it after the analysis.
 */
function teamGateAnswers(
  analysis: AnalysisView,
  tasks: readonly MemoGateTask[],
  configVersionId: string | null | undefined,
): Map<string, MemoGateAnswer> {
  const stored = tasks.flatMap((task) => {
    if (task.linkedKind !== "gate" || task.status !== "resolved") return [];
    const answer = gateAnswerFromTask({
      linked_key: task.linkedKey,
      answer_value: task.answerValue,
      answer_text: task.answerText,
      answer_evidence_id: null,
      resolved_at: task.resolvedAt,
    });
    return answer ? [{ answer, reason: text(task.answerText) }] : [];
  });
  const chosen = effectiveGateAnswers(
    stored.map((entry) => entry.answer),
    {
      completedAt: analysis.completedAt ?? analysis.startedAt,
      verdicts: new Map(analysis.gates.map((gate) => [gate.key, gate.passed] as const)),
      ...(configVersionId === undefined ? {} : { configVersionId }),
    },
  );
  const answers = new Map<string, MemoGateAnswer>();
  for (const pick of chosen) {
    // The stored answer the rules picked (the latest of identical ones), for its time and text.
    const source = stored
      .filter(
        ({ answer }: { answer: StoredGateAnswer }) =>
          answer.gateKey === pick.gateKey &&
          answer.passed === pick.passed &&
          answer.rationale === pick.rationale,
      )
      .sort((a, b) => Date.parse(b.answer.resolvedAt) - Date.parse(a.answer.resolvedAt))[0];
    if (!source) continue;
    answers.set(pick.gateKey, {
      passed: pick.passed,
      reason: source.reason,
      override: source.answer.override,
      answeredAt: source.answer.resolvedAt,
    });
  }
  return answers;
}

/**
 * The mandate as it stands now. The case's gate tasks are the team's current answers; without
 * them (none passed) the answers stored with the run are used, as the case page shows them.
 */
function buildMandate(
  analysis: AnalysisView | null,
  tasks: readonly MemoGateTask[],
  configVersionId: string | null | undefined,
): MemoMandate {
  const views = analysis?.gates ?? [];
  const fromTasks = tasks.some((task) => task.linkedKind === "gate");
  const current = analysis && fromTasks ? teamGateAnswers(analysis, tasks, configVersionId) : null;
  const answers = views.map((gate): MemoGateAnswer | null => {
    if (current) return current.get(gate.key) ?? null;
    return gate.teamAnswered
      ? { passed: gate.passed, reason: text(gate.rationale), override: false, answeredAt: null }
      : null;
  });
  const marks = gateMarks(
    views.map((gate, index) => ({
      gateKey: gate.key,
      passed: answers[index]?.passed ?? gate.passed,
    })),
    views.map((gate) => ({ key: gate.key, treatment: gate.treatment })),
  );
  const gates = views.map((gate, index): MemoGate => {
    const answer = answers[index] ?? null;
    const mark = marks[index]!;
    const treatment = isFinanceGate(gate.key) ? financeGateTreatment(gate.key) : gate.treatment;
    return {
      key: gate.key,
      label: gate.label,
      description: gate.description,
      binding: treatment === "hard",
      mark,
      // A team answer stored with the run already replaced the analysis's reading in the view.
      analysisNote: answer || gate.teamAnswered ? null : text(gate.rationale),
      answer,
      needsAnswer: mark !== "passed" && answer === null,
    };
  });
  return {
    gates,
    met: gates.filter((gate) => gate.mark === "passed").length,
    total: gates.length,
    open: gates.filter((gate) => gate.needsAnswer).length,
  };
}

const UNIT: Record<string, MemoFigure["unit"]> = {
  dkk: "amount",
  percent: "percent",
  months: "months",
  ratio: "ratio",
  count: "count",
  persons: "persons",
  days: "days",
};

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function buildFinance(
  report: FinancialMetricsReport | null,
  analysis: AnalysisView | null,
  language: Language,
): MemoFinance {
  const currency = report?.currency ?? "DKK";
  const periods = report?.years.slice(-4) ?? [];
  const metric = (key: string) => report?.metrics.find((entry) => entry.key === key) ?? null;
  const seriesOf = (key: string) => {
    const entry = metric(key);
    return periods.map((periodEnd) =>
      finiteOrNull(entry?.series.find((point) => point.periodEnd === periodEnd)?.value),
    );
  };
  const latestOf = (key: string): MemoFigure | null => {
    const entry = metric(key);
    const value = finiteOrNull(entry?.latest?.value);
    if (!entry || value === null) return null;
    const unit = UNIT[entry.unit] ?? "count";
    return {
      key,
      value,
      unit,
      currency: unit === "amount" ? (entry.currency ?? currency) : null,
      period: entry.latest?.periodEnd ?? null,
      estimate: entry.latest?.status === "estimat",
    };
  };
  const calculations = analysis?.calculations ?? [];
  const failed = calculations.filter((calculation) => calculation.status !== "ok");
  const inputsOf = (rows: typeof failed) => [
    ...new Set(rows.flatMap((calculation) => calculation.missingInputs)),
  ];
  return {
    currency,
    years: periods.map((periodEnd) => periodEnd.slice(0, 4)),
    summary: financeSummary(report, language),
    series: {
      revenue: seriesOf("revenue"),
      grossProfit: seriesOf("gross_profit"),
      operatingResult: seriesOf("ebit"),
      netResult: seriesOf("net_result"),
      cash: seriesOf("cash"),
    },
    latest: {
      revenue: latestOf("revenue"),
      revenueGrowth: latestOf("revenue_growth"),
      grossMargin: latestOf("gross_margin"),
      operatingResult: latestOf("ebit"),
      netResult: latestOf("net_result"),
      cash: latestOf("cash"),
      equityRatio: latestOf("equity_ratio"),
      burnPerMonth: latestOf("operating_burn"),
      runwayAtBalanceDate: latestOf("runway_at_balance_date"),
      runwayToday: latestOf("runway_today"),
    },
    unitEconomics: unitEconomics(calculations),
    notCalculable: failed.map((calculation) => calculation.metric),
    missingInputs: inputsOf(failed),
    unitEconomicsInputs: inputsOf(
      failed.filter((calculation) => UNIT_ECONOMICS_METRICS.has(calculation.metric)),
    ),
  };
}

/** The calculations behind the unit economics (deep-view.ts `unitEconomics`). */
const UNIT_ECONOMICS_METRICS = new Set(["ltv", "cac", "cac_payback", "ltv_cac"]);

const PHASE_OF: Record<MemoRisk["level"], MemoNextStepPhase> = {
  critical: "before_signing",
  high: "diligence",
  medium: "after_closing",
  low: "after_closing",
};

/**
 * Everything the committee memo shows, from the case (its last finished deep analysis), the
 * proposer's input (`case_memo_inputs`) and the team's mandate answers (gate tasks). Nothing is
 * guessed: what the analysis lacks has status `missing` or `human_only`, never a placeholder.
 */
export function buildMemoModel(
  caseView: CaseViewModel,
  proposerInput: MemoInput | null,
  gateAnswers: readonly MemoGateTask[] = [],
  options: BuildMemoOptions = {},
): MemoModel {
  const language = options.language ?? DEFAULT_LANGUAGE;
  const analysis = memoAnalysis(caseView);
  const cards = analysis?.cardData ?? null;
  const criteria = (analysis?.criteria ?? []).map(toCriterion);
  const inSection = (section: MemoSectionKey) => {
    const categories = SECTION_CATEGORIES[section] ?? [];
    return criteria.filter((criterion) => categories.includes(criterion.category));
  };
  const comments = proposerInput?.beliefComments ?? {};
  const beliefs = criteria.map((criterion): MemoBelief => {
    const verdict = beliefVerdict(criterion);
    return {
      key: criterion.key,
      label: criterion.label,
      score: criterion.score,
      weight: criterion.weight,
      verdict,
      verdictKey: `memo.belief.${BELIEF_TEXT[verdict]}`,
      comment: text(comments[criterion.key]),
    };
  });
  const mandate = buildMandate(analysis, gateAnswers, options.configVersionId);
  const finance = buildFinance(options.financials ?? null, analysis, language);

  const profile = analysis?.companyProfile ?? caseView.screening?.companyProfile ?? null;
  const company = {
    description: text(caseView.description),
    business: text(profile?.business),
    productModel: text(profile?.productModel),
    customers: text(profile?.market),
  };

  const market = cards?.market.status === "found" ? cards.market.data : null;
  const size: MemoMarket | null =
    market && market.points.length > 0
      ? {
          label: market.label,
          scope: market.scope,
          geography: market.geography,
          currency: market.currency,
          unit: market.unit,
          points: market.points.map((point) => ({
            year: point.year,
            value: point.value,
            forecast: point.basis === "forecast",
          })),
        }
      : null;
  const team = cards?.team.status === "found" ? cards.team.data : null;
  const people: MemoPerson[] = (team?.people ?? []).map((person) => ({
    name: person.name,
    role: person.role,
    scores: { ...person.scores },
  }));
  const tech = cards?.techBenchmarks.status === "found" ? cards.techBenchmarks.data : null;
  const benchmarks: MemoBenchmark[] = (tech?.items ?? []).map((item) => ({
    metric: item.metric,
    unit: item.unit,
    company: item.company,
    industry: item.industry,
    higherIsBetter: item.higherIsBetter,
  }));
  const highlights: MemoHighlight[] = Object.entries(cards?.highlights ?? {}).flatMap(
    ([moduleId, data]) =>
      data.items.map((item) => ({
        moduleId,
        label: item.label,
        value: item.value,
        unit: item.unit,
        period: item.period,
      })),
  );
  const ownership = cards?.ownership.status === "found" ? cards.ownership.data : null;
  const rounds: MemoRound[] = (ownership?.rounds ?? []).map((round) => ({
    name: round.name,
    date: round.date,
    amount: round.amount,
    currency: round.currency,
    investors: [...round.investors],
  }));
  const holders: MemoHolder[] = (ownership?.holders ?? []).map((holder) => ({
    holder: holder.holder,
    holderType: holder.holderType,
    percent: holder.percent,
    asOf: holder.asOf,
  }));

  const risks: MemoRisk[] = numberRisks(analysis?.risks ?? []).map(({ risk, number }) => ({
    number,
    level: risk.level,
    title: text(risk.label),
    category: risk.category,
    likelihood: risk.likelihood,
    impact: risk.impact,
    statement: risk.statement,
    mitigation: text(risk.mitigation),
  }));
  const nextSteps: MemoNextStep[] = risks.map((risk) => {
    const phase = PHASE_OF[risk.level];
    return {
      phase,
      phaseKey: `memo.phases.${PHASE_TEXT[phase]}`,
      riskNumber: risk.number,
      level: risk.level,
      action: risk.mitigation,
    };
  });
  const conclusion = {
    condition: text(analysis?.investmentCondition),
    reading: text(analysis?.overallAssessment),
    counterArgument: text(analysis?.contraryCase ?? analysis?.counterThesis),
  };

  const specialists: MemoSpecialist[] = analysis
    ? specialistGroups(
        analysis.criteria,
        caseView.screening?.criteria ?? [],
        analysis.specialistSet ?? specialistCatalog,
        analysis.specialists ?? [],
        language,
      ).map((group) => ({
        id: group.id,
        label: group.label,
        title: group.title,
        score: group.score,
        headline: text(group.headline),
        summary: group.summary,
      }))
    : [];
  // The evidence the analysis was built on; all of the case's when the run lists none.
  const used = new Set(analysis?.inputEvidenceIds ?? []);
  const evidence = caseView.evidence.filter((item) => used.size === 0 || used.has(item.id));
  const counts = new Map<string, number>();
  for (const item of evidence) counts.set(item.status, (counts.get(item.status) ?? 0) + 1);

  const keyFigures = [
    finance.latest.revenue,
    finance.latest.revenueGrowth,
    finance.latest.operatingResult,
    finance.latest.cash,
  ].filter((figure): figure is MemoFigure => figure !== null);

  const rationale = proposerInput?.rationale.trim() ?? "";
  const found = (value: boolean): MemoFieldStatus => (value ? "found" : "missing");
  const status: Record<MemoFieldKey, MemoFieldStatus> = {
    proposer_rationale: rationale ? "found" : "human_only",
    investment_condition: found(conclusion.condition !== null),
    mandate: mandate.open === 0 ? "found" : "human_only",
    thesis_text: found(text(caseView.thesis) !== null),
    criteria: found(criteria.some(isScored)),
    company_description: found(company.description !== null || company.business !== null),
    market_size: found(size !== null),
    // The analysis has no competitor set (memo-v5 section 5): a person adds it.
    competitor_map: "missing",
    product_scores: found(inSection("product").some(isScored)),
    tech_benchmarks: found(benchmarks.length > 0),
    team_people: found(people.length > 0),
    founder_references: "human_only",
    traction_figures: found(highlights.length > 0 || inSection("traction").some(isScored)),
    customer_references: "human_only",
    financial_statements: found(finance.years.length > 0),
    // Cash is enough: a company without burn has no runway to calculate ("not relevant").
    cash_runway: found(finance.latest.cash !== null),
    unit_economics: found(finance.unitEconomics !== null),
    funding_history: found(rounds.length > 0),
    cap_table: found(holders.length > 0),
    round_terms: "human_only",
    risks: found(risks.length > 0),
    counter_argument: found(conclusion.counterArgument !== null),
    specialist_work: found(specialists.length > 0),
    legal_review: "human_only",
    management_interview: "human_only",
    next_steps: found(nextSteps.some((step) => step.action !== null)),
  };

  const sections = MEMO_SECTIONS.map((section, index): MemoSection => ({
    key: section.key,
    number: index + 1,
    group: section.group,
    groupKey: `memo.groups.${section.group}`,
    titleKey: `memo.sections.${section.text}.title`,
    questionKey: `memo.sections.${section.text}.question`,
    fields: MEMO_SECTION_FIELDS[section.key].map((key) => ({
      key,
      labelKey: `memo.fields.${FIELD_TEXT[key]}`,
      status: status[key],
    })),
  }));

  return {
    caseId: caseView.id,
    analysisId: analysis?.id ?? null,
    language,
    cover: {
      companyName: caseView.companyName,
      stage: caseView.stageText,
      sector: caseView.sector,
      geography: caseView.geography,
      website: caseView.website,
      thesisName: caseView.profileName,
      thesisVersion: caseView.profileVersion,
      analysisCompletedAt: analysis?.completedAt ?? null,
    },
    proposal: {
      rationale,
      authorId: proposerInput?.authorId ?? null,
      updatedAt: proposerInput?.updatedAt ?? null,
    },
    score: analysis?.score ?? null,
    sections,
    mandate,
    thesis: { text: text(caseView.thesis), criteria, beliefs },
    company,
    market: { criteria: inSection("market"), size },
    product: { criteria: inSection("product"), benchmarks },
    team: { criteria: inSection("team"), people },
    traction: { criteria: inSection("traction"), highlights },
    finance,
    deal: { rounds, holders },
    conclusion,
    risks,
    diligence: {
      specialists,
      evidence: [...counts].map(([key, count]) => ({ status: key, count })),
      evidenceTotal: evidence.length,
      documents: caseView.documents.map((document) => ({
        kind: document.kind,
        fileName: document.fileName,
      })),
    },
    nextSteps,
    keyFigures,
    gapAnswers: (options.gapAnswers ?? []).map((answer) => ({
      gapKey: answer.gapKey,
      state: answer.state,
      reason: text(answer.reason),
      answeredAt: answer.answeredAt,
    })),
  };
}

/** A field's status in the model (the memo's "Not yet known" box and `memoGaps` read it). */
export function memoFieldStatus(model: MemoModel, key: MemoFieldKey): MemoFieldStatus {
  for (const section of model.sections) {
    const field = section.fields.find((entry) => entry.key === key);
    if (field) return field.status;
  }
  return "missing";
}
