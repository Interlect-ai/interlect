import type { SupabaseClient } from "@supabase/supabase-js";
import { embedWithGateway, type BrainEmbedder } from "../embeddings.server";
import { BrainUserError } from "../errors";
import { recallAtK } from "../retrieval";
import { searchBrain } from "../retrieval.server";
import {
  DEMO_EVAL_SET,
  DEMO_FUND_SLUG,
  demoCaseId,
  demoId,
  evalFactsColumn,
  facitPoints,
  staticRef,
  trackOf,
  type DemoEvalItem,
} from "./demo-set";

/**
 * Runs the demo test set through the search engine: stores the questions in
 * brain_eval_items (stable ids, so a rerun updates them), searches each one with the case as
 * context when it has one, measures recall@20 and stores the run in brain_eval_runs. Only for
 * the demo fund, whose ids the set is written against. Every search is logged like any other.
 */
export const EVAL_K = 20;
/** Acceptance: recall@20 on the demo set >= 0.85. */
export const EVAL_TARGET = 0.85;

export type EvalItemResult = {
  question: string;
  category: DemoEvalItem["category"];
  expected: number;
  found: number;
  recall: number | null;
  /** Expected refs that were not in the first 20 results. */
  missing: string[];
};

export async function runDemoEval(
  service: SupabaseClient,
  fundId: string,
  embed: BrainEmbedder = embedWithGateway,
): Promise<{
  runId: string;
  recallAt20: number;
  target: number;
  costUsd: number;
  items: EvalItemResult[];
}> {
  const { data: fund, error: fundError } = await service
    .from("funds")
    .select("slug")
    .eq("id", fundId)
    .maybeSingle();
  if (fundError) throw new Error(`eval fund: ${fundError.message}`);
  if (fund?.["slug"] !== DEMO_FUND_SLUG) {
    throw new BrainUserError("Testsættet hører til demo-fonden.");
  }

  const items: EvalItemResult[] = [];
  let costUsd = 0;
  for (const [index, item] of DEMO_EVAL_SET.entries()) {
    const expected = await resolveRefs(service, fundId, item);
    const caseId = item.caseIndex === null ? null : demoCaseId(item.caseIndex);
    await upsertEvalItem(service, fundId, index, item, expected);

    const result = await searchBrain(
      service,
      { fundId, query: item.question, caseId, scope: "learning" },
      embed,
    );
    costUsd += result.costUsd;
    const retrieved = result.items.flatMap((hit) => hit.refs);
    const top = new Set(retrieved);
    const recall = recallAtK(expected, retrieved, retrieved.length);
    items.push({
      question: item.question,
      category: item.category,
      expected: expected.length,
      found: expected.filter((ref) => top.has(ref)).length,
      recall,
      missing: expected.filter((ref) => !top.has(ref)),
    });
  }

  const counted = items.filter((item) => item.recall !== null);
  const recallAt20 = counted.length
    ? counted.reduce((sum, item) => sum + (item.recall ?? 0), 0) / counted.length
    : 0;
  const { data: run, error: runError } = await service
    .from("brain_eval_runs")
    .insert({
      fund_id: fundId,
      variant: "prod:retrieval-v1",
      results: items,
      scores: { recall_at_20: Number(recallAt20.toFixed(4)), items: counted.length },
      cost_usd: Number(costUsd.toFixed(6)),
    })
    .select("id")
    .single();
  if (runError) throw new Error(`brain_eval_runs: ${runError.message}`);
  return {
    runId: run["id"] as string,
    recallAt20: Number(recallAt20.toFixed(4)),
    target: EVAL_TARGET,
    costUsd: Number(costUsd.toFixed(6)),
    items,
  };
}

/**
 * The question as a brain_eval_items row (a stable id, so a rerun updates it), with its graded
 * points, track and regression flag (0059). The track is always written with is_holdout: 0059
 * requires them to agree, and the set's holdout questions are not the ones of 0043.
 */
export async function upsertEvalItem(
  service: SupabaseClient,
  fundId: string,
  index: number,
  item: DemoEvalItem,
  expected: string[],
): Promise<void> {
  const track = trackOf(index);
  const { error } = await service.from("brain_eval_items").upsert(
    {
      id: demoId(`eval-${index}`),
      fund_id: fundId,
      question: item.question,
      case_id: item.caseIndex === null ? null : demoCaseId(item.caseIndex),
      expected_facts: evalFactsColumn(item),
      expected_refs: expected,
      category: item.category,
      origin: "seed",
      is_holdout: track !== "dev",
      facit: facitPoints(item),
      track,
      regression: item.regression === true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );
  if (error) throw new Error(`brain_eval_items: ${error.message}`);
}

/** The "table:id" refs of an item; decision refs are the case's decision episodes' sources. */
export async function resolveRefs(
  service: SupabaseClient,
  fundId: string,
  item: DemoEvalItem,
): Promise<string[]> {
  const refs: string[] = [];
  for (const ref of item.expected) {
    // Similar cases are not search results; they are measured on the similar search.
    if (ref.kind === "case") continue;
    const fixed = staticRef(ref);
    if (fixed) {
      refs.push(fixed);
      continue;
    }
    if (ref.kind !== "decisions") continue;
    const { data, error } = await service
      .from("brain_episodes")
      .select("ref_id")
      .eq("fund_id", fundId)
      .eq("case_id", demoCaseId(ref.caseIndex))
      .eq("kind", "decision")
      .eq("ref_table", "case_transition_events");
    if (error) throw new Error(`eval decisions: ${error.message}`);
    for (const row of data ?? []) refs.push(`case_transition_events:${row["ref_id"] as string}`);
  }
  return [...new Set(refs)];
}
