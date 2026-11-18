import type { SupabaseClient } from "@supabase/supabase-js";
import { BrainBudgetReachedError } from "../errors.ts";

/**
 * One paid call booked in the fund's chat budget: reserve its maximum, run it, settle the
 * real price, or release the reservation when it fails. The same three functions as the chat's
 * own reservation and the search's embeddings (brain_reserve_budget, brain_finalize_usage,
 * brain_release_usage), so the price shows up in the budget and in the answer's cost.
 */
export async function bookedCall<T>(
  service: SupabaseClient,
  input: { fundId: string; maxUsd: number; model: string; userId?: string | null },
  run: () => Promise<{
    value: T;
    costUsd: number | null;
    inputTokens?: number | null;
    outputTokens?: number | null;
  }>,
): Promise<{ value: T; costUsd: number }> {
  const { data: usageId, error } = await service.rpc("brain_reserve_budget", {
    _fund_id: input.fundId,
    _scope: "chat",
    _max_usd: input.maxUsd,
    _loop: null,
    _ref_id: null,
    _model: input.model,
    _user_id: input.userId ?? null,
  });
  if (error) throw new Error(`brain_reserve_budget: ${error.message}`);
  if (usageId === null || usageId === undefined) throw new BrainBudgetReachedError("chat");
  let outcome: Awaited<ReturnType<typeof run>>;
  try {
    outcome = await run();
  } catch (cause) {
    // A call stopped after it was sent may have been charged; the price is unknown, so it costs
    // its maximum (as the screening). Any other failure gives the reservation back.
    if (cause instanceof Error && ["TimeoutError", "AbortError"].includes(cause.name)) {
      const { error: finalizeError } = await service.rpc("brain_finalize_usage", {
        _usage_id: usageId,
        _fund_id: input.fundId,
        _cost_usd: input.maxUsd,
        _input_tokens: null,
        _output_tokens: null,
      });
      if (finalizeError) console.error("[brain-web] timeout not settled", finalizeError.code);
      throw cause;
    }
    const { error: releaseError } = await service.rpc("brain_release_usage", {
      _usage_id: usageId,
      _fund_id: input.fundId,
    });
    if (releaseError) console.error("[brain-web] reservation not released", releaseError.code);
    throw cause;
  }
  // A call that reports no price is booked at its maximum, never at zero.
  const costUsd = Math.min(outcome.costUsd ?? input.maxUsd, input.maxUsd);
  const { error: finalizeError } = await service.rpc("brain_finalize_usage", {
    _usage_id: usageId,
    _fund_id: input.fundId,
    _cost_usd: costUsd,
    _input_tokens: outcome.inputTokens ?? null,
    _output_tokens: outcome.outputTokens ?? null,
  });
  // The call is paid for: a failed settle is logged (the stale reservation is swept later), never
  // allowed to throw the result away.
  if (finalizeError) {
    console.error("[brain-web] settle failed", { usageId, costUsd, error: finalizeError.message });
  }
  return { value: outcome.value, costUsd };
}
