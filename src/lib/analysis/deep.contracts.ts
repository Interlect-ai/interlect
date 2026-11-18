import { z } from "zod";
import { nextStepOutputSchema, riskAssessmentSchema, screeningOutputSchema } from "./contracts.ts";
import { SYNTHESIS_NEXT_STEPS, SYNTHESIS_RISK } from "./deep-text-rules.ts";

/**
 * The nine analysis areas. The synthesis must hold at least one finding for each of them
 * (auditDeepOutput rejects the run otherwise), so the same list is used by the schema, the
 * quality check and the synthesis prompt, which says the rule out loud.
 */
export const DEEP_FINDING_CATEGORIES = [
  "fund_thesis_fit",
  "founder_market_fit",
  "team_market_fit",
  "product_market_fit",
  "product_technology",
  "market_timing",
  "traction_gtm",
  "financial_strength",
  "evidence_quality",
] as const;

/**
 * The parse runs after the call is paid for, so its floor is the quality control's blocking floor,
 * not the JSON schema's 650: a risk a little short is a warning, never a parse failure.
 */
const deepRiskAssessmentSchema = riskAssessmentSchema.extend({
  rationale: z.string().min(SYNTHESIS_RISK.rationaleBlockingMin).max(2_400),
  mitigation: z.string().min(180).max(1_200),
});

export const deepAnalysisOutputSchema = screeningOutputSchema.extend({
  /** Absent in output stored before v10c: the older task builder runs for those. */
  nextSteps: z.array(nextStepOutputSchema).max(SYNTHESIS_NEXT_STEPS.maxItems).optional(),
  schemaVersion: z.enum(["interlect-deep-v1", "pap-deep-v1"]),
  risks: z.array(deepRiskAssessmentSchema).min(1).max(5),
  /**
   * The one condition the synthesis puts on an investment, in one or two Danish sentences
   * (prompt v10+); null when there is none. Optional so runs stored before v10 still parse.
   */
  investmentCondition: z
    .preprocess((value) => (value === "" ? null : value), z.string().min(1).nullable())
    .optional(),
  findings: z.array(
    z.object({
      category: z.enum(DEEP_FINDING_CATEGORIES),
      findingType: z.enum(["strength", "weakness", "unknown", "question", "assessment"]),
      statement: z.string().min(1),
      confidence: z.number().min(0).max(1),
      nature: z.enum(["fact", "company_claim", "judgement"]),
      evidenceIds: z.array(z.string().min(1)),
    }),
  ),
  financialInputs: z.array(
    z.object({
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
    }),
  ),
});

export type DeepAnalysisOutput = z.infer<typeof deepAnalysisOutputSchema>;
