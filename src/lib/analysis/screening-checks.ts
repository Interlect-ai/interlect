/**
 * The screening's checks and its score rationale (moved out of screening.functions.ts so a script
 * can use them without the server-function module; screening.functions.ts re-exports them).
 */
import type { ScreeningOutput } from "./contracts.ts";
import type { FundProfile } from "../funds/profiles.ts";
import type { scoreScreening } from "./scoring.ts";
import { serverText } from "../i18n/server-text.ts";

export function buildOverallScoreRationale(
  output: ScreeningOutput,
  result: ReturnType<typeof scoreScreening>,
  profile: FundProfile,
) {
  const scored = [...result.criteria]
    .filter((criterion) => criterion.score !== null)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const strongest = scored[0];
  const weakest = scored.at(-1);
  const thresholdDelta =
    result.overallScore === null
      ? null
      : Math.round((result.overallScore - profile.analysisThreshold) * 10) / 10;
  const scoreContext =
    result.overallScore === null
      ? serverText("analysisServer.screening.noTotal")
      : serverText("analysisServer.screening.scoreLine", {
          score: result.overallScore,
          relation:
            thresholdDelta === null
              ? ""
              : serverText(
                  thresholdDelta >= 0
                    ? "analysisServer.screening.pointsAbove"
                    : "analysisServer.screening.pointsBelow",
                  { points: Math.abs(thresholdDelta) },
                ),
          threshold: profile.analysisThreshold,
        });
  const spreadContext =
    strongest && weakest && strongest.criterionKey !== weakest.criterionKey
      ? serverText("analysisServer.screening.carriedBy", {
          strong: strongest.label.toLowerCase(),
          strongScore: String(strongest.score),
          weak: weakest.label.toLowerCase(),
          weakScore: String(weakest.score),
        })
      : null;
  const priorContext = result.missingCriterionKeys.length
    ? serverText("analysisServer.screening.priorCount", {
        count: result.missingCriterionKeys.length,
        total: result.criteria.length,
      })
    : null;

  return [output.overallAssessment, scoreContext, spreadContext, priorContext]
    .filter(Boolean)
    .join("\n");
}

export function validateEvidenceReferences(output: ScreeningOutput, allowed: Set<string>) {
  const references = [
    ...output.assessments.flatMap((item) => item.citations.map((citation) => citation.evidenceId)),
    ...output.gates.flatMap((item) => item.evidenceIds),
    ...output.risks.flatMap((item) => item.evidenceIds),
  ];
  if (references.some((id) => !allowed.has(id)))
    throw new Error(serverText("analysisServer.screening.unknownEvidence"));
  if (
    output.assessments.some((item) => item.proposedScore !== null && item.citations.length === 0)
  ) {
    throw new Error(serverText("analysisServer.screening.scoreWithoutEvidence"));
  }
}

export function validateConfiguredCoverage(output: ScreeningOutput, profile: FundProfile) {
  const assessmentKeys = output.assessments.map((item) => item.criterionKey);
  const gateKeys = output.gates.map((item) => item.gateKey);
  const expectedAssessmentKeys = profile.criteria.map((item) => item.key);
  const expectedGateKeys = profile.gates.map((item) => item.key);
  if (
    new Set(assessmentKeys).size !== assessmentKeys.length ||
    assessmentKeys.length !== expectedAssessmentKeys.length ||
    expectedAssessmentKeys.some((key) => !assessmentKeys.includes(key))
  ) {
    throw new Error(serverText("analysisServer.screening.criteriaCoverage"));
  }
  if (
    new Set(gateKeys).size !== gateKeys.length ||
    gateKeys.length !== expectedGateKeys.length ||
    expectedGateKeys.some((key) => !gateKeys.includes(key))
  ) {
    throw new Error(serverText("analysisServer.screening.gatesCoverage"));
  }
}

export function average(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}
