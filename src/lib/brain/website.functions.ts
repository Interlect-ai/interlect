import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireFundCapability, writeAudit } from "@/lib/auth/access.server";
import { isAdminRole } from "@/lib/auth/is-admin";
import { getServiceClient } from "@/lib/supabase/admin.server";
import { requireSupabaseAuth } from "@/lib/supabase/auth-middleware";
import { BrainUserError } from "./errors";
import { isBrainEnabled } from "./flags";
import { BRAIN_SOURCES_BUCKET } from "./forget.server";
import { supabaseIngestAdmin } from "./ingest-admin.server";
import { crawlSite } from "./ingest/crawl";
import { portfolioRows } from "./ingest/history";
import {
  decodeWebsiteFile,
  MAX_PORTFOLIO,
  MAX_SITE_PAGE_BYTES,
  sameSite,
  websiteStartUrl,
  type PortfolioCandidate,
} from "./ingest/site";
import { pinnedFetch } from "./ingest/site-fetch.server";
import { submitWebsite, type CompleteResult } from "./ingest/uploads";
import { serverText } from "@/lib/i18n/server-text";
import { inDemoView, loadChoiceKey } from "@/lib/display/display-names.server";

/**
 * Fondens hjemmeside ind i Brain (§4-5). Reading the site costs nothing (no AI):
 * the pages become one source that waits for the price to be approved like an upload. Portfolio
 * companies found on the site are only proposals; an Admin confirms them, and they become
 * "investeret" in the fund's decision history (brain_historical_decisions, 0046).
 */
const fundId = z.guid();
const sourceId = z.guid();

function requireBrain() {
  if (!isBrainEnabled()) throw new BrainUserError(serverText("brainServer.common.notEnabled"));
}

async function userFacing<T>(action: string, fund: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (cause) {
    if (cause instanceof BrainUserError) throw cause;
    console.error(
      `[brain-website] ${action} fund=${fund}`,
      cause instanceof Error ? cause.message : cause,
    );
    throw new Error(serverText("brainServer.common.failed"));
  }
}

export interface WebsiteSubmitResult {
  complete: CompleteResult;
  pages: number;
  portfolio: number;
}

export const submitBrainWebsite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) =>
    z
      .object({ fundId, url: z.string().trim().min(3).max(2_000) })
      .strict()
      .parse(data),
  )
  .handler(async ({ data, context }): Promise<WebsiteSubmitResult> => {
    await requireFundCapability(context.supabase, context.userId, data.fundId, "brain_ingest");
    requireBrain();
    const startUrl = websiteStartUrl(data.url);
    if (!startUrl) throw new BrainUserError(serverText("brainServer.site.addressMissing"));
    return userFacing("submit", data.fundId, async () => {
      const startHost = new URL(startUrl).hostname;
      const file = await crawlSite(startUrl, (url, kind) =>
        pinnedFetch(url, {
          // Only the domain the user typed, also after a redirect.
          allowHost: (host) => sameSite(startHost, host),
          maxBytes: MAX_SITE_PAGE_BYTES,
          accept:
            kind === "html"
              ? "text/html,application/xhtml+xml"
              : "text/plain,application/xml,text/xml",
        }),
      );
      const service = getServiceClient();
      const admin = supabaseIngestAdmin(service, (event) =>
        writeAudit(service, {
          fundId: data.fundId,
          actorType: "user",
          actorId: context.userId,
          action: event.action,
          entity: "brain_sources",
          entityId: event.sourceId,
          payload: event.payload,
        }),
      );
      const complete = await submitWebsite(admin, {
        fundId: data.fundId,
        userId: context.userId,
        file,
      });
      // Demo view: a duplicate shows the earlier source's title.
      return inDemoView(data.fundId, {
        complete,
        pages: file.pages.length,
        portfolio: file.portfolio.length,
      });
    });
  });

async function loadWebsite(fund: string, source: string) {
  const service = getServiceClient();
  const { data: row, error } = await service
    .from("brain_sources")
    .select("kind, storage_path")
    .eq("id", source)
    .eq("fund_id", fund)
    .maybeSingle();
  if (error) throw new Error(`brain_sources: ${error.message}`);
  if (!row || row["kind"] !== "website")
    throw new BrainUserError(serverText("brainServer.site.siteGone"));
  const { data: blob, error: downloadError } = await service.storage
    .from(BRAIN_SOURCES_BUCKET)
    .download(row["storage_path"] as string);
  if (downloadError || !blob) throw new BrainUserError(serverText("brainServer.site.readAgain"));
  const file = decodeWebsiteFile(new Uint8Array(await blob.arrayBuffer()));
  // Already "investeret" in the fund, from this site, an earlier reading of it or a decision file:
  // shown as confirmed and never imported twice (it would count twice in the decision statistics).
  const domains = file.portfolio.map((company) => company.domain);
  const done = new Set<string>();
  if (domains.length > 0) {
    const { data: confirmed, error: confirmedError } = await service
      .from("brain_historical_decisions")
      .select("company_domain")
      .eq("fund_id", fund)
      .eq("movement_kind", "invest")
      .in("company_domain", domains);
    if (confirmedError) throw new Error(`brain_historical_decisions: ${confirmedError.message}`);
    for (const row of confirmed ?? []) done.add(row["company_domain"] as string);
  }
  return { service, file, done };
}

export interface WebsitePortfolio {
  companies: Array<PortfolioCandidate & { confirmed: boolean }>;
  canConfirm: boolean;
}

/** The portfolio companies proposed from the site, and which of them are already confirmed. */
export const getWebsitePortfolio = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => z.object({ fundId, sourceId }).strict().parse(data))
  .handler(async ({ data, context }): Promise<WebsitePortfolio> => {
    const access = await requireFundCapability(
      context.supabase,
      context.userId,
      data.fundId,
      "brain_ingest",
    );
    requireBrain();
    return userFacing("portfolio", data.fundId, async () => {
      const { file, done } = await loadWebsite(data.fundId, data.sourceId);
      // Demo view: the proposed companies' names and domains; the names get an alias
      // before they are confirmed, and so does the domain's name ("kyckr.com" for "Kyckr
      // Technologies"), so the domain shows no real name either.
      return inDemoView(
        data.fundId,
        {
          companies: file.portfolio.map((c) => ({ ...c, confirmed: done.has(c.domain) })),
          canConfirm: isAdminRole(access.roles),
        },
        file.portfolio.flatMap((c) => [
          { name: c.name },
          { name: c.domain.split(".")[0] ?? "", sameAs: c.name },
        ]),
      );
    });
  });

/** An Admin confirms proposed companies: each becomes "investeret" in the decision history. */
export const confirmWebsitePortfolio = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) =>
    z
      .object({ fundId, sourceId, domains: z.array(z.string().max(253)).min(1).max(MAX_PORTFOLIO) })
      .strict()
      .parse(data),
  )
  .handler(async ({ data, context }): Promise<{ inserted: number; duplicates: number }> => {
    const access = await requireFundCapability(
      context.supabase,
      context.userId,
      data.fundId,
      "brain_ingest",
    );
    if (!isAdminRole(access.roles)) {
      throw new BrainUserError(serverText("brainServer.site.onlyAdmin"));
    }
    requireBrain();
    return userFacing("confirm", data.fundId, async () => {
      const { service, file, done } = await loadWebsite(data.fundId, data.sourceId);
      // Demo view: the domains come back as the portfolio showed them.
      const key = await loadChoiceKey(service, data.fundId);
      const chosen = new Set(data.domains.map((domain) => domain.toLowerCase()));
      const picked = file.portfolio.filter((c) => chosen.has(key(c.domain)));
      // Only companies the site itself proposed and the fund has not confirmed yet; names never
      // come from the browser.
      const rows = portfolioRows(picked.filter((c) => !done.has(c.domain)));
      if (rows.length === 0) {
        throw new BrainUserError(
          picked.some((c) => done.has(c.domain))
            ? serverText("brainServer.site.alreadyInvested")
            : serverText("brainServer.site.chooseCompany"),
        );
      }
      const { data: result, error } = await service.rpc("brain_import_historical_decisions", {
        _fund_id: data.fundId,
        _source_id: data.sourceId,
        _rows: rows,
        _imported_by: context.userId,
      });
      if (error) throw new Error(`brain_import_historical_decisions: ${error.message}`);
      const counts = result as { inserted: number; skipped: number };
      await writeAudit(service, {
        fundId: data.fundId,
        actorType: "user",
        actorId: context.userId,
        action: "brain.portfolio_confirmed",
        entity: "brain_sources",
        entityId: data.sourceId,
        payload: { inserted: counts.inserted, duplicates: counts.skipped },
      });
      return { inserted: counts.inserted, duplicates: counts.skipped };
    });
  });
