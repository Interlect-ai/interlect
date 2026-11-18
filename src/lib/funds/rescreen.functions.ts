import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/lib/supabase/auth-middleware";
import { requireFundCapability } from "@/lib/auth/access.server";
import { getServiceClient } from "@/lib/supabase/admin.server";
import { AI_BUDGETS } from "@/lib/analysis/budgets";
import { loadFundRunPlans } from "@/lib/analysis/run-plan.server";
import { serverText } from "@/lib/i18n/server-text";
import { withDemoView } from "@/lib/display/display-names.server";

export interface RescreenCandidate {
  caseId: string;
  companyName: string;
  /** Versionen af tesen, casen sidst blev screenet imod. */
  screenedVersion: number | null;
  score: number | null;
}

export interface RescreenCandidates {
  activeVersion: number;
  candidates: RescreenCandidate[];
  /** Gennemsnitlig faktisk pris pr. screening de seneste 30 dage, i kr. Null uden data. */
  averageCostDkk: number | null;
  maxCostDkk: number;
}

/**
 * Cases, der sidst blev screenet mod en ældre version af tesen (genscreening tilbydes efter en ny
 * version og kræver et klik). Arkiverede cases og cases
 * med en kørsel i gang tages ikke med.
 */
export const listRescreenCandidates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ fundId: z.guid() }).parse(input))
  .handler(
    withDemoView(async ({ data, context }): Promise<RescreenCandidates> => {
      await requireFundCapability(context.supabase, context.userId, data.fundId, "start_analysis");
      const { data: active, error: activeError } = await context.supabase
        .from("fund_config_versions")
        .select("id, version")
        .eq("fund_id", data.fundId)
        .eq("status", "active")
        .single();
      if (activeError || !active)
        throw new Error(serverText("fundServer.rescreen.versionNotLoaded"));

      const [{ data: cases, error: casesError }, { data: runs, error: runsError }] =
        await Promise.all([
          context.supabase
            .from("cases")
            .select("id, workspace_status, companies(name)")
            .eq("fund_id", data.fundId)
            .neq("workspace_status", "archived")
            // Besluttede cases (også Investeret) genscreenes ikke (harden).
            .neq("phase", "decided"),
          // The price is not readable with the member's own key; only the average leaves.
          getServiceClient()
            .from("analysis_runs")
            .select(
              "case_id, status, actual_cost, created_at, config_version_id, fund_config_versions(version), recommendations(overall_score)",
            )
            .eq("fund_id", data.fundId)
            .eq("kind", "screening")
            .order("created_at", { ascending: false })
            .limit(1000),
        ]);
      if (casesError || runsError)
        throw new Error(serverText("fundServer.rescreen.casesNotLoaded"));

      const latestByCase = new Map<string, Record<string, unknown>>();
      const busy = new Set<string>();
      for (const run of runs ?? []) {
        const caseId = run["case_id"] as string;
        if (["queued", "running"].includes(run["status"] as string)) busy.add(caseId);
        if (!latestByCase.has(caseId) && run["status"] !== "cancelled")
          latestByCase.set(caseId, run);
      }

      const candidates: RescreenCandidate[] = [];
      for (const row of cases ?? []) {
        const caseId = row["id"] as string;
        const latest = latestByCase.get(caseId);
        if (!latest || busy.has(caseId) || latest["config_version_id"] === active["id"]) continue;
        const rawCompany = row["companies"] as unknown;
        const company = (Array.isArray(rawCompany) ? rawCompany[0] : rawCompany) as {
          name: string;
        } | null;
        const rawVersion = latest["fund_config_versions"] as unknown;
        const version = (Array.isArray(rawVersion) ? rawVersion[0] : rawVersion) as {
          version: number;
        } | null;
        const rawRecommendation = latest["recommendations"] as unknown;
        const recommendation = (
          Array.isArray(rawRecommendation) ? rawRecommendation[0] : rawRecommendation
        ) as { overall_score: number | string | null } | null;
        candidates.push({
          caseId,
          companyName: company?.name ?? "Ukendt selskab",
          screenedVersion: version?.version ?? null,
          score:
            recommendation?.overall_score == null ? null : Number(recommendation.overall_score),
        });
      }

      const since = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const recentCosts = (runs ?? [])
        .filter(
          (run) =>
            run["status"] === "complete" &&
            run["actual_cost"] != null &&
            Date.parse(run["created_at"] as string) >= since,
        )
        .map((run) => Number(run["actual_cost"]))
        .filter((cost) => Number.isFinite(cost) && cost > 0);
      const averageUsd = recentCosts.length
        ? recentCosts.reduce((sum, cost) => sum + cost, 0) / recentCosts.length
        : null;

      return {
        activeVersion: active["version"] as number,
        candidates: candidates.sort((a, b) => a.companyName.localeCompare(b.companyName, "da")),
        averageCostDkk:
          averageUsd === null
            ? null
            : Math.round(averageUsd * AI_BUDGETS.exchangeRateDkkPerUsd * 100) / 100,
        maxCostDkk: (await loadFundRunPlans(context.supabase, data.fundId)).screening.budget.dkk,
      };
    }),
  );
