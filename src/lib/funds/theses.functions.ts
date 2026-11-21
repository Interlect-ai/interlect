/**
 * Theses in a team (spec, §3, §4.7, §4.9).
 *
 * Every member reads the team's theses. Creating, renaming, choosing the default, archiving and
 * reactivating are `configure_fund` (Admin and Lead): checked here first, and again inside the
 * database functions (0127 `create_thesis_from`, 0128), which also lock the team's theses and write
 * the audit line. "Delete thesis" archives: nothing is ever deleted (§3).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/lib/supabase/auth-middleware";
import { getServiceClient } from "@/lib/supabase/admin.server";
import { requireFundCapability } from "@/lib/auth/access.server";
import { serverText } from "@/lib/i18n/server-text";
import { parseLanguage } from "@/lib/i18n/language";
import {
  fundConfigTemplateIn,
  fundTemplateKeys,
  type FundTemplateKey,
} from "@/lib/funds/config-templates";
import { fundDraftRows } from "@/lib/funds/fund-draft";
import { loadTheses } from "@/lib/funds/thesis-scope.server";
import { thesisRefusal, type ThesisStatus } from "@/lib/funds/theses";

export interface ThesisSummary {
  id: string;
  name: string;
  status: ThesisStatus;
  isDefault: boolean;
  createdAt: string;
  archivedAt: string | null;
  /** The published version's number; null when the thesis was never published. */
  publishedVersion: number | null;
  /** When the thesis was last published (the active version's activation). */
  publishedAt: string | null;
  /** The open draft's version number, if any. */
  draftVersion: number | null;
  /** The draft's id, so the setup page can open it. */
  draftConfigId: string | null;
  /** The published version's id. */
  activeConfigId: string | null;
  caseCount: number;
}

const thesisNameSchema = z.string().trim().min(2).max(80);

/** A database refusal in the person's language; anything else becomes `fallback`. */
function thesisError(
  error: { message?: string; code?: string } | null,
  fallback: "notCreated" | "notSaved",
) {
  // 23505: two people chose the same name at the same moment (the unique name index).
  const refusal = error?.code === "23505" ? "nameTaken" : thesisRefusal(error?.message);
  if (!refusal) console.error("[theses]", error?.message);
  return new Error(serverText(`thesisServer.${refusal ?? fallback}`));
}

export const listTheses = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ fundId: z.guid() }).parse(input))
  .handler(async ({ data, context }): Promise<ThesisSummary[]> => {
    await requireFundCapability(context.supabase, context.userId, data.fundId, "view_case");
    const theses = await loadTheses(context.supabase, data.fundId);
    // One exact count per thesis: a list of all the team's cases would stop at 1,000 rows.
    const [versions, ...counts] = await Promise.all([
      context.supabase
        .from("fund_config_versions")
        .select("id, thesis_id, status, version, activated_at")
        .eq("fund_id", data.fundId)
        .in("status", ["active", "draft"]),
      ...theses.map((thesis) =>
        context.supabase
          .from("cases")
          .select("id", { count: "exact", head: true })
          .eq("fund_id", data.fundId)
          .eq("thesis_id", thesis.id),
      ),
    ]);
    const countError = counts.find((result) => result.error)?.error;
    if (versions.error || countError) {
      console.error("[theses] summary", versions.error?.message ?? countError?.message);
      throw new Error(serverText("thesisServer.notLoaded"));
    }
    const caseCounts = new Map(
      theses.map((thesis, index) => [thesis.id, counts[index]?.count ?? 0]),
    );
    return theses.map((thesis) => {
      const own = (versions.data ?? []).filter((row) => row["thesis_id"] === thesis.id);
      const active = own.find((row) => row["status"] === "active");
      const draft = own.find((row) => row["status"] === "draft");
      return {
        id: thesis.id,
        name: thesis.name,
        status: thesis.status,
        isDefault: thesis.isDefault,
        createdAt: thesis.createdAt,
        archivedAt: thesis.archivedAt,
        publishedVersion: (active?.["version"] as number | undefined) ?? null,
        publishedAt: (active?.["activated_at"] as string | null | undefined) ?? null,
        draftVersion: (draft?.["version"] as number | undefined) ?? null,
        draftConfigId: (draft?.["id"] as string | undefined) ?? null,
        activeConfigId: (active?.["id"] as string | undefined) ?? null,
        caseCount: caseCounts.get(thesis.id) ?? 0,
      } satisfies ThesisSummary;
    });
  });

/** A unique analysis key for a new thesis in the team (0127 §2.2: each thesis has its own). */
async function newProfileKey(
  service: ReturnType<typeof getServiceClient>,
  fundId: string,
  slug: string,
): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const key = `${slug.slice(0, 60)}-${crypto.randomUUID().slice(0, 8)}`;
    const { count, error } = await service
      .from("fund_config_versions")
      .select("id", { count: "exact", head: true })
      .eq("fund_id", fundId)
      .eq("profile_key", key);
    if (error) break;
    if (count === 0) return key;
  }
  throw new Error(serverText("thesisServer.notCreated"));
}

const createThesisSchema = z.object({
  fundId: z.guid(),
  name: thesisNameSchema,
  /** "Start fra": an empty thesis from a template (the default, §7.4) or a copy of an active one. */
  start: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("template"),
      template: z.enum(fundTemplateKeys).default("venture"),
    }),
    z.object({ kind: z.literal("copy"), sourceThesisId: z.guid() }),
  ]),
});

/**
 * "Ny tese" (§4.9): a new thesis in the same team with version 1 as a draft. It cannot be chosen
 * for a case until v1 is published. Returns the thesis and its draft, which the setup page opens.
 */
export const createThesis = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => createThesisSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ thesisId: string; configId: string }> => {
    await requireFundCapability(context.supabase, context.userId, data.fundId, "configure_fund");
    const service = getServiceClient();

    if (data.start.kind === "copy") {
      const { data: source, error: sourceError } = await context.supabase
        .from("fund_theses")
        .select("id")
        .eq("fund_id", data.fundId)
        .eq("id", data.start.sourceThesisId)
        .maybeSingle();
      if (sourceError) throw new Error(serverText("thesisServer.notLoaded"));
      if (!source) throw new Error(serverText("thesisServer.notFound"));
      const { data: thesisId, error } = await context.supabase.rpc("create_thesis_from", {
        _source_thesis_id: data.start.sourceThesisId,
        _name: data.name,
      });
      if (error || !thesisId) throw thesisError(error, "notCreated");
      const { data: draft, error: draftError } = await service
        .from("fund_config_versions")
        .select("id")
        .eq("fund_id", data.fundId)
        .eq("thesis_id", thesisId as string)
        .eq("status", "draft")
        .maybeSingle();
      if (draftError || !draft) throw new Error(serverText("thesisServer.notCreated"));
      return { thesisId: thesisId as string, configId: draft["id"] as string };
    }

    const { data: fund, error: fundError } = await service
      .from("funds")
      .select("slug, language")
      .eq("id", data.fundId)
      .single();
    if (fundError || !fund) throw new Error(serverText("thesisServer.notCreated"));

    const { data: created, error } = await context.supabase.rpc("create_thesis", {
      _fund_id: data.fundId,
      _name: data.name,
    });
    if (error || !created) throw thesisError(error, "notCreated");
    const thesisId = created as string;

    // Version 1 from the template, exactly as a new team's first setup (fund-draft.ts). Should a
    // step fail, the half-made thesis is removed again, so the menu never shows an empty one.
    try {
      const language = parseLanguage(fund["language"] as string | null);
      const template = fundConfigTemplateIn(data.start.template as FundTemplateKey, language);
      const profileKey = await newProfileKey(service, data.fundId, fund["slug"] as string);
      const draft = fundDraftRows(template, profileKey, language);
      const { data: config, error: configError } = await service
        .from("fund_config_versions")
        .insert({
          fund_id: data.fundId,
          thesis_id: thesisId,
          ...draft.config,
          created_by: context.userId,
        })
        .select("id")
        .single();
      if (configError || !config) throw new Error(configError?.message ?? "no config");
      const configId = config["id"] as string;
      const { error: mandateError } = await service
        .from("fund_mandates")
        .insert({ config_version_id: configId, ...draft.mandate });
      if (mandateError) throw new Error(mandateError.message);
      if (draft.gates.length > 0) {
        const { error: gateError } = await service
          .from("mandate_gates")
          .insert(draft.gates.map((gate) => ({ config_version_id: configId, ...gate })));
        if (gateError) throw new Error(gateError.message);
      }
      if (draft.criteria.length > 0) {
        const { error: criteriaError } = await service
          .from("assessment_criteria")
          .insert(
            draft.criteria.map((criterion) => ({ config_version_id: configId, ...criterion })),
          );
        if (criteriaError) throw new Error(criteriaError.message);
      }
      return { thesisId, configId };
    } catch (cause) {
      console.error("[theses] create from template", cause);
      // Only this new, never-published thesis (no cases, no runs); its versions follow (cascade).
      const { error: cleanupError } = await service
        .from("fund_theses")
        .delete()
        .eq("id", thesisId)
        .eq("fund_id", data.fundId)
        .eq("status", "draft");
      if (cleanupError) console.error("[theses] cleanup", cleanupError.message);
      throw new Error(serverText("thesisServer.notCreated"));
    }
  });

const thesisRefSchema = z.object({ fundId: z.guid(), thesisId: z.guid() });

/** Checks the role and that the thesis is the team's, before a database change. */
async function requireTeamThesis(
  supabase: Parameters<typeof requireFundCapability>[0],
  userId: string,
  fundId: string,
  thesisId: string,
) {
  await requireFundCapability(supabase, userId, fundId, "configure_fund");
  const { data, error } = await supabase
    .from("fund_theses")
    .select("id")
    .eq("fund_id", fundId)
    .eq("id", thesisId)
    .maybeSingle();
  if (error) throw new Error(serverText("thesisServer.notLoaded"));
  if (!data) throw new Error(serverText("thesisServer.notFound"));
}

export const renameThesis = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => thesisRefSchema.extend({ name: thesisNameSchema }).parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await requireTeamThesis(context.supabase, context.userId, data.fundId, data.thesisId);
    const { error } = await context.supabase.rpc("rename_thesis", {
      _thesis_id: data.thesisId,
      _name: data.name,
    });
    if (error) throw thesisError(error, "notSaved");
    return { ok: true };
  });

export const setDefaultThesis = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => thesisRefSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await requireTeamThesis(context.supabase, context.userId, data.fundId, data.thesisId);
    const { error } = await context.supabase.rpc("set_default_thesis", {
      _thesis_id: data.thesisId,
    });
    if (error) throw thesisError(error, "notSaved");
    return { ok: true };
  });

/**
 * "Slet tese" (§3): archives. The last active thesis cannot be archived. When the default is
 * archived, the oldest other active thesis becomes the default; its id is returned so the
 * confirmation can say so.
 */
export const archiveThesis = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => thesisRefSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ newDefaultThesisId: string | null }> => {
    await requireTeamThesis(context.supabase, context.userId, data.fundId, data.thesisId);
    const { data: newDefault, error } = await context.supabase.rpc("archive_thesis", {
      _thesis_id: data.thesisId,
    });
    if (error) throw thesisError(error, "notSaved");
    return { newDefaultThesisId: (newDefault as string | null) ?? null };
  });

/**
 * "Genaktivér" (§3): the thesis is back with the same published version and cases. `name` is only
 * needed when another thesis took the old name meanwhile (the dialog asks for a new one).
 */
export const reactivateThesis = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    thesisRefSchema.extend({ name: thesisNameSchema.optional() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await requireTeamThesis(context.supabase, context.userId, data.fundId, data.thesisId);
    const { error } = await context.supabase.rpc("reactivate_thesis", {
      _thesis_id: data.thesisId,
      _name: data.name ?? null,
    });
    if (error) throw thesisError(error, "notSaved");
    return { ok: true };
  });
