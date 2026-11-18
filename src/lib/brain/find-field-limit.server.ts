import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Counts one figure search for this user in the fund, or returns false when the user has had
 * `perMinute` in the last minute. The count is one atomic row in the database (0101) taken
 * before anything is paid, so a search without material or web results (still an embedding and a
 * web query) is counted, and parallel clicks cannot slip past the limit. A refused search is not
 * counted; a database that cannot answer refuses (no paid search starts without a count).
 */
export async function countFieldSearch(
  service: SupabaseClient,
  input: { fundId: string; userId: string; perMinute: number },
): Promise<boolean> {
  const { data, error } = await service.rpc("rate_limit_hit_all", {
    _keys: [`brain:find_field:fund:${input.fundId}:user:${input.userId}`],
    _limits: [input.perMinute],
    _window_seconds: 60,
  });
  if (error || typeof data !== "number") {
    console.error("[find-field] rate limit", error?.message ?? "no answer");
    return false;
  }
  return data === 0;
}
