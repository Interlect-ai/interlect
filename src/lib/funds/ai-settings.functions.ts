import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  AI_TIERS,
  CAP_LIMITS_DKK,
  isValidCapDkk,
  LIMIT_ACTIONS,
  STANDARD_SPECIALIST_COUNT,
  type AiRunKind,
} from "@/lib/analysis/model-tiers";
import { loadAnalysisMonth } from "@/lib/ai/analysis-month.server";
import { loadFundAiSettings, loadPlatformLimits } from "@/lib/analysis/run-plan.server";
import { requireSupabaseAuth } from "@/lib/supabase/auth-middleware";
import { loadTheses } from "@/lib/funds/thesis-scope.server";
import { thesisAllowsNewAnalysis } from "@/lib/funds/theses";
import { serverText } from "@/lib/i18n/server-text";
import { fundAiSettingsView, type FundAiSettingsView } from "./ai-settings-view";
import { saveAiSettings, type AiSettingsChange } from "./ai-settings-save";
import {
  analysisLimitsView,
  belowLowestCap,
  MONTHLY_CAP_MAX_DKK,
  overPlatformLimit,
  bookedRunCosts,
  type AnalysisLimitsView,
  type BookedRunRow,
  type FinishedRunRow,
} from "./analysis-limits";

export type { AiKindSettings } from "./ai-settings-view";

const fundIdSchema = z.guid();
const tierSchema = z.enum(AI_TIERS);
const DAYS_FOR_AVERAGES = 90;
const DAYS_FOR_COSTS = 30;

/** The fund's AI level and whether its cap is too low. Every role may read; no model, no amount. */
export const getFundAiSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ fundId: fundIdSchema }).parse(input))
  .handler(async ({ data, context }): Promise<FundAiSettingsView> => {
    const { requireFundCapability } = await import("@/lib/auth/access.server");
    const access = await requireFundCapability(
      context.supabase,
      context.userId,
      data.fundId,
      "view_case",
    );
    const { hasCapability } = await import("@/lib/domain/workflow");
    const canEdit = hasCapability(access.roles, "configure_fund", access.settings);

    // The limits are not readable with the member's own key (0123); they only decide the warning.
    const { getServiceClient } = await import("@/lib/supabase/admin.server");
    const service = getServiceClient();
    const [settings, platform] = await Promise.all([
      loadFundAiSettings(service, data.fundId),
      loadPlatformLimits(service),
    ]);
    const since = new Date(Date.now() - DAYS_FOR_AVERAGES * 24 * 60 * 60 * 1000).toISOString();
    // ai_tier does not exist before 0036; without the migration the averages are not split by level.
    const withTier = settings !== null;
    // The price is not readable with the member's own key and never leaves here:
    // it only decides the warning.
    const { data: runs, error } = await service
      .from("analysis_runs")
      .select(withTier ? "kind, ai_tier, actual_cost" : "kind, actual_cost")
      .eq("fund_id", data.fundId)
      .in("kind", ["screening", "deep"])
      .eq("status", "complete")
      .gte("created_at", since);
    if (error) {
      console.error("[ai-settings] runs", error.message);
      throw new Error(serverText("fundServer.aiSettings.runsNotLoaded"));
    }
    const rows = ((runs ?? []) as unknown as Array<Record<string, unknown>>).map((row) => ({
      kind: row["kind"] as string,
      ai_tier: withTier ? ((row["ai_tier"] as string | null) ?? null) : null,
      actual_cost: row["actual_cost"] as number | string | null,
    }));

    const { count: specialistCount } = await largestSpecialistCount(context.supabase, data.fundId);
    return fundAiSettingsView({
      canEdit,
      settings,
      rows,
      specialistCount,
      usdToDkk: platform.usdToDkk,
      platformCapsDkk: platform.capsDkk,
    });
  });

/**
 * The section Analysegrænser: the team's limits in kroner and the installation's hard
 * limits. Only for Admin and Lead (beslutningslog 2. nov); every other role is refused here.
 */
export const getFundAnalysisLimits = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ fundId: fundIdSchema }).parse(input))
  .handler(async ({ data, context }): Promise<AnalysisLimitsView> => {
    const { requireFundCapability } = await import("@/lib/auth/access.server");
    await requireFundCapability(context.supabase, context.userId, data.fundId, "configure_fund");
    const { getServiceClient } = await import("@/lib/supabase/admin.server");
    const service = getServiceClient();
    const since = new Date(Date.now() - DAYS_FOR_COSTS * 24 * 60 * 60 * 1000).toISOString();
    // The month settles finished runs first (ai_settle_now), so the ledger is read after it.
    const [settings, platform, specialistCount, month, runs] = await Promise.all([
      loadFundAiSettings(service, data.fundId),
      loadPlatformLimits(service),
      largestSpecialistCount(context.supabase, data.fundId),
      loadAnalysisMonth(service, data.fundId),
      allPages<FinishedRunRow>((from, to) =>
        service
          .from("analysis_runs")
          .select("id, kind, status")
          .eq("fund_id", data.fundId)
          .in("kind", ["screening", "deep"])
          // Every run that has ended; a stopped or failed one counts when it was paid for.
          .in("status", ["complete", "awaiting_approval", "failed", "cancelled"])
          .gte("created_at", since)
          .order("id")
          .range(from, to),
      ),
    ]);
    if (runs === null) throw new Error(serverText("fundServer.aiSettings.runsNotLoaded"));
    // What the team paid per run: the run's own settled row in the credit ledger (0125, 0131). A
    // run is reserved just before it is created, so the ledger is read from a day earlier.
    const booked = await allPages<BookedRunRow>((from, to) =>
      service
        .from("ai_credit_ledger")
        .select("ref_id, amount_dkk")
        .eq("fund_id", data.fundId)
        .eq("kind", "usage")
        .eq("scope", "analysis")
        .eq("status", "final")
        .is("loop", null)
        .not("ref_id", "is", null)
        .gte("created_at", new Date(Date.parse(since) - 24 * 60 * 60 * 1000).toISOString())
        .order("id")
        .range(from, to),
    );
    if (booked === null) throw new Error(serverText("fundServer.aiSettings.runsNotLoaded"));
    return analysisLimitsView({
      settings,
      platform,
      specialistCount: specialistCount.count,
      monthUsedDkk: month.usedDkk,
      costs: bookedRunCosts(runs, booked),
    });
  });

/** PostgREST returns at most this many rows per call. */
const PAGE_ROWS = 1000;

/**
 * Every row of a query, a page at a time, so a busy team's costs are never built from a cut-off
 * subset. Null when a page could not be read (logged; money is never shown from part of the rows).
 */
async function allPages<T>(
  page: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<T[] | null> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_ROWS) {
    const { data, error } = await page(from, from + PAGE_ROWS - 1);
    if (error) {
      console.error("[ai-settings] run costs", error.message);
      return null;
    }
    const part = (data ?? []) as T[];
    rows.push(...part);
    if (part.length < PAGE_ROWS) return rows;
  }
}

/**
 * The most specialists a deep analysis in the team can run with: the largest active set over the
 * theses that may start a new analysis. The bottom for the level grows with the
 * specialists, and a run uses its case's thesis (deep.functions.ts), so the limit is judged against
 * the thesis that needs the most; a limit that fits it fits every case. Never under the standard
 * four. `complete` is false when a thesis or a set could not be read: the count may then be too
 * low, so a save of a deep limit refuses rather than trusts it (a run checks its own set anyway).
 */
async function largestSpecialistCount(
  supabase: Parameters<typeof loadFundAiSettings>[0],
  fundId: string,
): Promise<{ count: number; complete: boolean }> {
  let theses;
  try {
    theses = (await loadTheses(supabase, fundId)).filter((thesis) =>
      thesisAllowsNewAnalysis(thesis.status),
    );
  } catch (cause) {
    console.error("[ai-settings] theses", cause);
    return { count: STANDARD_SPECIALIST_COUNT, complete: false };
  }
  if (theses.length === 0) return { count: STANDARD_SPECIALIST_COUNT, complete: true };
  const { data: versions, error } = await supabase
    .from("fund_config_versions")
    .select("id")
    .eq("fund_id", fundId)
    .in(
      "thesis_id",
      theses.map((thesis) => thesis.id),
    )
    .eq("status", "active");
  if (error) {
    console.error("[ai-settings] active versions", error.message);
    return { count: STANDARD_SPECIALIST_COUNT, complete: false };
  }
  const { loadLargestSpecialistSetSize } = await import("@/lib/analysis/specialist-set.server");
  // One unreadable set must not hide another thesis with more specialists.: per stage, the
  // largest stage's set counts (a version's rows without a stage would add up every stage's).
  const results = await Promise.allSettled(
    (versions ?? []).map((version) =>
      loadLargestSpecialistSetSize(supabase, version["id"] as string),
    ),
  );
  const counts: number[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") counts.push(result.value);
    else console.error("[ai-settings] specialist set", result.reason);
  }
  return {
    count: Math.max(STANDARD_SPECIALIST_COUNT, ...counts),
    complete: counts.length === results.length,
  };
}

const capSchema = (kind: AiRunKind) =>
  z
    .number()
    .refine((value) => isValidCapDkk(kind, value), {
      error: serverText("fundServer.aiSettings.capRange", {
        min: CAP_LIMITS_DKK[kind].min,
        max: CAP_LIMITS_DKK[kind].max,
      }),
    })
    .nullable();

/**
 * Changes the level, the price caps, the action at the limit and/or the monthly limit (Admin and
 * Lead). Only the fields that are sent change. A cap or a monthly limit is only saved when it is
 * sent with `confirmCaps: true`: the interface shows the expected price per run and per month
 * first, and the confirmed number is the fund's real limit. A limit can never pass the
 * installation's hard limit. A change only affects later runs. Every change is written to the
 * audit log first.
 */
export const updateFundAiSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        fundId: fundIdSchema,
        screeningTier: tierSchema.optional(),
        deepTier: tierSchema.optional(),
        /** null = back to the level's standard cap. */
        screeningCapDkk: capSchema("screening").optional(),
        deepCapDkk: capSchema("deep").optional(),
        limitAction: z.enum(LIMIT_ACTIONS).optional(),
        /** null = no monthly limit. */
        monthlyCapDkk: z
          .number()
          .min(0, {
            error: serverText("fundServer.aiSettings.monthlyRange", { max: MONTHLY_CAP_MAX_DKK }),
          })
          .max(MONTHLY_CAP_MAX_DKK, {
            error: serverText("fundServer.aiSettings.monthlyRange", { max: MONTHLY_CAP_MAX_DKK }),
          })
          .nullable()
          .optional(),
        confirmCaps: z.boolean().optional(),
      })
      .refine(
        (value) =>
          value.screeningTier !== undefined ||
          value.deepTier !== undefined ||
          value.screeningCapDkk !== undefined ||
          value.deepCapDkk !== undefined ||
          value.limitAction !== undefined ||
          value.monthlyCapDkk !== undefined,
        { error: serverText("fundServer.aiSettings.chooseSetting") },
      )
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireFundCapability, writeAudit, writeAuditWithId } =
      await import("@/lib/auth/access.server");
    const { getServiceClient } = await import("@/lib/supabase/admin.server");
    await requireFundCapability(context.supabase, context.userId, data.fundId, "configure_fund");

    const changesCap =
      (data.screeningCapDkk !== undefined && data.screeningCapDkk !== null) ||
      (data.deepCapDkk !== undefined && data.deepCapDkk !== null) ||
      (data.monthlyCapDkk !== undefined && data.monthlyCapDkk !== null);
    if (changesCap && data.confirmCaps !== true) {
      throw new Error(serverText("fundServer.aiSettings.confirmCap"));
    }

    const service = getServiceClient();
    const [platform, specialists] = await Promise.all([
      loadPlatformLimits(service),
      largestSpecialistCount(context.supabase, data.fundId),
    ]);
    // Only what is sent is checked: a limit from before the installation lowered its own stays
    // saved (a new run never gets more than the installation allows, run-plan.server.ts).
    const overLimit = overPlatformLimit(data, platform);
    if (overLimit) {
      throw new Error(serverText("fundServer.aiSettings.overPlatform", { max: overLimit.maxDkk }));
    }

    const change: AiSettingsChange = {
      screeningTier: data.screeningTier,
      deepTier: data.deepTier,
      screeningCapDkk: data.screeningCapDkk,
      deepCapDkk: data.deepCapDkk,
      limitAction: data.limitAction,
      monthlyCapDkk: data.monthlyCapDkk,
    };
    const audit = { fundId: data.fundId, actorType: "user" as const, actorId: context.userId };
    // Only the sent fields are written, and only on the row that was read and checked.
    return saveAiSettings(change, {
      read: async () => {
        // The mark is read first: a write after it makes the save read everything again.
        const { data: row, error } = await service
          .from("funds")
          .select("updated_at")
          .eq("id", data.fundId)
          .maybeSingle();
        if (error || !row) {
          if (error) console.error("[updateFundAiSettings] read", error.message);
          throw new Error(serverText("fundServer.aiSettings.notSaved"));
        }
        const settings = await loadFundAiSettings(service, data.fundId);
        if (!settings) throw new Error(serverText("fundServer.aiSettings.notEnabled"));
        return { settings, version: (row["updated_at"] as string | null) ?? null };
      },
      check: async (_before, after) => {
        // Under the bottom for the level no run can start (spec B.1 punkt 5), so it cannot be
        // chosen. The bottom grows with the specialists, so the thesis with the most is used
        // A saved limit then lets every thesis of the team start.
        const changedCaps = [
          ...(data.screeningCapDkk !== undefined || data.screeningTier !== undefined
            ? [
                {
                  kind: "screening" as const,
                  tier: after.screeningTier,
                  capDkk: after.screeningCapDkk,
                },
              ]
            : []),
          ...(data.deepCapDkk !== undefined || data.deepTier !== undefined
            ? [{ kind: "deep" as const, tier: after.deepTier, capDkk: after.deepCapDkk }]
            : []),
        ];
        // A deep limit is never saved on a count that may be too low (an unreadable set).
        if (!specialists.complete && changedCaps.some((cap) => cap.kind === "deep")) {
          throw new Error(serverText("fundServer.aiSettings.notSaved"));
        }
        const tooLow = belowLowestCap(changedCaps, specialists.count, platform.usdToDkk);
        if (tooLow) {
          throw new Error(serverText("fundServer.aiSettings.capTooLow", { min: tooLow.minDkk }));
        }
      },
      // Revisionen skrives først: fejler den, ændres intet (writeAudit afviser handlingen).
      audit: (before, after) =>
        writeAuditWithId(service, {
          ...audit,
          action: "fund_ai_settings_changed",
          entity: "funds",
          entityId: data.fundId,
          payload: { before, after },
        }),
      write: async (columns, version) => {
        const query = service
          .from("funds")
          .update({ ...columns, updated_at: new Date().toISOString() })
          .eq("id", data.fundId);
        const { data: rows, error } = await (
          version === null ? query.is("updated_at", null) : query.eq("updated_at", version)
        ).select("id");
        if (error) {
          console.error("[updateFundAiSettings]", error.message);
          throw new Error(serverText("fundServer.aiSettings.notSaved"));
        }
        return (rows ?? []).length > 0;
      },
      notSaved: async (after, auditId) => {
        // The audit log already holds the change; record that it was never saved.
        try {
          await writeAudit(service, {
            ...audit,
            action: "fund_ai_settings_not_saved",
            entity: "funds",
            entityId: data.fundId,
            payload: { after, undoes: auditId },
          });
        } catch (cause) {
          console.error("[updateFundAiSettings] not saved audit", cause);
        }
      },
      busy: () => new Error(serverText("fundServer.aiSettings.notSaved")),
    });
  });
