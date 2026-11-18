import type { SupabaseClient } from "@supabase/supabase-js";
import { aiGatewayOptions } from "../../ai/gateway-options.ts";
import { generateText, maskedModel, type WrappableModel } from "../../ai/model-call.ts";
import type { Redactor } from "../../ai/redact.ts";
import { redactorForFund } from "../../ai/redact-dictionary.server.ts";
import { extractGatewayCostUsd } from "../../analysis/gateway-response.ts";
import { bookedCall } from "./booked.server.ts";
import { sanitizeWebQueries } from "./queries.ts";

export const WEB_SEARCH_MODEL = "perplexity/sonar";
/** One search at most: sonar's tokens and its search fee, with room to spare. */
const WEB_SEARCH_MAX_USD = 0.03;

export type WebSource = { url: string; title: string | null };
export type WebResult = { query: string; text: string; sources: WebSource[] };

const SYSTEM =
  "Answer the search query from public web sources in at most 120 words, in the language of the query. State dates and figures as the sources give them. If you find nothing relevant, say so in one sentence. Never ask a question back.";

/**
 * Runs the user's approved queries on Perplexity sonar (B8). The queries are filtered
 * again here, because this is the last step before they leave: nothing but the query text goes
 * out (public search terms, no ZDR needed, never any fund data). The results are never saved in
 * Brain's memory unless the user presses "Gem i Brain". A search that fails is left out, so the
 * answer can still be written from the fund's own material.
 */
export async function runWebSearch(
  service: SupabaseClient,
  input: {
    fundId: string;
    userId?: string | null;
    queries: readonly string[];
    signal?: AbortSignal;
    /** Test seam: the default is Perplexity sonar through the Gateway. */
    model?: WrappableModel;
    /** Test seam: the default is the fund's masking dictionary. */
    redactor?: Redactor;
    /** Test seam: the default books each search in the fund's chat budget. */
    book?: typeof bookedCall;
  },
): Promise<{ results: WebResult[]; costUsd: number; failed: number }> {
  const { queries } = sanitizeWebQueries(input.queries);
  const redactor =
    input.redactor ?? (await redactorForFund(input.fundId, "brain_web_search", service));
  const book = input.book ?? bookedCall;
  const gatewayOptions = aiGatewayOptions({ model: WEB_SEARCH_MODEL, data: "public_search" });
  const settled = await Promise.allSettled(
    queries.map((query) =>
      book(
        service,
        {
          fundId: input.fundId,
          userId: input.userId ?? null,
          maxUsd: WEB_SEARCH_MAX_USD,
          model: WEB_SEARCH_MODEL,
        },
        async () => {
          const result = await generateText({
            model: maskedModel(input.model ?? WEB_SEARCH_MODEL, redactor),
            system: SYSTEM,
            prompt: query,
            maxOutputTokens: 500,
            ...(gatewayOptions ? { providerOptions: gatewayOptions } : {}),
            abortSignal: input.signal
              ? AbortSignal.any([AbortSignal.timeout(25_000), input.signal])
              : AbortSignal.timeout(25_000),
          });
          const seen = new Set<string>();
          const sources: WebSource[] = [];
          for (const source of result.sources) {
            // Only web links: a source from the open web is never a script or a data URL.
            if (source.sourceType !== "url" || !/^https?:\/\//i.test(source.url ?? "")) continue;
            if (seen.has(source.url)) continue;
            seen.add(source.url);
            sources.push({ url: source.url, title: source.title?.trim() || null });
          }
          return {
            value: { query, text: result.text.trim(), sources } satisfies WebResult,
            costUsd: extractGatewayCostUsd({ providerMetadata: result.providerMetadata }),
            inputTokens: result.totalUsage.inputTokens ?? null,
            outputTokens: result.totalUsage.outputTokens ?? null,
          };
        },
      ),
    ),
  );
  const results: WebResult[] = [];
  let costUsd = 0;
  let failed = 0;
  for (const outcome of settled) {
    if (outcome.status === "fulfilled") {
      costUsd += outcome.value.costUsd;
      // An answer without a link has nothing to cite, so it is left out (it was still paid for).
      if (outcome.value.value.text && outcome.value.value.sources.length > 0) {
        results.push(outcome.value.value);
      }
    } else {
      failed += 1;
      console.error(
        "[brain-web] search failed",
        outcome.reason instanceof Error ? outcome.reason.message : outcome.reason,
      );
    }
  }
  return { results, costUsd, failed };
}
