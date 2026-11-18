import type { SupabaseClient } from "@supabase/supabase-js";
import { writeAudit } from "@/lib/auth/access.server";
import { BudgetExceededError, type PricedModel } from "@/lib/analysis/budgets";
import { getServiceClient } from "@/lib/supabase/admin.server";
import { callCheapGateway, knownHelperCost } from "./cheap-gateway.server";
import { serverText } from "@/lib/i18n/server-text";
import { limitAiUse } from "@/lib/ai/usage-limits.server";
import { releaseAnalysisCredits } from "@/lib/ai/credits.server";

/**
 * The paid AI help in the fund setup: each call is counted per fund per hour
 * in the audit log, reserved in the credit ledger like an analysis and settled with its real
 * price. Server only: the server functions in specialist-assist.functions.ts,
 * screening-assist.functions.ts and screening-trial.functions.ts use it, and keeping it out of
 * those files lets the page import them.
 */

/** "Stærk model": the medium level's model writes the drafts and checks them. */
const ASSIST_MODEL: PricedModel = "openai/gpt-5.4";
/** Drafts and checks per fund per hour (each about 0.1-0.2 kr). */
const ASSIST_CALLS_PER_HOUR = 30;
const ASSIST_AUDIT_ACTION = "fund_specialist_assist";

/**
 * Records the attempt in the audit log, then counts the fund's attempts in the last hour (the
 * attempt itself included, so parallel requests cannot all pass the count). A refused attempt
 * stays in the log.
 */
export async function recordAttempt(
  service: SupabaseClient,
  input: {
    fundId: string;
    userId: string;
    action: string;
    entity: string;
    entityId: string;
    payload: Record<string, unknown>;
    perHour: number;
    refusal: string;
  },
): Promise<void> {
  await writeAudit(service, {
    fundId: input.fundId,
    actorType: "user",
    actorId: input.userId,
    action: input.action,
    entity: input.entity,
    entityId: input.entityId,
    payload: input.payload,
  });
  const { count, error } = await service
    .from("audit_events")
    .select("id", { count: "exact", head: true })
    .eq("fund_id", input.fundId)
    .eq("action", input.action)
    .gte("occurred_at", new Date(Date.now() - 60 * 60 * 1000).toISOString());
  if (error) {
    console.error(`[specialist-assist] ${input.action} count`, error.code, error.message);
    throw new Error(serverText("fundServer.assist.notStarted"));
  }
  if ((count ?? 0) > input.perHour) throw new Error(input.refusal);
}

/** Reserves a call's cap in the credit ledger like an analysis (no run: `ref_id` is null). */
export async function reserveAssistCredits(
  service: SupabaseClient,
  input: { fundId: string; userId: string; capUsd: number; model: string },
): Promise<number> {
  const { data, error } = await service.rpc("ai_reserve", {
    _scope: "analysis",
    _fund_id: input.fundId,
    _max_usd: input.capUsd,
    _loop: null,
    _ref_id: null,
    _model: input.model,
    _user_id: input.userId,
  });
  if (error) {
    console.error(`[credits] assist reservation (fund ${input.fundId})`, error.message);
    throw new Error(serverText("fundServer.assist.creditsNotReserved"));
  }
  if (data === null || data === undefined)
    throw new Error(serverText("appServer.credits.exhausted"));
  const ledgerId = Number(data);
  // The same per-user and per-team limit as the other AI help; a refused call gives its
  // reservation back.
  try {
    await limitAiUse(service, { kind: "helper", fundId: input.fundId, userId: input.userId });
  } catch (cause) {
    await releaseAnalysisCredits(service, ledgerId);
    throw cause;
  }
  return ledgerId;
}

/**
 * The same rules as a finished analysis run (0071): a finished call books its price (the
 * reservation when the price is unknown), a failed call books what it is known to have cost, and
 * nothing is booked when nothing is known to have been paid. A failed booking is only logged:
 * the reservation is then released as hanging after 3 hours (ai_release_stale).
 */
export async function settleAssistCredits(
  service: SupabaseClient,
  ledgerId: number,
  input: {
    fundId: string;
    succeeded: boolean;
    costUsd: number | null;
    capUsd: number;
    model: string;
    inputTokens?: number | null;
    outputTokens?: number | null;
  },
): Promise<void> {
  const cost = input.succeeded ? (input.costUsd ?? input.capUsd) : (input.costUsd ?? 0);
  const { error } =
    cost > 0
      ? await service.rpc("ai_finalize_usage", {
          _id: ledgerId,
          _cost_usd: cost,
          _input_tokens: input.inputTokens ?? null,
          _output_tokens: input.outputTokens ?? null,
          _requests: 1,
          _model: input.model,
        })
      : await service.rpc("ai_release_usage", { _id: ledgerId });
  if (error) {
    console.error(`[credits] assist ${ledgerId} (fund ${input.fundId}) not settled`, error.message);
  }
}

/**
 * One paid helper call (draft or check) with its attempt, credits and a price-free failure. The
 * screening's check uses it too, counted under its own audit action.
 */
export async function paidHelperCall(
  input: {
    fundId: string;
    userId: string;
    configId: string;
    step: "draft" | "check";
    action?: string;
    /** What to say when the text is too long for the helper's budget. */
    tooLong?: string;
  },
  call: Omit<Parameters<typeof callCheapGateway>[0], "fundId" | "model" | "credits">,
): Promise<string> {
  const service = getServiceClient();
  await recordAttempt(service, {
    fundId: input.fundId,
    userId: input.userId,
    action: input.action ?? ASSIST_AUDIT_ACTION,
    entity: "fund_config_versions",
    entityId: input.configId,
    payload: { step: input.step },
    perHour: ASSIST_CALLS_PER_HOUR,
    refusal: serverText("fundServer.assist.rateLimited", { count: ASSIST_CALLS_PER_HOUR }),
  });
  const ledgerId = await reserveAssistCredits(service, {
    fundId: input.fundId,
    userId: input.userId,
    capUsd: call.budgetUsd,
    model: ASSIST_MODEL,
  });
  const settle = (succeeded: boolean, costUsd: number | null) =>
    settleAssistCredits(service, ledgerId, {
      fundId: input.fundId,
      succeeded,
      costUsd,
      capUsd: call.budgetUsd,
      model: ASSIST_MODEL,
    });
  try {
    const { content, costUsd } = await callCheapGateway({
      ...call,
      fundId: input.fundId,
      model: ASSIST_MODEL,
      credits: "reserved_by_caller",
    });
    await settle(true, costUsd);
    return content;
  } catch (cause) {
    // A call that was answered and then rejected books its known price, not 0.
    await settle(false, knownHelperCost(cause));
    // The budget message names dollars; the customer sees no prices (P13).
    if (cause instanceof BudgetExceededError) {
      console.error("[specialist-assist]", cause.message);
      throw new Error(input.tooLong ?? serverText("fundServer.assist.tooLong"));
    }
    // The helper's own failures carry a Danish message for the user.
    throw cause;
  }
}
