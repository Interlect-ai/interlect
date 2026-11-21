import type { SupabaseClient } from "@supabase/supabase-js";
import { serverText } from "../i18n/server-text.ts";

/** The team's monthly limit for analyses and what it has used this month, in kroner (0125). */
export interface AnalysisMonth {
  /** Null = no monthly limit. Inside the installation's hard limit. */
  capDkk: number | null;
  /** Reserved runs count with their cap, settled runs with their price. */
  usedDkk: number;
}

/** Money is at stake: a failed read stops what asked, it never reads as "no limit". */
export async function loadAnalysisMonth(
  service: SupabaseClient,
  fundId: string,
): Promise<AnalysisMonth> {
  // Finished runs count with their real price: settle first (0118), or a run that cost 2 kr. would
  // still count with the whole limit it reserved, and the month would look fuller than it is.
  const { error: settleError } = await service.rpc("ai_settle_now");
  if (settleError) {
    // The database's own text goes to the server log only, never to the person.
    console.error("[analysis-month] settle failed", fundId, settleError.message);
    throw new Error(serverText("appServer.credits.monthNotRead"));
  }
  const { data, error } = await service.rpc("fund_analysis_month", { _fund_id: fundId });
  if (error) {
    console.error("[analysis-month] month could not be read", fundId, error.message);
    throw new Error(serverText("appServer.credits.monthNotRead"));
  }
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null | undefined;
  const cap = row?.["cap_dkk"];
  return {
    capDkk: cap === null || cap === undefined ? null : Number(cap),
    usedDkk: Number(row?.["used_dkk"] ?? 0),
  };
}

/** What is left of the month in kroner, rounded down to whole øre; null = no monthly limit. */
export function monthLeftDkk(month: AnalysisMonth): number | null {
  if (month.capDkk === null) return null;
  return Math.max(0, Math.floor((month.capDkk - month.usedDkk) * 100 + 1e-9) / 100);
}
