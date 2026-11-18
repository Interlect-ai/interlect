/**
 * Cases-listen: the list's data comes from one database call, `case_list_payload` (0112),
 * and becomes the rows the list, Overblik and the chart catalogue show here. Pure, so the capacity
 * test (scripts/capacity/run.mjs) can measure the answer the browser gets at 2,000 cases.
 */
import { storedTeamGateAnswers } from "../analysis/gate-answers.ts";
import { stagePriorScore } from "../analysis/scoring.ts";
import { gateMarks } from "./gate-marks.ts";
import type { CaseListItem, ListCriterionScore } from "@/lib/cases/cases.functions";
import type { CasePhase, CaseStatus } from "@/lib/cases/lifecycle";
import type { CaseWorkspaceStatus } from "@/lib/domain/types";

const processStageOrder = [
  "new_case",
  "initial_screening",
  "preliminary_analysis",
  "partner_review",
  "ready_for_contact",
  "contacted",
  "first_meeting",
  "further_evaluation",
  "due_diligence",
  "investment_memo",
  "investment_committee",
] as const;

function phaseIndexFor(processStage: string): number {
  const index = processStageOrder.indexOf(processStage as (typeof processStageOrder)[number]);
  if (index === -1) return processStage === "invested" ? 5 : 1;
  if (index <= 1) return index + 1;
  if (index <= 3) return 3;
  if (index <= 7) return 4;
  return 5;
}

export function criterionOrder(criteria: Array<{ key: string }>, key: string): number {
  const index = criteria.findIndex((criterion) => criterion.key === key);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

/** One case in `case_list_payload`: only what the list shows. */
export interface CaseListPayloadCase {
  id: string;
  primary_origin: CaseListItem["primaryOrigin"];
  process_stage: string;
  workspace_status: CaseWorkspaceStatus;
  workspace_reason: string | null;
  phase: CasePhase;
  status: CaseStatus;
  last_action_at: string;
  updated_at: string;
  assignee_id: string | null;
  company_name: string | null;
  website: string | null;
  stage: string | null;
  sector: string | null;
  geography: string | null;
  latest_run_id: string | null;
  screening_run_id: string | null;
  deep_run_id: string | null;
  /** The latest finished screening's gates, only gateKey and passed. */
  screening_gates: Array<{ gateKey?: unknown; passed?: unknown }> | null;
  screening_team_gate_answers: unknown;
  top_risk_level: string | null;
  source_count: number;
  open_tasks: number;
}

/**
 * A run of the fund, newest first: kind, status, its setup version (every version since 0122) and
 * the recommendation's numbers.
 */
export interface CaseListPayloadRun {
  id: string;
  case_id: string;
  kind: string;
  status: string;
  previous_run_id: string | null;
  config_version_id?: string | null;
  setup_version?: number | null;
  recommendation: string | null;
  overall_score: number | null;
  evidence_confidence: number | null;
}

export interface CaseListPayload {
  cases: CaseListPayloadCase[];
  runs: CaseListPayloadRun[];
  scores: Array<{
    run_id: string;
    category: string;
    /** The criterion's name in the run's own setup version (0122). */
    label?: string | null;
    validated_score: number | null;
    weight: number | null;
  }>;
  trust: Array<{
    run_id: string;
    verified: number | null;
    corroborated: number | null;
    company_stated: number | null;
    contradictory: number | null;
    unknown: number | null;
  }>;
  recalcs: Array<{
    run_id: string;
    overall_score: number | null;
    failed_gate_keys: string[] | null;
  }>;
  steps: Array<{ run_id: string; step_key: string; status: string }>;
  assignees: Array<{ id: string; full_name: string | null }>;
}

const CASE_LIST_PAYLOAD_KEYS = [
  "cases",
  "runs",
  "scores",
  "trust",
  "recalcs",
  "steps",
  "assignees",
] as const satisfies ReadonlyArray<keyof CaseListPayload>;

export function isCaseListPayload(value: unknown): value is CaseListPayload {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return CASE_LIST_PAYLOAD_KEYS.every((key) => Array.isArray(record[key]));
}

function payloadRunScore(run: CaseListPayloadRun): number | null {
  return run.overall_score == null ? null : Number(run.overall_score);
}

export function profileRunExecutionStatus(kind: string, status: string): string {
  if (status === "awaiting_approval") return "awaiting_approval";
  if (status === "failed") return "failed";
  if (status === "cancelled") return "cancelled";
  if (status === "running")
    return kind === "deep" ? "deep_analysis_in_progress" : "screening_in_progress";
  if (status === "queued") return kind === "deep" ? "deep_analysis_in_progress" : "queued";
  if (status === "complete") return kind === "deep" ? "complete" : "screening_complete";
  return "queued";
}

/** What the list needs from the active profile (resolveFund in cases.functions.ts). */
export interface CaseListProfile {
  /** The active setup version; a screening made with another one is marked. */
  configId?: string;
  threshold: number | null;
  gates: Array<{ key: string; treatment: "hard" | "review" }>;
  criteria: Array<{ key: string; label: string; category: string; weight: number }>;
}

/** The list's rows from the payload; runs come newest first, as the database sends them. */
export function buildCaseList(payload: CaseListPayload, profile: CaseListProfile): CaseListItem[] {
  const runById = new Map(payload.runs.map((run) => [run.id, run]));
  // Kørslerne kommer nyeste først; historikken vendes til kronologisk orden.
  const fitHistoryByCase = new Map<string, number[]>();
  for (const run of payload.runs) {
    // The history compares scores under the active setup; older versions' runs stay out.
    if (
      profile.configId !== undefined &&
      run.config_version_id != null &&
      run.config_version_id !== profile.configId
    ) {
      continue;
    }
    const score = payloadRunScore(run);
    if (score === null || !Number.isFinite(score)) continue;
    const history = fitHistoryByCase.get(run.case_id) ?? [];
    history.unshift(score);
    fitHistoryByCase.set(run.case_id, history);
  }
  // The server's own rule in approveAndRunDeepAnalysis: a screening goes to deep analysis once.
  const screeningsSentToDeep = new Set(
    payload.runs.flatMap((run) =>
      run.kind === "deep" &&
      run.previous_run_id &&
      ["queued", "running", "complete"].includes(run.status)
        ? [run.previous_run_id]
        : [],
    ),
  );
  const recalcByRun = new Map(
    payload.recalcs.map((recalcRow) => [
      recalcRow.run_id,
      {
        score: recalcRow.overall_score == null ? null : Number(recalcRow.overall_score),
        failedGates: recalcRow.failed_gate_keys ?? [],
      },
    ]),
  );
  const nameById = new Map(
    payload.assignees.map((profileRow) => [profileRow.id, profileRow.full_name ?? null]),
  );
  const criterionByKey = new Map(profile.criteria.map((criterion) => [criterion.key, criterion]));
  const scoresByRun = new Map<string, ListCriterionScore[]>();
  for (const scoreRow of payload.scores) {
    const runId = scoreRow.run_id;
    const list = scoresByRun.get(runId) ?? [];
    const criterionKey = scoreRow.category;
    list.push({
      criterionKey,
      label: scoreRow.label ?? criterionByKey.get(criterionKey)?.label ?? criterionKey,
      category: criterionByKey.get(criterionKey)?.category ?? criterionKey,
      score: scoreRow.validated_score == null ? null : Number(scoreRow.validated_score),
      weight: Number(scoreRow.weight ?? criterionByKey.get(criterionKey)?.weight ?? 0),
    });
    scoresByRun.set(runId, list);
  }
  for (const list of scoresByRun.values()) {
    list.sort(
      (a, b) =>
        criterionOrder(profile.criteria, a.criterionKey) -
        criterionOrder(profile.criteria, b.criterionKey),
    );
  }
  const progressByRun = new Map<
    string,
    { activeStepKey: string | null; completed: number; total: number }
  >();
  for (const stepRow of payload.steps) {
    const runId = stepRow.run_id;
    const current = progressByRun.get(runId) ?? {
      activeStepKey: null,
      completed: 0,
      total: 0,
    };
    const status = stepRow.status;
    current.total += 1;
    if (
      status === "complete" ||
      status === "skipped" ||
      (stepRow.step_key === "cvr_financials" && status === "failed")
    ) {
      current.completed += 1;
    }
    if (status === "running") current.activeStepKey = stepRow.step_key;
    if (!current.activeStepKey && status === "queued") {
      current.activeStepKey = stepRow.step_key;
    }
    progressByRun.set(runId, current);
  }

  return payload.cases.map((row) => {
    const latestRun = row.latest_run_id ? runById.get(row.latest_run_id) : undefined;
    const profileRun = latestRun
      ? {
          id: latestRun.id,
          kind: latestRun.kind,
          status: latestRun.status,
          recommendation: latestRun.recommendation ?? null,
          score: payloadRunScore(latestRun),
          evidenceConfidence:
            latestRun.evidence_confidence == null ? null : Number(latestRun.evidence_confidence),
        }
      : undefined;
    const activeProgress = profileRun ? progressByRun.get(profileRun.id) : null;
    const fitHistory = fitHistoryByCase.get(row.id) ?? [];
    const deepRunId = row.deep_run_id ?? null;
    const screeningRunId = row.screening_run_id ?? null;
    const screeningRun = screeningRunId ? runById.get(screeningRunId) : undefined;
    // The shown screening was made with an older setup version (shown with its version).
    const olderSetup =
      profile.configId !== undefined &&
      screeningRun?.config_version_id != null &&
      screeningRun.config_version_id !== profile.configId;
    // Teamets svar, som kørslen blev scoret med, lægges ovenpå AI'ens vurdering (G2).
    const teamGates = new Map(
      storedTeamGateAnswers({ teamGateAnswers: row.screening_team_gate_answers }).map((answer) => [
        answer.gateKey,
        answer.passed,
      ]),
    );
    const gates = (Array.isArray(row.screening_gates) ? row.screening_gates : []).map(
      (gate): { gateKey?: string; passed: boolean | null } => {
        const passed = typeof gate?.passed === "boolean" ? gate.passed : null;
        if (typeof gate?.gateKey !== "string") return { passed };
        const gateKey = gate.gateKey;
        return {
          gateKey,
          passed: teamGates.has(gateKey) ? (teamGates.get(gateKey) ?? null) : passed,
        };
      },
    );
    const recalc = screeningRunId ? recalcByRun.get(screeningRunId) : undefined;
    const assigneeId = row.assignee_id ?? null;
    const storedDeepScores = deepRunId ? (scoresByRun.get(deepRunId) ?? []) : [];
    const deepScores = storedDeepScores.map((score) => ({
      ...score,
      score: score.score ?? stagePriorScore(row.stage),
    }));
    const derivedDeepScore =
      deepScores.length === 0
        ? null
        : Math.round(
            deepScores.reduce((sum, score) => sum + ((score.score ?? 0) * score.weight) / 100, 0) *
              10,
          ) / 10;
    return {
      id: row.id,
      companyName: row.company_name ?? "Ukendt selskab",
      website: row.website ?? null,
      stage: row.stage ?? "unknown",
      sector: row.sector ?? null,
      geography: row.geography ?? null,
      primaryOrigin: row.primary_origin,
      executionStatus: profileRun
        ? profileRunExecutionStatus(profileRun.kind, profileRun.status)
        : "needs_information",
      processStage: row.process_stage,
      workspaceStatus: row.workspace_status,
      workspaceReason: row.workspace_reason ?? null,
      phase: row.phase,
      status: row.status,
      lastActionAt: row.last_action_at,
      recommendation: profileRun?.recommendation ?? null,
      updatedAt: row.updated_at,
      fitScore:
        profileRun?.kind === "deep" && profileRun.status !== "complete"
          ? null
          : (profileRun?.score ?? derivedDeepScore ?? fitHistory[fitHistory.length - 1] ?? null),
      fitHistory,
      threshold: profile.threshold ?? null,
      evidenceConfidence: profileRun?.evidenceConfidence ?? null,
      phaseIndex: phaseIndexFor(row.process_stage),
      hasDeepAnalysis: deepRunId !== null,
      deepScores,
      topRiskLevel: deepRunId ? (row.top_risk_level ?? null) : null,
      screeningScores: screeningRunId ? (scoresByRun.get(screeningRunId) ?? []) : [],
      screeningScore: recalc
        ? recalc.score
        : screeningRun?.overall_score == null
          ? null
          : Number(screeningRun.overall_score),
      screeningConfidence:
        screeningRun?.evidence_confidence == null ? null : Number(screeningRun.evidence_confidence),
      screeningRecommendation: screeningRun?.recommendation ?? null,
      gatePassed: gates.filter((gate) => gate.passed === true).length,
      gateTotal: gates.length,
      // An older version's screening is not judged against the active setup's gates.
      gateMarks: screeningRun && !olderSetup ? gateMarks(gates, profile.gates) : null,
      sourceCount: Number(row.source_count ?? 0),
      activeRunKind:
        profileRun && (profileRun.status === "queued" || profileRun.status === "running")
          ? (profileRun.kind as "screening" | "deep")
          : null,
      activeStepKey: activeProgress?.activeStepKey ?? null,
      activeStepsCompleted: activeProgress?.completed ?? 0,
      activeStepsTotal: activeProgress?.total ?? 0,
      openTasks: Number(row.open_tasks ?? 0),
      assigneeId,
      assigneeName: assigneeId ? (nameById.get(assigneeId) ?? null) : null,
      // Only a binding gate is a breach ("Brud på mandatet"); review rules need judgement.
      // The server only sends a screening of the active setup on (approveAndRunDeepAnalysis).
      canRunDeep:
        screeningRunId !== null && !olderSetup && !screeningsSentToDeep.has(screeningRunId),
      olderSetupVersion: olderSetup ? (screeningRun?.setup_version ?? null) : null,
      olderSetup,
      mandateBreach: olderSetup
        ? false
        : recalc
          ? recalc.failedGates.length > 0
          : screeningRun
            ? gateMarks(gates, profile.gates).includes("hard_breach")
            : false,
    };
  });
}
