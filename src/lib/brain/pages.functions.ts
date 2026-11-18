/**
 * Brain · Sider (for): list and search the fund's pages, read one page with its
 * versions, and edit or lock a written section as the user's own change. Reads go through the
 * user's own session (row security: members of the fund only); the edit goes through
 * `brain_page_user_edit` (0079) with the service client after the capability `brain_review` is
 * checked, because the database's lock guard needs a switch set in the same transaction.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireFundCapability } from "@/lib/auth/access.server";
import { requireSupabaseAuth } from "@/lib/supabase/auth-middleware";
import { BrainUserError } from "./errors";
import {
  MAX_PAGE_LIST,
  MAX_PAGE_VERSIONS,
  MAX_USER_SECTION_CHARS,
  checkEditBody,
  cleanSearch,
  emptyCard,
  shapeCard,
  type BrainCard,
  shapePageDetail,
  shapePageSummary,
  type PageDetail,
  type PageSummary,
} from "./page-view";
import { requestLanguage, serverText } from "@/lib/i18n/server-text";
import type { MessageKey } from "@/lib/i18n/translate";
import { inDemoView } from "@/lib/display/display-names.server";

const fund = z.object({ fundId: z.guid() });
const KINDS = [
  "company",
  "person",
  "case",
  "sector",
  "market",
  "theme",
  "investor",
  "thesis",
  "fund_overview",
] as const;

const PAGE_COLUMNS = "id, kind, entity_id, title, version, updated_at, updated_by, sections";

export interface PageList {
  pages: PageSummary[];
  /** The list was cut at the limit. */
  truncated: boolean;
  /** Whether the user may edit and lock sections (brain_review). */
  canEdit: boolean;
}

async function readAccess(
  context: { supabase: Parameters<typeof requireFundCapability>[0]; userId: string },
  fundId: string,
) {
  const access = await requireFundCapability(
    context.supabase,
    context.userId,
    fundId,
    "brain_chat",
  );
  const { computeBrainCapabilities } = await import("./capabilities.server");
  const caps = await computeBrainCapabilities(fundId, access);
  if (!caps.chat) throw new BrainUserError(serverText("brainServer.common.notAvailable"));
  const { hasCapability } = await import("@/lib/domain/workflow");
  return {
    canEdit: hasCapability(access.roles, "brain_review", access.settings),
    canForget: hasCapability(access.roles, "brain_forget", access.settings),
  };
}

export const listBrainPages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    fund
      .extend({ q: z.string().max(200).optional(), kind: z.enum(KINDS).optional() })
      .strict()
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<PageList> => {
    const { canEdit } = await readAccess(context, data.fundId);
    const q = cleanSearch(data.q ?? "");
    const base = () => {
      let query = context.supabase
        .from("brain_pages")
        .select(PAGE_COLUMNS)
        .eq("fund_id", data.fundId)
        .order("updated_at", { ascending: false })
        .limit(MAX_PAGE_LIST + 1);
      if (data.kind) query = query.eq("kind", data.kind);
      return query;
    };
    // A search finds words anywhere in the page (full text, Danish) and in the title.
    const [text, title] = await Promise.all([
      q ? base().textSearch("search_fts", q, { type: "websearch", config: "danish" }) : base(),
      q ? base().ilike("title", `%${q}%`) : Promise.resolve(null),
    ]);
    if (text.error || title?.error) {
      console.error("[brain-pages]", text.error?.message ?? title?.error?.message);
      throw new Error(serverText("brainServer.pageServer.listNotLoaded"));
    }
    const rows = new Map<string, Record<string, unknown>>();
    for (const row of [...(text.data ?? []), ...(title?.data ?? [])]) {
      rows.set((row as { id: string }).id, row as unknown as Record<string, unknown>);
    }
    const language = requestLanguage();
    const pages = [...rows.values()]
      .map((row) => shapePageSummary(row, language))
      .filter((page): page is PageSummary => page !== null)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return inDemoView(data.fundId, {
      pages: pages.slice(0, MAX_PAGE_LIST),
      truncated: pages.length > MAX_PAGE_LIST,
      canEdit,
    });
  });

export const getBrainPage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => fund.extend({ pageId: z.guid() }).strict().parse(input))
  .handler(async ({ data, context }): Promise<PageDetail & { canEdit: boolean }> => {
    const { canEdit } = await readAccess(context, data.fundId);
    const [page, versions] = await Promise.all([
      context.supabase
        .from("brain_pages")
        .select(PAGE_COLUMNS)
        .eq("fund_id", data.fundId)
        .eq("id", data.pageId)
        .maybeSingle(),
      context.supabase
        .from("brain_page_versions")
        .select("version, sections, change_note, changed_by, created_at")
        .eq("fund_id", data.fundId)
        .eq("page_id", data.pageId)
        .order("version", { ascending: false })
        .limit(MAX_PAGE_VERSIONS),
    ]);
    if (page.error || versions.error) {
      console.error("[brain-page]", page.error?.message ?? versions.error?.message);
      throw new Error(serverText("brainServer.pageServer.notLoaded"));
    }
    if (!page.data) throw new BrainUserError(serverText("brainServer.pageServer.gone"));
    const detail = shapePageDetail(
      page.data as unknown as Record<string, unknown>,
      (versions.data ?? []) as unknown as Array<Record<string, unknown>>,
      requestLanguage(),
    );
    if (!detail) throw new BrainUserError(serverText("brainServer.pageServer.gone"));
    return inDemoView(data.fundId, { ...detail, canEdit });
  });

const SKIPPED: Record<string, MessageKey> = {
  page_gone: "brainServer.pageServer.gone",
  section_gone: "brainServer.pageServer.sectionGone",
  computed: "brainServer.pageServer.computed",
};

export const editBrainPageSection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    fund
      .extend({
        pageId: z.guid(),
        key: z.string().min(1).max(80),
        /** Omit to only lock or unlock. */
        bodyMd: z
          .string()
          .max(MAX_USER_SECTION_CHARS * 2)
          .optional(),
        /** Omit to lock when the text changes. */
        lock: z.boolean().optional(),
        note: z.string().max(500).optional(),
      })
      .strict()
      .refine((value) => value.bodyMd !== undefined || value.lock !== undefined, {
        error: serverText("brainServer.pageServer.nothing"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ version: number | null; unchanged: boolean }> => {
    await requireFundCapability(context.supabase, context.userId, data.fundId, "brain_review");
    let body: string | null = null;
    if (data.bodyMd !== undefined) {
      const check = checkEditBody(data.bodyMd);
      if (!check.ok) throw new BrainUserError(check.message);
      body = check.body;
    }
    const { getServiceClient } = await import("@/lib/supabase/admin.server");
    const { data: result, error } = await getServiceClient().rpc("brain_page_user_edit", {
      _fund_id: data.fundId,
      _page_id: data.pageId,
      _user_id: context.userId,
      _key: data.key,
      _body_md: body,
      _lock: data.lock ?? null,
      _note: data.note ?? null,
    });
    if (error) {
      console.error("[brain-page-edit]", error.message);
      throw new Error(serverText("brainServer.pageServer.editNotSaved"));
    }
    const outcome = (result ?? {}) as { skipped?: string; version?: number };
    if (outcome.skipped === "unchanged") return { version: null, unchanged: true };
    if (outcome.skipped) {
      throw new BrainUserError(
        serverText(SKIPPED[outcome.skipped] ?? "brainServer.pageServer.editNotStored"),
      );
    }
    return { version: outcome.version ?? null, unchanged: false };
  });

/**
 * The compact "Hvem var det nu lige?" card for a company or a person, found from a
 * case (its company), a Brain entity (a point on the map) or a page (a cited source). Reads go
 * through the user's own session, so row security decides what is visible; a missing page is an
 * answer ("Brain har ikke skrevet en side endnu"), not an error.
 */
export const getBrainCard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    fund
      .extend({
        caseId: z.guid().optional(),
        entityId: z.guid().optional(),
        pageId: z.guid().optional(),
      })
      .strict()
      .refine(
        (value) => [value.caseId, value.entityId, value.pageId].filter(Boolean).length === 1,
        { error: serverText("brainServer.pageServer.exactlyOne") },
      )
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<BrainCard> => {
    const shown = (card: BrainCard) => inDemoView(data.fundId, card);
    const { canEdit, canForget } = await readAccess(context, data.fundId);
    // "Glem person" on a person's card, for those who may forget (admin).
    const forgettable = (card: BrainCard, entityId: unknown, kind: unknown): BrainCard =>
      canForget && kind === "person" && typeof entityId === "string"
        ? { ...card, forgetEntityId: entityId }
        : card;
    const fail = (error: { message: string } | null) => {
      console.error("[brain-card]", error?.message);
      throw new Error(serverText("brainServer.pageServer.cardNotLoaded"));
    };
    const page = async (column: "id" | "entity_id", value: string) => {
      const { data: row, error } = await context.supabase
        .from("brain_pages")
        .select(PAGE_COLUMNS)
        .eq("fund_id", data.fundId)
        .eq(column, value)
        .in("kind", ["company", "person"])
        .maybeSingle();
      if (error) fail(error);
      return row as unknown as Record<string, unknown> | null;
    };
    const card = (row: Record<string, unknown> | null, title: string) =>
      (row && shapeCard(row, canEdit, requestLanguage())) || emptyCard("no_page", title, canEdit);

    if (data.pageId) {
      const row = await page("id", data.pageId);
      const thePage = serverText("brainServer.pageServer.thePage");
      return shown(forgettable(card(row, thePage), row?.["entity_id"], row?.["kind"]));
    }
    let entityId = data.entityId ?? null;
    let entityType: string | null = null;
    let name = serverText("brainServer.pageServer.theCompany");
    if (data.caseId) {
      const { data: found, error } = await context.supabase
        .from("cases")
        .select("company_id, companies(name)")
        .eq("fund_id", data.fundId)
        .eq("id", data.caseId)
        .maybeSingle();
      if (error) fail(error);
      if (!found) return shown(emptyCard("unknown", name, canEdit));
      const companies = (found as unknown as { companies?: { name?: string } | null }).companies;
      name = companies?.name ?? name;
      const { data: entity, error: entityError } = await context.supabase
        .from("brain_entities")
        .select("id")
        .eq("fund_id", data.fundId)
        .eq("ref_table", "companies")
        .eq("ref_id", (found as { company_id: string }).company_id)
        .eq("status", "active")
        .maybeSingle();
      if (entityError) fail(entityError);
      entityId = entity?.id ?? null;
    } else if (entityId) {
      const { data: entity, error } = await context.supabase
        .from("brain_entities")
        .select("id, name, type")
        .eq("fund_id", data.fundId)
        .eq("id", entityId)
        .eq("status", "active")
        .maybeSingle();
      if (error) fail(error);
      if (!entity) return shown(emptyCard("unknown", name, canEdit));
      name = entity.name ?? name;
      entityType = (entity.type as string | null) ?? null;
    }
    if (!entityId) return shown(emptyCard("no_page", name, canEdit));
    return shown(forgettable(card(await page("entity_id", entityId), name), entityId, entityType));
  });
