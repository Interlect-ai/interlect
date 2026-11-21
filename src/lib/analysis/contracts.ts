import { z } from "zod";

export const evidenceStatusSchema = z.enum([
  "verified",
  "corroborated",
  "company_stated",
  "contradictory",
  "unknown",
]);

export const evidenceCitationSchema = z.object({
  evidenceId: z.string().min(1),
  support: z.enum(["supporting", "opposing"]),
});

export const criterionAssessmentSchema = z.object({
  criterionKey: z.string().min(1),
  proposedScore: z.number().min(0).max(100).nullable(),
  confidence: z.number().min(0).max(1),
  verdict: z.string().min(1).optional(),
  rationale: z.string().min(1),
  positiveDrivers: z.array(z.string().min(1)).max(3).default([]),
  negativeDrivers: z.array(z.string().min(1)).max(3).default([]),
  citations: z.array(evidenceCitationSchema),
  unknowns: z.array(z.string().min(1)),
});

export const gateAssessmentSchema = z.object({
  gateKey: z.string().min(1),
  passed: z.boolean().nullable(),
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(1),
  evidenceIds: z.array(z.string().min(1)),
});

export const riskAssessmentSchema = z.object({
  riskKey: z.string().min(1),
  label: z.string().min(1),
  level: z.enum(["low", "medium", "high", "critical"]),
  likelihood: z.number().int().min(1).max(5),
  impact: z.number().int().min(1).max(5),
  rationale: z.string().min(1),
  evidenceIds: z.array(z.string().min(1)),
  mitigation: z.string().min(1).nullable(),
});

/**
 * "Læs mere om virksomheden" on the screening (v0.5): six short sections written
 * from the run's evidence. Screenings before prompt v8 have none.
 */
export const companyProfileSchema = z.object({
  business: z.string(),
  productModel: z.string(),
  market: z.string(),
  team: z.string(),
  economyCapital: z.string(),
  status: z.string(),
});

/**
 * Nøglefund (Screening v5): what lifts or drags the case, tied to the criterion it moves most,
 * with the analyst's weight 1–3. Screenings before prompt v8 have none.
 */
export const keyFindingSchema = z.object({
  statement: z.string().min(1),
  direction: z.enum(["up", "down"]),
  criterionKey: z.string().min(1),
  importance: z.number().int().min(1).max(3),
});

/**
 * A curated next step: the synthesis's since prompt v10c, the screening's. Lenient on
 * purpose (a stored output must parse): `sanitizeNextSteps` in code validates keys, kinds and
 * lengths before any task is made. `question` is the precise question or action; the title
 * is then a short name of at most six words. Older output has the whole action in the title.
 */
export const nextStepOutputSchema = z.object({
  title: z.string(),
  question: z.string().nullish(),
  why: z.string().nullish(),
  kind: z.string(),
  linkedKind: z.string().nullish(),
  linkedKey: z.string().nullish(),
  priority: z.number(),
});

/**
 * The short label beside the company's name ("Seed, Aquatech, Danmark"), in the
 * team's language. Absent in screenings before prompt v13; `cleanCompanyLabel` trims it.
 */
export const companyLabelSchema = z.object({
  stage: z.string(),
  sector: z.string(),
  country: z.string(),
});

/**
 * The AI's reading of one economy point or own question from the material (prompt
 * `economySection`). Lenient on purpose: `evaluateEconomy` checks keys, values and sources in code.
 */
export const economyAnswerSchema = z.object({
  key: z.string(),
  value: z.number().nullable(),
  /** A yes/no question's answer (null otherwise). */
  yes: z.boolean().nullish(),
  answer: z.string(),
  evidenceIds: z.array(z.string()),
});

export const screeningOutputSchema = z.object({
  schemaVersion: z.enum(["interlect-screening-v1", "pap-screening-v1"]),
  fundProfileId: z.string().min(1),
  fundProfileVersion: z.string().min(1),
  caseId: z.string().min(1),
  assessments: z.array(criterionAssessmentSchema),
  gates: z.array(gateAssessmentSchema),
  risks: z.array(riskAssessmentSchema),
  strengths: z.array(z.string().min(1)),
  weaknesses: z.array(z.string().min(1)),
  openQuestions: z.array(z.string().min(1)),
  overallAssessment: z.string().min(1),
  contraryCase: z.string().min(1),
  proposedRecommendation: z.enum(["go_forward", "follow", "reject", "outside_thesis_interesting"]),
  companyProfile: companyProfileSchema.nullable().optional(),
  keyFindings: z.array(keyFindingSchema).optional(),
  /** "Skal afklares": absent in screenings before prompt v12; the older builder runs. */
  nextSteps: z.array(nextStepOutputSchema).optional(),
  companyLabel: companyLabelSchema.nullable().optional(),
  /** Absent for a version without economy points per stage (every older screening). */
  economy: z.array(economyAnswerSchema).optional(),
});

export type CompanyProfile = z.infer<typeof companyProfileSchema>;
export type CompanyLabel = z.infer<typeof companyLabelSchema>;
export type KeyFinding = z.infer<typeof keyFindingSchema>;
export type ScreeningOutput = z.infer<typeof screeningOutputSchema>;
export type CriterionAssessment = z.infer<typeof criterionAssessmentSchema>;
export type GateAssessment = z.infer<typeof gateAssessmentSchema>;
export type RiskAssessment = z.infer<typeof riskAssessmentSchema>;

/**
 * Model responses are never trusted directly. This is the only entry point from
 * provider output into normalized screening and scoring.
 */
export function parseScreeningOutput(input: unknown): ScreeningOutput {
  return screeningOutputSchema.parse(input);
}
