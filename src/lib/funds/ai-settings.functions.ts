import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { AI_BUDGETS } from "@/lib/analysis/budgets";
import {
  AI_TIERS,
  AI_TIER_LABELS,
  CAP_LIMITS_DKK,
  TIER_MODELS,
  capBelowExpectedCost,
  estimatedRunCostDkk,
  isValidCapDkk,
  resolveRunBudget,
  STANDARD_SPECIALIST_COUNT,
  standardCapDkk,
  type AiRunKind,
  type AiTier,
} from "@/lib/analysis/model-tiers";
import { loadFundAiSettings } from "@/lib/analysis/run-plan.server";
import { requireSupabaseAuth } from "@/lib/supabase/auth-middleware";
import { serverText } from "@/lib/i18n/server-text";

const fundIdSchema = z.guid();
const tierSchema = z.enum(AI_TIERS);
const DAYS_FOR_AVERAGES = 90;
const DAYS_FOR_TEMPO = 30;

export interface AiTierInfo {
  tier: AiTier;
  label: string;
  model: string;
  thoroughness: string;
  standardCapDkk: number;
  /** Real average of the fund's finished runs at this level, or null until there are any. */
  averageCostDkk: number | null;
  runsMeasured: number;
  /** The price shown: the real average when there is one, otherwise the estimate. */
  expectedCostDkk: number;
  expectedIsEstimate: boolean;
}

export interface AiKindSettings {
  tier: AiTier;
  /** The cap the fund confirmed; null = the level's standard cap. */
  confirmedCapDkk: number | null;
  /** The cap runs are stopped at now. */
  effectiveCapDkk: number;
  limits: { min: number; max: number };
  tiers: AiTierInfo[];
  /** Runs started in the last 30 days, for "expected price per month at the current pace". */
  runsLast30Days: number;
  /** The cap is below what the chosen level usually costs: runs will stop before they finish. */
  capWarning: boolean;
}

export interface FundAiSettingsView {
  /** False until the database migration (0036) has run; the settings are then the old defaults. */
  available: boolean;
  canEdit: boolean;
  screening: AiKindSettings;
  deep: AiKindSettings;
}

interface RunCostRow {
  kind: string;
  ai_tier: string | null;
  actual_cost: number | string | null;
  created_at: string;
}

/** A run from has no tier: screening ran light and deep analysis ran middle. */
function runTier(row: RunCostRow): AiTier | null {
  if (row.ai_tier && (AI_TIERS as readonly string[]).includes(row.ai_tier)) {
    return row.ai_tier as AiTier;
  }
  if (row.ai_tier === null) return row.kind === "screening" ? "light" : "medium";
  return null;
}

function tiersFor(kind: AiRunKind, rows: RunCostRow[], specialistCount: number): AiTierInfo[] {
  return AI_TIERS.map((tier) => {
    const costs = rows
      .filter((row) => row.kind === kind && runTier(row) === tier)
      .map((row) => Number(row.actual_cost))
      .filter((cost) => Number.isFinite(cost) && cost > 0);
    const averageCostDkk = costs.length
      ? Math.round(
          (costs.reduce((sum, cost) => sum + cost, 0) / costs.length) *
            AI_BUDGETS.exchangeRateDkkPerUsd *
            100,
        ) / 100
      : null;
    return {
      tier,
      label: AI_TIER_LABELS[tier],
      model: TIER_MODELS[kind][tier],
      // The tier's own one-line description of how thorough it is (economy only, no long text).
      thoroughness: serverText(`analysisServer.tiers.${tier}`),
      standardCapDkk: standardCapDkk(kind, tier, specialistCount),
      averageCostDkk,
      runsMeasured: costs.length,
      expectedCostDkk: averageCostDkk ?? estimatedRunCostDkk(kind, tier),
      expectedIsEstimate: averageCostDkk === null,
    };
  });
}

function kindSettings(
  kind: AiRunKind,
  tier: AiTier,
  confirmedCapDkk: number | null,
  rows: RunCostRow[],
  runsLast30Days: number,
  /** A deep run's specialists in the active version; the cap follows them. */
  specialistCount: number = STANDARD_SPECIALIST_COUNT,
): AiKindSettings {
  const tiers = tiersFor(kind, rows, specialistCount);
  const { budget } = resolveRunBudget(kind, tier, confirmedCapDkk, specialistCount);
  const chosen = tiers.find((item) => item.tier === tier)!;
  return {
    tier,
    confirmedCapDkk,
    effectiveCapDkk: budget.dkk,
    limits: CAP_LIMITS_DKK[kind],
    tiers,
    runsLast30Days,
    capWarning: capBelowExpectedCost(kind, budget.dkk, chosen.expectedCostDkk),
  };
}

/** The fund's AI level and price caps, with a comparison of the three levels. Every role may read. */
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

    const settings = await loadFundAiSettings(context.supabase, data.fundId);
    const since = new Date(Date.now() - DAYS_FOR_AVERAGES * 24 * 60 * 60 * 1000).toISOString();
    // ai_tier does not exist before 0036; without the migration the averages are not split by level.
    const withTier = settings !== null;
    // The price is not readable with the member's own key; only the averages leave here.
    const { getServiceClient } = await import("@/lib/supabase/admin.server");
    const { data: runs, error } = await getServiceClient()
      .from("analysis_runs")
      .select(withTier ? "kind, ai_tier, actual_cost, created_at" : "kind, actual_cost, created_at")
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
      created_at: row["created_at"] as string,
    }));
    const tempoSince = Date.now() - DAYS_FOR_TEMPO * 24 * 60 * 60 * 1000;
    const recent = (kind: AiRunKind) =>
      rows.filter((row) => row.kind === kind && Date.parse(row.created_at) >= tempoSince).length;

    return {
      available: withTier,
      canEdit,
      screening: kindSettings(
        "screening",
        settings?.screeningTier ?? "light",
        settings?.screeningCapDkk ?? null,
        rows,
        recent("screening"),
      ),
      deep: kindSettings(
        "deep",
        settings?.deepTier ?? "medium",
        settings?.deepCapDkk ?? null,
        rows,
        recent("deep"),
        await activeSpecialistCount(context.supabase, data.fundId),
      ),
    };
  });

/**
 * The number of specialists a deep analysis with the fund's active version runs, so the
 * shown cap is the one a new run gets. Display only: an unreadable set shows the standard four.
 */
async function activeSpecialistCount(
  supabase: Parameters<typeof loadFundAiSettings>[0],
  fundId: string,
): Promise<number> {
  const { data: active } = await supabase
    .from("fund_config_versions")
    .select("id")
    .eq("fund_id", fundId)
    .eq("status", "active")
    .maybeSingle();
  if (!active) return STANDARD_SPECIALIST_COUNT;
  try {
    const { loadSpecialistSet } = await import("@/lib/analysis/specialist-set.server");
    return (await loadSpecialistSet(supabase, active["id"] as string)).set.length;
  } catch (cause) {
    console.error("[ai-settings] specialist set", cause);
    return STANDARD_SPECIALIST_COUNT;
  }
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
 * Changes the level and/or the price cap (Admin and Lead). Only the fields that are sent change.
 * A cap is only saved when it is sent with `confirmCaps: true`: the interface shows the expected
 * price per run and per month first, and the confirmed number is the fund's real limit.
 * A new level or cap only affects later runs. Every change is written to the audit log first.
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
        confirmCaps: z.boolean().optional(),
      })
      .refine(
        (value) =>
          value.screeningTier !== undefined ||
          value.deepTier !== undefined ||
          value.screeningCapDkk !== undefined ||
          value.deepCapDkk !== undefined,
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
      (data.deepCapDkk !== undefined && data.deepCapDkk !== null);
    if (changesCap && data.confirmCaps !== true) {
      throw new Error(serverText("fundServer.aiSettings.confirmCap"));
    }

    const service = getServiceClient();
    const before = await loadFundAiSettings(service, data.fundId);
    if (!before) {
      throw new Error(serverText("fundServer.aiSettings.notEnabled"));
    }
    const after = {
      screeningTier: data.screeningTier ?? before.screeningTier,
      deepTier: data.deepTier ?? before.deepTier,
      screeningCapDkk:
        data.screeningCapDkk !== undefined ? data.screeningCapDkk : before.screeningCapDkk,
      deepCapDkk: data.deepCapDkk !== undefined ? data.deepCapDkk : before.deepCapDkk,
    };

    // Revisionen skrives først: fejler den, ændres intet (writeAudit afviser handlingen).
    const auditId = await writeAuditWithId(service, {
      fundId: data.fundId,
      actorType: "user",
      actorId: context.userId,
      action: "fund_ai_settings_changed",
      entity: "funds",
      entityId: data.fundId,
      payload: { before, after },
    });
    const { error } = await service
      .from("funds")
      .update({
        screening_tier: after.screeningTier,
        deep_tier: after.deepTier,
        screening_cap_dkk: after.screeningCapDkk,
        deep_cap_dkk: after.deepCapDkk,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.fundId);
    if (error) {
      console.error("[updateFundAiSettings]", error.message);
      // The audit log already holds the change; record that it was never saved.
      try {
        await writeAudit(service, {
          fundId: data.fundId,
          actorType: "user",
          actorId: context.userId,
          action: "fund_ai_settings_not_saved",
          entity: "funds",
          entityId: data.fundId,
          payload: { after, undoes: auditId },
        });
      } catch (cause) {
        console.error("[updateFundAiSettings] not saved audit", cause);
      }
      throw new Error(serverText("fundServer.aiSettings.notSaved"));
    }
    return { before, after };
  });
