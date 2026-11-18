import { z } from "zod";
import { storedCardDataSchema } from "./card-data.ts";
import { criterionAssessmentSchema, riskAssessmentSchema } from "./contracts.ts";

export const specialistModuleIdSchema = z.enum([
  "people_team",
  "product_market_gtm",
  "technology_risk",
  "fund_finance_deal",
]);

/** A fund's own specialist; the key is written by the server (specialist-set.ts). */
export const customSpecialistIdSchema = z.string().regex(/^custom_[a-z0-9]{8,32}$/);

export const analysisCategorySchema = z.enum([
  "fund_thesis_fit",
  "founder_market_fit",
  "team_market_fit",
  "product_market_fit",
  "product_technology",
  "market_timing",
  "traction_gtm",
  "financial_strength",
  "evidence_quality",
]);

export const analysisFindingSchema = z.object({
  category: analysisCategorySchema,
  findingType: z.enum(["strength", "weakness", "unknown", "question", "assessment"]),
  statement: z.string().min(1),
  confidence: z.number().min(0).max(1),
  nature: z.enum(["fact", "company_claim", "judgement"]),
  evidenceIds: z.array(z.string().min(1)),
});

export const financialInputSchema = z.object({
  metric: z.enum([
    "mrr",
    "arr",
    "monthly_revenue",
    "annual_revenue",
    "cash",
    "monthly_operating_expenses",
    "cogs",
    "sales_marketing_spend",
    "new_customers",
    "customers",
    "monthly_churn_rate",
    "monthly_growth_rate",
  ]),
  value: z.number(),
  unit: z.string().min(1),
  periodStart: z.string().nullable(),
  periodEnd: z.string().nullable(),
  evidenceId: z.string().min(1),
});

export const specialistOutputSchema = z.object({
  schemaVersion: z.enum(["interlect-specialist-v1", "pap-specialist-v1"]),
  moduleId: z.union([specialistModuleIdSchema, customSpecialistIdSchema]),
  caseId: z.string().min(1),
  assessments: z.array(criterionAssessmentSchema),
  /**
   * The specialist's own conclusion, 2-3 Danish sentences (prompt v10). Optional and
   * nullable so outputs stored before v10 still parse.
   */
  summary: z
    .preprocess((value) => (value === "" ? null : value), z.string().min(1).nullable())
    .optional(),
  /** The short point for its card; absent before prompt v15. */
  headline: z.string().nullish(),
  findings: z.array(analysisFindingSchema),
  risks: z.array(riskAssessmentSchema),
  strengths: z.array(z.string().min(1)),
  weaknesses: z.array(z.string().min(1)),
  unknowns: z.array(z.string().min(1)),
  questions: z.array(z.string().min(1)),
  financialInputs: z.array(financialInputSchema),
  /**
   * The sourced data the specialist's card draws (card-data.ts); `highlights` when
   * its own chart's data is missing, and always for a fund's own specialist. Missing in packets
   * stored (and, for a fund's own specialist).
   */
  cardData: storedCardDataSchema.optional(),
});

export type SpecialistOutput = z.infer<typeof specialistOutputSchema>;
