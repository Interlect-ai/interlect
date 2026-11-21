import type { PapRecommendation, RiskLevel } from "@/lib/domain/types";
import { financeGateTreatment, isFinanceGate } from "./financial-gates.ts";
import { isCodeAnchored } from "./code-anchor.ts";
import {
  blendFinancialScore,
  financialScoreRationale,
  type FinancialScore,
} from "./financial-score.ts";
import type { FundProfile } from "@/lib/funds/profiles";
import { translate } from "../i18n/translate.ts";
import type { ScreeningOutput } from "./contracts";

/** V4, no outcome "blocked"; the score itself is computed exactly as in v3. */
export const SCORING_FORMULA_VERSION = "interlect-weighted-stage-adjusted-v4-never-blocked";

export interface CriterionScoreResult {
  criterionKey: string;
  label: string;
  score: number | null;
  weight: number;
  weightedPoints: number | null;
  confidence: number | null;
  evidenceCount: number;
  isStagePrior: boolean;
  /** C8: kode-scoren for finansiel styrke, når den er brugt (AI højst ±10 herfra). */
  financeCodeScore?: number;
  /** C8: begrundelsen for en kode-forankret score (erstatter AI'ens tekst ved gem). */
  codeRationale?: string;
}

export interface DeterministicScreeningResult {
  formulaVersion: typeof SCORING_FORMULA_VERSION;
  fundProfileId: FundProfile["id"];
  fundProfileVersion: string;
  overallScore: number | null;
  criteria: CriterionScoreResult[];
  missingCriterionKeys: string[];
  evidenceCoverage: number;
  failedHardGateKeys: string[];
  unresolvedGateKeys: string[];
  highestRisk: RiskLevel | null;
  /**
   * What the case breaks: a binding mandate rule that is not met, or a critical risk. Shown on the
   * case; it stops nothing (beslutningsloggen 15. nov 2026: "Vi blokerer generelt ikke cases"). The
   * name is kept for the stored runs (`validation_result.blockers`).
   */
  blockers: string[];
  /**
   * Never "blocked" any more. Old runs and cases may still carry it in the database
   * (0033, 0034); no new screening gets it.
   */
  outcome: "needs_information" | "below_threshold" | "awaiting_approval";
  recommendation: PapRecommendation;
  /** A deep analysis is always possible; a break is shown, never a stop. */
  eligibleForDeepAnalysis: true;
}

/**
 * C8: kode-scoren til revisionssporet (analysis_runs.validation_result.financeScore), så
 * delmål, dækning og kurveversion kan efterregnes, og visningen ved, hvilke kriterier der
 * er regnet i kode (ikke en stage-prior).
 */
export function financeScoreAudit(
  financeScore: FinancialScore | null,
  result: DeterministicScreeningResult,
) {
  if (!financeScore) return null;
  return {
    ...financeScore,
    anchoredCriterionKeys: result.criteria
      .filter((criterion) => criterion.financeCodeScore !== undefined)
      .map((criterion) => criterion.criterionKey),
  };
}

const riskRank: Record<RiskLevel, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

export function scoreScreening(
  profile: FundProfile,
  output: ScreeningOutput,
  companyStage = "unknown",
  /**
   * C8: kode-score for finansiel styrke fra CVR-regnskabet (financial-score.ts), når
   * dækningen er god nok og CVR-matchet sikkert. AI'en kan så højst justere ±10.
   */
  financeScore: FinancialScore | null = null,
): DeterministicScreeningResult {
  if (output.fundProfileId !== profile.id || output.fundProfileVersion !== profile.version) {
    throw new Error(translate(profile.language ?? "da", "analysisServer.scoring.wrongProfile"));
  }

  const totalWeight = profile.criteria.reduce((sum, criterion) => sum + criterion.weight, 0);
  if (totalWeight !== 100) {
    throw new Error(
      translate(profile.language ?? "da", "analysisServer.scoring.weightsSum", {
        total: totalWeight,
      }),
    );
  }

  const assessmentByKey = new Map(output.assessments.map((item) => [item.criterionKey, item]));
  const criteria = profile.criteria.map((criterion): CriterionScoreResult => {
    const assessment = assessmentByKey.get(criterion.key);
    const evidenceCount = assessment?.citations.length ?? 0;
    const hasEvidenceScore = assessment?.proposedScore != null && evidenceCount > 0;
    const financeCodeScore = financeScore?.score ?? null;
    if (isCodeAnchored(criterion) && financeScore && financeCodeScore !== null) {
      const score = blendFinancialScore(
        financeCodeScore,
        hasEvidenceScore ? assessment.proposedScore : null,
      );
      return {
        criterionKey: criterion.key,
        label: criterion.label,
        score,
        weight: criterion.weight,
        weightedPoints: (score * criterion.weight) / 100,
        confidence: financeScore.confidence,
        evidenceCount,
        isStagePrior: false,
        financeCodeScore,
        codeRationale: financialScoreRationale(
          financeScore,
          score,
          hasEvidenceScore ? (assessment?.rationale ?? null) : null,
        ),
      };
    }
    const score = hasEvidenceScore ? assessment.proposedScore : stagePriorScore(companyStage);
    return {
      criterionKey: criterion.key,
      label: criterion.label,
      score,
      weight: criterion.weight,
      weightedPoints: score === null ? null : (score * criterion.weight) / 100,
      confidence: hasEvidenceScore ? (assessment?.confidence ?? null) : 0,
      evidenceCount,
      isStagePrior: !hasEvidenceScore,
    };
  });

  const missingCriterionKeys = criteria
    .filter((criterion) => criterion.isStagePrior)
    .map((criterion) => criterion.criterionKey);
  const evidenceCoverage =
    criteria.reduce((sum, criterion) => sum + (criterion.isStagePrior ? 0 : criterion.weight), 0) /
    100;
  const gateByKey = new Map(output.gates.map((gate) => [gate.gateKey, gate]));
  // Finans-gates har låst behandling (kun positiv egenkapital er bindende), uanset
  // hvad fondsopsætningen siger, fordi de regnes af kode på estimater.
  const treatmentOf = (gate: { key: string; treatment: "hard" | "review" }) =>
    isFinanceGate(gate.key) ? financeGateTreatment(gate.key) : gate.treatment;
  const failedHardGateKeys = profile.gates
    .filter((gate) => treatmentOf(gate) === "hard" && gateByKey.get(gate.key)?.passed === false)
    .map((gate) => gate.key);
  // Et ukendt finans-vurderingskrav (fx intet dansk regnskab) er et åbent spørgsmål i
  // listen, men holder ikke casen tilbage; et ukendt bindende krav gør.
  const unresolvedGateKeys = profile.gates
    .filter(
      (gate) =>
        gateByKey.get(gate.key)?.passed == null &&
        !(isFinanceGate(gate.key) && treatmentOf(gate) === "review"),
    )
    .map((gate) => gate.key);
  const highestRisk = output.risks.reduce<RiskLevel | null>((highest, risk) => {
    if (!highest || riskRank[risk.level] > riskRank[highest]) return risk.level;
    return highest;
  }, null);

  const overallScore = roundToOneDecimal(
    criteria.reduce((sum, criterion) => sum + (criterion.weightedPoints ?? 0), 0),
  );
  const blockers = [
    ...failedHardGateKeys.map((key) => `Mandatbrud: ${key}`),
    ...(highestRisk === "critical" ? ["Mindst én kritisk risiko"] : []),
  ];

  // A score is always available, but thin evidence cannot automatically promote a case. An
  // unknown binding rule makes the case "mangler information" ("Ja"); a broken one
  // is shown (blockers, failedHardGateKeys) and changes neither the score nor the outcome: the case
  // always goes on (the locked rule "binding_rule_shown" in fixed-rules.ts).
  const hasInsufficientInformation = evidenceCoverage < 0.6 || unresolvedGateKeys.length > 0;
  const aboveThreshold = overallScore !== null && overallScore >= profile.analysisThreshold;
  const outcome = hasInsufficientInformation
    ? "needs_information"
    : aboveThreshold
      ? "awaiting_approval"
      : "below_threshold";

  return {
    formulaVersion: SCORING_FORMULA_VERSION,
    fundProfileId: profile.id,
    fundProfileVersion: profile.version,
    overallScore,
    criteria,
    missingCriterionKeys,
    evidenceCoverage,
    failedHardGateKeys,
    unresolvedGateKeys,
    highestRisk,
    blockers,
    outcome,
    recommendation: constrainRecommendation(output.proposedRecommendation, outcome),
    eligibleForDeepAnalysis: true,
  };
}

/**
 * Neutral-to-cautious prior for a criterion that genuinely cannot be scored.
 * Missing maturity data is normal at pre-seed, but increasingly material later.
 */
export function stagePriorScore(stage: string | null | undefined): number {
  const normalized = (stage ?? "unknown").trim().toLowerCase().replaceAll("-", "_");
  if (normalized === "pre_seed" || normalized === "preseed") return 50;
  if (normalized === "seed") return 45;
  if (normalized === "series_a" || normalized === "seriesa") return 35;
  if (normalized === "series_b" || normalized === "seriesb") return 25;
  if (["later", "growth", "buyout", "series_c", "seriesc"].includes(normalized)) return 20;
  return 40;
}

function constrainRecommendation(
  proposed: PapRecommendation,
  outcome: DeterministicScreeningResult["outcome"],
): PapRecommendation {
  if (outcome === "needs_information") return "follow";
  if (outcome === "below_threshold" && proposed === "go_forward") return "follow";
  return proposed;
}

function roundToOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}
