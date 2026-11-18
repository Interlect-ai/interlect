/**
 * Ét fælles view-model for casevisningen.
 *
 * Rigtige cases (serverfunktionen `getCaseDetail`) normaliseres hertil. Der
 * udledes ingen nye tal: alt kommer fra kilden, og felter uden data er `null`.
 */
import type { DeepCardData } from "@/lib/analysis/card-data";
import type { CaseDetail } from "@/lib/cases/cases.functions";
import type { CompanyLabel, CompanyProfile, KeyFinding } from "@/lib/analysis/contracts";
import type { SpecialistSetEntry, SpecialistView } from "@/lib/cases/specialist-view";
import { stagePriorScore } from "@/lib/analysis/scoring";
import { withoutMethodNote } from "@/lib/analysis/financial-score";
import { DEFAULT_LANGUAGE, LANGUAGES, type Language } from "../i18n/language.ts";
import { DICTIONARIES, translate } from "../i18n/translate.ts";
import {
  executionStatusLabelIn,
  intakeSourceLabelIn,
  scoreCategoryLabelIn,
} from "@/lib/domain/labels";
import type {
  AnalysisExecutionStatus,
  CaseWorkspaceStatus,
  InvestmentProcessStage,
  PapRecommendation,
  RiskLevel,
  ScoreCategory,
} from "@/lib/domain/types";

export const SIMULATION_PREFIX = "sim-";

export function isSimulationId(caseId: string) {
  return caseId.startsWith(SIMULATION_PREFIX);
}

export function simulationCaseId(demoId: string) {
  return `${SIMULATION_PREFIX}${demoId}`;
}

export interface CriterionView {
  criterionKey: string;
  category: ScoreCategory | string;
  label: string;
  /** Fondens egen beskrivelse af kriteriet (tom for demo-data). */
  description?: string;
  score: number | null;
  weight: number;
  /** 0-1 */
  confidence: number | null;
  verdict: string | null;
  rationale: string;
  positiveDrivers: string[];
  negativeDrivers: string[];
  unknowns: string[];
  evidenceIds: string[];
  /** True when the score is a transparent low-confidence prior, not a company KPI. */
  isStagePrior?: boolean;
}

export interface StatementView {
  statement: string;
  meta: string;
  tone: "positive" | "warning" | "neutral";
}

/** One finding the analysis stored (deep: what a specialist found, by category and type). */
export interface FindingView {
  category: string;
  findingType: "strength" | "weakness" | "unknown" | "question" | "assessment" | string;
  statement: string;
  confidence: number | null;
  nature: string;
}

export interface RiskView {
  category: string;
  /** Modellens korte danske titel, når den findes. */
  label: string | null;
  level: RiskLevel;
  likelihood: number | null;
  impact: number | null;
  statement: string;
  mitigation: string | null;
}

export interface CalculationView {
  metric: string;
  status: string;
  value: number | null;
  unit: string | null;
  missingInputs: string[];
  warnings: string[];
}

export interface EvidenceView {
  id: string;
  claim: string;
  valueText: string | null;
  status: string;
  confidence: number | null;
  excerpt: string | null;
  date: string | null;
  sourceId: string | null;
  documentId: string | null;
  entityMatchStatus: string | null;
  /** D-7: kildens titel og adresse (null for dokumenter og interne kilder). */
  sourceTitle: string | null;
  sourceUrl: string | null;
  /** F7: kildens type (fx company_website, cvr_regnskab, public_research:news). */
  sourceType: string | null;
}

export interface GateView {
  key: string;
  label: string;
  description: string;
  treatment: "hard" | "review";
  passed: boolean | null;
  rationale: string | null;
  confidence: number | null;
  /** The status is the team's answer, not the AI's assessment. */
  teamAnswered?: boolean;
}

/** Én analysekørsel — screening eller grundig analyse — i visningsform. */
export interface AnalysisView {
  /** Kørslens id; null for simulerede cases. Bruges fx til "første visning". */
  id: string | null;
  kind: "screening" | "deep";
  status: string;
  /** Den screening, en dyb analyse bygger på; null for screeninger og simulerede cases. */
  basisScreeningId: string | null;
  /** Opsætningsversionen, kørslen blev lavet med; null når den ikke kendes. */
  setupVersion?: number | null;
  /** Tærsklen i kørslens egen opsætningsversion. */
  setupThreshold?: number | null;
  /** False, når kørslen blev lavet med en ældre opsætningsversion end den aktive. */
  setupCurrent?: boolean;
  title: string;
  score: number | null;
  /**
   * Den stærkeste modfortolkning mod investeringen ("Stærkeste modfortolkning: ...").
   * Modellen bliver allerede bedt om `contraryCase` i outputskemaet, men den bliver i
   * dag lagt sammen med `overallAssessment` i den gemte `rationale`-tekst frem for
   * gemt som sit eget felt. Udledes her uden at ændre den gemte tekst, så ældre
   * analyser uden markøren blot ikke matcher og falder tilbage til `null`.
   */
  counterThesis?: string | null;
  /** 0-1 */
  confidence: number | null;
  recommendation: PapRecommendation | null;
  rationale: string | null;
  hasFailedGate: boolean;
  hasCriticalRisk: boolean;
  /** The score the run itself gave (before any recalculation after team answers). */
  runScore?: number | null;
  /** The AI's overall assessment without the code's score context (the case summary). */
  overallAssessment?: string | null;
  contraryCase?: string | null;
  /** The one condition the synthesis puts on an investment (deep prompt v10+; else null). */
  investmentCondition?: string | null;
  /** The specialists' own output (deep runs; summary null before prompt v10). */
  specialists?: SpecialistView[];
  /** The deep run's own set of specialists; null for runs from (the four). */
  specialistSet?: SpecialistSetEntry[] | null;
  /** The cards' data on Konklusion; null for screenings and missing runs. */
  cardData?: DeepCardData | null;
  /** "Læs mere om virksomheden" (screening prompt v8+). */
  companyProfile?: CompanyProfile | null;
  /** The short label beside the name: stage, sector, country (shown). */
  companyLabel?: CompanyLabel | null;
  /** Nøglefund tied to criteria (screening prompt v8+). */
  keyFindings?: KeyFinding[];
  /** When the score was last recalculated after a team answer. */
  recalculatedAt?: string | null;
  gates: GateView[];
  criteria: CriterionView[];
  strengths: StatementView[];
  weaknesses: StatementView[];
  questions: StatementView[];
  /** The stored findings as they are (batch 2 groups them by category on the specialist tabs). */
  findings?: FindingView[];
  risks: RiskView[];
  calculations: CalculationView[];
  inputEvidenceIds: string[];
  startedAt: string;
  completedAt: string | null;
  steps: Array<{
    key: string;
    order: number;
    status: string;
    errorMessage: string | null;
    startedAt: string | null;
    completedAt: string | null;
  }>;
}

export interface HistoryEntry {
  id: string;
  kind: string;
  kindText: string;
  status: string;
  createdAt: string;
  completedAt: string | null;
  errorMessage: string | null;
}

export interface CaseViewModel {
  id: string;
  isSimulation: boolean;
  companyName: string;
  /** Fase B: CVR og identitetsvurdering (null for simulerede cases). */
  identity: CaseDetail["identity"] | null;
  website: string | null;
  description: string | null;
  stageText: string;
  sector: string | null;
  geography: string | null;
  originText: string;
  profileName: string;
  profileVersion: string;
  /** Fondens tese, som analysen holdes op imod. */
  thesis: string | null;
  /** Analysetærskel fra fondsmandatet. */
  threshold: number | null;
  headline: string | null;
  overallScore: number | null;
  /** 0-1 */
  confidence: number | null;
  recommendation: PapRecommendation | null;
  executionStatus: AnalysisExecutionStatus;
  executionText: string;
  processStage: InvestmentProcessStage;
  workspaceStatus: CaseWorkspaceStatus;
  hasFailedGate: boolean;
  hasCriticalRisk: boolean;
  analysisKind: "screening" | "deep" | null;
  /** Den indledende screening mod fondstesen — altid vist, når den findes. */
  screening: AnalysisView | null;
  /** Den grundige analyse — vises separat under screeningen. */
  deep: AnalysisView | null;
  /**
   * Sidste FÆRDIGE dybe analyse — bruges af komité-pakken, så den ikke
   * pludselig viser tomme tal, mens en genkørsel er i gang. Null når der
   * aldrig har været en færdig dyb analyse.
   */
  committeeDeep: AnalysisView | null;
  /**
   * Ældre screeninger, som de viste dybe analyser bygger på, når en nyere screening er kommet
   * siden. Ændringen "siden screening" vises mod dem.
   */
  basisScreenings: AnalysisView[];
  history: HistoryEntry[];
  criteria: CriterionView[];
  strengths: StatementView[];
  weaknesses: StatementView[];
  questions: StatementView[];
  risks: RiskView[];
  calculations: CalculationView[];
  evidence: EvidenceView[];
  documents: Array<{ id: string; kind: string; fileName: string; status: string }>;
  /** Finansielle tidsserier fra evidens — tegnes kun, når punkter findes. */
  financialSeries: Array<{
    metric: string;
    unit: string;
    points: Array<{ label: string; value: number }>;
  }>;
  /** Fondens egen retrospektive hukommelse — tom for en fond uden historik. */
  relatedMemory: MemoryMatchView[];
  updatedAt: string | null;
}

export interface MemoryMatchView {
  companyName: string;
  sector: string | null;
  geography: string | null;
  stage: string | null;
  decision: "invested" | "closed_without_investment";
  decidedAt: string | null;
  summary: string;
  similarity: number;
}

/** The stage as the fund's language names it; a stage the dictionary lacks shows as stored. */
function stageNameOf(stage: string, language: Language): string {
  const names = DICTIONARIES[language].basis.stage as Readonly<Record<string, string>>;
  return Object.hasOwn(names, stage) ? names[stage]! : stage;
}

type RunDetail = NonNullable<CaseDetail["latestScreening"]>;

/** The marker in each language the rationale can be stored in: "Stærkeste modfortolkning: ". */
const COUNTER_THESIS_MARKERS = LANGUAGES.map((language) =>
  translate(language, "analysisServer.deep.contrary", { text: "" }),
);

/**
 * Den dybe analyses rationale gemmes i dag som
 * `${overallAssessment}\n\n${marker}${contraryCase}` (markøren på fondens sprog). Udtrækker
 * modfortolkningen uden at ændre den gemte tekst — ældre kørsler uden markøren
 * giver blot `null` tilbage.
 */
function extractCounterThesis(rationale: string | null, kind: "screening" | "deep") {
  if (kind !== "deep" || !rationale) return null;
  const [index, marker] = COUNTER_THESIS_MARKERS.reduce<[number, string]>(
    (best, marker) => {
      const at = rationale.lastIndexOf(marker);
      return at > best[0] ? [at, marker] : best;
    },
    [-1, ""],
  );
  if (index === -1) return null;
  const statement = rationale.slice(index + marker.length).trim();
  return statement.length > 0 ? statement : null;
}

/** Normaliserer én kørsel til visningsform uden at udlede nye tal. */
function toAnalysisView(
  run: RunDetail,
  companyStage: string,
  language: Language = DEFAULT_LANGUAGE,
): AnalysisView {
  const risks: RiskView[] = run.risks.map((risk) => ({
    category: risk.category,
    label: risk.label,
    level: risk.level as RiskLevel,
    likelihood: risk.likelihood,
    impact: risk.impact,
    statement: risk.statement,
    mitigation: risk.mitigation,
  }));
  const confidences = run.scores
    .map((score) => score.confidence)
    .filter((value): value is number => value !== null);
  const prior = stagePriorScore(companyStage);
  const criteria = run.scores.map((score) => ({
    criterionKey: score.criterionKey,
    category: score.category,
    label: score.label || scoreCategoryLabelIn(score.category, language) || score.category,
    description: score.description,
    score: score.score ?? prior,
    weight: score.weight,
    confidence: score.isStagePrior || score.score === null ? 0 : score.confidence,
    verdict: score.verdict,
    rationale: score.rationale && withoutMethodNote(score.rationale),
    positiveDrivers: score.positiveDrivers,
    negativeDrivers: score.negativeDrivers,
    unknowns: score.unknowns,
    evidenceIds: score.evidenceIds,
    isStagePrior: score.isStagePrior || score.score === null,
  }));
  const derivedScore =
    criteria.length === 0
      ? null
      : Math.round(
          criteria.reduce(
            (sum, criterion) => sum + ((criterion.score ?? 0) * criterion.weight) / 100,
            0,
          ) * 10,
        ) / 10;
  return {
    id: run.id,
    kind: run.kind,
    status: run.status,
    basisScreeningId: run.basisScreeningId,
    setupVersion: run.setupVersion,
    setupThreshold: run.setupThreshold,
    setupCurrent: run.setupCurrent,
    title: translate(
      language,
      run.kind === "deep" ? "screening.model.titleDeep" : "screening.model.titleScreening",
    ),
    // A team answer recalculates the screening's score in code; that is the case's score.
    score: run.recalculation ? run.recalculation.score : (run.overallScore ?? derivedScore),
    runScore: run.overallScore ?? derivedScore,
    overallAssessment: run.overallAssessment,
    contraryCase: run.contraryCase,
    investmentCondition: run.investmentCondition ?? null,
    specialists: run.specialists ?? [],
    specialistSet: run.specialistSet ?? null,
    cardData: run.cardData ?? null,
    companyProfile: run.companyProfile,
    companyLabel: run.companyLabel,
    keyFindings: run.keyFindings,
    recalculatedAt: run.recalculation?.createdAt ?? null,
    confidence:
      run.evidenceConfidence ??
      (confidences.length === 0
        ? null
        : confidences.reduce((sum, value) => sum + value, 0) / confidences.length),
    recommendation:
      ((run.recalculation?.recommendation ?? run.recommendation) as PapRecommendation | null) ??
      null,
    rationale: run.rationale,
    counterThesis: extractCounterThesis(run.rationale, run.kind),
    hasFailedGate: run.hasFailedGate,
    hasCriticalRisk: run.hasCriticalRisk,
    gates: run.gates,
    criteria,
    findings: run.findings.map((finding) => ({
      category: finding.category,
      findingType: finding.findingType,
      statement: finding.statement,
      confidence: finding.confidence,
      nature: finding.nature,
    })),
    strengths: run.findings
      .filter((finding) => finding.findingType === "strength")
      .map((finding) => ({
        statement: finding.statement,
        meta: "",
        tone: "positive" as const,
      })),
    weaknesses: [
      ...run.findings
        .filter((finding) => finding.findingType === "weakness")
        .map((finding) => ({
          statement: finding.statement,
          meta: "",
          tone: "warning" as const,
        })),
      ...risks
        .filter((risk) => risk.level === "high" || risk.level === "critical")
        .map((risk) => ({
          statement: risk.statement,
          meta: `${translate(language, "screening.model.riskWord")} · ${translate(
            language,
            risk.level === "critical" ? "screening.model.riskCritical" : "screening.model.riskHigh",
          )}`,
          tone: "warning" as const,
        })),
    ],
    questions: [
      ...run.findings
        .filter(
          (finding) => finding.findingType === "unknown" || finding.findingType === "question",
        )
        .map((finding) => ({
          statement: finding.statement,
          meta: translate(language, "screening.model.openQuestion"),
          tone: "neutral" as const,
        })),
      ...run.calculations.flatMap((calculation) =>
        calculation.missingInputs.map((input) => ({
          statement: translate(language, "screening.model.calcMissing", {
            metric: calculation.metric,
            input,
          }),
          meta: translate(language, "screening.model.dataGap"),
          tone: "neutral" as const,
        })),
      ),
    ],
    risks,
    calculations: run.calculations,
    inputEvidenceIds: run.inputEvidenceIds,
    startedAt: run.createdAt,
    completedAt: run.completedAt,
    steps: run.steps,
  };
}

function runKindText(kind: string, language: Language) {
  return translate(
    language,
    kind === "deep" ? "screening.model.runKindDeep" : "screening.model.runKindScreening",
  );
}

export function fromCaseDetail(
  detail: CaseDetail,
  language: Language = DEFAULT_LANGUAGE,
): CaseViewModel {
  const screening = detail.latestScreening
    ? toAnalysisView(detail.latestScreening, detail.stage, language)
    : null;
  const deep = detail.latestDeepAnalysis
    ? toAnalysisView(detail.latestDeepAnalysis, detail.stage, language)
    : null;
  const committeeDeep = detail.committeeDeepAnalysis
    ? toAnalysisView(detail.committeeDeepAnalysis, detail.stage, language)
    : deep?.status === "complete"
      ? deep
      : null;
  const latest = deep ?? screening;

  return {
    id: detail.id,
    isSimulation: false,
    companyName: detail.companyName,
    identity: detail.identity,
    website: detail.website,
    description: detail.description,
    stageText: stageNameOf(detail.stage, language),
    sector: detail.sector,
    geography: detail.geography,
    originText: intakeSourceLabelIn(detail.primaryOrigin, language) ?? detail.primaryOrigin,
    profileName: detail.analysisProfile.name,
    profileVersion: `v${detail.analysisProfile.version}`,
    thesis: detail.analysisProfile.thesis,
    // Den viste analyse holdes op mod sin egen versions tærskel.
    threshold:
      latest?.setupThreshold === undefined
        ? detail.analysisProfile.threshold
        : latest.setupThreshold,
    headline: firstSentence(latest?.rationale ?? null),
    overallScore: latest?.score ?? null,
    confidence: latest?.confidence ?? null,
    recommendation: latest?.recommendation ?? null,
    executionStatus: detail.executionStatus as AnalysisExecutionStatus,
    executionText:
      executionStatusLabelIn(detail.executionStatus, language) ?? detail.executionStatus,
    processStage: detail.processStage as InvestmentProcessStage,
    workspaceStatus: detail.workspaceStatus,
    hasFailedGate: latest?.hasFailedGate ?? false,
    hasCriticalRisk: latest?.hasCriticalRisk ?? false,
    analysisKind: latest?.kind ?? null,
    screening,
    deep,
    committeeDeep,
    basisScreenings: detail.basisScreenings.map((run) =>
      toAnalysisView(run, detail.stage, language),
    ),
    history: detail.analysisHistory.map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      kindText: runKindText(entry.kind, language),
      status: entry.status,
      createdAt: entry.createdAt,
      completedAt: entry.completedAt,
      errorMessage: entry.errorMessage,
    })),
    criteria: latest?.criteria ?? [],
    strengths: latest?.strengths ?? [],
    weaknesses: latest?.weaknesses ?? [],
    questions: latest?.questions ?? [],
    risks: latest?.risks ?? [],
    calculations: latest?.calculations ?? [],
    evidence: detail.evidence.map((item) => ({
      id: item.id,
      claim: item.claim,
      valueText: item.valueText,
      status: item.status,
      confidence: item.confidence,
      excerpt: item.excerpt,
      date: item.observationDate ?? item.collectedAt,
      sourceId: item.sourceId,
      documentId: item.documentId,
      entityMatchStatus: item.entityMatchStatus,
      sourceTitle: item.sourceTitle,
      sourceUrl: item.sourceUrl,
      sourceType: item.sourceType,
    })),
    documents: detail.documents.map((document) => ({
      id: document.id,
      kind: document.kind,
      fileName: document.fileName,
      status: document.status,
    })),
    financialSeries: detail.financialSeries,
    relatedMemory: detail.relatedMemory,
    updatedAt: detail.updatedAt,
  };
}

/**
 * Sidetitlen er én beslutningssætning, ikke hele begrundelsen.
 * Den fulde rationale vises fortsat i konklusionspanelet.
 */
export function firstSentence(text: string | null): string | null {
  if (!text) return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^[\s\S]*?[.!?](?=\s|$)/);
  const sentence = (match?.[0] ?? trimmed).trim();
  return sentence.length > 180 ? `${sentence.slice(0, 177).trimEnd()} …` : sentence;
}

/**
 * Screening and deep analysis are separate decision surfaces. This keeps the
 * same case data while exposing only the analysis selected from the case list.
 */
export function focusCaseView(model: CaseViewModel, focus: "screening" | "deep"): CaseViewModel {
  const active = focus === "deep" ? model.deep : model.screening;
  return {
    ...model,
    screening: focus === "screening" ? model.screening : null,
    deep: focus === "deep" ? model.deep : null,
    headline: firstSentence(active?.rationale ?? null),
    overallScore: active?.score ?? null,
    confidence: active?.confidence ?? null,
    recommendation: active?.recommendation ?? null,
    hasFailedGate: active?.hasFailedGate ?? false,
    hasCriticalRisk: active?.hasCriticalRisk ?? false,
    analysisKind: active?.kind ?? null,
    criteria: active?.criteria ?? [],
    strengths: active?.strengths ?? [],
    weaknesses: active?.weaknesses ?? [],
    questions: active?.questions ?? [],
    risks: active?.risks ?? [],
    calculations: active?.calculations ?? [],
  };
}
