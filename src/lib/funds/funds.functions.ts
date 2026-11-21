import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/lib/supabase/auth-middleware";
import { getServiceClient } from "@/lib/supabase/admin.server";
import { LANGUAGES, languageToApply, parseLanguage, type Language } from "@/lib/i18n/language";
import { requireFundCapability, writeAudit } from "@/lib/auth/access.server";
import {
  fundConfigTemplateIn,
  fundTemplateKeys,
  type FundTemplateKey,
} from "@/lib/funds/config-templates";
import { fundDraftRows } from "@/lib/funds/fund-draft";
import { serverText } from "@/lib/i18n/server-text";
import { isStoragePathIn } from "@/lib/security/storage-path";
import { pickDefaultThesis, thesisRowFrom, type ThesisRow } from "@/lib/funds/theses";

/**
 * Fondsidentitet kommer fra `funds` og `fund_config_versions` — aldrig fra en
 * hardkodet profilnøgle. En fond adresseres altid med sit uuid.
 */
export interface MemberFund {
  id: string;
  name: string;
  slug: string;
  /** Kort tese fra den aktive (ellers seneste) opsætning. Tom for nye fonde. */
  shortThesis: string | null;
  /** Om fonden har en publiceret opsætning, kun en kladde, eller ingen. */
  configStatus: "active" | "draft" | "none";
  /** Versionsnummer for den aktive (ellers seneste kladde) opsætning; null uden opsætning. */
  configVersion: number | null;
  /** Brains demofond med syntetiske data (slug `demo`), ikke en kundefond. */
  isDemo: boolean;
  /** Stadier i den aktive (ellers seneste) opsætning; styrer fx om Vækst og Buyout kan vælges. */
  stages: string[];
  roles: string[];
  /** The fund's language: the interface and everything AI writes. */
  language: Language;
  /**
   * The default thesis: the card shows the team and under it this thesis's name and
   * version (spec flere-teser-i-et-team §4.8). Null when the team has no thesis yet.
   */
  defaultThesis: { id: string; name: string } | null;
}

// "demo" er Brains demo-fond med syntetiske data på staging (scripts/brain-seed-demo.ts).
// Kun den mærkes "Demo"; en kundefond med et andet slug er aldrig en demo.
const DEMO_SLUG = "demo";

export const listMemberFunds = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MemberFund[]> => {
    const { data: memberships, error } = await context.supabase
      .from("fund_memberships")
      .select("id, fund_id, status, funds(name, slug, language), fund_membership_roles(role)")
      .eq("user_id", context.userId)
      .eq("status", "active");
    if (error) throw new Error(serverText("fundServer.funds.notLoaded"));

    const rows = memberships ?? [];
    const fundIds = rows.map((row) => row["fund_id"] as string);
    if (fundIds.length === 0) return [];

    const [{ data: configs }, { data: thesisRows, error: thesesError }] = await Promise.all([
      context.supabase
        .from("fund_config_versions")
        .select("fund_id, thesis_id, status, version, fund_mandates(thesis, stages)")
        .in("fund_id", fundIds)
        .in("status", ["active", "draft"])
        .order("version", { ascending: false }),
      context.supabase
        .from("fund_theses")
        .select("id, fund_id, name, status, is_default, created_at")
        .in("fund_id", fundIds),
    ]);
    if (thesesError) {
      console.error("[listMemberFunds] theses", thesesError.message);
      throw new Error(serverText("fundServer.funds.notLoaded"));
    }
    // The card reads the team's default thesis, not "the team's active version".
    const defaultByFund = new Map<string, ThesisRow>();
    for (const fundId of fundIds) {
      const chosen = pickDefaultThesis(
        (thesisRows ?? [])
          .filter((row) => row["fund_id"] === fundId)
          .map((row) => thesisRowFrom(row as Record<string, unknown>)),
      );
      if (chosen) defaultByFund.set(fundId, chosen);
    }

    const byFund = new Map<
      string,
      { status: "active" | "draft"; version: number; thesis: string | null; stages: string[] }
    >();
    for (const config of configs ?? []) {
      const fundId = config["fund_id"] as string;
      if (config["thesis_id"] !== defaultByFund.get(fundId)?.id) continue;
      const status = config["status"] as "active" | "draft";
      const existing = byFund.get(fundId);
      if (existing?.status === "active") continue;
      const rawMandate = config["fund_mandates"] as unknown;
      const mandate = (Array.isArray(rawMandate) ? rawMandate[0] : rawMandate) as {
        thesis: string;
        stages: string[] | null;
      } | null;
      byFund.set(fundId, {
        status,
        version: config["version"] as number,
        thesis: mandate?.thesis ?? null,
        stages: mandate?.stages ?? [],
      });
    }

    return rows
      .map((row) => {
        const rawFund = row["funds"] as unknown;
        const fund = (Array.isArray(rawFund) ? rawFund[0] : rawFund) as {
          name: string;
          slug: string;
          language?: string | null;
        } | null;
        const config = byFund.get(row["fund_id"] as string);
        const rawRoles = (row["fund_membership_roles"] ?? []) as Array<{ role: string }>;
        const slug = fund?.slug ?? "";
        return {
          id: row["fund_id"] as string,
          name: fund?.name ?? "Unavngivet team",
          slug,
          shortThesis: config?.thesis ? firstSentence(config.thesis) : null,
          configStatus: config?.status ?? "none",
          configVersion: config?.version ?? null,
          isDemo: slug === DEMO_SLUG,
          stages: config?.stages ?? [],
          roles: (Array.isArray(rawRoles) ? rawRoles : []).map((entry) => entry.role),
          language: parseLanguage(fund?.language),
          defaultThesis: defaultThesisOf(defaultByFund.get(row["fund_id"] as string)),
        } satisfies MemberFund;
      })
      .sort((a, b) => Number(a.isDemo) - Number(b.isDemo) || a.name.localeCompare(b.name, "da"));
  });

function defaultThesisOf(thesis: ThesisRow | undefined): MemberFund["defaultThesis"] {
  return thesis ? { id: thesis.id, name: thesis.name } : null;
}

function firstSentence(text: string): string {
  const trimmed = text.trim();
  const stop = trimmed.indexOf(". ");
  return stop > 30 ? trimmed.slice(0, stop + 1) : trimmed.slice(0, 180);
}

/**
 * The caller's only team, when it was never used: the caller is its only member (Admin)
 * and nobody is invited, it has only an unpublished draft (v1 from `customer:new`) and no cases. "Ny investeringstese" then fills that
 * team (the guide saves its answers to the draft, name included) instead of creating a second one
 * next to it. Any doubt (an error, a published setup, a case) creates a new team as before.
 */
async function firstUnusedFund(
  service: ReturnType<typeof getServiceClient>,
  userId: string,
): Promise<{ fundId: string; configId: string } | null> {
  const { data: memberships, error } = await service
    .from("fund_memberships")
    .select("fund_id, fund_membership_roles(role)")
    .eq("user_id", userId)
    .eq("status", "active");
  if (error || !memberships || memberships.length !== 1) return null;
  const only = memberships[0]!;
  const roles = (only["fund_membership_roles"] ?? []) as Array<{ role: string }>;
  if (!roles.some((entry) => entry.role === "admin")) return null;
  const fundId = only["fund_id"] as string;
  // Nobody else is in (or invited to) the team, so filling it never surprises a colleague.
  const [configs, cases, members, invitations] = await Promise.all([
    service.from("fund_config_versions").select("id, status").eq("fund_id", fundId),
    service.from("cases").select("id", { count: "exact", head: true }).eq("fund_id", fundId),
    service
      .from("fund_memberships")
      .select("id", { count: "exact", head: true })
      .eq("fund_id", fundId),
    service
      .from("invitations")
      .select("id", { count: "exact", head: true })
      .eq("fund_id", fundId)
      .is("accepted_at", null)
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString()),
  ]);
  if (configs.error || cases.error || members.error || invitations.error) return null;
  if (cases.count !== 0 || members.count !== 1 || invitations.count !== 0) return null;
  const rows = configs.data ?? [];
  if (rows.length !== 1 || rows[0]!["status"] !== "draft") return null;
  return { fundId, configId: rows[0]!["id"] as string };
}

/** Gives a just-created (or still unused) team the wanted language; returns the language it has. */
async function applyFundLanguage(
  service: ReturnType<typeof getServiceClient>,
  fundId: string,
  current: Language,
  wanted: Language | undefined,
): Promise<Language> {
  const next = languageToApply(current, wanted);
  if (!next) return current;
  const { error } = await service
    .from("funds")
    .update({ language: next, updated_at: new Date().toISOString() })
    .eq("id", fundId);
  if (error) {
    console.error("[createFund] language", error.message);
    throw new Error(serverText("fundServer.funds.fundNotCreated"));
  }
  return next;
}

/**
 * Opretter en ny fond med administratormedlemskab og en tom opsætning i
 * kladde-tilstand. Screening kan først køres, når kladden er publiceret.
 */
export const createFund = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        name: z.string().trim().min(2).max(160),
        template: z.enum(fundTemplateKeys).default("venture"),
        // The language the guide was shown in. Missing: the installation's language.
        language: z.enum(LANGUAGES).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ fundId: string; configId: string }> => {
    const service = getServiceClient();
    // Kun en Admin i en eksisterende investeringstese må oprette en ny (harden S5-3). Den første
    // Admin i en ny installation oprettes af customer:new, ikke herfra.
    const { data: adminRows, error: adminError } = await service
      .from("fund_memberships")
      .select("id, fund_membership_roles!inner(role)")
      .eq("user_id", context.userId)
      .eq("status", "active")
      .eq("fund_membership_roles.role", "admin")
      .limit(1);
    if (adminError) {
      console.error("[createFund] admin check", adminError.message);
      throw new Error(serverText("fundServer.common.accessCheckFailed"));
    }
    if (!adminRows?.length) {
      throw new Error(serverText("fundServer.funds.adminOnly"));
    }
    // On a new installation the guide fills the first team instead of making a second one.
    const unused = await firstUnusedFund(service, context.userId);
    if (unused) {
      const { data: current, error: currentError } = await service
        .from("funds")
        .select("language")
        .eq("id", unused.fundId)
        .single();
      if (currentError || !current) throw new Error(serverText("fundServer.funds.fundNotCreated"));
      await applyFundLanguage(
        service,
        unused.fundId,
        parseLanguage(current["language"] as string | null),
        data.language,
      );
      return unused;
    }
    const slug = await uniqueSlug(service, slugify(data.name));

    const { data: fund, error: fundError } = await service
      .from("funds")
      .insert({ name: data.name, slug })
      .select("id, language")
      .single();
    if (fundError || !fund) throw new Error(serverText("fundServer.funds.fundNotCreated"));
    const fundId = fund["id"] as string;
    // The draft in the new team's own language: the guide's, else the installation's (0085).
    // The insert trigger turns an explicit 'da' into the installation's language, so it is set again.
    const language = await applyFundLanguage(
      service,
      fundId,
      parseLanguage(fund["language"] as string | null),
      data.language,
    );
    const template = fundConfigTemplateIn(data.template as FundTemplateKey, language);
    const draft = fundDraftRows(template, slug, language);

    const { data: membership, error: membershipError } = await service
      .from("fund_memberships")
      .insert({ fund_id: fundId, user_id: context.userId, status: "active" })
      .select("id")
      .single();
    if (membershipError || !membership)
      throw new Error(serverText("fundServer.funds.membershipNotCreated"));

    const { error: roleError } = await service
      .from("fund_membership_roles")
      .insert({ membership_id: membership["id"] as string, role: "admin" });
    if (roleError) throw new Error(serverText("fundServer.funds.roleNotGranted"));

    const { data: config, error: configError } = await service
      .from("fund_config_versions")
      .insert({ fund_id: fundId, ...draft.config, created_by: context.userId })
      .select("id")
      .single();
    if (configError || !config) throw new Error(serverText("fundServer.funds.setupNotCreated"));
    const configId = config["id"] as string;

    const { error: mandateError } = await service
      .from("fund_mandates")
      .insert({ config_version_id: configId, ...draft.mandate });
    if (mandateError) throw new Error(serverText("fundServer.funds.mandateNotCreated"));

    if (draft.gates.length > 0) {
      const { error: gateError } = await service
        .from("mandate_gates")
        .insert(draft.gates.map((gate) => ({ config_version_id: configId, ...gate })));
      if (gateError) throw new Error(serverText("fundServer.funds.rulesNotCreated"));
    }

    if (draft.criteria.length > 0) {
      const { error: criteriaError } = await service
        .from("assessment_criteria")
        .insert(draft.criteria.map((criterion) => ({ config_version_id: configId, ...criterion })));
      if (criteriaError) throw new Error(serverText("fundServer.funds.scoringNotCreated"));
    }

    return { fundId, configId };
  });

interface DeleteFundResult {
  deletedFundId: string;
  /** Private files that could not be removed after the fund was deleted. */
  filesNotRemoved: number;
  /** false when the fund's folder could not be listed in full, so leftovers may exist. */
  sweepComplete: boolean;
  /** A cleanup record was written for the leftovers (server-only audit event). */
  cleanupRecorded: boolean;
}

const deleteFundSchema = z.object({
  fundId: z.guid(),
  confirmationName: z.string().trim().min(1).max(160),
});

/**
 * Sletter hele et fonds-workspace. Navnet skal skrives præcist, og både UI og
 * server kræver administratorrollen. Databasen slettes først (én transaktion), og først
 * derefter de private filer, så en fejlet sletning aldrig efterlader en fond uden sine filer.
 */
export const deleteFund = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => deleteFundSchema.parse(input))
  .handler(async ({ data, context }): Promise<DeleteFundResult> => {
    const access = await requireFundCapability(
      context.supabase,
      context.userId,
      data.fundId,
      // Hele fonden slettes: kun administrator, også efter at partnere kan ændre opsætningen.
      "manage_users",
    );
    if (access.fundName.trim() !== data.confirmationName.trim()) {
      throw new Error(serverText("fundServer.funds.nameMismatch"));
    }

    const service = getServiceClient();
    // Kun en Admin kan oprette en ny investeringstese (harden S5-3), så en Admin må ikke slette
    // sin eneste: så kunne vedkommende aldrig oprette en igen (harden G15).
    const { data: adminFunds, error: adminFundsError } = await service
      .from("fund_memberships")
      .select("fund_id, fund_membership_roles!inner(role)")
      .eq("user_id", context.userId)
      .eq("status", "active")
      .eq("fund_membership_roles.role", "admin");
    if (adminFundsError) {
      console.error("[delete-fund] admin funds", adminFundsError.message);
      throw new Error(serverText("fundServer.common.accessCheckFailed"));
    }
    if (!(adminFunds ?? []).some((row) => row["fund_id"] !== data.fundId)) {
      throw new Error(serverText("fundServer.funds.onlyThesis"));
    }

    const { data: documents, error: documentsError } = await service
      .from("documents")
      .select("storage_path")
      .eq("fund_id", data.fundId);
    if (documentsError) throw new Error(serverText("fundServer.funds.filesNotChecked"));

    const storagePaths = (documents ?? [])
      .map((document) => document["storage_path"] as string | null)
      // Removed with the service key: only paths in this fund's own folder.
      .filter(
        (path): path is string => Boolean(path) && isStoragePathIn(path as string, data.fundId),
      );

    await writeAudit(service, {
      fundId: null,
      actorType: "user",
      actorId: context.userId,
      action: "fund_deletion_confirmed",
      entity: "fund",
      entityId: data.fundId,
      payload: { fundName: access.fundName, privateFiles: storagePaths.length },
    });

    // delete_fund (0037) sletter alt i én transaktion: kørsler, scanner-rækker og finanstal, der
    // ellers blokerer (ON DELETE RESTRICT), og selve fonden; resten følger med som cascade.
    const { error: deleteError } = await service.rpc("delete_fund", { _fund_id: data.fundId });
    if (deleteError) {
      console.error("[delete-fund] delete_fund failed", deleteError.message);
      // The confirmation is already in the audit log; record that nothing was deleted (G19).
      try {
        await writeAudit(service, {
          fundId: null,
          actorType: "user",
          actorId: context.userId,
          action: "fund_deletion_not_saved",
          entity: "fund",
          entityId: data.fundId,
          payload: {},
        });
      } catch (cause) {
        console.error(`[delete-fund] not-saved record for fund ${data.fundId}`, cause);
      }
      throw new Error(serverText("fundServer.funds.notDeleted"));
    }

    // Fonden er væk; filerne fjernes nu, også alt andet i fondens mappe (fondsdokumenter og filer,
    // der blev lagt op, mens sletningen stod på; harden/G6). Fejler det, skrives en
    // oprydningsnote, som kun serveren kan læse (fund_id null), med antallet og fondens id:
    // oprydningen gentages ved at feje mappen igen, så filnavne gemmes aldrig (harden G7).
    // Sletningen af fonden står ved magt, og brugeren får at vide, hvad der mangler.
    const bucket = service.storage.from("pitch-decks");
    const leftovers = await listFundFolder(bucket, data.fundId);
    const toRemove = [...new Set([...storagePaths, ...leftovers.paths])];
    const notRemoved: string[] = [];
    for (let index = 0; index < toRemove.length; index += 100) {
      const batch = toRemove.slice(index, index + 100);
      const { error: storageError } = await bucket.remove(batch);
      if (storageError) {
        notRemoved.push(...batch);
        console.error(
          `[delete-fund] ${batch.length} private files of deleted fund ${data.fundId} not removed`,
          storageError.message,
        );
      }
    }
    let cleanupRecorded = false;
    if (notRemoved.length || !leftovers.complete) {
      try {
        await writeAudit(service, {
          fundId: null,
          actorType: "user",
          actorId: context.userId,
          action: "fund_files_not_removed",
          entity: "fund",
          entityId: data.fundId,
          payload: {
            prefix: `${data.fundId}/`,
            filesNotRemoved: notRemoved.length,
            folderListed: leftovers.complete,
          },
        });
        cleanupRecorded = true;
      } catch (cause) {
        console.error(`[delete-fund] cleanup record for fund ${data.fundId}`, cause);
      }
    }
    return {
      deletedFundId: data.fundId,
      filesNotRemoved: notRemoved.length,
      sweepComplete: leftovers.complete,
      cleanupRecorded,
    };
  });

/**
 * Every file under `<fundId>/` in the private bucket, at any depth (case files are
 * `<fundId>/<caseId>/<file>`, fund documents `<fundId>/fund-config/<configId>/<file>`), page by
 * page. complete = false when a listing failed, so the caller records that the sweep was partial.
 */
async function listFundFolder(
  bucket: ReturnType<ReturnType<typeof getServiceClient>["storage"]["from"]>,
  fundId: string,
): Promise<{ paths: string[]; complete: boolean }> {
  const PAGE = 1000;
  const paths: string[] = [];
  let complete = true;
  const folders = [fundId];
  while (folders.length) {
    const folder = folders.pop()!;
    for (let offset = 0; ; offset += PAGE) {
      const { data: entries, error } = await bucket.list(folder, { limit: PAGE, offset });
      if (error) {
        console.error(
          `[delete-fund] a folder of fund ${fundId} could not be listed`,
          error.message,
        );
        complete = false;
        break;
      }
      for (const entry of entries ?? []) {
        // A file has an id; a folder does not.
        if (entry.id) paths.push(`${folder}/${entry.name}`);
        else folders.push(`${folder}/${entry.name}`);
      }
      if ((entries ?? []).length < PAGE) break;
    }
  }
  return { paths, complete };
}

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replaceAll("æ", "ae")
    .replaceAll("ø", "oe")
    .replaceAll("å", "aa")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base.length > 0 ? base.slice(0, 60) : "fond";
}

async function uniqueSlug(
  service: ReturnType<typeof getServiceClient>,
  base: string,
): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const { data } = await service.from("funds").select("id").eq("slug", candidate).maybeSingle();
    if (!data) return candidate;
  }
  return `${base}-${Date.now()}`;
}
