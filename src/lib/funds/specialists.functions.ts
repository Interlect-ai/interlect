import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/lib/supabase/auth-middleware";
import { requireFundCapability } from "@/lib/auth/access.server";
import { fundConfigErrorText, type DbErrorLike } from "./db-errors";
import { hasCapability } from "@/lib/domain/workflow";
import { getServiceClient } from "@/lib/supabase/admin.server";
import type { ScoreCategory } from "@/lib/domain/types";
import { specialistCatalog } from "@/lib/analysis/specialist-catalog";
import { loadSpecialistSet } from "@/lib/analysis/specialist-set.server";
import { loadFundAiSettings, loadPlatformLimits } from "@/lib/analysis/run-plan.server";
import { buildRunPlan, capWithinPlatform, tooLowCause } from "@/lib/analysis/model-tiers";
import {
  CUSTOM_SPECIALIST_KEY,
  MAX_CUSTOM_SPECIALISTS_DEFAULT,
  newCustomSpecialistKey,
  specialistSetProblems,
  specialistSetWarnings,
  type FundSpecialistRow,
} from "@/lib/analysis/specialist-set";
import { customSpecialistSchema, type CustomSpecialistInput } from "./specialist-assist";
import { requestLanguage, serverText } from "@/lib/i18n/server-text";
import type { SetupStage } from "@/lib/analysis/setup-stage";
import { setupStageSchema } from "./setup-input";

/**
 * The fund's own set of specialists in the fund setup: read the set of a version,
 * switch a standard specialist off and on, and add, change, switch or remove the fund's own. Only
 * a draft can change (RLS, 0076); the database checks the rules again when the draft is published.
 * The AI help (draft, quality check, trial run) builds on these; the page is.
 */

const fundIdSchema = z.guid();
const configIdSchema = z.guid();
const standardIdSchema = z.enum([
  "people_team",
  "product_market_gtm",
  "technology_risk",
  "fund_finance_deal",
]);
const keySchema = z.string().regex(CUSTOM_SPECIALIST_KEY);
/**
 * the stage whose own set is meant; left out (or null) = the shared set (every call). A stage
 * without its own rows runs the shared set; its first change copies the shared
 * set into the stage, so the stage starts from what it runs with today (setup-stage.ts).
 */
const stageSchema = setupStageSchema.nullable().optional();
export type { CustomSpecialistInput };

export interface FundSpecialistsView {
  configId: string;
  /** The stage the view is for; null = the shared set. */
  stage: SetupStage | null;
  /** The stage has its own set (else it shows and runs the shared one). */
  ownSet: boolean;
  /** True for a draft the user may change (Admin and Lead). */
  editable: boolean;
  /** The installation's limit on active own specialists (`ai_settings`, standard 3). */
  maxCustom: number;
  /** What stops the draft from being published, in Danish; empty when the set is fine. */
  problems: string[];
  /** What is allowed but worth changing (one specialist with most areas), in Danish. */
  warnings: string[];
  standard: Array<{
    id: string;
    title: string;
    enabled: boolean;
    /** The module's own areas. */
    categories: ScoreCategory[];
    /** The fund has its own text for the module (`prompt_module_overrides`). */
    isCustomized: boolean;
  }>;
  custom: Array<CustomSpecialistInput & { key: string; enabled: boolean; sortOrder: number }>;
  /** Who assesses which score area in a run with this version (switched-off areas move on). */
  assignment: Array<{
    id: string;
    kind: "standard" | "custom";
    title: string;
    categories: ScoreCategory[];
  }>;
}

async function loadMaxCustom(): Promise<number> {
  const { data, error } = await getServiceClient()
    .from("ai_settings")
    .select("max_custom_specialists")
    .maybeSingle();
  if (error || !data) return MAX_CUSTOM_SPECIALISTS_DEFAULT;
  const value = Number(data["max_custom_specialists"]);
  return Number.isInteger(value) && value >= 0 ? value : MAX_CUSTOM_SPECIALISTS_DEFAULT;
}

async function loadVersion(supabase: SupabaseClient, fundId: string, configId: string) {
  const { data, error } = await supabase
    .from("fund_config_versions")
    .select("id, fund_id, status")
    .eq("id", configId)
    .eq("fund_id", fundId)
    .maybeSingle();
  if (error) throw new Error(serverText("fundServer.common.setupNotLoaded"));
  if (!data) throw new Error(serverText("fundServer.common.versionNotFound"));
  return data as { id: string; fund_id: string; status: string };
}

async function requireDraft(
  supabase: SupabaseClient,
  userId: string,
  fundId: string,
  configId: string,
) {
  await requireFundCapability(supabase, userId, fundId, "configure_fund");
  const version = await loadVersion(supabase, fundId, configId);
  if (version.status !== "draft") {
    throw new Error(serverText("fundServer.common.draftOnlyEdit"));
  }
}

async function readView(
  supabase: SupabaseClient,
  fundId: string,
  configId: string,
  editable: boolean,
  canConfigure: boolean,
  stage: SetupStage | null,
): Promise<FundSpecialistsView> {
  // 0104: the override texts are readable only by who configures the fund. The others still see
  // that a module is "Tilpasset" (and the warnings), so the set is read with the service role for
  // them; none of the texts reaches the view. The caller has already been checked against the fund.
  const [{ set, rows, overrides }, maxCustom] = await Promise.all([
    loadSpecialistSet(canConfigure ? supabase : getServiceClient(), configId, stage),
    loadMaxCustom(),
  ]);
  const deepTooLow = await deepLimitTooLowFor(fundId, set.length);
  const deepWarning =
    deepTooLow === "platform"
      ? serverText("fundServer.specialists.deepPlatformTooLow")
      : deepTooLow === "team"
        ? serverText("fundServer.specialists.deepLimitTooLow")
        : null;
  const off = new Set(
    rows.filter((row) => row.kind === "standard" && !row.enabled).map((row) => row.specialist_key),
  );
  return {
    configId,
    stage,
    ownSet: stage !== null && rows.some((row) => row.stage === stage),
    editable,
    maxCustom,
    problems: specialistSetProblems(rows, maxCustom, requestLanguage()),
    warnings: [
      ...specialistSetWarnings(set, requestLanguage()),
      ...(deepWarning ? [deepWarning] : []),
    ],
    standard: specialistCatalog.map((module) => ({
      id: module.id,
      title: module.title,
      enabled: !off.has(module.id),
      categories: [...module.categories],
      isCustomized: overrides.has(module.id),
    })),
    custom: rows
      .filter((row) => row.kind === "custom")
      .sort(
        (a, b) => a.sort_order - b.sort_order || a.specialist_key.localeCompare(b.specialist_key),
      )
      .map((row) => ({
        key: row.specialist_key,
        enabled: row.enabled,
        sortOrder: row.sort_order,
        name: row.name ?? "",
        purpose: row.purpose ?? "",
        mandate: row.mandate ?? [],
        evidenceTests: row.evidence_tests ?? [],
        riskAreas: row.risk_areas ?? [],
        questions: row.research_questions ?? [],
        deliverables: row.output_focus ?? [],
        categories: (row.categories ?? []) as ScoreCategory[],
      })),
    assignment: set.map((specialist) => ({
      id: specialist.id,
      kind: specialist.kind ?? "standard",
      title: specialist.title,
      categories: [...specialist.categories],
    })),
  };
}

/**
 * Why no deep analysis on the thesis could start with this many specialists, or null when one can
 * the bottom for the level grows with the specialists, so the editor warns before
 * publishing. "platform" when the installation's own hard limit is under the bottom (the team
 * cannot raise it), else "team". No amount: kroner are for Analysegrænser only (beslutningslog 2.
 * nov). A failed read never blocks the editor; the run checks again when it starts.
 */
async function deepLimitTooLowFor(
  fundId: string,
  specialistCount: number,
): Promise<"platform" | "team" | null> {
  if (specialistCount === 0) return null;
  try {
    const service = getServiceClient();
    const [settings, platform] = await Promise.all([
      loadFundAiSettings(service, fundId),
      loadPlatformLimits(service),
    ]);
    if (!settings) return null;
    const cap = capWithinPlatform(
      "deep",
      settings.deepTier,
      settings.deepCapDkk,
      platform.capsDkk.deep,
      specialistCount,
    );
    const plan = buildRunPlan("deep", settings.deepTier, cap, specialistCount, platform.usdToDkk);
    if (plan.scope.status !== "too_low") return null;
    return tooLowCause(
      "deep",
      settings.deepTier,
      platform.capsDkk.deep,
      specialistCount,
      platform.usdToDkk,
    );
  } catch (cause) {
    console.error("[fund-specialists] deep limit", cause);
    return null;
  }
}

/** The set of one version (a draft or the active one); every member may read it. */
export const getFundSpecialists = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ fundId: fundIdSchema, configId: configIdSchema, stage: stageSchema }).parse(input),
  )
  .handler(async ({ data, context }): Promise<FundSpecialistsView> => {
    const access = await requireFundCapability(
      context.supabase,
      context.userId,
      data.fundId,
      "view_case",
    );
    const version = await loadVersion(context.supabase, data.fundId, data.configId);
    const canConfigure = hasCapability(access.roles, "configure_fund", access.settings);
    const editable = version.status === "draft" && canConfigure;
    return readView(
      context.supabase,
      data.fundId,
      data.configId,
      editable,
      canConfigure,
      data.stage ?? null,
    );
  });

/** The rows of the draft's set (the stage's own, else the shared), for the rule check before saving. */
async function draftRows(supabase: SupabaseClient, configId: string, stage: SetupStage | null) {
  const { rows } = await loadSpecialistSet(supabase, configId, stage);
  return rows;
}

const STANDARD_IDS = standardIdSchema.options;

/**
 * Before the first change to a stage's own set, the shared set is copied into the stage,
 * with an explicit row for each standard specialist (on or off). The stage then always has rows of
 * its own: without them it would fall back to the shared set (a standard specialist that is on has
 * no row in the shared set; overdragelsen fra session 2, punkt h). `rows` is the stage's set as it
 * will be (for the checks); `ensure` writes the copy and is called only right before the change
 * itself, so a refused change leaves the stage reading the shared set as before.
 */
async function stageSet(
  supabase: SupabaseClient,
  userId: string,
  configId: string,
  stage: SetupStage | null,
): Promise<{ rows: FundSpecialistRow[]; ensure: () => Promise<void> }> {
  const rows = await draftRows(supabase, configId, stage);
  if (!stage || rows.some((row) => row.stage === stage)) {
    return { rows, ensure: async () => {} };
  }
  const off = new Set(
    rows.filter((row) => row.kind === "standard" && !row.enabled).map((row) => row.specialist_key),
  );
  const copies: FundSpecialistRow[] = [
    ...STANDARD_IDS.map((id) => ({
      stage,
      specialist_key: id,
      kind: "standard" as const,
      enabled: !off.has(id),
      sort_order: 0,
      name: null,
      purpose: null,
      mandate: null,
      evidence_tests: null,
      risk_areas: null,
      research_questions: [],
      output_focus: [],
      categories: [],
    })),
    ...rows.filter((row) => row.kind === "custom").map((row) => ({ ...row, stage })),
  ];
  return {
    rows: copies,
    ensure: async () => {
      const now = new Date().toISOString();
      const { error } = await supabase.from("fund_specialists").insert(
        copies.map((row) => ({
          config_version_id: configId,
          stage,
          specialist_key: row.specialist_key,
          kind: row.kind,
          enabled: row.enabled,
          sort_order: row.sort_order,
          name: row.name,
          purpose: row.purpose,
          mandate: row.mandate,
          evidence_tests: row.evidence_tests,
          risk_areas: row.risk_areas,
          research_questions: row.research_questions,
          output_focus: row.output_focus,
          categories: row.categories,
          updated_by: userId,
          updated_at: now,
        })),
      );
      if (error) failWrite(error, serverText("fundServer.specialists.notSaved"));
    },
  };
}

/** A query on the draft's rows narrowed to one set: the stage's own, or the shared (stage null). */
function inSet<
  Q extends { eq: (column: string, value: string) => Q; is: (column: string, value: null) => Q },
>(query: Q, stage: SetupStage | null): Q {
  return stage ? query.eq("stage", stage) : query.is("stage", null);
}

function refuseBrokenSet(rows: FundSpecialistRow[], maxCustom: number) {
  const problems = specialistSetProblems(rows, maxCustom, requestLanguage());
  if (problems.length) throw new Error(problems[0]);
}

/** Own specialists a version may hold, active or not (the active ones are limited separately). */
const MAX_CUSTOM_ROWS = 12;

/** A refused write in the draft, logged and shown in plain Danish (never the raw error). */
function failWrite(error: DbErrorLike, fallback: string): never {
  console.error("[fund-specialists]", error.code, error.message);
  throw new Error(
    fundConfigErrorText(error, fallback, {
      duplicateNames: false,
      language: requestLanguage(),
    }),
  );
}

/**
 * The view after a write. RLS lets a write into a version that was published meanwhile touch no
 * row without an error, so the version is read again: a write that did not land is never shown
 * as saved.
 */
async function viewAfterWrite(
  supabase: SupabaseClient,
  fundId: string,
  configId: string,
  stage: SetupStage | null,
) {
  const version = await loadVersion(supabase, fundId, configId);
  if (version.status !== "draft") {
    throw new Error(serverText("fundServer.specialists.changedElsewhere"));
  }
  return readView(supabase, fundId, configId, true, true, stage);
}

/** Switches a standard specialist off or on in the draft (on = no row, as). */
export const setStandardSpecialist = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        fundId: fundIdSchema,
        configId: configIdSchema,
        moduleId: standardIdSchema,
        enabled: z.boolean(),
        stage: stageSchema,
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<FundSpecialistsView> => {
    await requireDraft(context.supabase, context.userId, data.fundId, data.configId);
    const stage = data.stage ?? null;
    if (stage) {
      // A stage keeps an explicit row per standard specialist (stageSet), so it is updated.
      const { rows, ensure } = await stageSet(
        context.supabase,
        context.userId,
        data.configId,
        stage,
      );
      if (
        !data.enabled &&
        specialistSetProblems(
          rows.map((row) =>
            row.kind === "standard" && row.specialist_key === data.moduleId
              ? { ...row, enabled: false }
              : row,
          ),
          Number.MAX_SAFE_INTEGER,
        ).length
      ) {
        throw new Error(serverText("fundServer.specialists.oneActive"));
      }
      await ensure();
      const { error } = await context.supabase
        .from("fund_specialists")
        .update({
          enabled: data.enabled,
          updated_by: context.userId,
          updated_at: new Date().toISOString(),
        })
        .eq("config_version_id", data.configId)
        .eq("stage", stage)
        .eq("specialist_key", data.moduleId)
        .eq("kind", "standard");
      if (error)
        failWrite(
          error,
          serverText(
            data.enabled
              ? "fundServer.specialists.notEnabled"
              : "fundServer.specialists.notDisabled",
          ),
        );
      return viewAfterWrite(context.supabase, data.fundId, data.configId, stage);
    }
    if (data.enabled) {
      const { error } = await context.supabase
        .from("fund_specialists")
        .delete()
        .eq("config_version_id", data.configId)
        .is("stage", null)
        .eq("specialist_key", data.moduleId)
        .eq("kind", "standard");
      if (error) failWrite(error, serverText("fundServer.specialists.notEnabled"));
    } else {
      const rows = (await draftRows(context.supabase, data.configId, null)).filter(
        (row) => row.specialist_key !== data.moduleId,
      );
      const after: FundSpecialistRow[] = [
        ...rows,
        {
          specialist_key: data.moduleId,
          kind: "standard",
          enabled: false,
          sort_order: 0,
          name: null,
          purpose: null,
          mandate: null,
          evidence_tests: null,
          risk_areas: null,
          research_questions: [],
          output_focus: [],
          categories: [],
        },
      ];
      if (specialistSetProblems(after, Number.MAX_SAFE_INTEGER).length) {
        throw new Error(serverText("fundServer.specialists.oneActive"));
      }
      const { error } = await context.supabase.from("fund_specialists").upsert(
        {
          config_version_id: data.configId,
          specialist_key: data.moduleId,
          kind: "standard",
          enabled: false,
          updated_by: context.userId,
          updated_at: new Date().toISOString(),
        },
        // The key includes the stage (0133, nulls not distinct): this is the shared row.
        { onConflict: "config_version_id,stage,specialist_key" },
      );
      if (error) failWrite(error, serverText("fundServer.specialists.notDisabled"));
    }
    return viewAfterWrite(context.supabase, data.fundId, data.configId, null);
  });

/**
 * Adds the fund's own specialist to the draft (no key) or changes one (with its key). A new one
 * is active unless that would pass the installation's limit, then it is saved switched off.
 */
export const saveCustomSpecialist = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        fundId: fundIdSchema,
        configId: configIdSchema,
        key: keySchema.optional(),
        specialist: customSpecialistSchema,
        stage: stageSchema,
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<FundSpecialistsView> => {
    await requireDraft(context.supabase, context.userId, data.fundId, data.configId);
    const stage = data.stage ?? null;
    const [{ rows, ensure }, maxCustom] = await Promise.all([
      stageSet(context.supabase, context.userId, data.configId, stage),
      loadMaxCustom(),
    ]);
    const existing = data.key
      ? rows.find((row) => row.kind === "custom" && row.specialist_key === data.key)
      : undefined;
    if (data.key && !existing)
      throw new Error(serverText("fundServer.common.specialistNotInDraft"));
    if (!existing && rows.filter((row) => row.kind === "custom").length >= MAX_CUSTOM_ROWS) {
      throw new Error(
        serverText("fundServer.specialists.tooManyCustom", { count: MAX_CUSTOM_ROWS }),
      );
    }
    const activeOwn = rows.filter((row) => row.kind === "custom" && row.enabled).length;
    const enabled = existing ? existing.enabled : activeOwn < maxCustom;
    const sortOrder = existing
      ? existing.sort_order
      : Math.min(100, Math.max(0, ...rows.map((row) => row.sort_order)) + 1);
    const { specialist } = data;
    await ensure();
    const { error } = await context.supabase.from("fund_specialists").upsert(
      {
        config_version_id: data.configId,
        stage,
        specialist_key: existing?.specialist_key ?? newCustomSpecialistKey(),
        kind: "custom",
        enabled,
        sort_order: sortOrder,
        name: specialist.name,
        purpose: specialist.purpose,
        mandate: specialist.mandate,
        evidence_tests: specialist.evidenceTests,
        risk_areas: specialist.riskAreas,
        research_questions: specialist.questions,
        output_focus: specialist.deliverables,
        categories: specialist.categories,
        updated_by: context.userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "config_version_id,stage,specialist_key" },
    );
    if (error) failWrite(error, serverText("fundServer.specialists.notSaved"));
    return viewAfterWrite(context.supabase, data.fundId, data.configId, stage);
  });

/** Switches the fund's own specialist off or on in the draft (on only within the limit). */
export const setCustomSpecialistEnabled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        fundId: fundIdSchema,
        configId: configIdSchema,
        key: keySchema,
        enabled: z.boolean(),
        stage: stageSchema,
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<FundSpecialistsView> => {
    await requireDraft(context.supabase, context.userId, data.fundId, data.configId);
    const stage = data.stage ?? null;
    const [{ rows, ensure }, maxCustom] = await Promise.all([
      stageSet(context.supabase, context.userId, data.configId, stage),
      loadMaxCustom(),
    ]);
    if (!rows.some((row) => row.kind === "custom" && row.specialist_key === data.key)) {
      throw new Error(serverText("fundServer.common.specialistNotInDraft"));
    }
    // Switching off is always allowed while one specialist stays active, also when the limit
    // was lowered after the specialists were switched on.
    refuseBrokenSet(
      rows.map((row) =>
        row.specialist_key === data.key ? { ...row, enabled: data.enabled } : row,
      ),
      data.enabled ? maxCustom : Number.MAX_SAFE_INTEGER,
    );
    await ensure();
    const { error } = await inSet(
      context.supabase
        .from("fund_specialists")
        .update({
          enabled: data.enabled,
          updated_by: context.userId,
          updated_at: new Date().toISOString(),
        })
        .eq("config_version_id", data.configId)
        .eq("specialist_key", data.key)
        .eq("kind", "custom"),
      stage,
    );
    if (error) failWrite(error, serverText("fundServer.specialists.notChanged"));
    return viewAfterWrite(context.supabase, data.fundId, data.configId, stage);
  });

/** Removes the fund's own specialist from the draft (published versions keep theirs). */
export const deleteCustomSpecialist = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        fundId: fundIdSchema,
        configId: configIdSchema,
        key: keySchema,
        stage: stageSchema,
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<FundSpecialistsView> => {
    await requireDraft(context.supabase, context.userId, data.fundId, data.configId);
    const stage = data.stage ?? null;
    const { rows, ensure } = await stageSet(context.supabase, context.userId, data.configId, stage);
    if (!rows.some((row) => row.kind === "custom" && row.specialist_key === data.key)) {
      throw new Error(serverText("fundServer.common.specialistNotInDraft"));
    }
    refuseBrokenSet(
      rows.filter((row) => row.specialist_key !== data.key),
      Number.MAX_SAFE_INTEGER,
    );
    await ensure();
    const { error } = await inSet(
      context.supabase
        .from("fund_specialists")
        .delete()
        .eq("config_version_id", data.configId)
        .eq("specialist_key", data.key)
        .eq("kind", "custom"),
      stage,
    );
    if (error) failWrite(error, serverText("fundServer.specialists.notDeleted"));
    return viewAfterWrite(context.supabase, data.fundId, data.configId, stage);
  });
