/**
 * Grænser pr. bruger og pr. team på de dyre AI-veje. Hver reservation i kreditbogen,
 * som en bruger udløser (screening, dyb analyse og AI-hjælperne i opsætningen, tese-chatten,
 * dokumentimporten, forslagene og selskabssøgningen), tæller først mod brugerens og teamets
 * grænse i den seneste time, i databasen (0101), så ét medlem ikke kan tømme installationens
 * fælles saldo, og grænsen gælder på tværs af alle Vercel-instanser.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { serverText } from "../i18n/server-text.ts";

export type AiUseKind = "screening" | "deep_analysis" | "helper";

const HOUR_SECONDS = 60 * 60;

/**
 * Per hour. A deep analysis costs about 8-35 kr, a screening 1-3 kr, a helper call 0.1-1 kr, so
 * one person can at most spend a few hundred kroner an hour and a team about three times that.
 */
export const AI_USE_LIMITS: Record<AiUseKind, { perUser: number; perTeam: number }> = {
  screening: { perUser: 20, perTeam: 60 },
  deep_analysis: { perUser: 4, perTeam: 10 },
  helper: { perUser: 60, perTeam: 200 },
};

const WHAT = {
  screening: "appServer.aiLimits.screening",
  deep_analysis: "appServer.aiLimits.deepAnalysis",
  helper: "appServer.aiLimits.helper",
} as const;

export class AiUseLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiUseLimitError";
  }
}

/**
 * Counts one paid AI use for the user and the team, or throws AiUseLimitError when either has
 * reached its hourly limit; a refused use is not counted. The callers count only after the
 * credits are reserved, so a call stopped by an empty balance uses no place in the hour.
 */
export async function limitAiUse(
  service: SupabaseClient,
  input: { kind: AiUseKind; fundId: string; userId: string },
): Promise<void> {
  const limits = AI_USE_LIMITS[input.kind];
  // Both limits in one call: either both count the use, or neither does (0101).
  const { data, error } = await service.rpc("rate_limit_hit_all", {
    _keys: [`ai:${input.kind}:user:${input.userId}`, `ai:${input.kind}:fund:${input.fundId}`],
    _limits: [limits.perUser, limits.perTeam],
    _window_seconds: HOUR_SECONDS,
  });
  if (error || typeof data !== "number") {
    // No paid call starts without a count.
    console.error(`[ai-limits] ${input.kind}`, error?.message ?? "intet svar");
    throw new Error(serverText("appServer.aiLimits.notChecked"));
  }
  if (data === 0) return;
  const what = serverText(WHAT[input.kind]);
  throw new AiUseLimitError(
    data === 1
      ? serverText("appServer.aiLimits.user", { count: limits.perUser, what })
      : serverText("appServer.aiLimits.team", { count: limits.perTeam, what }),
  );
}
