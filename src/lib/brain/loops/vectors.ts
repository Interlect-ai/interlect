import type { LoopContext } from "../worker.server";
import { embedWithGateway, type BrainEmbedder } from "../embeddings.server";
import { BrainBudgetReachedError } from "../errors";
import { readForgetGeneration, storeVectorsChecked } from "./forget-guard";
import { embedWithBudget } from "./shared";

/** Facts embedded per night; the rest wait for the next one (a fact searches only with a vector). */
export const FACT_VECTOR_LIMIT = 100;
/** The text a fact keeps when "Glem" emptied its wording; there is nothing to embed. */
const EMPTIED = "[kilde slettet]";

export type VectorSweepStats = { found: number; stored: number; stopped?: "budget" | "forgotten" };

/**
 * L4 step "vectors": extracted facts whose vector was not stored (a "Glem" since the run
 * read its data, a failed write) never got one, and a search skips a fact without a vector. This
 * embeds up to FACT_VECTOR_LIMIT of them, the oldest first, on the fund's "learning" budget, and
 * stores them only where there is still none and nothing was forgotten since the facts were read.
 */
export async function embedFactsWithoutVector(
  ctx: LoopContext,
  embed: BrainEmbedder = embedWithGateway,
): Promise<{ output: VectorSweepStats; costUsd: number }> {
  // Before the texts: a "Glem" while the embedding runs makes the store refuse them.
  const generation = await readForgetGeneration(ctx.service, ctx.fundId);
  const { data, error } = await ctx.service
    .from("brain_facts")
    .select("id, statement")
    .eq("fund_id", ctx.fundId)
    .eq("origin", "extracted")
    .eq("status", "active")
    .is("expired_at", null)
    .is("embedding", null)
    .neq("statement", EMPTIED)
    .order("created_at", { ascending: true })
    .limit(FACT_VECTOR_LIMIT);
  if (error) throw new Error(`brain_facts without vector: ${error.message}`);
  const rows = (data ?? []).map((row) => ({
    id: row["id"] as string,
    statement: row["statement"] as string,
  }));
  if (rows.length === 0) return { output: { found: 0, stored: 0 }, costUsd: 0 };

  let embedded;
  try {
    embedded = await embedWithBudget(
      ctx,
      rows.map((row) => row.statement),
      ctx.jobId,
      embed,
    );
  } catch (cause) {
    // A night without the free budget still runs the other steps; the facts wait.
    if (cause instanceof BrainBudgetReachedError) {
      return { output: { found: rows.length, stored: 0, stopped: "budget" }, costUsd: 0 };
    }
    throw cause;
  }
  const result = await storeVectorsChecked(
    ctx.service,
    ctx.fundId,
    generation,
    rows.map((row, index) => ({
      table: "fact" as const,
      id: row.id,
      embedding: embedded.embeddings[index]!,
      onlyIfNull: true,
    })),
  );
  return {
    output: {
      found: rows.length,
      stored: result.stored,
      ...(result.forgotten ? { stopped: "forgotten" as const } : {}),
    },
    costUsd: embedded.costUsd,
  };
}
