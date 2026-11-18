import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireFundCapability } from "@/lib/auth/access.server";
import { requireSupabaseAuth } from "@/lib/supabase/auth-middleware";
import { copenhagenDate, parsePeriod, shiftDate } from "./dates";
import {
  loadCaseRows,
  loadOlderVersionScreenedCaseIds,
  loadOpenTaskRows,
  loadRecalcs,
  loadRunningRuns,
  loadRuns,
  loadTransitionEvents,
} from "./load.server";
import { one, type Row } from "./mappers";
import { mapTaskCase } from "./task-build";
import { translate } from "@/lib/i18n/translate";
import { runStatusText, runsSince } from "./rules";
import { buildOverview, type OverviewCore } from "./snapshot";
import { serverText } from "@/lib/i18n/server-text";
import { withDemoView } from "@/lib/display/display-names.server";

const fundIdSchema = z.guid();

export interface RunningLine {
  caseId: string;
  companyName: string;
  kind: "screening" | "deep";
  stepKey: string | null;
  completed: number;
  total: number;
}

export interface OverviewSnapshot extends OverviewCore {
  fundName: string;
  configVersion: number;
  /** Viewer's first name for the greeting; null when the profile has none. */
  viewerFirstName: string | null;
  /** The server's clock when the numbers were built (ISO). */
  generatedAt: string;
  activity: Array<{ id: string; companyName: string; text: string; at: string }>;
  /** Runs per Danish calendar day, the last 14 days (oldest first). */
  activityByDay: Array<{ day: string; count: number }>;
  /** Runs going when the snapshot was built; the page then follows `getOverviewRunning`. */
  running: RunningLine[];
}

/** A fund without a published setup has no threshold and no profile: an empty state, not an error. */
export type OverviewResult =
  { status: "ready"; data: OverviewSnapshot } | { status: "no_profile"; fundName: string };

const inputSchema = z.object({
  fundId: fundIdSchema,
  period: z.enum(["4w", "12w", "52w"]).default("4w"),
});

export const getOverviewSnapshot = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => {
    const raw = (input ?? {}) as Record<string, unknown>;
    return inputSchema.parse({ ...raw, period: parsePeriod(raw["period"]) });
  })
  .handler(
    withDemoView(async ({ data, context }): Promise<OverviewResult> => {
      // The role first: a reader may see the page, a stranger gets nothing, not even "no profile".
      const access = await requireFundCapability(
        context.supabase,
        context.userId,
        data.fundId,
        "view_case",
      );
      const { data: config, error: configError } = await context.supabase
        .from("fund_config_versions")
        .select("id, version, fund_mandates(analysis_threshold, stages)")
        .eq("fund_id", data.fundId)
        .eq("status", "active")
        .maybeSingle();
      if (configError) {
        console.error(`[overview] profile (fund ${data.fundId})`, configError.message);
        throw new Error(serverText("appServer.overview.notLoaded"));
      }
      if (!config) return { status: "no_profile", fundName: access.fundName };

      const now = new Date();
      const mandate = one<{
        analysis_threshold: number | string | null;
        stages: string[] | null;
      }>(config.fund_mandates);
      const thresholdValue = Number(mandate?.analysis_threshold);
      const threshold = Number.isFinite(thresholdValue) ? thresholdValue : 72;
      const configId = config.id as string;

      let rows;
      try {
        rows = await Promise.all([
          loadCaseRows(context.supabase, data.fundId, access.language),
          loadRuns(context.supabase, data.fundId, configId, runsSince(now)),
          loadRecalcs(context.supabase, data.fundId),
          loadTransitionEvents(context.supabase, data.fundId),
          loadOpenTaskRows(context.supabase, data.fundId),
          loadRunningRuns(context.supabase, data.fundId),
          loadOlderVersionScreenedCaseIds(context.supabase, data.fundId, configId),
        ]);
      } catch (cause) {
        console.error(
          `[overview] read (fund ${data.fundId})`,
          cause instanceof Error ? cause.message : cause,
        );
        throw new Error(serverText("appServer.overview.notLoaded"));
      }
      const [caseRows, runs, recalcs, events, openTasks, runningRuns, olderVersion] = rows;

      const core = buildOverview({
        language: access.language,
        now,
        period: data.period,
        threshold,
        fundStages: mandate?.stages ?? [],
        viewerId: context.userId,
        cases: caseRows,
        runs: runs.configRuns,
        recalcs,
        events,
        openTasks,
        runningCaseIds: new Set(runningRuns.map((run) => run.caseId)),
        olderVersionScreenedIds: olderVersion,
      });
      const nameOf = (caseId: string) => core.cases[caseId]?.name ?? "Ukendt case";
      const openCaseIds = new Set(
        caseRows.filter((row) => row.phase !== "decided").map((row) => row.id),
      );
      const running = runningRuns
        .filter((run) => openCaseIds.has(run.caseId))
        .map((run) => ({ ...run, companyName: nameOf(run.caseId) }));

      // Aktivitet: runs per Danish calendar day, the last 14 days.
      const recent = runs.recent;
      const today = copenhagenDate(now);
      const activityByDay = Array.from({ length: 14 }, (_, index) => ({
        day: shiftDate(today, -(13 - index)),
        count: 0,
      }));
      const dayIndex = new Map(activityByDay.map((entry, index) => [entry.day, index]));
      for (const run of recent) {
        const index = dayIndex.get(copenhagenDate(run["created_at"] as string));
        if (index !== undefined) activityByDay[index]!.count += 1;
      }
      const activity = [...recent]
        .sort((a, b) => ((a["created_at"] as string) < (b["created_at"] as string) ? 1 : -1))
        .slice(0, 6)
        .map((run) => ({
          id: run["id"] as string,
          companyName: nameOf(run["case_id"] as string),
          text: `${translate(access.language, run["kind"] === "deep" ? "cases.phase.deep_analysis" : "cases.phase.screening")} ${runStatusText(run["status"] as string, access.language)}`,
          at: (run["completed_at"] ?? run["created_at"]) as string,
        }));

      // The greeting uses the first name only, and only a real one.
      const { data: profile } = await context.supabase
        .from("profiles")
        .select("full_name")
        .eq("id", context.userId)
        .maybeSingle();
      const fullName = ((profile?.full_name as string | null | undefined) ?? "").trim();
      const viewerFirstName = fullName ? (fullName.split(/\s+/)[0] ?? null) : null;

      return {
        status: "ready",
        data: {
          ...core,
          fundName: access.fundName,
          configVersion: Number(config.version),
          viewerFirstName,
          generatedAt: now.toISOString(),
          activity,
          activityByDay,
          running,
        },
      };
    }),
  );

/**
 * "I gang nu", small enough to poll every few seconds: the runs in progress and their steps.
 * The page refetches the full snapshot only when a run finishes (or the window regains focus).
 */
export const getOverviewRunning = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ fundId: fundIdSchema }).parse(input))
  .handler(
    withDemoView(async ({ data, context }): Promise<RunningLine[]> => {
      const access = await requireFundCapability(
        context.supabase,
        context.userId,
        data.fundId,
        "view_case",
      );
      let runs;
      try {
        runs = await loadRunningRuns(context.supabase, data.fundId);
      } catch (cause) {
        console.error(
          `[overview] running (fund ${data.fundId})`,
          cause instanceof Error ? cause.message : cause,
        );
        throw new Error(serverText("appServer.overview.runsNotLoaded"));
      }
      if (runs.length === 0) return [];
      const { data: caseRows, error } = await context.supabase
        .from("cases")
        .select("id, phase, companies(name)")
        .eq("fund_id", data.fundId)
        .in("id", [...new Set(runs.map((run) => run.caseId))]);
      if (error) console.warn("[overview] running case names unavailable", error.message);
      const cases = new Map(
        (caseRows ?? []).map((row) => mapTaskCase(row as Row, access.language)),
      );
      return runs
        .filter((run) => (cases.get(run.caseId)?.phase ?? "decided") !== "decided")
        .map((run) => ({ ...run, companyName: cases.get(run.caseId)?.name ?? "Ukendt case" }));
    }),
  );
