import type { SupabaseClient } from "@supabase/supabase-js";
import { AiDataPolicyError, aiGatewayOptions } from "../ai/gateway-options";
import { embed } from "../ai/model-call";
import { redactorForFund } from "../ai/redact-dictionary.server";
import { isFundMemoryEnabled } from "./gateway-security";
import { assertWithinBudget, estimateRequestMaximumUsd } from "./budgets";
import type { RelatedPastCaseInput } from "./prompt";
import { requestLanguage } from "../i18n/server-text.ts";

const FUND_MEMORY_EMBEDDING_MODEL = "openai/text-embedding-3-small";

/**
 * A single short embedding call costs a fraction of a cent -- capped on its
 * own rather than threaded through the screening/deep budget ledgers, which
 * are scoped to the two-stage LLM calls those pipelines already account for.
 */
const MEMORY_EMBEDDING_CEILING_USD = 0.01;

type MemoryDecision = "invested" | "closed_without_investment";

/**
 * Why a run did or did not get related past cases, kept on the run (validation_result.fundMemory)
 * so "blocked" or "failed" is never read as "no similar cases".
 */
export type FundMemoryStatus = "ok" | "off" | "blocked" | "failed";

export interface FundMemoryResult {
  cases: RelatedPastCaseInput[];
  status: FundMemoryStatus;
}

type MemoryEmbedding = { status: "ok"; embedding: number[] } | { status: "blocked" | "failed" };

/**
 * Never throws: a failed embedding call means fund memory is unavailable for this call, not a
 * broken screening/deep run or a lost decision. Errors are logged with `where` (the fund and the
 * case or investment), and "blocked" (stopped by the data rules, nothing sent) is told apart.
 */
async function embedMemoryText(
  value: string,
  fund: { service: SupabaseClient; fundId: string },
  where: string,
): Promise<MemoryEmbedding> {
  try {
    const gatewayOptions = aiGatewayOptions({
      model: FUND_MEMORY_EMBEDDING_MODEL,
      data: "confidential",
    });
    const estimate = estimateRequestMaximumUsd({
      model: FUND_MEMORY_EMBEDDING_MODEL,
      requestBody: { model: FUND_MEMORY_EMBEDDING_MODEL, value },
      maxOutputTokens: 0,
    });
    assertWithinBudget(
      estimate,
      MEMORY_EMBEDDING_CEILING_USD,
      "Fondens hukommelse",
      requestLanguage(),
    );
    const { embedding } = await embed({
      model: FUND_MEMORY_EMBEDDING_MODEL,
      value,
      redactor: await redactorForFund(fund.fundId, "fund_memory", fund.service),
      ...(gatewayOptions ? { providerOptions: gatewayOptions } : {}),
    });
    return { status: "ok", embedding };
  } catch (cause) {
    if (cause instanceof AiDataPolicyError) {
      console.error(`Fondens hukommelse er stoppet af datareglerne (${where}): ${cause.code}`);
      return { status: "blocked" };
    }
    // The message only: the request carries the team's decision note (harden L3).
    console.error(
      `Kunne ikke generere embedding til fondens hukommelse (${where}):`,
      cause instanceof Error ? cause.message : String(cause),
    );
    return { status: "failed" };
  }
}

function buildMemorySummary(input: {
  companyName: string;
  sector: string | null;
  geography: string | null;
  stage: string | null;
  decision: MemoryDecision;
  context: string;
}): string {
  const decisionLabel = input.decision === "invested" ? "Investeret" : "Afsluttet uden investering";
  return [
    `${input.companyName} -- ${decisionLabel}.`,
    input.sector ? `Sektor: ${input.sector}.` : null,
    input.stage ? `Stadie: ${input.stage}.` : null,
    input.geography ? `Geografi: ${input.geography}.` : null,
    input.context ? input.context : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join(" ");
}

/** Deterministic, no extra AI call -- built purely from already-known fields. */
export function buildMemoryQueryText(input: {
  companyName: string;
  sector: string | null;
  geography: string | null;
  stage: string;
  description: string | null;
}): string {
  return [
    input.companyName,
    input.sector ? `Sektor: ${input.sector}.` : null,
    `Stadie: ${input.stage}.`,
    input.geography ? `Geografi: ${input.geography}.` : null,
    input.description ? input.description.slice(0, 500) : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join(" ");
}

/** A decided case's entry text; the reconcile compares it with the stored one. */
export function caseMemorySummary(input: {
  companyName: string;
  sector: string | null;
  geography: string | null;
  stage: string | null;
  decision: MemoryDecision;
  reason: string;
}): string {
  return buildMemorySummary({
    companyName: input.companyName,
    sector: input.sector,
    geography: input.geography,
    stage: input.stage,
    decision: input.decision,
    context: `Begrundelse: ${input.reason}`,
  });
}

/**
 * The moment a case turns from "Interlect's analysis" into "the fund's own decided
 * history". Called in the background from transitionCases (scheduleMemoryReconcile, after the
 * Fortryd window) -- never blocks the decision itself, and a failure here never undoes it.
 */
export async function writeCaseMemoryEntry(input: {
  service: SupabaseClient;
  fundId: string;
  caseId: string;
  companyName: string;
  sector: string | null;
  geography: string | null;
  stage: string | null;
  decision: MemoryDecision;
  /** The day of the decision; null for a case decided before the transition log. */
  decidedAt: string | null;
  reason: string;
}): Promise<void> {
  if (!isFundMemoryEnabled()) return;
  const summary = caseMemorySummary(input);
  const embedded = await embedMemoryText(
    summary,
    input,
    `fond ${input.fundId}, case ${input.caseId}`,
  );
  if (embedded.status !== "ok") return;
  const { embedding } = embedded;

  const { error: deleteError } = await input.service
    .from("fund_memory_entries")
    .delete()
    .eq("fund_id", input.fundId)
    .eq("case_id", input.caseId);
  if (deleteError) {
    console.error(
      `Kunne ikke opdatere fondens hukommelse for case ${input.caseId}:`,
      deleteError.message,
    );
    return;
  }
  const { error: insertError } = await input.service.from("fund_memory_entries").insert({
    fund_id: input.fundId,
    case_id: input.caseId,
    company_name: input.companyName,
    sector: input.sector,
    geography: input.geography,
    stage: input.stage,
    decision: input.decision,
    decided_at: input.decidedAt,
    summary_text: summary,
    embedding,
    embedding_model: FUND_MEMORY_EMBEDDING_MODEL,
  });
  if (insertError)
    console.error(
      `Kunne ikke skrive fondens hukommelse for case ${input.caseId}:`,
      insertError.message,
    );
}

/**
 * The second source of fund memory: manually logged historical investments
 * that predate Interlect.ai. Called as a fire-and-forget tail on
 * saveHistoricalInvestment.
 */
export async function writeHistoricalMemoryEntry(input: {
  service: SupabaseClient;
  fundId: string;
  historicalInvestmentId: string;
  companyName: string;
  sector: string | null;
  geography: string | null;
  stage: string | null;
  investedAt: string | null;
  note: string;
}): Promise<void> {
  if (!isFundMemoryEnabled()) return;
  const summary = buildMemorySummary({
    companyName: input.companyName,
    sector: input.sector,
    geography: input.geography,
    stage: input.stage,
    decision: "invested",
    context: input.note,
  });
  const embedded = await embedMemoryText(
    summary,
    input,
    `fond ${input.fundId}, tidligere investering ${input.historicalInvestmentId}`,
  );
  if (embedded.status !== "ok") return;
  const { embedding } = embedded;

  const { error: deleteError } = await input.service
    .from("fund_memory_entries")
    .delete()
    .eq("historical_investment_id", input.historicalInvestmentId);
  if (deleteError) {
    console.error(
      `Kunne ikke opdatere fondens hukommelse for tidligere investering ${input.historicalInvestmentId}:`,
      deleteError.message,
    );
    return;
  }
  const { error: insertError } = await input.service.from("fund_memory_entries").insert({
    fund_id: input.fundId,
    historical_investment_id: input.historicalInvestmentId,
    company_name: input.companyName,
    sector: input.sector,
    geography: input.geography,
    stage: input.stage,
    decision: "invested",
    decided_at: input.investedAt,
    summary_text: summary,
    embedding,
    embedding_model: FUND_MEMORY_EMBEDDING_MODEL,
  });
  if (insertError)
    console.error(
      `Kunne ikke skrive fondens hukommelse for tidligere investering ${input.historicalInvestmentId}:`,
      insertError.message,
    );
}

interface MatchFundMemoryRow {
  memory_entry_id: string;
  company_name: string;
  sector: string | null;
  geography: string | null;
  stage: string | null;
  decision: MemoryDecision;
  decided_at: string | null;
  summary_text: string;
  similarity: number;
}

/**
 * Retrieval happens once per run (never at page-render time), so the
 * citation the UI later shows always matches what the model actually saw.
 * Persists the result to case_memory_matches (delete-then-reinsert) so
 * getCaseDetail can read it without another embedding call.
 */
export async function retrieveFundMemory(input: {
  service: SupabaseClient;
  fundId: string;
  caseId: string;
  runId: string | null;
  queryText: string;
  limit?: number;
}): Promise<FundMemoryResult> {
  if (!isFundMemoryEnabled()) return { cases: [], status: "off" };
  // Ryd tidligere match FØRST, uanset hvad der sker herunder: en fejlet
  // embedding eller RPC-kald skal aldrig lade et ældre runs match stå
  // tilbage og blive vist, som var det denne kørsels resultat.
  const { error: deleteError } = await input.service
    .from("case_memory_matches")
    .delete()
    .eq("case_id", input.caseId);
  if (deleteError)
    console.error(
      `Kunne ikke rydde tidligere match for case ${input.caseId}:`,
      deleteError.message,
    );
  // i18n-keep: the log label ("where") for the embedding call, never shown to the person.
  try {
    const embedded = await embedMemoryText(
      input.queryText,
      input,
      `fond ${input.fundId}, case ${input.caseId}, kørsel ${input.runId ?? "ingen"}`,
    );
    if (embedded.status !== "ok") return { cases: [], status: embedded.status };
    const { embedding } = embedded;
    const { data: rows, error } = await input.service.rpc("match_fund_memory", {
      _fund_id: input.fundId,
      _query_embedding: embedding,
      _exclude_case_id: input.caseId,
      _match_count: input.limit ?? 5,
    });
    if (error || !rows) {
      console.error(`match_fund_memory fejlede for case ${input.caseId}:`, error?.message);
      return { cases: [], status: "failed" };
    }
    const matches = rows as MatchFundMemoryRow[];

    if (matches.length > 0) {
      const { error: matchInsertError } = await input.service.from("case_memory_matches").insert(
        matches.map((match) => ({
          fund_id: input.fundId,
          case_id: input.caseId,
          run_id: input.runId,
          memory_entry_id: match.memory_entry_id,
          similarity: match.similarity,
        })),
      );
      if (matchInsertError)
        console.error(
          `Kunne ikke gemme fund-memory-match for case ${input.caseId}:`,
          matchInsertError.message,
        );
    }

    return {
      cases: matches.map((match) => ({
        companyName: match.company_name,
        sector: match.sector,
        geography: match.geography,
        stage: match.stage,
        decision: match.decision,
        decidedAt: match.decided_at,
        summary: match.summary_text,
        similarity: match.similarity,
      })),
      status: "ok",
    };
  } catch (cause) {
    console.error(`Fondens hukommelse kunne ikke hentes for case ${input.caseId}:`, cause);
    return { cases: [], status: "failed" };
  }
}
