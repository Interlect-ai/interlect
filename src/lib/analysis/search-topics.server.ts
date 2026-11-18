/** The ZDR call behind the search topics. The rules and filters are in search-topics.ts. */
import type { SupabaseClient } from "@supabase/supabase-js";
import { jsonSchema, Output } from "ai";
import { AiDataPolicyError, aiGatewayOptions } from "@/lib/ai/gateway-options";
import { generateText, maskedModel } from "@/lib/ai/model-call";
import { redactorForFund } from "@/lib/ai/redact-dictionary.server";
import {
  assertWithinBudget,
  budgetCharge,
  estimateRequestMaximumUsd,
  type RequestBudgetEstimate,
} from "@/lib/analysis/budgets";
import { extractGatewayCostUsd } from "@/lib/analysis/gateway-response";
import {
  SEARCH_TOPICS_MODEL,
  SEARCH_TOPICS_SCHEMA,
  SEARCH_TOPICS_SYSTEM_PROMPT,
  sanitizeTopics,
  searchTopicsKey,
  topicsPrompt,
  type SanitizedTopics,
  type TopicsBrief,
} from "./search-topics";
import { requestLanguage, serverText } from "@/lib/i18n/server-text";

const MAX_OUTPUT_TOKENS = 700;
const TIMEOUT_MS = 40_000;
/** A masking placeholder ("[Person 1]") in a topic: never restored into a public search. */
const PLACEHOLDER = /\[[^[\]\n]{1,24}\]/u;

export type SearchTopicsOutcome =
  | {
      status: "ok";
      topics: string[];
      dropped: SanitizedTopics["dropped"];
      actualCostUsd: number | null;
      chargeUsd: number;
      /** The topics were stored by an earlier run with the same setup (no call, no cost). */
      reused?: boolean;
    }
  | { status: "skipped" | "failed"; reason: string; topics: []; chargeUsd: number };

/**
 * Writes the topics with a ZDR model. Never throws: a failure means no topics, and the research
 * runs on its default questions. The data rules (aiGatewayOptions) stop a model without ZDR
 * before anything is sent.
 */
export async function generateSearchTopics(input: {
  brief: TopicsBrief;
  availableUsd: number;
  /** The fund whose dictionary masks the call. */
  fundId: string;
  service: SupabaseClient;
}): Promise<SearchTopicsOutcome> {
  if (!input.brief.thesis.trim() && input.brief.criteria.length === 0) {
    return {
      status: "skipped",
      reason: serverText("analysisServer.search.noThesis"),
      topics: [],
      chargeUsd: 0,
    };
  }
  // The same setup reuses its stored topics. They pass today's filter again, so a filter
  // made stricter later also holds for topics stored before it.
  const key = await searchTopicsKey(input.brief);
  const stored = await loadStoredSearchTopics(input.service, input.fundId, key);
  if (stored) {
    const { topics } = sanitizeTopics(stored, input.brief);
    if (topics.length > 0) {
      return { status: "ok", topics, dropped: [], actualCostUsd: 0, chargeUsd: 0, reused: true };
    }
  }
  const prompt = topicsPrompt(input.brief);
  const requestBody = {
    model: SEARCH_TOPICS_MODEL,
    system: SEARCH_TOPICS_SYSTEM_PROMPT,
    prompt,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    schema: SEARCH_TOPICS_SCHEMA,
  };
  const estimate: RequestBudgetEstimate = estimateRequestMaximumUsd({
    model: SEARCH_TOPICS_MODEL,
    requestBody,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
  });
  try {
    // i18n-keep: the call's name in logs only, not shown to the person.
    assertWithinBudget(estimate, input.availableUsd, "Søgeemnerne", requestLanguage());
  } catch {
    return {
      status: "skipped",
      reason: "Kriterierne var for lange.",
      topics: [],
      chargeUsd: 0,
    };
  }
  try {
    const gatewayOptions = aiGatewayOptions({ model: SEARCH_TOPICS_MODEL, data: "confidential" });
    const result = await generateText({
      // An SDK retry would be a second paid call the price check never counts.
      maxRetries: 0,
      // The topics go to a public search engine: a placeholder stays a placeholder and the topic
      // is dropped below, so a masked name can never come back into a search.
      model: maskedModel(
        SEARCH_TOPICS_MODEL,
        await redactorForFund(input.fundId, "search_topics", input.service),
        {
          restore: false,
        },
      ),
      system: SEARCH_TOPICS_SYSTEM_PROMPT,
      prompt,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      ...(gatewayOptions ? { providerOptions: gatewayOptions } : {}),
      abortSignal: AbortSignal.timeout(TIMEOUT_MS),
      output: Output.object({
        name: "interlect_search_topics_v1",
        schema: jsonSchema<{ topics: string[] }>(
          SEARCH_TOPICS_SCHEMA as unknown as Parameters<typeof jsonSchema>[0],
        ),
      }),
    });
    const actualCostUsd = extractGatewayCostUsd({ providerMetadata: result.providerMetadata });
    const raw = Array.isArray(result.output?.topics) ? result.output.topics : [];
    const masked = raw.filter((topic) => typeof topic === "string" && PLACEHOLDER.test(topic));
    const { topics, dropped } = sanitizeTopics(
      raw.filter((topic) => !masked.includes(topic)),
      input.brief,
    );
    for (const topic of masked) dropped.push({ topic: topic.slice(0, 80), why: "personal data" });
    if (topics.length > 0) {
      await storeSearchTopics(input.service, {
        fundId: input.fundId,
        key,
        topics,
        droppedCount: dropped.length,
        costUsd: actualCostUsd,
      });
    }
    return {
      status: "ok",
      topics,
      dropped,
      actualCostUsd,
      chargeUsd: budgetCharge(actualCostUsd, estimate),
    };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    if (cause instanceof AiDataPolicyError) {
      // Stopped by the data rules before anything was sent: nothing to charge.
      console.error("[search-topics] blocked by the data rules", cause.code);
      return {
        status: "failed",
        reason: serverText("analysisServer.common.stoppedByDataRules"),
        topics: [],
        chargeUsd: 0,
      };
    }
    console.error("[search-topics] model call failed", message);
    // The call may have been billed even if the answer was lost: charge the maximum.
    return {
      status: "failed",
      reason: `Modelkaldet fejlede: ${message.slice(0, 160)}`,
      topics: [],
      chargeUsd: estimate.maxCostUsd,
    };
  }
}

/**
 * The topics an earlier run stored for this fund and brief key, or null. A failed read is
 * logged and treated as "none stored": the step then writes the topics as before.
 */
export async function loadStoredSearchTopics(
  service: SupabaseClient,
  fundId: string,
  key: string,
): Promise<string[] | null> {
  const { data, error } = await service
    .from("fund_search_topics")
    .select("topics")
    .eq("fund_id", fundId)
    .eq("brief_key", key)
    .maybeSingle();
  if (error) {
    console.error("[search-topics] stored topics not read", error.code ?? error.message);
    return null;
  }
  const topics = (data as { topics?: unknown } | null)?.topics;
  return Array.isArray(topics) ? topics.filter((t): t is string => typeof t === "string") : null;
}

/** Stores new topics once per fund and key; a failed write is logged, never stops the run. */
async function storeSearchTopics(
  service: SupabaseClient,
  input: {
    fundId: string;
    key: string;
    topics: readonly string[];
    droppedCount: number;
    costUsd: number | null;
  },
): Promise<void> {
  const { error } = await service.from("fund_search_topics").upsert(
    {
      fund_id: input.fundId,
      brief_key: input.key,
      topics: input.topics,
      dropped_count: input.droppedCount,
      model: SEARCH_TOPICS_MODEL,
      cost_usd: input.costUsd,
    },
    { onConflict: "fund_id,brief_key", ignoreDuplicates: true },
  );
  if (error) console.error("[search-topics] topics not stored", error.code ?? error.message);
}
