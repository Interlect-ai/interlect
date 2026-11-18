/**
 * The deep analysis's checks of a stored or fresh output (moved out of deep.functions.ts so a
 * script can use them without the server-function module; deep.functions.ts re-exports them).
 * Used by the worker before it saves a run, and by the self-host demo data's tests.
 */
import type { z } from "zod";
import { reasonsLikelihoodAndImpact } from "./risk-reasoning.ts";
import { auditDeepTextLengths, auditRiskRationale, countSentences } from "./deep-text-rules.ts";
import { DEEP_FINDING_CATEGORIES, type deepAnalysisOutputSchema } from "./deep.contracts.ts";
import type { mapProfile } from "./fund-profile.ts";
import { isFinanceSpecialist, type DeepSpecialist } from "./specialist-prompts.ts";
import type { SpecialistOutput } from "./specialist.contracts.ts";
import { requestLanguage, serverText } from "../i18n/server-text.ts";

export function validateSpecialistPacket(
  packet: SpecialistOutput,
  module: DeepSpecialist,
  profile: ReturnType<typeof mapProfile>,
  caseId: string,
  allowedEvidenceIds: Set<string>,
) {
  if (packet.moduleId !== module.id || packet.caseId !== caseId) {
    throw new Error(serverText("analysisServer.deep.specialistOtherTask", { name: module.title }));
  }
  const expectedCriteria = profile.criteria
    .filter((criterion) => module.categories.includes(criterion.category))
    .map((criterion) => criterion.key);
  const actualCriteria = packet.assessments.map((assessment) => assessment.criterionKey);
  const duplicateCriteria = actualCriteria.filter(
    (key, index) => actualCriteria.indexOf(key) !== index,
  );
  const missingCriteria = expectedCriteria.filter((key) => !actualCriteria.includes(key));
  const unexpectedCriteria = actualCriteria.filter((key) => !expectedCriteria.includes(key));
  const missingCategories = module.categories.filter(
    (category) => !packet.findings.some((finding) => finding.category === category),
  );
  if (
    duplicateCriteria.length ||
    missingCriteria.length ||
    unexpectedCriteria.length ||
    missingCategories.length
  ) {
    throw new Error(serverText("analysisServer.deep.specialistCoverage", { name: module.title }));
  }
  if (!isFinanceSpecialist(module) && packet.financialInputs.length) {
    throw new Error(serverText("analysisServer.deep.financeOnly"));
  }
  const references = [
    ...packet.assessments.flatMap((item) => item.citations.map((citation) => citation.evidenceId)),
    ...packet.findings.flatMap((item) => item.evidenceIds),
    ...packet.risks.flatMap((item) => item.evidenceIds),
    ...packet.financialInputs.map((item) => item.evidenceId),
  ];
  if (references.some((id) => !allowedEvidenceIds.has(id))) {
    throw new Error(
      serverText("analysisServer.deep.specialistUnknownEvidence", { name: module.title }),
    );
  }
  if (
    packet.assessments.some((item) => item.proposedScore !== null && item.citations.length === 0)
  ) {
    throw new Error(
      serverText("analysisServer.deep.specialistScoreNoEvidence", { name: module.title }),
    );
  }
  if (
    packet.findings.some((item) => item.nature !== "judgement" && item.evidenceIds.length === 0)
  ) {
    throw new Error(
      serverText("analysisServer.deep.specialistClaimNoEvidence", { name: module.title }),
    );
  }
}

export function validateReferences(
  output: z.infer<typeof deepAnalysisOutputSchema>,
  allowed: Set<string>,
) {
  const references = [
    ...output.assessments.flatMap((item) => item.citations.map((citation) => citation.evidenceId)),
    ...output.gates.flatMap((item) => item.evidenceIds),
    ...output.risks.flatMap((item) => item.evidenceIds),
    ...output.findings.flatMap((item) => item.evidenceIds),
    ...output.financialInputs.map((item) => item.evidenceId),
  ];
  if (references.some((id) => !allowed.has(id)))
    throw new Error(serverText("analysisServer.deep.unknownEvidence"));
  if (output.assessments.some((item) => item.proposedScore !== null && item.citations.length === 0))
    throw new Error(serverText("analysisServer.deep.scoreWithoutEvidence"));
  if (output.findings.some((item) => item.nature !== "judgement" && item.evidenceIds.length === 0))
    throw new Error(serverText("analysisServer.deep.claimWithoutEvidence"));
}

export function auditDeepOutput(
  output: z.infer<typeof deepAnalysisOutputSchema>,
  profile: ReturnType<typeof mapProfile>,
) {
  const blockingErrors: string[] = [];
  const warnings: string[] = [];
  const requiredCategories = DEEP_FINDING_CATEGORIES;
  const assessmentKeys = output.assessments.map((item) => item.criterionKey);
  const gateKeys = output.gates.map((item) => item.gateKey);
  const duplicateAssessments = assessmentKeys.filter(
    (key, index) => assessmentKeys.indexOf(key) !== index,
  );
  const duplicateGates = gateKeys.filter((key, index) => gateKeys.indexOf(key) !== index);
  const missingAssessments = profile.criteria
    .filter((criterion) => !assessmentKeys.includes(criterion.key))
    .map((criterion) => criterion.key);
  const missingGates = profile.gates
    .filter((gate) => !gateKeys.includes(gate.key))
    .map((gate) => gate.key);
  const missingCategories = requiredCategories.filter(
    (category) => !output.findings.some((finding) => finding.category === category),
  );

  if (duplicateAssessments.length)
    blockingErrors.push(
      `Dublerede kriterievurderinger: ${[...new Set(duplicateAssessments)].join(", ")}.`,
    );
  if (duplicateGates.length)
    blockingErrors.push(`Dublerede mandatkontroller: ${[...new Set(duplicateGates)].join(", ")}.`);
  if (missingAssessments.length)
    blockingErrors.push(`Manglende kriterievurderinger: ${missingAssessments.join(", ")}.`);
  if (missingGates.length)
    blockingErrors.push(`Manglende mandatkontroller: ${missingGates.join(", ")}.`);
  // Missing data is uncertainty, not a failure after payment (principle 7). Code fills a category
  // the model skipped with an 'unknown' finding (finding-categories.ts) before this audit, so
  // this is only a visible warning.
  if (missingCategories.length)
    warnings.push(
      serverText("analysisServer.deep.missingAreas", { areas: missingCategories.join(", ") }),
    );
  output.risks.forEach((risk, index) => {
    const title =
      risk.label.trim() ||
      risk.riskKey ||
      serverText("analysisServer.deep.riskNumber", { n: index + 1 });
    const reasoning = reasonsLikelihoodAndImpact(risk.rationale);
    const hasLikelihoodReasoning = reasoning.likelihood;
    const hasImpactReasoning = reasoning.impact;
    const rationaleCheck = auditRiskRationale(title, risk.rationale, requestLanguage());
    if (rationaleCheck.blockingError) blockingErrors.push(rationaleCheck.blockingError);
    if (rationaleCheck.warning) warnings.push(rationaleCheck.warning);
    if (!hasLikelihoodReasoning || !hasImpactReasoning) {
      blockingErrors.push(serverText("analysisServer.deep.riskNoBoth", { name: title }));
    }
    if (risk.mitigation.trim().length < 180 || countSentences(risk.mitigation) < 2) {
      blockingErrors.push(serverText("analysisServer.deep.riskNoPlan", { name: title }));
    }
  });
  const textAudit = auditDeepTextLengths(output, requestLanguage());
  blockingErrors.push(...textAudit.blockingErrors);
  warnings.push(...textAudit.warnings);
  if (output.contraryCase.trim().length < 40)
    warnings.push(serverText("analysisServer.deep.contraryShort"));
  if (!output.openQuestions.length)
    warnings.push(serverText("analysisServer.deep.noOpenQuestions"));
  if (output.financialInputs.some((item) => !item.periodStart && !item.periodEnd)) {
    warnings.push(serverText("analysisServer.deep.financeNoPeriod"));
  }
  return { blockingErrors, warnings, checkedAt: new Date().toISOString() };
}

export function normalizeFinancialDate(
  value: string | null,
  boundary: "start" | "end",
): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const month = /^(\d{4})-(\d{2})$/.exec(value);
  if (!month) return null;
  const year = Number(month[1]);
  const monthIndex = Number(month[2]);
  if (monthIndex < 1 || monthIndex > 12) return null;
  if (boundary === "start") return `${month[1]}-${month[2]}-01`;
  const lastDay = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
  return `${month[1]}-${month[2]}-${String(lastDay).padStart(2, "0")}`;
}
