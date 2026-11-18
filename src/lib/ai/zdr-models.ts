import type { PricedModel } from "../analysis/budgets.ts";

/**
 * What each model we call may be used for (plan, decision D4 5 Oct 2026).
 *
 * Source: the AI Gateway catalog, `GET https://ai-gateway.vercel.sh/v1/models/<id>/endpoints`
 * (fields `has_zdr`, `has_no_training`, `inference_regions` per provider), and Vercel's ZDR
 * provider list (updated 22 Sep 2026). Checked
 * 5 Oct 2026. `npm run check:zdr` compares this table with the live catalog and sends one small
 * call per model, so a provider that drops ZDR is found before a customer's call fails.
 *
 * Keyed by PricedModel: a new model without a row here does not compile.
 */
export type AiModelKind = "language" | "embedding" | "search";

export interface AiModelPolicy {
  kind: AiModelKind;
  /** At least one provider on the Gateway serves the model with zero data retention. */
  zdr: boolean;
  /** Every provider on the Gateway serves it without training on our data. */
  noTraining: boolean;
  /** An EU inference endpoint exists (used only when ZDR is not required for the call). */
  eu: boolean;
  /**
   * An EU endpoint that also has ZDR. When ZDR is required and this is false, pinning EU would
   * leave no provider and fail the whole call, so the region is left to the Gateway.
   */
  euWithZdr: boolean;
}

export const AI_MODEL_POLICIES: Record<PricedModel, AiModelPolicy> = {
  // ZDR via OpenAI and Azure; OpenAI's endpoint is US only, Azure has no region pin.
  "openai/gpt-5.4-mini": {
    kind: "language",
    zdr: true,
    noTraining: true,
    eu: false,
    euWithZdr: false,
  },
  "openai/gpt-5.4": { kind: "language", zdr: true, noTraining: true, eu: false, euWithZdr: false },
  // ZDR via OpenAI and Azure; Bedrock serves it without ZDR, so ZDR narrows the routing.
  "openai/gpt-5.5": { kind: "language", zdr: true, noTraining: true, eu: false, euWithZdr: false },
  // ZDR only via Azure (no region); OpenAI's own endpoint has EU but no ZDR.
  "openai/text-embedding-3-small": {
    kind: "embedding",
    zdr: true,
    noTraining: true,
    eu: true,
    euWithZdr: false,
  },
  // Perplexity is not on Vercel's ZDR list. Only public search terms may go here (D4).
  "perplexity/sonar": { kind: "search", zdr: false, noTraining: true, eu: false, euWithZdr: false },
  "perplexity/sonar-pro": {
    kind: "search",
    zdr: false,
    noTraining: true,
    eu: false,
    euWithZdr: false,
  },
  // Exam judge only. ZDR and no training on every provider (Anthropic, Bedrock,
  // Claude on AWS, Vertex); EU with ZDR via Bedrock and Vertex. Checked 6 Oct 2026.
  "anthropic/claude-sonnet-5.5": {
    kind: "language",
    zdr: true,
    noTraining: true,
    eu: true,
    euWithZdr: true,
  },
  "anthropic/claude-opus-5.5": {
    kind: "language",
    zdr: true,
    noTraining: true,
    eu: true,
    euWithZdr: true,
  },
};

export function aiModelPolicy(model: string): AiModelPolicy | null {
  return Object.prototype.hasOwnProperty.call(AI_MODEL_POLICIES, model)
    ? AI_MODEL_POLICIES[model as PricedModel]
    : null;
}
