/**
 * The result rows of a finished screening or deep analysis, written exactly one way. The workers
 * (screening-analysis.server.ts, deep-worker.server.ts) call these after the model has answered
 * and the output has been checked; the self-host demo data (scripts/selfhost/seed-demo.ts) calls
 * them with its pre-written outputs, so a demo case is stored as a real run would be.
 *
 * Kept free of the server-function modules (screening.functions.ts, deep.functions.ts), which a
 * Node script cannot load.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ScreeningOutput } from "./contracts";
import type { DeepAnalysisOutput } from "./deep.contracts";
import { normalizeFinancialDate } from "./deep-checks";
import { calculateFinance, FINANCE_FORMULA_VERSION } from "./finance";
import { FINANCE_POINT_SELECT, financeInputsFor, type FinancePointRow } from "./finance-inputs";
import type { FundProfile } from "@/lib/funds/profiles";
import { average, buildOverallScoreRationale } from "./screening-checks";
import type { scoreScreening } from "./scoring";
import { requestLanguage, serverText } from "@/lib/i18n/server-text";

type ScoreResult = ReturnType<typeof scoreScreening>;

/** The run's and the case's status after a screening with this score. */
export function screeningStatuses(result: ScoreResult): {
  runStatus: "awaiting_approval" | "complete";
  caseStatus: "awaiting_approval" | "needs_information" | "screening_complete";
} {
  return {
    runStatus: result.outcome === "awaiting_approval" ? "awaiting_approval" : "complete",
    caseStatus:
      result.outcome === "awaiting_approval"
        ? "awaiting_approval"
        : result.outcome === "needs_information"
          ? "needs_information"
          : "screening_complete",
  };
}

/**
 * A screening's scores, risks, explanations and recommendation. Throws (with the person's text)
 * when a row cannot be saved; the caller fails the run.
 */
export async function writeScreeningResultRows(
  service: SupabaseClient,
  input: {
    fundId: string;
    runId: string;
    profile: FundProfile;
    output: ScreeningOutput;
    result: ScoreResult;
  },
): Promise<void> {
  const { fundId, runId, profile, output, result } = input;
  const assessmentByKey = new Map(output.assessments.map((item) => [item.criterionKey, item]));
  const rationale = buildOverallScoreRationale(output, result, profile);

  const { error: categoryScoreError } = await service.from("category_scores").insert(
    result.criteria.map((criterion) => ({
      fund_id: fundId,
      run_id: runId,
      category: criterion.criterionKey,
      proposed_score: assessmentByKey.get(criterion.criterionKey)?.proposedScore ?? null,
      validated_score: criterion.score,
      weight: criterion.weight,
      confidence: criterion.confidence,
      rationale:
        criterion.codeRationale ??
        assessmentByKey.get(criterion.criterionKey)?.rationale ??
        serverText("analysisServer.common.noAssessment"),
    })),
  );
  if (categoryScoreError) throw new Error(serverText("analysisServer.screening.scoresNotSaved"));
  if (output.risks.length) {
    const { error: riskError } = await service.from("risks").insert(
      output.risks.map((risk) => ({
        fund_id: fundId,
        run_id: runId,
        category: risk.riskKey,
        level: risk.level,
        likelihood: risk.likelihood,
        impact: risk.impact,
        statement: risk.rationale,
        mitigation: risk.mitigation,
        evidence_ids: risk.evidenceIds,
      })),
    );
    if (riskError) throw new Error(serverText("analysisServer.screening.risksNotSaved"));
  }
  const findingRows = [
    ...output.strengths.map((statement) => ({ findingType: "strength", statement })),
    ...output.weaknesses.map((statement) => ({ findingType: "weakness", statement })),
    ...output.openQuestions.map((statement) => ({ findingType: "question", statement })),
  ].map((finding) => ({
    fund_id: fundId,
    run_id: runId,
    category: "screening_summary",
    finding_type: finding.findingType,
    statement: finding.statement,
    confidence: average(output.assessments.map((item) => item.confidence)),
    nature: "judgement",
    origin: "model",
  }));
  if (findingRows.length) {
    const { error: findingError } = await service.from("analysis_findings").insert(findingRows);
    if (findingError) throw new Error(serverText("analysisServer.screening.explanationsNotSaved"));
  }
  const assessmentConfidence = average(output.assessments.map((item) => item.confidence));
  const { error: recommendationError } = await service.from("recommendations").insert({
    fund_id: fundId,
    run_id: runId,
    recommendation: result.recommendation,
    overall_score: result.overallScore,
    evidence_confidence:
      assessmentConfidence === null ? null : assessmentConfidence * result.evidenceCoverage,
    has_failed_gate: result.failedHardGateKeys.length > 0,
    has_critical_risk: result.highestRisk === "critical",
    rationale,
  });
  if (recommendationError)
    throw new Error(serverText("analysisServer.screening.recommendationNotSaved"));
}

/** One financial point's identity: the same fact from the same evidence. */
function financialPointKey(point: Record<string, unknown>): string {
  return JSON.stringify([
    point["metric"],
    Number(point["value"]),
    point["unit"],
    point["period_start"] ?? null,
    point["period_end"] ?? null,
    point["evidence_id"],
  ]);
}

/** The rows `writeDeepResultRows` writes for one run (financial points are reused, not deleted). */
async function clearPersistedDeepRows(service: SupabaseClient, fundId: string, runId: string) {
  const results = await Promise.all(
    ["category_scores", "analysis_findings", "risks", "calculation_results", "recommendations"].map(
      (table) => service.from(table).delete().eq("fund_id", fundId).eq("run_id", runId),
    ),
  );
  const failed = results.find((result) => result.error);
  if (failed?.error) throw new Error(serverText("analysisServer.common.deepScoresNotSaved"));
}

/**
 * A deep analysis's scores, findings (with their evidence), risks, financial points, finance
 * calculations and recommendation. Rows an earlier attempt of the same run left behind are
 * removed first, so a second attempt saves the whole result once.
 */
export async function writeDeepResultRows(
  service: SupabaseClient,
  input: {
    fundId: string;
    caseId: string;
    runId: string;
    output: DeepAnalysisOutput;
    result: ScoreResult;
  },
): Promise<void> {
  const { fundId, caseId, runId, output, result } = input;
  const assessmentByKey = new Map(output.assessments.map((item) => [item.criterionKey, item]));

  // An attempt of this run that died while saving left part of its rows behind; they
  // are removed first, so a second attempt saves the whole result once (unique keys on scores,
  // calculations and the recommendation would otherwise reject it).
  await clearPersistedDeepRows(service, fundId, runId);

  const { error: scoreError } = await service.from("category_scores").insert(
    result.criteria.map((criterion) => ({
      fund_id: fundId,
      run_id: runId,
      category: criterion.criterionKey,
      proposed_score: assessmentByKey.get(criterion.criterionKey)?.proposedScore ?? null,
      validated_score: criterion.score,
      weight: criterion.weight,
      confidence: criterion.confidence,
      rationale:
        criterion.codeRationale ??
        assessmentByKey.get(criterion.criterionKey)?.rationale ??
        serverText("analysisServer.common.noAssessment"),
    })),
  );
  if (scoreError) throw new Error(serverText("analysisServer.common.deepScoresNotSaved"));

  if (output.findings.length) {
    const { data: insertedFindings, error: findingError } = await service
      .from("analysis_findings")
      .insert(
        output.findings.map((finding) => ({
          fund_id: fundId,
          run_id: runId,
          category: finding.category,
          finding_type: finding.findingType,
          statement: finding.statement,
          confidence: finding.confidence,
          nature: finding.nature,
          // A finding made by code (no data found for an area) is stored as such.
          origin:
            (finding as { origin?: string }).origin === "deterministic" ? "deterministic" : "model",
        })),
      )
      .select("id");
    if (findingError) throw findingError;
    const links = (insertedFindings ?? []).flatMap((row, index) =>
      (output.findings[index]?.evidenceIds ?? []).map((evidenceId) => ({
        fund_id: fundId,
        finding_id: row["id"],
        evidence_id: evidenceId,
        supports: true,
      })),
    );
    if (links.length) {
      const { error } = await service.from("analysis_finding_evidence").insert(links);
      if (error) throw error;
    }
  }

  if (output.risks.length) {
    const { error } = await service.from("risks").insert(
      output.risks.map((risk) => ({
        fund_id: fundId,
        run_id: runId,
        category: risk.riskKey,
        level: risk.level,
        likelihood: risk.likelihood,
        impact: risk.impact,
        statement: risk.rationale,
        mitigation: risk.mitigation,
        evidence_ids: risk.evidenceIds,
      })),
    );
    if (error) throw new Error(serverText("analysisServer.common.deepRisksNotSaved"));
  }

  const specialistPointIds = new Set<string>();
  if (output.financialInputs.length) {
    const points = output.financialInputs.map((point) => ({
      fund_id: fundId,
      case_id: caseId,
      metric: point.metric,
      value: point.value,
      unit: point.unit,
      period_start: normalizeFinancialDate(point.periodStart, "start"),
      period_end: normalizeFinancialDate(point.periodEnd, "end"),
      evidence_id: point.evidenceId,
    }));
    // The same point from the same evidence (an earlier attempt of this run, or an
    // earlier run) is reused instead of saved twice; the points have no run of their own.
    const { data: existing, error: existingError } = await service
      .from("financial_data_points")
      .select("id, metric, value, unit, period_start, period_end, evidence_id")
      .eq("fund_id", fundId)
      .eq("case_id", caseId)
      .in("evidence_id", [...new Set(points.map((point) => point.evidence_id))]);
    if (existingError) throw existingError;
    const reused = new Map(
      (existing ?? []).map((row) => [financialPointKey(row), row as Record<string, unknown>]),
    );
    const fresh = points.filter((point) => !reused.has(financialPointKey(point)));
    const { data: insertedFresh, error: financialError } = fresh.length
      ? await service
          .from("financial_data_points")
          .insert(fresh)
          .select("id, metric, value, unit, period_start, period_end, evidence_id")
      : { data: [], error: null };
    if (financialError) throw financialError;
    const byKey = new Map(reused);
    for (const row of insertedFresh ?? []) byKey.set(financialPointKey(row), row);
    const inserted = [...new Set(points.map(financialPointKey))].flatMap((key) => {
      const row = byKey.get(key);
      return row ? [row] : [];
    });
    for (const point of inserted) specialistPointIds.add(point["id"] as string);
  }
  // The specialist's figures, topped up with the register's for what it did not give.
  const { data: caseFinanceRows, error: caseFinanceError } = await service
    .from("financial_data_points")
    .select(FINANCE_POINT_SELECT)
    .eq("fund_id", fundId)
    .eq("case_id", caseId);
  if (caseFinanceError) {
    console.error("[deep] finance inputs", caseFinanceError.message);
    throw new Error(serverText("analysisServer.common.financeNotSaved"));
  }
  const financeInputs = financeInputsFor(
    (caseFinanceRows ?? []) as unknown as FinancePointRow[],
    specialistPointIds,
  );
  const workerCalculations = financeInputs.length
    ? calculateFinance(financeInputs, requestLanguage())
    : [];
  // Only the register's figures (no specialist input) and nothing computable: save no empty rows.
  if (specialistPointIds.size > 0 || workerCalculations.some((item) => item.status === "ok")) {
    const { error } = await service.from("calculation_results").insert(
      workerCalculations.map((item) => ({
        fund_id: fundId,
        run_id: runId,
        metric: item.metric,
        status: item.status,
        value: item.value,
        unit: item.unit,
        formula_version: FINANCE_FORMULA_VERSION,
        input_ids: item.inputIds,
        missing_inputs: item.missingInputs,
        warnings: item.warnings,
      })),
    );
    if (error) throw new Error(serverText("analysisServer.common.financeNotSaved"));
  }

  const rationale = [
    output.overallAssessment,
    serverText("analysisServer.deep.contrary", { text: output.contraryCase }),
  ].join("\n\n");
  const assessmentConfidence = average(output.assessments.map((item) => item.confidence));
  const { error: recommendationError } = await service.from("recommendations").insert({
    fund_id: fundId,
    run_id: runId,
    recommendation: result.recommendation,
    overall_score: result.overallScore,
    evidence_confidence:
      assessmentConfidence === null ? null : assessmentConfidence * result.evidenceCoverage,
    has_failed_gate: result.failedHardGateKeys.length > 0,
    has_critical_risk: result.highestRisk === "critical",
    rationale,
  });
  if (recommendationError)
    throw new Error(serverText("analysisServer.common.deepRecommendationNotSaved"));
}
