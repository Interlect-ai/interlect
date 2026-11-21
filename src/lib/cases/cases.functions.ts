import { createServerFn } from "@tanstack/react-start";
import { cleanCompanyLabel } from "@/lib/analysis/short-texts";
import { financeGateTreatment, isFinanceGate } from "@/lib/analysis/financial-gates";
import { readDeepCardData, type DeepCardData } from "@/lib/analysis/card-data";
import { gateMarks, type GateMark } from "@/lib/cases/gate-marks";
import {
  parseSpecialistSet,
  parseSpecialistViews,
  type SpecialistSetEntry,
  type SpecialistView,
} from "@/lib/cases/specialist-view";
import { fundAllowsStage } from "@/lib/domain/stages";
import { isSafeStoragePath, isStoragePathIn } from "@/lib/security/storage-path";
import { z } from "zod";
import { requireSupabaseAuth } from "@/lib/supabase/auth-middleware";
import { requireFundCapability } from "@/lib/auth/access.server";
import { caseThesis, chosenThesis } from "@/lib/funds/thesis-scope.server";
import type { ThesisStatus } from "@/lib/funds/theses";
import { getServiceClient } from "@/lib/supabase/admin.server";
import { stagePriorScore } from "@/lib/analysis/scoring";
import { isFundMemoryEnabled } from "@/lib/analysis/gateway-security";
import type { CaseWorkspaceStatus, InvestmentProcessStage } from "@/lib/domain/types";
import { runCaseTransitions, staleCaseMessage } from "@/lib/cases/lifecycle.server";
import { enqueueBrainCapture } from "@/lib/brain/queue.server";
import { clipCodePoints } from "@/lib/text";
import { extractPdfPages, extractPptxSlides } from "@/lib/cases/file-text.server";
import {
  effectiveGateAnswers,
  gateAnswerFromTask,
  storedTeamGateAnswers,
} from "@/lib/analysis/gate-answers";
import {
  companyLabelSchema,
  companyProfileSchema,
  keyFindingSchema,
  type CompanyLabel,
  type CompanyProfile,
  type KeyFinding,
} from "@/lib/analysis/contracts";
import type { CasePhase, CaseStatus } from "@/lib/cases/lifecycle";
import { addCaseNoteInputSchema, type CaseNote } from "./notes.contracts";
import { requestLanguage, serverText } from "@/lib/i18n/server-text";
import {
  readSetupStageChoice,
  selectSetupForStage,
  type SetupStageChoice,
} from "@/lib/analysis/setup-stage";
import { readEconomyResult, type EconomyResult } from "@/lib/analysis/economy-check";
import { publicRunError } from "@/lib/errors/run-error";
import { withDemoView } from "@/lib/display/display-names.server";
import {
  buildCaseList,
  criterionOrder,
  isCaseListPayload,
  profileRunExecutionStatus,
  type CaseListProfile,
} from "@/lib/cases/case-list";

const keyFindingsSchema = z.array(keyFindingSchema);
const fundIdSchema = z.guid();
const stageSchema = z.enum([
  "pre_seed",
  "seed",
  "series_a",
  "series_b",
  "later",
  "growth",
  "buyout",
  "unknown",
]);

const founderSchema = z.object({
  name: z.string().trim().min(1).max(160),
  role: z.string().trim().max(160).default("Founder"),
  linkedinUrl: z.union([z.string().url(), z.literal("")]).default(""),
});

const createCaseSchema = z.object({
  fundId: fundIdSchema,
  companyName: z.string().trim().min(1).max(200),
  website: z.union([z.string().url(), z.literal("")]),
  stage: stageSchema,
  sector: z.string().trim().max(160),
  geography: z.string().trim().max(160),
  sourceNote: z.string().trim().max(1000),
  intakeText: z.string().trim().max(20_000).default(""),
  intakeTextSource: z
    .enum(["founder_email", "warm_intro", "meeting_notes", "analyst_note"])
    .default("founder_email"),
  founders: z.array(founderSchema).max(20),
  /** The thesis the case belongs to; without it, the team's default thesis. */
  thesisId: z.guid().optional(),
});

export type CreateCaseInput = z.infer<typeof createCaseSchema>;

/** Én kriteriescore i caselisten, i fondens egen rækkefølge. */
export interface ListCriterionScore {
  criterionKey: string;
  label: string;
  category: string;
  score: number | null;
  weight: number;
}

export interface CaseListItem {
  id: string;
  /** The thesis the case belongs to; null only for a list from before 0128. */
  thesisId: string | null;
  /**
   * The shown screening was made with an older setup version than the active one; its
   * version number in olderSetupVersion (null when unknown).
   */
  olderSetup?: boolean;
  olderSetupVersion?: number | null;
  companyName: string;
  website: string | null;
  stage: string;
  sector: string | null;
  geography: string | null;
  primaryOrigin: "manual" | "pitch_deck" | "scanner";
  executionStatus: string;
  processStage: string;
  workspaceStatus: CaseWorkspaceStatus;
  workspaceReason: string | null;
  /** Redesignets fase og status (0033); workspaceStatus/processStage følger med til. */
  phase: CasePhase;
  status: CaseStatus;
  lastActionAt: string;
  recommendation: string | null;
  updatedAt: string;
  /** Seneste fondsfit i den aktive profil — null indtil casen er scoret. */
  fitScore: number | null;
  /** Fit fra tidligere kørsler i kronologisk orden; driver rækkens sparkline. */
  fitHistory: number[];
  /** Profilens godkendelsestærskel, så listen kan tegnes mod den. */
  threshold: number | null;
  /** 0-1 fra den seneste analyses anbefaling. */
  evidenceConfidence: number | null;
  /** Fase 1-5 udledt af procestrin, til fase-indikatoren i rækken. */
  phaseIndex: number;
  /** Sand når en grundig analyse er gennemført i den aktive profil. */
  hasDeepAnalysis: boolean;
  /** Specialistscorer fra den seneste færdige grundige analyse. */
  deepScores: ListCriterionScore[];
  /** Højeste risikoniveau i den grundige analyse. */
  topRiskLevel: string | null;
  /** De fem visuelle screeningsgrupper udledes af disse rå kategoriscores. */
  screeningScores: ListCriterionScore[];
  screeningScore: number | null;
  screeningConfidence: number | null;
  screeningRecommendation: string | null;
  gatePassed: number;
  gateTotal: number;
  /** D-6: ét mærke pr. krav i den aktive profil; null, når casen ikke er screenet. */
  gateMarks: GateMark[] | null;
  sourceCount: number;
  /** Den aktive baggrundskørsel, når screening eller dyb analyse er i gang. */
  activeRunKind: "screening" | "deep" | null;
  activeStepKey: string | null;
  activeStepsCompleted: number;
  activeStepsTotal: number;
  /** Open tasks under "Skal afklares" (case_tasks, not deleted). */
  openTasks: number;
  /** Ansvarlig: the case's assigned person, else whoever created it. */
  assigneeId: string | null;
  assigneeName: string | null;
  /** A mandate gate is breached in the latest screening (team answers and recalculations included). */
  mandateBreach: boolean;
  /**
   * The latest finished screening has not been sent to a deep analysis yet (the server's own
   * rule in approveAndRunDeepAnalysis), so "Kør dyb analyse" can start.
   */
  canRunDeep: boolean;
}

/**
 * The team's access and the setup a case page reads: the active version of the case's own
 * thesis (`caseId`), of a chosen thesis (`thesisId`), or of the team's default thesis.
 */
async function resolveFund(
  supabase: Parameters<typeof requireFundCapability>[0],
  userId: string,
  fundId: string,
  scope: { caseId?: string; thesisId?: string | null | undefined } = {},
) {
  // The setup and the access check are asked for at the same time; the setup's error
  // still comes first, as before.
  const [config, accessResult] = await Promise.allSettled([
    (async () => {
      const thesis = scope.caseId
        ? await caseThesis(supabase, fundId, scope.caseId)
        : await chosenThesis(supabase, fundId, scope.thesisId);
      // A case that is not in the team (or not visible) is "not found", not "no setup".
      if (!thesis && scope.caseId) {
        throw new Error(serverText("caseServer.cases.notFoundOrNoAccess"));
      }
      if (!thesis) return { data: null, error: null, thesis: null };
      const result = await supabase
        .from("fund_config_versions")
        .select(CONFIG_PROFILE_COLUMNS)
        .eq("fund_id", fundId)
        .eq("thesis_id", thesis.id)
        .eq("status", "active")
        .single();
      return { data: result.data, error: result.error, thesis };
    })(),
    requireFundCapability(supabase, userId, fundId, "view_case"),
  ]);
  // The thesis lookup's own message (case not found, thesis not in the team, not loaded) goes
  // through; only a thesis without a published version is "no published setup".
  if (config.status === "rejected") throw config.reason;
  const data = config.value.data;
  if (config.value.error || !data) {
    throw new Error(serverText("caseServer.cases.noPublishedSetup"));
  }
  if (accessResult.status === "rejected") throw accessResult.reason;
  const access = accessResult.value;
  const thesis = config.value.thesis!;
  return {
    fundId,
    ...configProfile(data as Record<string, unknown>),
    access,
    thesisRef: { id: thesis.id, name: thesis.name, status: thesis.status },
  };
}

/** A setup version with what the case pages show from it (its gates, criteria and mandate). */
const CONFIG_PROFILE_COLUMNS = `id, fund_id, profile_key, version, funds(name),
      fund_mandates(analysis_threshold, approval_mode, thesis, stages, setup),
      mandate_gates(stage, gate_key, label, description, treatment, sort_order),
      assessment_criteria(stage, criterion_key, label, description, score_category, weight, sort_order),
      fund_specialists(stage)`;

type RunProfile = ReturnType<typeof configProfile>;

/**
 * One setup version as the case pages read it: the active one, or the one an older run was made
 * with (a run keeps its own version's criteria and gates).
 */
function configProfile(data: Record<string, unknown>) {
  const rawFund = data["funds"] as unknown;
  const fund = (Array.isArray(rawFund) ? rawFund[0] : rawFund) as { name: string } | null;
  const mandateRows = (data["fund_mandates"] ?? []) as Array<{
    analysis_threshold: number;
    approval_mode: string;
    thesis: string;
    stages?: string[] | null;
    setup?: unknown;
  }>;
  const mandate = Array.isArray(mandateRows) ? mandateRows[0] : mandateRows;
  const gateRows = [
    ...((data["mandate_gates"] ?? []) as Array<{
      stage?: string | null;
      gate_key: string;
      label: string;
      description: string;
      treatment: "hard" | "review";
      sort_order: number;
    }>),
  ].sort((a, b) => a.sort_order - b.sort_order);
  const criterionRows = [
    ...((data["assessment_criteria"] ?? []) as Array<{
      stage?: string | null;
      criterion_key: string;
      label: string;
      description: string | null;
      score_category: string;
      weight: number;
      sort_order: number;
    }>),
  ].sort((a, b) => a.sort_order - b.sort_order);
  const specialistRows = (data["fund_specialists"] ?? []) as Array<{ stage?: string | null }>;
  const mapGates = (rows: typeof gateRows) =>
    rows.map((gate) => ({
      key: gate.gate_key,
      label: gate.label,
      description: gate.description,
      // Finans-gates har låst behandling (scoring.ts), så visningen følger den.
      treatment: isFinanceGate(gate.gate_key)
        ? financeGateTreatment(gate.gate_key)
        : gate.treatment,
    }));
  const mapCriteria = (rows: typeof criterionRows) =>
    rows.map((criterion) => ({
      key: criterion.criterion_key,
      label: criterion.label,
      description: criterion.description ?? "",
      category: criterion.score_category,
      weight: Number(criterion.weight),
    }));
  /**
   * The gates and criteria a case is read with, as the analysis chose them
   * (selectSetupForStage): the run's own stage while it is one of the version's, else the case's
   * stage resolved (unknown = the earliest chosen stage, "stadie antaget"). A version with nothing
   * per stage has no choice and reads every row, as before.
   */
  const forStage = (caseStage: string | null | undefined, runChoice?: SetupStageChoice | null) => {
    const selected = selectSetupForStage({
      gates: gateRows,
      criteria: criterionRows,
      mandateStages: mandate?.stages ?? [],
      setup: mandate?.setup,
      otherRows: specialistRows,
      caseStage,
      runChoice,
    });
    return {
      choice: selected.choice,
      gates: mapGates(selected.gates),
      criteria: mapCriteria(selected.criteria),
      threshold: selected.threshold ?? (mandate ? Number(mandate.analysis_threshold) : null),
    };
  };
  // Without a case: the shared reading (every row of a version with nothing per stage).
  const gates = mapGates(gateRows.filter((gate) => !gate.stage));
  const criteria = mapCriteria(criterionRows.filter((criterion) => !criterion.stage));
  return {
    configId: data["id"] as string,
    configVersion: Number(data["version"]),
    profileKey: data["profile_key"] as string,
    fundName: fund?.name ?? "Ukendt team",
    threshold: mandate ? Number(mandate.analysis_threshold) : null,
    approvalMode: mandate?.approval_mode ?? null,
    thesis: mandate?.thesis ?? null,
    gates,
    criteria,
    forStage,
  };
}

export interface GateResultView {
  key: string;
  label: string;
  description: string;
  treatment: "hard" | "review";
  passed: boolean | null;
  rationale: string | null;
  confidence: number | null;
  /** The status is the team's answer (Opfyldt/Ikke opfyldt), not the AI's assessment. */
  teamAnswered: boolean;
}

/**
 * The run columns the case page reads (its newest runs and a deep run's own screening). No model,
 * prompt version, tokens or price: they never reach the customer's browser. No
 * `error_message` either: the browser's role cannot read it, see `storedRunErrors`.
 */
const CASE_RUN_COLUMNS =
  "id, kind, status, config_version_id, previous_run_id, input_evidence_ids, raw_response, validation_public, stop_reason, created_at, completed_at";

/**
 * The stored errors of runs the person may already see. `error_message` can hold the
 * provider's or the database's own text, so only the server reads it (0130) and only the mapped
 * sentence (`publicRunError`) leaves. Call it after the user's own read of the runs: the ids come
 * from that read, and the fund and case filters keep it inside the team. Decoration: a failed read
 * shows the general sentence.
 */
async function storedRunErrors(
  fundId: string,
  caseId: string,
  runIds: readonly string[],
): Promise<Map<string, string>> {
  if (runIds.length === 0) return new Map();
  const { data, error } = await getServiceClient()
    .from("analysis_runs")
    .select("id, error_message")
    .eq("fund_id", fundId)
    .eq("case_id", caseId)
    .in("id", [...runIds])
    .not("error_message", "is", null);
  if (error) {
    console.error(`[cases] run errors (case ${caseId})`, error.message);
    return new Map();
  }
  return new Map((data ?? []).map((row) => [row["id"] as string, row["error_message"] as string]));
}

export interface AnalysisRunView {
  id: string;
  kind: "screening" | "deep";
  status: string;
  /** The screening a deep run was built on (`previous_run_id`); null for screenings. */
  basisScreeningId: string | null;
  /** The setup version the run was made with; null when it could not be read. */
  setupVersion: number | null;
  /** The threshold of the run's own setup version (the active one's when unknown). */
  setupThreshold: number | null;
  /** The run was made with the active setup version; false offers a rescreening. */
  setupCurrent: boolean;
  /**
   * The stage the case was analysed with (Teamopsætning pr. stadie). `assumed` is the mark
   * "stadie antaget": the case's stage was unknown, so the earliest chosen stage was used. Null
   * for a version with nothing per stage and for runs from.
   */
  setupStage: SetupStageChoice | null;
  /** The screening's economy points (figures, limits, what is missing); else null. */
  economy: EconomyResult | null;
  inputEvidenceIds: string[];
  createdAt: string;
  completedAt: string | null;
  overallScore: number | null;
  recommendation: string | null;
  evidenceConfidence: number | null;
  hasFailedGate: boolean;
  hasCriticalRisk: boolean;
  rationale: string | null;
  /** The AI's own overall assessment (the case summary), without the code's score context. */
  overallAssessment: string | null;
  /** The strongest counter-reading of the case (contraryCase). */
  contraryCase: string | null;
  /** The one condition the synthesis puts on an investment (deep prompt v10+; else null). */
  investmentCondition: string | null;
  /**
   * The specialists' own output (deep runs only; empty for screenings): `summary` (2–3
   * sentences, prompt v10+, null on older runs), strengths, weaknesses, questions, unknowns.
   * `moduleId` matches the specialist group ids (`people_team` …).
   */
  specialists: SpecialistView[];
  /**
   * The deep run's own set of specialists (the fund can switch the standard ones off and add its
   * own); null for screenings and for deep runs from (the standard four).
   * Every newer deep run stores its set, also when it is the standard four.
   */
  specialistSet: SpecialistSetEntry[] | null;
  /** The cards' data on Konklusion; null for screenings. */
  cardData: DeepCardData | null;
  /** "Læs mere om virksomheden" (screening prompt v8+; null for older runs and deep runs). */
  companyProfile: CompanyProfile | null;
  /** The short label beside the name (screening prompt v13; null for older runs). */
  companyLabel: CompanyLabel | null;
  /** Nøglefund tied to criteria (screening prompt v8+; empty for older runs). */
  keyFindings: KeyFinding[];
  /**
   * The newest code recalculation of this screening after team answers; the
   * score and the gates' status on the case page follow it. null when nobody has answered.
   */
  recalculation: {
    score: number | null;
    outcome: string;
    /** The recommendation after the recalculation (the code constrains it by the outcome). */
    recommendation: string | null;
    failedGateKeys: string[];
    unresolvedGateKeys: string[];
    createdAt: string;
  } | null;
  gates: GateResultView[];
  scores: Array<{
    criterionKey: string;
    category: string;
    label: string;
    /** Fondens egen beskrivelse af kriteriet, som analysen blev bedt om at bruge. */
    description: string;
    score: number | null;
    weight: number;
    confidence: number | null;
    verdict: string | null;
    rationale: string;
    positiveDrivers: string[];
    negativeDrivers: string[];
    unknowns: string[];
    evidenceIds: string[];
    isStagePrior: boolean;
  }>;
  risks: Array<{
    category: string;
    label: string | null;
    level: string;
    likelihood: number | null;
    impact: number | null;
    statement: string;
    mitigation: string | null;
  }>;
  findings: Array<{
    category: string;
    findingType: string;
    statement: string;
    confidence: number | null;
    nature: string;
  }>;
  calculations: Array<{
    metric: string;
    status: string;
    value: number | null;
    unit: string | null;
    missingInputs: string[];
    warnings: string[];
  }>;
  steps: Array<{
    key: string;
    order: number;
    status: string;
    errorMessage: string | null;
    startedAt: string | null;
    completedAt: string | null;
  }>;
}

export interface CaseIdentity {
  cvrNumber: string | null;
  /** Udenlandsk registernummer (fx norsk org.nr.), når selskabet ikke har et dansk CVR. */
  registryCountry: string | null;
  registryNumber: string | null;
  legalName: string | null;
  /** unverified | uncertain | probable | confirmed | rejected | not_danish */
  status: string;
  confidence: number | null;
  signals: Array<{ key: string; label: string; weight: number }>;
  confirmedByHuman: boolean;
  /** Er identiteten vurderet af en screening efter fase B? Ellers er "ikke vurderet" ikke et fund. */
  assessed: boolean;
  confirmedAt: string | null;
  hqCountry: string | null;
  domains: string[];
}

export interface CaseDetail {
  id: string;
  /**
   * The case's thesis: the page reads its setup through it, and an archived thesis gets a
   * calm line on top and no new analysis (spec flere-teser-i-et-team §3).
   */
  thesisRef: { id: string; name: string; status: ThesisStatus };
  fundId: string;
  companyId: string;
  companyName: string;
  website: string | null;
  description: string | null;
  stage: string;
  sector: string | null;
  geography: string | null;
  primaryOrigin: "manual" | "pitch_deck" | "scanner";
  executionStatus: string;
  processStage: string;
  workspaceStatus: CaseWorkspaceStatus;
  workspaceReason: string | null;
  /** Redesignets fase og status (0033); workspaceStatus/processStage følger med til. */
  phase: CasePhase;
  status: CaseStatus;
  lastActionAt: string;
  recommendation: string | null;
  sourceNote: string;
  updatedAt: string;
  analysisProfile: {
    key: string;
    name: string;
    version: number;
    threshold: number | null;
    approvalMode: string | null;
    thesis: string | null;
  };
  founders: Array<{ id: string; name: string; role: string; linkedinUrl: string | null }>;
  /** Fase B: hvem er selskabet? Beregnet i kode ud fra navngivne signaler. */
  identity: CaseIdentity;
  documents: Array<{
    id: string;
    kind: string;
    fileName: string;
    status: string;
    createdAt: string;
  }>;
  evidence: Array<{
    id: string;
    claim: string;
    valueText: string | null;
    status: string;
    confidence: number | null;
    excerpt: string | null;
    observationDate: string | null;
    collectedAt: string;
    sourceId: string | null;
    documentId: string | null;
    /** 'confirmed' | 'suggested' | 'unconfirmed' — null når kilden ikke findes (fx udgået dokument). */
    entityMatchStatus: string | null;
    sourceTitle: string | null;
    sourceUrl: string | null;
    sourceType: string | null;
  }>;
  latestScreening: AnalysisRunView | null;
  latestDeepAnalysis: AnalysisRunView | null;
  /** Sidste FÆRDIGE dybe analyse -- bruges af komité-pakken, så den ikke tømmes under en genkørsel. */
  committeeDeepAnalysis: AnalysisRunView | null;
  /**
   * The screenings the shown deep runs were built on, when that is not `latestScreening` (a newer
   * screening came after the analysis). The change "siden screening" is shown against them.
   */
  basisScreenings: AnalysisRunView[];
  analysisHistory: Array<{
    id: string;
    kind: string;
    status: string;
    createdAt: string;
    completedAt: string | null;
    errorMessage: string | null;
    /** The run stopped at the team's price limit; never an amount. */
    stoppedAtLimit?: boolean;
  }>;
  /** Seneste kørsel uanset type — bevaret for eksisterende visninger. */
  latestAnalysis: AnalysisRunView | null;
  /** Faktiske finansielle datapunkter grupperet pr. metrik, til kurverne. */
  financialSeries: FinancialSeries[];
  /** Fondens egen retrospektive hukommelse -- tom for en fond uden historik. */
  relatedMemory: Array<{
    companyName: string;
    sector: string | null;
    geography: string | null;
    stage: string | null;
    decision: "invested" | "closed_without_investment";
    decidedAt: string | null;
    summary: string;
    similarity: number;
  }>;
}

export interface FinancialSeries {
  metric: string;
  unit: string;
  points: Array<{ label: string; value: number }>;
}

const monthLabels = [
  "jan",
  "feb",
  "mar",
  "apr",
  "maj",
  "jun",
  "jul",
  "aug",
  "sep",
  "okt",
  "nov",
  "dec",
];

function periodLabel(periodEnd: string | null, periodStart: string | null): string {
  const raw = periodEnd ?? periodStart;
  if (!raw) return "—";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "—";
  return `${monthLabels[date.getUTCMonth()]} ${String(date.getUTCFullYear()).slice(2)}`;
}

function groupFinancialSeries(rows: Array<Record<string, unknown>>): FinancialSeries[] {
  const byMetric = new Map<string, FinancialSeries>();
  for (const row of rows) {
    const metric = row["metric"] as string;
    const value = Number(row["value"]);
    if (!Number.isFinite(value)) continue;
    const series = byMetric.get(metric) ?? {
      metric,
      unit: (row["unit"] as string) ?? "",
      points: [],
    };
    series.points.push({
      label: periodLabel(row["period_end"] as string | null, row["period_start"] as string | null),
      value,
    });
    byMetric.set(metric, series);
  }
  return [...byMetric.values()];
}

export const getCaseDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ caseId: z.guid(), fundId: fundIdSchema }).parse(input))
  .handler(
    withDemoView(async ({ data, context }): Promise<CaseDetail> => {
      // The case row is fetched while the fund is resolved; RLS guards it, and the fund's
      // error (no access, no setup) is still the one thrown.
      const [profile, { data: caseRow, error: caseError }] = await Promise.all([
        resolveFund(context.supabase, context.userId, data.fundId, { caseId: data.caseId }),
        context.supabase
          .from("cases")
          .select(
            "id, fund_id, company_id, primary_origin, execution_status, process_stage, workspace_status, workspace_reason, phase, status, last_action_at, pap_recommendation, source_note, updated_at, companies(name, website, description, stage, sector, geography, legal_name, cvr_number, registry_country, registry_number, identity_status, identity_confidence, identity_signals, identity_confirmed_by, identity_confirmed_at, hq_country, domains)",
          )
          .eq("id", data.caseId)
          .eq("fund_id", data.fundId)
          .single(),
      ]);
      if (caseError || !caseRow) throw new Error(serverText("caseServer.cases.notFoundOrNoAccess"));

      const rawCompany = caseRow["companies"] as unknown;
      const company = (Array.isArray(rawCompany) ? rawCompany[0] : rawCompany) as {
        name: string;
        website: string | null;
        description: string | null;
        stage: string;
        sector: string | null;
        geography: string | null;
        legal_name: string | null;
        cvr_number: string | null;
        registry_country: string | null;
        registry_number: string | null;
        identity_status: string | null;
        identity_confidence: number | string | null;
        identity_signals: {
          signals?: Array<{ key: string; label: string; weight: number }>;
          assessedAt?: string;
        } | null;
        identity_confirmed_by: string | null;
        identity_confirmed_at: string | null;
        hq_country: string | null;
        domains: string[] | null;
      };
      const companyId = caseRow["company_id"] as string;
      const [
        founderResult,
        documentResult,
        evidenceResult,
        runResult,
        financialResult,
        sourceResult,
        memoryResult,
        gateTaskResult,
      ] = await Promise.all([
        context.supabase
          .from("company_people")
          .select("role_title, people(id, full_name, linkedin_url)")
          .eq("company_id", companyId)
          .eq("fund_id", data.fundId)
          .eq("is_founder", true),
        context.supabase
          .from("documents")
          .select("id, kind, file_name, status, created_at")
          .eq("case_id", data.caseId)
          .eq("fund_id", data.fundId)
          .order("created_at", { ascending: false }),
        context.supabase
          .from("evidence_items")
          .select(
            "id, claim, value_text, status, confidence, excerpt, observation_date, collected_at, source_id, document_id",
          )
          .eq("case_id", data.caseId)
          .eq("fund_id", data.fundId)
          .order("collected_at", { ascending: false }),
        context.supabase
          .from("analysis_runs")
          .select(CASE_RUN_COLUMNS)
          .eq("case_id", data.caseId)
          .eq("fund_id", data.fundId)
          // Every setup version; a new version leaves the earlier runs as they were.
          .order("created_at", { ascending: false })
          .limit(40),
        context.supabase
          .from("financial_data_points")
          .select("metric, value, unit, period_start, period_end")
          .eq("case_id", data.caseId)
          .eq("fund_id", data.fundId)
          .order("period_end", { ascending: true }),
        context.supabase
          .from("sources")
          .select("id, entity_match_status, title, url, source_type")
          .eq("case_id", data.caseId)
          .eq("fund_id", data.fundId),
        isFundMemoryEnabled()
          ? context.supabase
              .from("case_memory_matches")
              .select(
                "similarity, fund_memory_entries(company_name, sector, geography, stage, decision, decided_at, summary_text)",
              )
              .eq("case_id", data.caseId)
              .eq("fund_id", data.fundId)
              .order("similarity", { ascending: false })
          : Promise.resolve({ data: [] as Array<Record<string, unknown>>, error: null }),
        // The team's answers to the mandate gates, applied to the latest screening below.
        context.supabase
          .from("case_tasks")
          .select("linked_key, answer_value, answer_text, answer_evidence_id, resolved_at")
          .eq("fund_id", data.fundId)
          .eq("case_id", data.caseId)
          .eq("linked_kind", "gate")
          .eq("status", "resolved")
          .is("deleted_at", null)
          .order("resolved_at", { ascending: true }),
      ]);
      if (founderResult.error || documentResult.error || evidenceResult.error || runResult.error) {
        throw new Error(serverText("caseServer.cases.detailsNotLoaded"));
      }
      // Without them the screening shows the answers it was scored with; logged, not fatal.
      if (gateTaskResult.error) {
        console.error("[cases] gate answers", gateTaskResult.error.message);
      }
      const gateAnswersNow = gateTaskResult.error
        ? null
        : (gateTaskResult.data ?? []).flatMap((taskRow) => {
            const answer = gateAnswerFromTask(taskRow, requestLanguage());
            return answer ? [answer] : [];
          });
      // Fondens hukommelse er understøttende kontekst; en fejl her må ikke vælte casen.
      const relatedMemory = (memoryResult.error ? [] : (memoryResult.data ?? [])).map((row) => {
        const rawEntry = row["fund_memory_entries"] as unknown;
        const entry = (Array.isArray(rawEntry) ? rawEntry[0] : rawEntry) as {
          company_name: string;
          sector: string | null;
          geography: string | null;
          stage: string | null;
          decision: "invested" | "closed_without_investment";
          decided_at: string | null;
          summary_text: string;
        };
        return {
          companyName: entry.company_name,
          sector: entry.sector,
          geography: entry.geography,
          stage: entry.stage,
          decision: entry.decision,
          decidedAt: entry.decided_at,
          summary: entry.summary_text,
          similarity: Number(row["similarity"]),
        };
      });
      // Kilde-identitetsflag er en lempelig oplysning; en fejl her må ikke vælte casen.
      const entityMatchStatusBySourceId = new Map<string, string>(
        (sourceResult.error ? [] : (sourceResult.data ?? [])).map((row) => [
          row["id"] as string,
          row["entity_match_status"] as string,
        ]),
      );
      // D-7: kildens titel og adresse til kildemarkørerne ved AI-teksten.
      const sourceById = new Map<
        string,
        { title: string | null; url: string | null; type: string | null }
      >(
        (sourceResult.error ? [] : (sourceResult.data ?? [])).map((row) => [
          row["id"] as string,
          {
            title: (row["title"] as string | null) ?? null,
            url: (row["url"] as string | null) ?? null,
            type: (row["source_type"] as string | null) ?? null,
          },
        ]),
      );
      // Finansielle punkter er valgfri evidens; en fejl her må ikke vælte casen.
      const financialSeries = groupFinancialSeries(
        financialResult.error ? [] : (financialResult.data ?? []),
      );

      const runRows = runResult.data ?? [];
      const pickRun = (kind: "screening" | "deep") =>
        // En aktiv genkoersel skal vises foran et aeldre, faerdigt resultat.
        // Ellers ser brugeren gamle tal, mens casen samtidig er laast som "i gang".
        // Kun paa den aktive opsaetning: en kørsel, der hang paa en aeldre version,
        // frigives aldrig af en ny start og maa ikke skjule nyere resultater.
        runRows.find(
          (row) =>
            row["kind"] === kind &&
            row["config_version_id"] === profile.configId &&
            ["queued", "running"].includes(row["status"] as string),
        ) ??
        runRows.find(
          (row) =>
            row["kind"] === kind &&
            (kind === "screening"
              ? ["complete", "awaiting_approval"].includes(row["status"] as string)
              : row["status"] === "complete"),
        ) ??
        runRows.find(
          (row) =>
            row["kind"] === kind && row["status"] !== "failed" && row["status"] !== "cancelled",
        ) ??
        runRows.find((row) => row["kind"] === kind);

      async function hydrateRun(
        row: Record<string, unknown> | undefined | null,
        profileById: ReadonlyMap<string, RunProfile>,
      ) {
        if (!row) return null;
        const runId = row["id"] as string;
        // The run's own setup version names its criteria and gates; the active one stands
        // in only when that version could not be read.
        const runVersionId = row["config_version_id"] as string;
        const versionProfile = profileById.get(runVersionId) ?? profile;
        // The run's own stage (validation_public.setupStage) picks the gates, criteria and
        // threshold it was scored with; the case's stage only when the run has none.
        const runPublic = (row["validation_public"] ?? null) as {
          setupStage?: unknown;
          economy?: unknown;
        } | null;
        const runStage = versionProfile.forStage(
          company?.stage,
          readSetupStageChoice(runPublic?.setupStage),
        );
        const runProfile = { ...versionProfile, ...runStage };
        const [
          scoreResult,
          riskResult,
          recommendationResult,
          findingResult,
          calculationResult,
          stepResult,
          stepErrorResult,
          recalculationResult,
        ] = await Promise.all([
          context.supabase
            .from("category_scores")
            .select("category, validated_score, weight, confidence, rationale")
            .eq("run_id", runId)
            .order("category"),
          context.supabase
            .from("risks")
            .select("category, level, likelihood, impact, statement, mitigation")
            .eq("run_id", runId),
          context.supabase
            .from("recommendations")
            .select(
              "recommendation, overall_score, evidence_confidence, has_failed_gate, has_critical_risk, rationale",
            )
            .eq("run_id", runId)
            .maybeSingle(),
          context.supabase
            .from("analysis_findings")
            .select("category, finding_type, statement, confidence, nature")
            .eq("run_id", runId)
            .order("category"),
          context.supabase
            .from("calculation_results")
            .select("metric, status, value, unit, missing_inputs, warnings")
            .eq("run_id", runId)
            .order("metric"),
          context.supabase
            .from("analysis_run_steps")
            .select("step_key, step_order, status, started_at, completed_at")
            .eq("run_id", runId)
            .order("step_order")
            .order("created_at"),
          // The steps' errors only through the server (0130), for a run read above.
          getServiceClient()
            .from("analysis_run_steps")
            .select("step_key, step_order, error_message")
            .eq("fund_id", data.fundId)
            .eq("run_id", runId)
            .not("error_message", "is", null),
          row["kind"] === "screening"
            ? context.supabase
                .from("case_score_recalculations")
                .select(
                  "overall_score, outcome, failed_gate_keys, unresolved_gate_keys, created_at, recommendation:result->>recommendation",
                )
                .eq("fund_id", data.fundId)
                .eq("case_id", data.caseId)
                .eq("run_id", runId)
                .order("created_at", { ascending: false })
                .limit(1)
                .maybeSingle()
            : Promise.resolve({ data: null, error: null }),
        ]);
        // The recalculation only replaces the run's own score; without it the page shows the
        // run's score, so a failed lookup is logged and the page still loads.
        if (stepErrorResult.error) {
          console.error(`[cases] step errors (run ${runId})`, stepErrorResult.error.message);
        }
        const stepErrors = new Map(
          (stepErrorResult.error ? [] : (stepErrorResult.data ?? [])).map((stepRow) => [
            `${String(stepRow["step_key"])}:${String(stepRow["step_order"])}`,
            stepRow["error_message"] as string,
          ]),
        );
        if (recalculationResult.error) {
          console.error(`[cases] recalculation (run ${runId})`, recalculationResult.error.message);
        }
        const recalculationRow = recalculationResult.error ? null : recalculationResult.data;
        const recommendation = recommendationResult.data;
        type RawAnalysis = {
          assessments?: Array<{
            criterionKey: string;
            proposedScore?: number | null;
            verdict?: string;
            positiveDrivers?: string[];
            negativeDrivers?: string[];
            unknowns?: string[];
            citations?: Array<{ evidenceId: string; support: string }>;
          }>;
          gates?: Array<{
            gateKey: string;
            passed: boolean | null;
            confidence: number | null;
            rationale: string;
          }>;
          risks?: Array<{ riskKey?: string; label?: string; rationale?: string }>;
          overallAssessment?: string;
          contraryCase?: string;
          investmentCondition?: string | null;
          companyProfile?: unknown;
          companyLabel?: unknown;
          keyFindings?: unknown;
        };
        const rawEnvelope = (row["raw_response"] ?? null) as
          (RawAnalysis & { synthesis?: RawAnalysis }) | null;
        const raw = rawEnvelope?.synthesis ?? rawEnvelope;
        const assessedGates = new Map(
          (raw?.gates ?? []).map((gate) => [gate.gateKey, gate] as const),
        );
        // Teamets svar vises i stedet for AI'ens vurdering (G2). For screeningen gælder de svar,
        // der tæller nu (samme regel som genberegningen), så kravene følger scoren; en dyb
        // analyse viser de svar, den blev scoret med.
        const completedAt = (row["completed_at"] as string | null) ?? null;
        const teamGates = new Map(
          (row["kind"] === "screening" && completedAt && gateAnswersNow
            ? effectiveGateAnswers(gateAnswersNow, {
                completedAt,
                verdicts: new Map(
                  (raw?.gates ?? []).map((gate) => [gate.gateKey, gate.passed] as const),
                ),
                configVersionId: runVersionId,
              })
            : storedTeamGateAnswers(row["validation_public"])
          ).map((answer) => [answer.gateKey, answer]),
        );
        const assessmentByKey = new Map(
          (raw?.assessments ?? []).map(
            (assessment) => [assessment.criterionKey, assessment] as const,
          ),
        );
        const criterionByKey = new Map(
          runProfile.criteria.map((criterion) => [criterion.key, criterion]),
        );
        // C8: kriterier regnet i kode fra regnskabet er ikke en stage-prior, selv når
        // AI'en ikke selv foreslog en score.
        const financeAudit = (
          row["validation_public"] as {
            financeScore?: { anchoredCriterionKeys?: string[] } | null;
          } | null
        )?.financeScore;
        const codeAnchoredKeys = new Set(financeAudit?.anchoredCriterionKeys ?? []);
        const view: AnalysisRunView = {
          id: runId,
          kind: row["kind"] as "screening" | "deep",
          status: row["status"] as string,
          basisScreeningId:
            row["kind"] === "deep" ? ((row["previous_run_id"] as string | null) ?? null) : null,
          setupVersion: profileById.has(runVersionId) ? runProfile.configVersion : null,
          setupThreshold: runProfile.threshold,
          setupCurrent: runVersionId === profile.configId,
          setupStage: runStage.choice,
          economy: readEconomyResult(runPublic?.economy),
          inputEvidenceIds: (row["input_evidence_ids"] ?? []) as string[],
          createdAt: row["created_at"] as string,
          completedAt: (row["completed_at"] as string | null) ?? null,
          overallScore:
            recommendation?.["overall_score"] == null
              ? null
              : Number(recommendation["overall_score"]),
          recommendation: (recommendation?.["recommendation"] as string | null) ?? null,
          evidenceConfidence:
            recommendation?.["evidence_confidence"] == null
              ? null
              : Number(recommendation["evidence_confidence"]),
          hasFailedGate: Boolean(recommendation?.["has_failed_gate"]),
          hasCriticalRisk: Boolean(recommendation?.["has_critical_risk"]),
          rationale: (recommendation?.["rationale"] as string | null) ?? null,
          overallAssessment: raw?.overallAssessment?.trim() || null,
          contraryCase: raw?.contraryCase?.trim() || null,
          investmentCondition:
            typeof raw?.investmentCondition === "string"
              ? raw.investmentCondition.trim() || null
              : null,
          specialists: parseSpecialistViews(
            (rawEnvelope as { specialists?: unknown } | null)?.specialists,
          ),
          specialistSet: parseSpecialistSet(
            (rawEnvelope as { specialistSet?: unknown } | null)?.specialistSet,
          ),
          cardData: row["kind"] === "deep" ? readDeepCardData(rawEnvelope) : null,
          companyProfile: companyProfileSchema.safeParse(raw?.companyProfile).data ?? null,
          companyLabel: cleanCompanyLabel(companyLabelSchema.safeParse(raw?.companyLabel).data),
          keyFindings: (keyFindingsSchema.safeParse(raw?.keyFindings).data ?? []).filter(
            (finding) => criterionByKey.has(finding.criterionKey),
          ),
          recalculation: recalculationRow
            ? {
                score:
                  recalculationRow["overall_score"] == null
                    ? null
                    : Number(recalculationRow["overall_score"]),
                outcome: recalculationRow["outcome"] as string,
                recommendation: (recalculationRow["recommendation"] as string | null) ?? null,
                failedGateKeys: (recalculationRow["failed_gate_keys"] as string[] | null) ?? [],
                unresolvedGateKeys:
                  (recalculationRow["unresolved_gate_keys"] as string[] | null) ?? [],
                createdAt: recalculationRow["created_at"] as string,
              }
            : null,
          gates: runProfile.gates.map((gate) => {
            const assessed = assessedGates.get(gate.key);
            const team = teamGates.get(gate.key);
            return {
              key: gate.key,
              label: gate.label,
              description: gate.description,
              treatment: gate.treatment,
              passed: team ? team.passed : (assessed?.passed ?? null),
              rationale: team ? team.rationale : (assessed?.rationale ?? null),
              confidence: team ? 1 : (assessed?.confidence ?? null),
              teamAnswered: Boolean(team),
            };
          }),
          // Fondens egen rækkefølge fra opsætningen; ukendte nøgler sidst.
          scores: [...(scoreResult.data ?? [])]
            .sort(
              (a, b) =>
                criterionOrder(runProfile.criteria, a["category"] as string) -
                criterionOrder(runProfile.criteria, b["category"] as string),
            )
            .map((scoreRow) => {
              const criterionKey = scoreRow["category"] as string;
              const criterion = criterionByKey.get(criterionKey);
              return {
                criterionKey,
                category: criterion?.category ?? criterionKey,
                label: criterion?.label ?? criterionKey,
                description: criterion?.description ?? "",
                score:
                  scoreRow["validated_score"] == null ? null : Number(scoreRow["validated_score"]),
                weight: Number(scoreRow["weight"]),
                confidence: scoreRow["confidence"] == null ? null : Number(scoreRow["confidence"]),
                verdict: assessmentByKey.get(criterionKey)?.verdict ?? null,
                rationale: scoreRow["rationale"] as string,
                positiveDrivers: assessmentByKey.get(criterionKey)?.positiveDrivers ?? [],
                negativeDrivers: assessmentByKey.get(criterionKey)?.negativeDrivers ?? [],
                unknowns: assessmentByKey.get(criterionKey)?.unknowns ?? [],
                evidenceIds: (assessmentByKey.get(criterionKey)?.citations ?? []).map(
                  (citation) => citation.evidenceId,
                ),
                isStagePrior:
                  !codeAnchoredKeys.has(criterionKey) &&
                  assessmentByKey.get(criterionKey)?.proposedScore == null,
              };
            }),
          risks: (riskResult.data ?? []).map((riskRow) => ({
            category: riskRow["category"] as string,
            // D-12: modellens korte danske titel (gemmes kun i det rå svar).
            // Begrundelsen gemmes ordret som statement, så den matcher entydigt; nøglen er fri tekst.
            label:
              (
                (raw?.risks ?? []).find((risk) => risk.rationale === riskRow["statement"]) ??
                (raw?.risks ?? []).find((risk) => risk.riskKey === riskRow["category"])
              )?.label?.trim() || null,
            level: riskRow["level"] as string,
            likelihood: riskRow["likelihood"] == null ? null : Number(riskRow["likelihood"]),
            impact: riskRow["impact"] == null ? null : Number(riskRow["impact"]),
            statement: riskRow["statement"] as string,
            mitigation: riskRow["mitigation"] as string | null,
          })),
          findings: (findingResult.data ?? []).map((findingRow) => ({
            category: findingRow["category"] as string,
            findingType: findingRow["finding_type"] as string,
            statement: findingRow["statement"] as string,
            confidence: findingRow["confidence"] == null ? null : Number(findingRow["confidence"]),
            nature: findingRow["nature"] as string,
          })),
          calculations: (calculationResult.data ?? []).map((calcRow) => ({
            metric: calcRow["metric"] as string,
            status: calcRow["status"] as string,
            value: calcRow["value"] == null ? null : Number(calcRow["value"]),
            unit: calcRow["unit"] as string | null,
            missingInputs: (calcRow["missing_inputs"] ?? []) as string[],
            warnings: (calcRow["warnings"] ?? []) as string[],
          })),
          steps: (stepResult.error ? [] : (stepResult.data ?? [])).map((stepRow) => ({
            key: stepRow["step_key"] as string,
            order: Number(stepRow["step_order"]),
            status: stepRow["status"] as string,
            // Only Interlect's own sentence leaves the server, for every role.
            errorMessage: publicRunError(
              stepErrors.get(`${String(stepRow["step_key"])}:${String(stepRow["step_order"])}`),
              requestLanguage(),
            ),
            startedAt: (stepRow["started_at"] as string | null) ?? null,
            completedAt: (stepRow["completed_at"] as string | null) ?? null,
          })),
        };
        return view;
      }

      const pickedScreeningRow = pickRun("screening");
      const pickedDeepRow = pickRun("deep");
      const lastCompleteDeepRow = runRows.find(
        (row) => row["kind"] === "deep" && row["status"] === "complete",
      );
      // The screening each shown deep run was built on, when a newer screening has come
      // since (else it is latestScreening). By id, also when it is outside the newest runs or was
      // made on another setup version. Decoration: if it cannot be read, the page still loads and
      // the change since screening is not shown (as before).
      const basisIds = [
        ...new Set(
          [pickedDeepRow, lastCompleteDeepRow]
            .map((row) => (row?.["previous_run_id"] as string | null | undefined) ?? null)
            .filter((id): id is string => id !== null && id !== pickedScreeningRow?.["id"]),
        ),
      ];
      const missingBasisIds = basisIds.filter((id) => !runRows.some((row) => row["id"] === id));
      const extraBasis = missingBasisIds.length
        ? await context.supabase
            .from("analysis_runs")
            .select(CASE_RUN_COLUMNS)
            .eq("case_id", data.caseId)
            .eq("fund_id", data.fundId)
            .eq("kind", "screening")
            .in("id", missingBasisIds)
        : { data: [], error: null };
      if (extraBasis.error) {
        console.error(`[cases] basis screening (case ${data.caseId})`, extraBasis.error.message);
      }
      const basisRows = basisIds
        .map((id) =>
          [...runRows, ...(extraBasis.error ? [] : (extraBasis.data ?? []))].find(
            (row) => row["id"] === id && row["kind"] === "screening",
          ),
        )
        .filter((row): row is (typeof runRows)[number] => row !== undefined);
      // The setup versions the shown runs were made with, other than the active one.
      // Decoration: if they cannot be read, the run is shown with the active version's names.
      const profileById = new Map<string, RunProfile>([[profile.configId, profile]]);
      const olderVersionIds = [
        ...new Set(
          [pickedScreeningRow, pickedDeepRow, lastCompleteDeepRow, ...basisRows]
            .map((row) => (row?.["config_version_id"] as string | undefined) ?? null)
            .filter((id): id is string => id !== null && id !== profile.configId),
        ),
      ];
      if (olderVersionIds.length) {
        const older = await context.supabase
          .from("fund_config_versions")
          .select(CONFIG_PROFILE_COLUMNS)
          .eq("fund_id", data.fundId)
          .in("id", olderVersionIds);
        if (older.error) {
          console.error(`[cases] older setup (case ${data.caseId})`, older.error.message);
        }
        for (const versionRow of older.error ? [] : (older.data ?? [])) {
          const versionProfile = configProfile(versionRow as Record<string, unknown>);
          profileById.set(versionProfile.configId, versionProfile);
        }
      }
      const [latestScreening, latestDeepAnalysis, lastCompleteDeepAnalysis, ...basisScreenings] =
        await Promise.all([
          hydrateRun(pickedScreeningRow, profileById),
          hydrateRun(pickedDeepRow, profileById),
          pickedDeepRow?.["id"] === lastCompleteDeepRow?.["id"]
            ? Promise.resolve(null)
            : hydrateRun(lastCompleteDeepRow, profileById),
          ...basisRows.map((row) => hydrateRun(row, profileById)),
        ]);
      // Komité-visningen skal fortsætte med at vise sidste FÆRDIGE dybe analyse
      // under en igangværende genkørsel -- ikke pludselig tomme tal midt i mødet.
      const committeeDeepAnalysis =
        lastCompleteDeepAnalysis ??
        (latestDeepAnalysis?.status === "complete" ? latestDeepAnalysis : null);
      const latestRow = runRows[0];
      const latestAnalysis =
        latestRow == null
          ? null
          : latestRow["kind"] === "deep"
            ? latestDeepAnalysis
            : latestScreening;
      const runErrors = await storedRunErrors(
        data.fundId,
        data.caseId,
        runRows.map((row) => row["id"] as string),
      );
      const analysisHistory = runRows.map((row) => ({
        id: row["id"] as string,
        kind: row["kind"] as string,
        status: row["status"] as string,
        createdAt: row["created_at"] as string,
        completedAt: (row["completed_at"] as string | null) ?? null,
        // Only Interlect's own sentence leaves the server, for every role.
        errorMessage: publicRunError(runErrors.get(row["id"] as string), requestLanguage()),
        // "Stoppet på prisgrænsen", shown without an amount.
        stoppedAtLimit: row["stop_reason"] === "price_limit",
      }));

      return {
        id: caseRow["id"] as string,
        thesisRef: profile.thesisRef,
        fundId: caseRow["fund_id"] as string,
        companyId,
        companyName: company?.name ?? "Ukendt selskab",
        website: company?.website ?? null,
        description: company?.description ?? null,
        stage: company?.stage ?? "unknown",
        sector: company?.sector ?? null,
        geography: company?.geography ?? null,
        primaryOrigin: caseRow["primary_origin"] as CaseDetail["primaryOrigin"],
        executionStatus: latestRow
          ? profileRunExecutionStatus(latestRow["kind"] as string, latestRow["status"] as string)
          : "needs_information",
        processStage: caseRow["process_stage"] as string,
        workspaceStatus: caseRow["workspace_status"] as CaseWorkspaceStatus,
        workspaceReason: (caseRow["workspace_reason"] as string | null) ?? null,
        phase: caseRow["phase"] as CasePhase,
        status: caseRow["status"] as CaseStatus,
        lastActionAt: caseRow["last_action_at"] as string,
        recommendation: latestAnalysis?.recommendation ?? null,
        sourceNote: caseRow["source_note"] as string,
        updatedAt: caseRow["updated_at"] as string,
        analysisProfile: {
          key: profile.profileKey,
          name: profile.fundName,
          version: profile.configVersion,
          threshold: profile.threshold,
          approvalMode: profile.approvalMode,
          thesis: profile.thesis,
        },
        identity: {
          cvrNumber: company?.cvr_number ?? null,
          registryCountry: company?.registry_country ?? null,
          registryNumber: company?.registry_number ?? null,
          legalName: company?.legal_name ?? null,
          status: company?.identity_status ?? "unverified",
          confidence:
            company?.identity_confidence == null ? null : Number(company.identity_confidence),
          signals: company?.identity_signals?.signals ?? [],
          confirmedByHuman: Boolean(company?.identity_confirmed_by),
          assessed: Boolean(company?.identity_signals?.assessedAt),
          confirmedAt: company?.identity_confirmed_at ?? null,
          hqCountry: company?.hq_country ?? null,
          domains: company?.domains ?? [],
        },
        founders: (founderResult.data ?? []).map((row) => {
          const rawPerson = row["people"] as unknown;
          const person = (Array.isArray(rawPerson) ? rawPerson[0] : rawPerson) as {
            id: string;
            full_name: string;
            linkedin_url: string | null;
          };
          return {
            id: person.id,
            name: person.full_name,
            role: row["role_title"] as string,
            linkedinUrl: person.linkedin_url,
          };
        }),
        documents: (documentResult.data ?? []).map((row) => ({
          id: row["id"] as string,
          kind: row["kind"] as string,
          fileName: row["file_name"] as string,
          status: row["status"] as string,
          createdAt: row["created_at"] as string,
        })),
        evidence: (evidenceResult.data ?? []).map((row) => ({
          id: row["id"] as string,
          claim: row["claim"] as string,
          valueText: row["value_text"] as string | null,
          status: row["status"] as string,
          confidence: row["confidence"] == null ? null : Number(row["confidence"]),
          excerpt: row["excerpt"] as string | null,
          observationDate: row["observation_date"] as string | null,
          collectedAt: row["collected_at"] as string,
          sourceId: (row["source_id"] as string | null) ?? null,
          documentId: (row["document_id"] as string | null) ?? null,
          sourceTitle: row["source_id"]
            ? (sourceById.get(row["source_id"] as string)?.title ?? null)
            : null,
          sourceUrl: row["source_id"]
            ? (sourceById.get(row["source_id"] as string)?.url ?? null)
            : null,
          sourceType: row["source_id"]
            ? (sourceById.get(row["source_id"] as string)?.type ?? null)
            : null,
          entityMatchStatus: row["source_id"]
            ? (entityMatchStatusBySourceId.get(row["source_id"] as string) ?? null)
            : null,
        })),
        latestScreening,
        latestDeepAnalysis,
        committeeDeepAnalysis,
        basisScreenings: basisScreenings.filter((run): run is AnalysisRunView => run !== null),
        analysisHistory,
        latestAnalysis,
        financialSeries,
        relatedMemory,
      };
    }),
  );

export const listCases = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        fundId: fundIdSchema,
        /** One thesis's cases (also an archived one); without it, every active thesis. */
        thesisId: z.guid().optional(),
      })
      .parse(input),
  )
  .handler(
    withDemoView(async ({ data, context }): Promise<CaseListItem[]> => {
      const profile = await resolveFund(context.supabase, context.userId, data.fundId, {
        thesisId: data.thesisId,
      });
      // The database builds the list in one call (0112), so 2,000 cases are not 33 MB of
      // analysis output, every id in the address or PostgREST's silent cut at 1,000 rows.
      const { data: payload, error } = await context.supabase.rpc("case_list_payload", {
        _fund_id: data.fundId,
        _config_version_id: profile.configId,
        _thesis_id: data.thesisId ?? null,
      });
      if (error || !isCaseListPayload(payload)) {
        console.error(`[cases] list (fund ${data.fundId})`, error?.message ?? "unexpected payload");
        throw new Error(serverText("caseServer.common.casesNotLoaded"));
      }
      // Each case is shown with its own thesis's active setup (threshold, criteria, gates).
      const profiles = new Map<string, CaseListProfile>([[profile.configId, profile]]);
      const otherConfigIds = [
        ...new Set(
          payload.cases
            .map((row) => row.active_config_id ?? null)
            .filter((id): id is string => id !== null && id !== profile.configId),
        ),
      ];
      if (otherConfigIds.length) {
        const others = await context.supabase
          .from("fund_config_versions")
          .select(CONFIG_PROFILE_COLUMNS)
          .eq("fund_id", data.fundId)
          .in("id", otherConfigIds);
        if (others.error) {
          console.error(`[cases] list setups (fund ${data.fundId})`, others.error.message);
          throw new Error(serverText("caseServer.common.casesNotLoaded"));
        }
        for (const row of others.data ?? []) {
          const other = configProfile(row as Record<string, unknown>);
          profiles.set(other.configId, other);
        }
      }
      return buildCaseList(payload, profile, profiles);
    }),
  );

export const createManualCase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => createCaseSchema.parse(input))
  .handler(async ({ data, context }) => {
    await requireFundCapability(context.supabase, context.userId, data.fundId, "create_case");
    // The case belongs to the chosen thesis (else the team's default); only an active one.
    const thesis = await chosenThesis(context.supabase, data.fundId, data.thesisId);
    if (!thesis) throw new Error(serverText("thesisServer.noActiveThesis"));
    if (thesis.status !== "active") throw new Error(serverText("thesisServer.notSelectable"));
    // P1: Vækst og Buyout kan kun bruges af fonde, der har dem i deres stadieliste.
    if (data.stage === "growth" || data.stage === "buyout") {
      const { data: mandate } = await context.supabase
        .from("fund_config_versions")
        .select("fund_mandates(stages)")
        .eq("fund_id", data.fundId)
        .eq("thesis_id", thesis.id)
        .eq("status", "active")
        .maybeSingle();
      const raw = mandate?.["fund_mandates"] as unknown;
      const stages =
        ((Array.isArray(raw) ? raw[0] : raw) as { stages: string[] } | null)?.stages ?? [];
      if (!fundAllowsStage(stages, data.stage)) {
        throw new Error(serverText("caseServer.cases.stageNotUsed"));
      }
    }
    const { data: caseId, error } = await context.supabase.rpc("create_manual_case_for_fund", {
      _fund_id: data.fundId,
      _company_name: data.companyName,
      _website: data.website,
      _stage: data.stage,
      _sector: data.sector,
      _geography: data.geography,
      _source_note: data.sourceNote,
      _founders: data.founders,
      _thesis_id: thesis.id,
    });
    if (error || !caseId) {
      // P0001 = et bevidst `raise exception` fra selve RPC'en (allerede en
      // forståelig dansk besked) -- alt andet er en uventet databasefejl,
      // som ikke må lække rå driver-tekst til brugeren.
      if (error?.code === "P0001") throw new Error(error.message);
      console.error("[create_manual_case_for_fund]", error);
      throw new Error(serverText("caseServer.cases.notCreated"));
    }
    const claimedFacts = [
      { claim: "Virksomhedens navn ved intake", value_text: data.companyName },
      data.website ? { claim: "Virksomhedens website", value_text: data.website } : null,
      data.stage !== "unknown" ? { claim: "Virksomhedens stadie", value_text: data.stage } : null,
      data.sector ? { claim: "Virksomhedens sektor", value_text: data.sector } : null,
      data.geography ? { claim: "Virksomhedens geografi", value_text: data.geography } : null,
      data.sourceNote ? { claim: "Kildenote ved intake", value_text: data.sourceNote } : null,
      data.intakeText
        ? {
            claim: intakeTextLabel(data.intakeTextSource),
            excerpt: data.intakeText,
            stated_by: intakeTextStatedBy(data.intakeTextSource),
          }
        : null,
    ]
      .filter(Boolean)
      .map((fact) => ({
        ...fact,
        fund_id: data.fundId,
        case_id: String(caseId),
        status: "company_stated",
        created_by: context.userId,
      }));
    if (claimedFacts.length) {
      const { error: evidenceError } = await context.supabase
        .from("evidence_items")
        .insert(claimedFacts);
      if (evidenceError) {
        // The case exists: never throw (a retry would look like a duplicate); warn instead.
        console.error("[createManualCase] evidence", evidenceError.code, evidenceError.message);
        return {
          caseId: String(caseId),
          fundId: data.fundId,
          warning: serverText("caseServer.cases.factsNotSaved"),
        };
      }
    }
    return { caseId: String(caseId), fundId: data.fundId, warning: null as string | null };
  });

const registerDeckSchema = z.object({
  caseId: z.guid(),
  fileName: z.string().trim().min(1).max(240),
  storagePath: z.string().trim().min(1).max(1000),
  mimeType: z.enum([
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ]),
  sizeBytes: z.number().int().positive().max(52_428_800),
});

export const registerPitchDeck = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => registerDeckSchema.parse(input))
  .handler(async ({ data, context }) => {
    // The database checks the fund and case folders; `..` and friends must not slip past them.
    if (!isSafeStoragePath(data.storagePath)) {
      throw new Error(serverText("caseServer.files.notInFolder"));
    }
    const { data: documentId, error } = await context.supabase.rpc("register_pitch_deck", {
      _case_id: data.caseId,
      _file_name: data.fileName,
      _storage_path: data.storagePath,
      _mime_type: data.mimeType,
      _size_bytes: data.sizeBytes,
    });
    if (error || !documentId) {
      if (error?.code === "P0001") throw new Error(error.message);
      console.error("[register_pitch_deck]", error);
      throw new Error(serverText("caseServer.cases.deckNotRegistered"));
    }
    return { documentId: String(documentId) };
  });

export const extractPitchDeck = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ caseId: z.guid(), documentId: z.guid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: document, error } = await context.supabase
      .from("documents")
      .select("id, fund_id, case_id, storage_path, mime_type, file_removed_at")
      .eq("id", data.documentId)
      .eq("case_id", data.caseId)
      .single();
    if (error || !document) throw new Error(serverText("caseServer.cases.deckNotFound"));
    if (document["file_removed_at"]) throw new Error(serverText("caseServer.files.removedForget"));
    await requireFundCapability(
      context.supabase,
      context.userId,
      document["fund_id"] as string,
      "upload_document",
    );
    // Read with the service key, so the path must lie in this case's own folder.
    if (
      !isStoragePathIn(
        document["storage_path"] as string,
        `${document["fund_id"] as string}/${document["case_id"] as string}`,
      )
    ) {
      throw new Error(serverText("caseServer.cases.deckNotFound"));
    }

    const service = getServiceClient();
    const { error: extractingError } = await service
      .from("documents")
      .update({ status: "extracting" })
      .eq("id", data.documentId);
    if (extractingError) console.error("[extractPitchDeck] extracting", extractingError.message);
    try {
      const { data: file, error: downloadError } = await service.storage
        .from("pitch-decks")
        .download(document["storage_path"] as string);
      if (downloadError || !file) throw new Error(serverText("caseServer.cases.pdfNotRead"));
      const bytes = new Uint8Array(await file.arrayBuffer());
      const mimeType = document["mime_type"] as string;
      const extracted =
        mimeType === "application/pdf"
          ? await extractPdfPages(bytes)
          : await extractPptxSlides(bytes);
      const pages = extracted.pages;

      // Kun deckets egne siderækker erstattes. Teamets svar kan være knyttet til samme fil
      // (answerCaseTask) og må ikke forsvinde ved et nyt udtræk (harden).
      const { error: clearError } = await service
        .from("evidence_items")
        .delete()
        .eq("document_id", data.documentId)
        .not("slide_ref", "is", null);
      if (clearError) {
        console.error("[extractPitchDeck] clear pages", clearError.message);
        throw new Error(serverText("caseServer.cases.oldPagesNotReplaced"));
      }
      if (pages.length) {
        const { error: insertError } = await service.from("evidence_items").insert(
          pages.map((page) => ({
            fund_id: document["fund_id"],
            case_id: data.caseId,
            document_id: data.documentId,
            claim: `Pitch deck, side ${page.page}`,
            slide_ref: page.page,
            excerpt: clipCodePoints(page.text, 6000),
            status: "company_stated",
            confidence: 1,
            stated_by: "Virksomhedens pitch deck",
            created_by: context.userId,
          })),
        );
        if (insertError) {
          console.error("[extractPitchDeck] pages", insertError.message);
          throw new Error(serverText("caseServer.cases.pagesNotSaved"));
        }
      }
      const [{ error: documentError }, { error: deckError }] = await Promise.all([
        service
          .from("documents")
          .update({
            status: "ready",
            // Filer-fanens søgning (0035) læser teksten herfra.
            extracted_text: clipCodePoints(pages.map((page) => page.text).join("\n\n"), 200_000),
            updated_at: new Date().toISOString(),
          })
          .eq("id", data.documentId),
        service
          .from("pitch_decks")
          .update({
            page_count: extracted.totalPages,
            extracted_at: new Date().toISOString(),
            extraction_error: null,
          })
          .eq("document_id", data.documentId),
      ]);
      if (documentError || deckError) {
        console.error("[extractPitchDeck] save", documentError?.message ?? deckError?.message);
        throw new Error(serverText("caseServer.cases.textNotSaved"));
      }
      await enqueueBrainCapture(document.fund_id as string, data.caseId);
      return { pageCount: extracted.totalPages, evidenceCount: pages.length };
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : serverText("caseServer.cases.pdfExtractFailed");
      const marks = await Promise.all([
        service
          .from("documents")
          .update({ status: "failed", updated_at: new Date().toISOString() })
          .eq("id", data.documentId),
        service
          .from("pitch_decks")
          .update({ extraction_error: message })
          .eq("document_id", data.documentId),
      ]);
      for (const { error: markError } of marks) {
        if (markError) console.error("[extractPitchDeck] mark failed", markError.message);
      }
      throw new Error(message);
    }
  });

/** The intake text's evidence label and who stated it, in the fund's language (stored with the case). */
const intakeTextLabel = (source: keyof typeof INTAKE_TEXT_SOURCES) =>
  serverText(`caseServer.intakeLabels.${source}`);
const intakeTextStatedBy = (source: keyof typeof INTAKE_TEXT_SOURCES) =>
  serverText(`caseServer.intakeStatedBy.${source}`);

const INTAKE_TEXT_SOURCES = {
  founder_email: true,
  warm_intro: true,
  meeting_notes: true,
  analyst_note: true,
} as const;

export interface PitchDeckListItem {
  documentId: string;
  caseId: string;
  companyName: string;
  fileName: string;
  status: string;
  sizeBytes: number;
  createdAt: string;
}

export const listPitchDecks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ fundId: fundIdSchema }).parse(input))
  .handler(
    withDemoView(async ({ data, context }): Promise<PitchDeckListItem[]> => {
      await resolveFund(context.supabase, context.userId, data.fundId);
      const { data: rows, error } = await context.supabase
        .from("documents")
        .select("id, case_id, file_name, status, size_bytes, created_at, cases(companies(name))")
        .eq("kind", "pitch_deck")
        .eq("fund_id", data.fundId)
        .order("created_at", { ascending: false });
      if (error) throw new Error(serverText("caseServer.cases.decksNotLoaded"));
      return (rows ?? []).map((row) => {
        const rawCase = row["cases"] as unknown;
        const caseRow = (Array.isArray(rawCase) ? rawCase[0] : rawCase) as {
          companies: { name: string } | { name: string }[];
        } | null;
        const rawCompany = caseRow?.companies;
        const company = (Array.isArray(rawCompany) ? rawCompany[0] : rawCompany) as
          { name: string } | undefined;
        return {
          documentId: row["id"] as string,
          caseId: row["case_id"] as string,
          companyName: company?.name ?? "Ukendt selskab",
          fileName: row["file_name"] as string,
          status: row["status"] as string,
          sizeBytes: Number(row["size_bytes"]),
          createdAt: row["created_at"] as string,
        };
      });
    }),
  );

export const listCaseNotes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ fundId: fundIdSchema, caseId: z.guid() }).parse(input))
  .handler(
    withDemoView(async ({ data, context }): Promise<CaseNote[]> => {
      await requireFundCapability(context.supabase, context.userId, data.fundId, "view_case");

      const { data: rows, error } = await context.supabase
        .from("case_notes")
        .select("id, body, created_at, author_id")
        .eq("case_id", data.caseId)
        .eq("fund_id", data.fundId)
        .order("created_at", { ascending: false });
      if (error) throw new Error(serverText("caseServer.cases.notesNotLoaded"));

      // author_id peger på auth.users, ikke public.profiles, så PostgREST kan
      // ikke embedde et join automatisk (samme grund som i access.functions.ts
      // sin listMembers) — profiler slås derfor op separat og merges her.
      const authorIds = [...new Set((rows ?? []).map((row) => row["author_id"] as string))];
      const profileByAuthorId = new Map<string, string | null>();
      if (authorIds.length > 0) {
        const { data: profiles } = await context.supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", authorIds);
        for (const profile of (profiles ?? []) as Array<{ id: string; full_name: string | null }>) {
          profileByAuthorId.set(profile.id, profile.full_name);
        }
      }

      return (rows ?? []).map((row) => ({
        id: row["id"] as string,
        body: row["body"] as string,
        createdAt: row["created_at"] as string,
        authorId: row["author_id"] as string,
        authorName: profileByAuthorId.get(row["author_id"] as string) ?? null,
      }));
    }),
  );

export const addCaseNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => addCaseNoteInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await requireFundCapability(context.supabase, context.userId, data.fundId, "write_notes");

    const { error } = await context.supabase.from("case_notes").insert({
      fund_id: data.fundId,
      case_id: data.caseId,
      author_id: context.userId,
      body: data.body,
    });
    if (error) throw new Error(serverText("caseServer.cases.noteNotSaved"));
    await enqueueBrainCapture(data.fundId, data.caseId);

    return { ok: true };
  });
