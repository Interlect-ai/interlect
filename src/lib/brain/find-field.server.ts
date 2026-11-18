import { jsonSchema, Output } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { aiGatewayOptions } from "@/lib/ai/gateway-options";
import { generateText, maskedModel } from "@/lib/ai/model-call";
import { redactorForFund } from "@/lib/ai/redact-dictionary.server";
import { extractGatewayCostUsd } from "@/lib/analysis/gateway-response";
import type { ManualFinancialMetric } from "@/lib/analysis/manual-financials";
import type { Language } from "@/lib/i18n/language";
import { bookedCall } from "./web/booked.server";
import { runWebSearch } from "./web/search.server";
import { sanitizeWebQueries } from "./web/queries";
import { searchBrain } from "./retrieval.server";
import {
  FIND_FIELD_SCHEMA,
  FIND_FIELD_SYSTEM,
  caseMaterialQuery,
  findFieldPrompt,
  verifyFindAnswer,
  webQueryFor,
  type FieldProposal,
  type FindFieldAnswer,
  type FindSource,
} from "./find-field";

export const FIND_FIELD_MODEL = "openai/gpt-5.4-mini";
/** The most one extraction may cost: a few thousand tokens in and a few hundred out, mini model. */
const FIND_FIELD_MAX_USD = 0.02;
/** How many pieces of the case's own material are read for one figure. */
const MATERIAL_ITEMS = 6;

export type FoundProposal = FieldProposal & { id: string };

export type FindFieldOutcome =
  | { status: "found"; proposal: FoundProposal; costUsd: number }
  | { status: "not_found"; costUsd: number; searched: Array<"case_material" | "web"> };

/** Reads the sources with the model and checks the answer in code. Null = not found. */
async function extract(
  service: SupabaseClient,
  input: {
    fundId: string;
    userId: string;
    companyName: string;
    metric: ManualFinancialMetric;
    fiscalYear: number;
    sources: readonly FindSource[];
  },
): Promise<{ proposal: FieldProposal | null; costUsd: number }> {
  if (input.sources.length === 0) return { proposal: null, costUsd: 0 };
  const gatewayOptions = aiGatewayOptions({ model: FIND_FIELD_MODEL, data: "confidential" });
  const redactor = await redactorForFund(input.fundId, "brain_find_field", service);
  const { value, costUsd } = await bookedCall(
    service,
    {
      fundId: input.fundId,
      userId: input.userId,
      maxUsd: FIND_FIELD_MAX_USD,
      model: FIND_FIELD_MODEL,
    },
    async () => {
      const result = await generateText({
        model: maskedModel(FIND_FIELD_MODEL, redactor),
        system: FIND_FIELD_SYSTEM,
        prompt: findFieldPrompt(input),
        maxOutputTokens: 500,
        ...(gatewayOptions ? { providerOptions: gatewayOptions } : {}),
        abortSignal: AbortSignal.timeout(40_000),
        output: Output.object({
          name: "interlect_find_field_v1",
          schema: jsonSchema<FindFieldAnswer>(
            FIND_FIELD_SCHEMA as unknown as Parameters<typeof jsonSchema>[0],
          ),
        }),
      });
      return {
        value: result.output ?? null,
        costUsd: extractGatewayCostUsd({ providerMetadata: result.providerMetadata }),
        inputTokens: result.totalUsage.inputTokens ?? null,
        outputTokens: result.totalUsage.outputTokens ?? null,
      };
    },
  );
  const verified = verifyFindAnswer(value, input);
  if (!verified.proposal && verified.reason !== "not_found") {
    // The model claimed a figure the sources do not back up: logged, never shown.
    console.warn("[find-field] answer rejected", verified.reason);
  }
  return { proposal: verified.proposal, costUsd };
}

/**
 * Looks for ONE missing figure: first in the case's own material (deck, website, notes,
 * everything Brain holds for the case), then, only if that gave nothing, on the web with one query.
 * The answer is stored as a proposal with its source; nothing reaches the case until a person
 * presses "Sæt ind" (`acceptFieldProposal`). Callers check access; ids come from the server.
 */
export async function findFieldWithBrain(
  service: SupabaseClient,
  input: {
    fundId: string;
    caseId: string;
    userId: string;
    metric: ManualFinancialMetric;
    fiscalYear: number;
    language: Language;
  },
): Promise<FindFieldOutcome> {
  const { data: caseRow, error } = await service
    .from("cases")
    .select("companies(name)")
    .eq("fund_id", input.fundId)
    .eq("id", input.caseId)
    .maybeSingle();
  if (error) throw new Error(`find-field case: ${error.message}`);
  if (!caseRow) throw new Error("find-field: case not in fund");
  const company = Array.isArray(caseRow["companies"])
    ? caseRow["companies"][0]
    : caseRow["companies"];
  const companyName = ((company as { name?: string } | null)?.name ?? "").trim();
  if (!companyName) throw new Error("find-field: case has no company name");

  let costUsd = 0;
  const searched: Array<"case_material" | "web"> = [];
  const common = {
    fundId: input.fundId,
    userId: input.userId,
    companyName,
    metric: input.metric,
    fiscalYear: input.fiscalYear,
  };

  // 1. The case's own material.
  searched.push("case_material");
  const retrieved = await searchBrain(service, {
    fundId: input.fundId,
    caseId: input.caseId,
    query: caseMaterialQuery(input.metric, input.fiscalYear, input.language),
    scope: "chat",
  });
  costUsd += retrieved.costUsd;
  const material: FindSource[] = retrieved.items
    .filter((item) => item.caseId === input.caseId && item.kind !== "entity")
    .slice(0, MATERIAL_ITEMS)
    .map((item) => ({
      kind: "case_material" as const,
      text: item.text,
      title: item.title,
      url: null,
    }));
  const fromMaterial = await extract(service, { ...common, sources: material });
  costUsd += fromMaterial.costUsd;
  let proposal = fromMaterial.proposal;

  // 2. The web: one query with the company's name and the figure, nothing else.
  if (!proposal) {
    const { queries } = sanitizeWebQueries([
      webQueryFor(companyName, input.metric, input.fiscalYear),
    ]);
    if (queries.length > 0) {
      searched.push("web");
      const web = await runWebSearch(service, {
        fundId: input.fundId,
        userId: input.userId,
        queries,
      });
      costUsd += web.costUsd;
      // A search that failed is not "nothing found": the person must be told to try again.
      if (web.failed > 0 && web.results.length === 0) {
        throw new Error(`find-field: web search failed (${web.failed}/${queries.length})`);
      }
      const sources: FindSource[] = web.results.map((result) => ({
        kind: "web" as const,
        text: result.text,
        title: result.sources[0]?.title ?? null,
        url: result.sources[0]?.url ?? null,
      }));
      const fromWeb = await extract(service, { ...common, sources });
      costUsd += fromWeb.costUsd;
      proposal = fromWeb.proposal;
    }
  }

  if (!proposal) return { status: "not_found", costUsd, searched };

  // Only one open proposal per figure: an older, unanswered one is replaced by this one.
  const { error: supersedeError } = await service
    .from("case_field_proposals")
    .update({ status: "dismissed", resolved_at: new Date().toISOString() })
    .eq("fund_id", input.fundId)
    .eq("case_id", input.caseId)
    .eq("metric", proposal.metric)
    .eq("fiscal_year", proposal.fiscalYear)
    .eq("status", "proposed");
  if (supersedeError) {
    throw new Error(`find-field supersede: ${supersedeError.message}`);
  }
  const { data: row, error: insertError } = await service
    .from("case_field_proposals")
    .insert({
      fund_id: input.fundId,
      case_id: input.caseId,
      metric: proposal.metric,
      fiscal_year: proposal.fiscalYear,
      value: proposal.value,
      currency: proposal.currency,
      certainty: proposal.certainty,
      source_kind: proposal.sourceKind,
      source_title: proposal.sourceTitle,
      source_url: proposal.sourceUrl,
      quote: proposal.quote,
      created_by: input.userId,
    })
    .select("id")
    .single();
  if (insertError || !row) {
    throw new Error(
      `find-field insert (fund ${input.fundId}, case ${input.caseId}, ${input.metric} ${input.fiscalYear}): ${insertError?.message ?? "no row"}`,
    );
  }
  return { status: "found", proposal: { ...proposal, id: row["id"] as string }, costUsd };
}
