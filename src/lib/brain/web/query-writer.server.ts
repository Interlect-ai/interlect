import { jsonSchema, Output } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { aiGatewayOptions } from "@/lib/ai/gateway-options";
import { generateText, maskedModel } from "@/lib/ai/model-call";
import { redactorForFund } from "@/lib/ai/redact-dictionary.server";
import { extractGatewayCostUsd } from "@/lib/analysis/gateway-response";
import { bookedCall } from "./booked.server";
import {
  QUERY_WRITER_SCHEMA,
  QUERY_WRITER_SYSTEM,
  queryWriterInput,
  sanitizeWebQueries,
  type SanitizedWebQueries,
  type WebCompanyIdentity,
} from "./queries";

export const QUERY_WRITER_MODEL = "openai/gpt-5.4-mini";
/** The most the query writer may cost: a few hundred tokens in and out on a mini model. */
const QUERY_WRITER_MAX_USD = 0.01;

/**
 * Proposes 1 to 3 web queries for the user to approve (B8). Sees only the question and the
 * identity of the companies the user pointed to (`queryWriterInput`), runs on a ZDR model through
 * the masking, and every query it writes passes `sanitizeWebQueries`. The user's approval of the
 * queries is a separate step; this call never searches.
 */
export async function proposeWebQueries(
  service: SupabaseClient,
  input: {
    fundId: string;
    userId: string;
    question: string;
    companies: readonly WebCompanyIdentity[];
  },
): Promise<SanitizedWebQueries & { costUsd: number }> {
  const packet = queryWriterInput(input.question, input.companies);
  const gatewayOptions = aiGatewayOptions({ model: QUERY_WRITER_MODEL, data: "confidential" });
  const redactor = await redactorForFund(input.fundId, "brain_web_queries", service);
  const { value, costUsd } = await bookedCall(
    service,
    {
      fundId: input.fundId,
      userId: input.userId,
      maxUsd: QUERY_WRITER_MAX_USD,
      model: QUERY_WRITER_MODEL,
    },
    async () => {
      const result = await generateText({
        model: maskedModel(QUERY_WRITER_MODEL, redactor),
        system: QUERY_WRITER_SYSTEM,
        prompt: JSON.stringify(packet),
        maxOutputTokens: 400,
        ...(gatewayOptions ? { providerOptions: gatewayOptions } : {}),
        abortSignal: AbortSignal.timeout(30_000),
        output: Output.object({
          name: "interlect_web_queries_v1",
          schema: jsonSchema<{ queries: string[] }>(
            QUERY_WRITER_SCHEMA as unknown as Parameters<typeof jsonSchema>[0],
          ),
        }),
      });
      return {
        value: Array.isArray(result.output?.queries) ? result.output.queries : [],
        costUsd: extractGatewayCostUsd({ providerMetadata: result.providerMetadata }),
        inputTokens: result.totalUsage.inputTokens ?? null,
        outputTokens: result.totalUsage.outputTokens ?? null,
      };
    },
  );
  return { ...sanitizeWebQueries(value), costUsd };
}

/**
 * How many query proposals this user has had in the fund since `since`. Each proposal is
 * one booked row in brain_usage with the user and the writer's model, so the count needs no table
 * of its own; a released reservation (a failed call) counts too, as it was still an attempt.
 */
export async function recentWebProposals(
  service: SupabaseClient,
  input: { fundId: string; userId: string; since: Date },
): Promise<number> {
  const { count, error } = await service
    .from("brain_usage")
    .select("id", { count: "exact", head: true })
    .eq("fund_id", input.fundId)
    .eq("scope", "chat")
    .eq("user_id", input.userId)
    .eq("model", QUERY_WRITER_MODEL)
    .gte("created_at", input.since.toISOString());
  if (error) throw new Error(`brain_usage count: ${error.message}`);
  return count ?? 0;
}
