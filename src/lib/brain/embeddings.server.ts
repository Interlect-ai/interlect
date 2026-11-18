import { aiGatewayOptions } from "@/lib/ai/gateway-options";
import { embedMany } from "@/lib/ai/model-call";
import type { Redactor } from "@/lib/ai/redact";
import { EMBEDDING_MODEL } from "./capture";

/**
 * Embeds texts in one batch, masked with the fund's redactor; returns one vector per
 * text and the tokens billed.
 */
export type BrainEmbedder = (
  values: string[],
  redactor: Redactor,
) => Promise<{ embeddings: number[][]; tokens: number }>;

/** Through the Vercel AI Gateway with the same data rules as the analyses (ZDR, no training). */
export const embedWithGateway: BrainEmbedder = async (values, redactor) => {
  const result = await embedMany({
    model: EMBEDDING_MODEL,
    values,
    redactor,
    maxRetries: 1,
    providerOptions: aiGatewayOptions({ model: EMBEDDING_MODEL, data: "confidential" }),
  });
  return { embeddings: result.embeddings, tokens: result.usage.tokens };
};
