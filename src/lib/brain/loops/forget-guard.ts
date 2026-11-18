import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * "Glem" while a loop is mid-call. A loop that writes what it read before a
 * model or embedding call reads the fund's forget counter first, before the data, and writes
 * through a function that stores nothing if something was forgotten since: the forgetting may
 * have masked the text it read. L4's pages do the same (brain_save_page).
 */

/** The fund's forget counter; read it before the data the later write is based on. */
export async function readForgetGeneration(
  service: SupabaseClient,
  fundId: string,
): Promise<number> {
  const { data, error } = await service.rpc("brain_forget_generation", { _fund_id: fundId });
  if (error) throw new Error(`brain_forget_generation: ${error.message}`);
  if (typeof data !== "number" || !Number.isSafeInteger(data) || data < 0) {
    throw new Error(`brain_forget_generation: unexpected value ${String(data)}`);
  }
  return data;
}

export interface VectorRow {
  table: "chunk" | "fact" | "entity";
  id: string;
  embedding: readonly number[];
  model?: string;
  /** Only where the row has no vector yet. */
  onlyIfNull?: boolean;
  /** Never a case entity (its profile vector is L0's). */
  notCase?: boolean;
}

/** About 25 × 1536 numbers per call, well under the request limit. */
const VECTOR_ROWS_PER_CALL = 25;

/**
 * Stores the vectors unless something was forgotten since `generation` (brain_store_vectors).
 * `forgotten` means the rest was not stored; the rows keep no vector, and the next run embeds
 * the masked text.
 */
export async function storeVectorsChecked(
  service: SupabaseClient,
  fundId: string,
  generation: number,
  rows: readonly VectorRow[],
): Promise<{ stored: number; forgotten: boolean }> {
  let stored = 0;
  for (let start = 0; start < rows.length; start += VECTOR_ROWS_PER_CALL) {
    const slice = rows.slice(start, start + VECTOR_ROWS_PER_CALL);
    const { data, error } = await service.rpc("brain_store_vectors", {
      _fund_id: fundId,
      _forget_generation: generation,
      _rows: slice.map((row) => ({ ...row, embedding: JSON.stringify(row.embedding) })),
    });
    if (error) throw new Error(`brain_store_vectors: ${error.message}`);
    const result = (data ?? {}) as { stored?: unknown; skipped?: unknown };
    if (result.skipped === "forgotten") return { stored, forgotten: true };
    stored += Number(result.stored ?? 0);
  }
  return { stored, forgotten: false };
}
