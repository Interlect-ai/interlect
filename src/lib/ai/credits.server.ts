/**
 * Kreditter til analyser. En screening eller dyb analyse reserverer sit loft i
 * kreditbogen, før kørslen oprettes. Afregningen sker i databasen (0071, ai_settle_analysis_runs):
 * næste reservation bogfører den faktiske pris fra analysis_runs.actual_cost for færdige kørsler,
 * så ingen af afslutningsvejene i koden skal kende kreditterne. En kørsel i gang bliver altid færdig.
 * Enkelte AI-kald uden for analyser og Brain (fondsopsætningens AI-hjælpere, selskabssøgningen)
 * reserverer og afregner selv med reserveCallCredits.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { extractGatewayCostUsd } from "../analysis/gateway-response.ts";
import { AiDataPolicyError } from "./gateway-options.ts";
import { serverText } from "../i18n/server-text.ts";
import { translate } from "../i18n/translate.ts";
import { loadAnalysisMonth, monthLeftDkk } from "./analysis-month.server.ts";
import { limitAiUse } from "./usage-limits.server.ts";

/** The Danish text; a refusal is sent in the page's language (`serverText`). */
export const CREDITS_EXHAUSTED_MESSAGE = translate("da", "appServer.credits.exhausted");

/**
 * The team's monthly limit for analyses refused the reservation (0125). Its own class, so a run the
 * team lets shrink can be planned again on what is left of the month (`reservePlannedRun`).
 */
export class MonthlyLimitError extends Error {
  constructor(message: string = serverText("appServer.credits.monthlyLimit")) {
    super(message);
    this.name = "MonthlyLimitError";
  }
}

/**
 * Reserves the run's cap (USD) in the credit ledger and returns the ledger id. The run id is
 * the ledger's ref_id: that is how the database later settles the reservation. Throws
 * CREDITS_EXHAUSTED_MESSAGE when the balance cannot cover the cap (only while the installation
 * enforces credits, ai_settings.credits_enforced), and a sentence about the team's monthly limit
 * when that is what stopped it.
 */
export async function reserveAnalysisCredits(
  service: SupabaseClient,
  input: {
    fundId: string;
    runId: string;
    capUsd: number;
    /** The same cap in kroner: what the monthly limit must have room for. */
    capDkk: number;
    userId: string;
    model: string | null;
    kind: "screening" | "deep_analysis";
  },
): Promise<number> {
  const { data, error } = await service.rpc("ai_reserve", {
    _scope: "analysis",
    _fund_id: input.fundId,
    _max_usd: input.capUsd,
    _loop: null,
    _ref_id: input.runId,
    _model: input.model,
    _user_id: input.userId,
  });
  if (error) {
    // The database's own error is logged, never shown.
    console.error(`[credits] analysis reservation (fund ${input.fundId})`, error.message);
    throw new Error(serverText("appServer.credits.notReserved"));
  }
  if (data === null || data === undefined) {
    const left = monthLeftDkk(await loadAnalysisMonth(service, input.fundId));
    if (left !== null && left < input.capDkk) throw new MonthlyLimitError();
    throw new Error(serverText("appServer.credits.exhausted"));
  }
  const ledgerId = Number(data);
  // Per user and per team; a refused run gives its reservation back.
  try {
    await limitAiUse(service, { kind: input.kind, fundId: input.fundId, userId: input.userId });
  } catch (cause) {
    await releaseAnalysisCredits(service, ledgerId);
    throw cause;
  }
  return ledgerId;
}

/** Gives the reservation back when the run was never created. Never throws: it is cleanup. */
export async function releaseAnalysisCredits(
  service: SupabaseClient,
  ledgerId: number,
): Promise<void> {
  const { error } = await service.rpc("ai_release_usage", { _id: ledgerId });
  if (error) console.error(`[credits] reservation ${ledgerId} not released: ${error.message}`);
}

/** Shown when the balance cannot cover one of the AI helpers outside analyses and Brain. */
export const HELPER_CREDITS_EXHAUSTED_MESSAGE = translate(
  "da",
  "appServer.credits.helperExhausted",
);

/** The balance cannot cover the call (only while the installation enforces credits). */
export class CreditsExhaustedError extends Error {
  constructor(message: string = serverText("appServer.credits.helperExhausted")) {
    super(message);
    this.name = "CreditsExhaustedError";
  }
}

/**
 * One model call outside analyses and Brain: the fund setup's AI helpers and the company
 * search in Opret case. Before they never reserved, so an empty balance did not stop them.
 */
export interface CallCredits {
  /**
   * The call may have cost money (the gateway answered, or the request left and the answer was
   * lost), even when its answer is not used. The price is booked; an unknown price books the
   * reservation (like a completed run without a price) and never replaces a known one.
   */
  charge(costUsd: number | null): void;
  /** Books the charge, or gives the reservation back when nothing was charged. Never throws. */
  settle(): Promise<void>;
}

/**
 * Reserves the call's maximum in the credit ledger. Throws CreditsExhaustedError when the balance
 * cannot cover it, and a plain Error when the ledger cannot be reached. `loop` names the call in
 * the ledger (e.g. "fund_setup:criterion").
 */
export async function reserveCallCredits(
  service: SupabaseClient,
  input: {
    scope: "analysis" | "chat";
    fundId: string;
    userId: string | null;
    maxUsd: number;
    loop: string;
    model: string;
  },
): Promise<CallCredits> {
  const { data, error } = await service.rpc("ai_reserve", {
    _scope: input.scope,
    _fund_id: input.fundId,
    _max_usd: input.maxUsd,
    _loop: input.loop,
    _ref_id: null,
    _model: input.model,
    _user_id: input.userId,
  });
  if (error) {
    console.error(`[credits] ${input.loop} reservation (fund ${input.fundId})`, error.message);
    throw new Error(serverText("appServer.credits.notReserved"));
  }
  if (data === null || data === undefined) throw new CreditsExhaustedError();
  const ledgerId = Number(data);
  // A call a person started counts towards their and their team's hourly limit; a
  // refused call gives its reservation back.
  if (input.userId) {
    try {
      await limitAiUse(service, { kind: "helper", fundId: input.fundId, userId: input.userId });
    } catch (cause) {
      await releaseAnalysisCredits(service, ledgerId);
      throw cause;
    }
  }
  let chargedUsd: number | null = null;
  let priceKnown = false;
  let settled = false;
  return {
    charge(costUsd) {
      if (costUsd !== null && Number.isFinite(costUsd) && costUsd >= 0) {
        chargedUsd = costUsd;
        priceKnown = true;
      } else if (!priceKnown) {
        chargedUsd = input.maxUsd;
      }
    },
    async settle() {
      if (settled) return;
      settled = true;
      const { error: settleError } =
        chargedUsd === null
          ? await service.rpc("ai_release_usage", { _id: ledgerId })
          : await service.rpc("ai_finalize_usage", {
              _id: ledgerId,
              _cost_usd: chargedUsd,
              _model: input.model,
            });
      if (settleError) {
        console.error(`[credits] ${input.loop} reservation ${ledgerId} not settled`, {
          chargedUsd,
          error: settleError.message,
        });
      }
    },
  };
}

/**
 * Sends one gateway request for a reserved call and charges it: the price on an answer, the
 * reservation when the request left but no readable answer came back (a timeout, a lost
 * connection, a body that is not JSON). Nothing is charged when the data rules stopped the call
 * before it was sent, or when the gateway answered with an error status.
 */
export async function sendCharged<T>(
  credits: CallCredits,
  send: () => Promise<Response>,
): Promise<{ response: Response; body: T; costUsd: number | null }> {
  let response: Response;
  try {
    response = await send();
  } catch (cause) {
    if (!(cause instanceof AiDataPolicyError)) credits.charge(null);
    throw cause;
  }
  let body: T;
  try {
    body = (await response.json()) as T;
  } catch (cause) {
    if (response.ok) credits.charge(null);
    throw cause;
  }
  const costUsd = extractGatewayCostUsd(body);
  if (response.ok) credits.charge(costUsd);
  return { response, body, costUsd };
}
