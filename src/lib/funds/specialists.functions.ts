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
export type { CustomSpecialistInput };

export interface FundSpecialistsView {
  configId: string;
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
  configId: string,
  editable: boolean,
  canConfigure: boolean,
): Promise<FundSpecialistsView> {
  // 0104: the override texts are readable only by who configures the fund. The others still see
  // that a module is "Tilpasset" (and the warnings), so the set is read with the service role for
  // them; none of the texts reaches the view. The caller has already been checked against the fund.
  const [{ set, rows, overrides }, maxCustom] = await Promise.all([
    loadSpecialistSet(canConfigure ? supabase : getServiceClient(), configId),
    loadMaxCustom(),
  ]);
  const off = new Set(
    rows.filter((row) => row.kind === "standard" && !row.enabled).map((row) => row.specialist_key),
  );
  return {
    configId,
    editable,
    maxCustom,
    problems: specialistSetProblems(rows, maxCustom, requestLanguage()),
    warnings: specialistSetWarnings(set, requestLanguage()),
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

/** The set of one version (a draft or the active one); every member may read it. */
export const getFundSpecialists = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ fundId: fundIdSchema, configId: configIdSchema }).parse(input),
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
    return readView(context.supabase, data.configId, editable, canConfigure);
  });

/** The rows of the draft as they would be after a change, for the rule check before saving. */
async function draftRows(supabase: SupabaseClient, configId: string) {
  const { rows } = await loadSpecialistSet(supabase, configId);
  return rows;
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
async function viewAfterWrite(supabase: SupabaseClient, fundId: string, configId: string) {
  const version = await loadVersion(supabase, fundId, configId);
  if (version.status !== "draft") {
    throw new Error(serverText("fundServer.specialists.changedElsewhere"));
  }
  return readView(supabase, configId, true, true);
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
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<FundSpecialistsView> => {
    await requireDraft(context.supabase, context.userId, data.fundId, data.configId);
    if (data.enabled) {
      const { error } = await context.supabase
        .from("fund_specialists")
        .delete()
        .eq("config_version_id", data.configId)
        .eq("specialist_key", data.moduleId)
        .eq("kind", "standard");
      if (error) failWrite(error, serverText("fundServer.specialists.notEnabled"));
    } else {
      const rows = (await draftRows(context.supabase, data.configId)).filter(
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
        { onConflict: "config_version_id,specialist_key" },
      );
      if (error) failWrite(error, serverText("fundServer.specialists.notDisabled"));
    }
    return viewAfterWrite(context.supabase, data.fundId, data.configId);
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
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<FundSpecialistsView> => {
    await requireDraft(context.supabase, context.userId, data.fundId, data.configId);
    const [rows, maxCustom] = await Promise.all([
      draftRows(context.supabase, data.configId),
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
    const { error } = await context.supabase.from("fund_specialists").upsert(
      {
        config_version_id: data.configId,
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
      { onConflict: "config_version_id,specialist_key" },
    );
    if (error) failWrite(error, serverText("fundServer.specialists.notSaved"));
    return viewAfterWrite(context.supabase, data.fundId, data.configId);
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
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<FundSpecialistsView> => {
    await requireDraft(context.supabase, context.userId, data.fundId, data.configId);
    const [rows, maxCustom] = await Promise.all([
      draftRows(context.supabase, data.configId),
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
    const { error } = await context.supabase
      .from("fund_specialists")
      .update({
        enabled: data.enabled,
        updated_by: context.userId,
        updated_at: new Date().toISOString(),
      })
      .eq("config_version_id", data.configId)
      .eq("specialist_key", data.key)
      .eq("kind", "custom");
    if (error) failWrite(error, serverText("fundServer.specialists.notChanged"));
    return viewAfterWrite(context.supabase, data.fundId, data.configId);
  });

/** Removes the fund's own specialist from the draft (published versions keep theirs). */
export const deleteCustomSpecialist = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ fundId: fundIdSchema, configId: configIdSchema, key: keySchema }).parse(input),
  )
  .handler(async ({ data, context }): Promise<FundSpecialistsView> => {
    await requireDraft(context.supabase, context.userId, data.fundId, data.configId);
    const rows = await draftRows(context.supabase, data.configId);
    if (!rows.some((row) => row.kind === "custom" && row.specialist_key === data.key)) {
      throw new Error(serverText("fundServer.common.specialistNotInDraft"));
    }
    refuseBrokenSet(
      rows.filter((row) => row.specialist_key !== data.key),
      Number.MAX_SAFE_INTEGER,
    );
    const { error } = await context.supabase
      .from("fund_specialists")
      .delete()
      .eq("config_version_id", data.configId)
      .eq("specialist_key", data.key)
      .eq("kind", "custom");
    if (error) failWrite(error, serverText("fundServer.specialists.notDeleted"));
    return viewAfterWrite(context.supabase, data.fundId, data.configId);
  });
