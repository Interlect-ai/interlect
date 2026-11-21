import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/lib/supabase/auth-middleware";
import { requireFundCapability } from "@/lib/auth/access.server";
import { serverText } from "@/lib/i18n/server-text";
import { withDemoView } from "@/lib/display/display-names.server";
import { chosenThesis } from "@/lib/funds/thesis-scope.server";
import { thesisAllowsNewAnalysis } from "@/lib/funds/theses";

export interface RescreenCandidate {
  caseId: string;
  companyName: string;
  /** Versionen af tesen, casen sidst blev screenet imod. */
  screenedVersion: number | null;
  score: number | null;
}

export interface RescreenCandidates {
  /** The thesis the offer is for (a new version re-screens only that thesis's cases). */
  thesisId: string;
  activeVersion: number;
  candidates: RescreenCandidate[];
}

/**
 * Cases, der sidst blev screenet mod en ældre version af tesen (genscreening tilbydes efter en ny
 * version og kræver et klik). Arkiverede cases og cases
 * med en kørsel i gang tages ikke med.
 */
export const listRescreenCandidates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        fundId: z.guid(),
        /** The thesis that got a new version; without it, the team's default thesis. */
        thesisId: z.guid().optional(),
      })
      .parse(input),
  )
  .handler(
    withDemoView(async ({ data, context }): Promise<RescreenCandidates> => {
      await requireFundCapability(context.supabase, context.userId, data.fundId, "start_analysis");
      const thesis = await chosenThesis(context.supabase, data.fundId, data.thesisId);
      // An archived thesis runs no new analysis (spec §3), so it offers no re-screening either.
      if (!thesis || !thesisAllowsNewAnalysis(thesis.status))
        throw new Error(serverText("fundServer.rescreen.versionNotLoaded"));
      const { data: active, error: activeError } = await context.supabase
        .from("fund_config_versions")
        .select("id, version")
        .eq("fund_id", data.fundId)
        .eq("thesis_id", thesis.id)
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
            // Only this thesis's cases; other theses' cases are never touched (§4.4).
            .eq("thesis_id", thesis.id)
            .neq("workspace_status", "archived")
            // Besluttede cases (også Investeret) genscreenes ikke (harden).
            .neq("phase", "decided"),
          context.supabase
            .from("analysis_runs")
            .select(
              "case_id, status, config_version_id, fund_config_versions(version), recommendations(overall_score)",
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

      return {
        thesisId: thesis.id,
        activeVersion: active["version"] as number,
        candidates: candidates.sort((a, b) => a.companyName.localeCompare(b.companyName, "da")),
      };
    }),
  );
