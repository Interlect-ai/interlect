/**
 * Reads up to six pages of a company's own website and stores each as a source with one piece of
 * company-stated evidence on the case. The server function captureCompanyWebsite checks the
 * user's access and calls this; moved here so a script (the research eval) can set up a
 * case the way intake does. Every request is pinned to its checked public address.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { load } from "cheerio";
import { sha256Hex } from "@/lib/auth/access.server";
import { looksLikeBrandName } from "@/lib/cases/company-name";
import { companyPage, companyRobots } from "@/lib/cases/company-site.server";
import { assertPublicSite } from "@/lib/brain/ingest/site-fetch.server";
import { sameSite } from "@/lib/brain/ingest/site";
import { serverText } from "@/lib/i18n/server-text";
import {
  LINK_PRIORITY,
  READER_MAX_BYTES,
  READER_USER_AGENT,
  cleanText,
  parseHttpDate,
  readSiteViaReader,
} from "@/lib/cases/reader-fallback";

export { cleanText };
export const USER_AGENT = READER_USER_AGENT;
const MAX_PAGES = 6;
// Moderne app-sites kan uden problemer ligge over 750 KB. Grænsen beskytter
// stadig serveren, men tillader bl.a. Wix-baserede virksomhedssider som BYON8.
const MAX_PAGE_BYTES = READER_MAX_BYTES;

export async function captureWebsiteForCase(input: {
  service: SupabaseClient;
  fundId: string;
  caseId: string;
  companyId: string;
  /** The company's current name: a placeholder name ("Ikke identificeret ...") is replaced. */
  existingName: string | null | undefined;
  website: string;
  actorId: string;
  /**
   * Pages the case already has (the deep analysis reads a site again when intake read too
   * few pages). They are still visited for their links, but not stored twice.
   */
  skipUrls?: readonly string[];
}): Promise<{ pageCount: number; evidenceCount: number }> {
  const startUrl = normalizeUrl(input.website);
  // A clear refusal first; every request below is pinned to its checked address.
  await assertPublicSite(startUrl);
  const robots = await companyRobots(startUrl);
  const startHost = new URL(startUrl).hostname;
  // Links on the same site (www., a subdomain) are followed, not only the same origin. Each
  // host has its own robots.txt (robots-parser answers nothing for another host's address).
  const robotsByOrigin = new Map([[new URL(startUrl).origin, robots]]);
  const robotsFor = async (url: string) => {
    const origin = new URL(url).origin;
    if (!robotsByOrigin.has(origin)) robotsByOrigin.set(origin, await companyRobots(url));
    return robotsByOrigin.get(origin) ?? null;
  };
  const onSite = (url: string) => sameSite(startHost, new URL(url).hostname);
  const queue = [startUrl];
  const visited = new Set<string>();
  const pages: Array<{
    url: string;
    title: string;
    siteName?: string | null;
    text: string;
    sourceDate: string | null;
  }> = [];

  while (queue.length && pages.length < MAX_PAGES) {
    const requestedUrl = queue.shift()!;
    const normalized = normalizeUrl(requestedUrl);
    if (visited.has(normalized)) continue;
    visited.add(normalized);
    if (!onSite(normalized)) continue;
    const pageRobots = await robotsFor(normalized);
    if (pageRobots && !pageRobots.isAllowed(normalized, USER_AGENT)) continue;

    let response: Awaited<ReturnType<typeof companyPage>>;
    try {
      response = await companyPage(normalized, startUrl, MAX_PAGE_BYTES);
    } catch (error) {
      console.warn("[website-capture] direct fetch failed", {
        url: normalized,
        message: error instanceof Error ? error.message : "unknown",
      });
      // A single protected subpage must not make the entire intake fail. If the
      // homepage is protected too, the reader fallback below still gets a turn.
      continue;
    }
    if (!response.contentType.includes("text/html")) continue;
    // pinnedFetch already refused a page over MAX_PAGE_BYTES (counted on the bytes received).
    const html = new TextDecoder().decode(response.body);
    const $ = load(html);
    // Hentes før body-oprydningen, da meta-tags altid ligger i <head>.
    const siteName = cleanText(
      // i18n-keep: a CSS selector, not a text.
      $('meta[property="og:site_name"]').attr("content") ??
        $('meta[name="application-name"]').attr("content") ??
        $('meta[name="apple-mobile-web-app-title"]').attr("content") ??
        "",
    );
    // The links are read before the menu and footer are removed: on many sites (Veo, 15
    // Oct) the pages worth reading (product, about, pricing) are only linked from the menu.
    const links =
      pages.length === 0
        ? $("a[href]")
            .toArray()
            .map((element) => ({
              href: $(element).attr("href"),
              label: cleanText($(element).text()),
            }))
        : [];
    $("script, style, noscript, svg, form, nav, footer").remove();
    const title = cleanText($("title").first().text()) || new URL(normalized).pathname || "Website";
    const text = cleanText($("main").text() || $("article").text() || $("body").text()).slice(
      0,
      18_000,
    );
    if (text.length >= 80) {
      pages.push({
        url: response.url,
        title,
        siteName: siteName || null,
        text,
        sourceDate: parseHttpDate(response.lastModified),
      });
    }

    if (pages.length === 1 && links.length) {
      const candidates = links
        .map(({ href, label }) => {
          if (!href) return null;
          try {
            const url = new URL(href, response.url);
            url.hash = "";
            return { url: url.toString(), label };
          } catch {
            return null;
          }
        })
        .filter((candidate): candidate is { url: string; label: string } => Boolean(candidate))
        .filter((candidate) => /^https?:$/.test(new URL(candidate.url).protocol))
        .filter((candidate) => onSite(candidate.url))
        .filter((candidate) =>
          LINK_PRIORITY.test(`${candidate.label} ${new URL(candidate.url).pathname}`),
        );
      for (const candidate of candidates) {
        if (!queue.includes(candidate.url) && queue.length < 20) queue.push(candidate.url);
      }
    }
  }

  if (!pages.length && (!robots || robots.isAllowed(startUrl, USER_AGENT))) {
    // The homepage and its most useful subpages, as the reader gives no links of its own
    // beyond the list it is asked for.
    pages.push(
      ...(await readSiteViaReader(startUrl, {
        maxPages: MAX_PAGES,
        exclude: new Set((input.skipUrls ?? []).map((url) => normalizeUrl(url))),
        allowed: async (url) => {
          const rules = await robotsFor(url);
          return !rules || rules.isAllowed(url, USER_AGENT) !== false;
        },
      })),
    );
  }

  if (!pages.length) {
    console.warn("[website-capture] no readable pages", {
      origin: new URL(startUrl).origin,
      robotsAllowed: robots ? robots.isAllowed(startUrl, USER_AGENT) : null,
    });
    throw new Error(serverText("caseServer.website.notRead"));
  }

  const skip = new Set((input.skipUrls ?? []).map((url) => normalizeUrl(url)));
  const newPages = pages.filter((page) => !skip.has(normalizeUrl(page.url)));
  let evidenceCount = 0;
  for (const page of newPages) {
    const { data: source, error: sourceError } = await input.service
      .from("sources")
      .insert({
        fund_id: input.fundId,
        case_id: input.caseId,
        url: page.url,
        title: page.title,
        source_type: "company_website",
        content_hash: await sha256Hex(page.text),
        source_date: page.sourceDate,
        fetched_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (sourceError || !source) {
      console.error("[website-capture] source insert failed", sourceError);
      throw new Error(serverText("caseServer.website.sourceNotRegistered"));
    }
    const { error: evidenceError } = await input.service.from("evidence_items").insert({
      fund_id: input.fundId,
      case_id: input.caseId,
      source_id: source["id"],
      claim: `Virksomhedens hjemmeside: ${page.title}`,
      excerpt: page.text,
      source_date: page.sourceDate,
      stated_by: "Virksomhedens offentlige hjemmeside",
      status: "company_stated",
      confidence: 1,
      created_by: input.actorId,
    });
    if (evidenceError) {
      console.error("[website-capture] evidence insert failed", evidenceError);
      throw new Error(serverText("caseServer.website.evidenceNotRegistered"));
    }
    evidenceCount += 1;
  }

  const existingName = input.existingName;
  const inferredName = inferCompanyName(pages[0]?.title ?? "", pages[0]?.siteName ?? null);
  await input.service
    .from("companies")
    .update({
      website: startUrl,
      // i18n-keep: the stored placeholder name's prefix (company-name.ts), matched, not shown.
      ...(existingName?.startsWith("Ikke identificeret") && inferredName
        ? { name: inferredName }
        : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.companyId);
  return { pageCount: newPages.length, evidenceCount };
}

export function normalizeUrl(raw: string): string {
  const url = new URL(raw.trim());
  url.hash = "";
  if (url.pathname === "") url.pathname = "/";
  return url.toString();
}

function inferCompanyName(title: string, siteName: string | null): string | null {
  // og:site_name (eller tilsvarende) er skrevet af selskabet selv til netop
  // dette formål og er langt mere pålideligt end en gættet <title>-splitning.
  if (siteName && looksLikeBrandName(siteName)) return siteName.slice(0, 120);
  // Kun en tydelig separator tæller som "Brand | Tagline"-delimiter -- en
  // bar bindestreg midt i et ord (fx "High-quality") er ikke det, og må
  // aldrig splitte titlen op.
  const candidate = cleanText(title.split(/\s+-\s+|[|–—]/)[0] ?? "").slice(0, 120);
  if (!candidate || /^(home|website|forside|virksomhedens website)$/i.test(candidate)) return null;
  return looksLikeBrandName(candidate) ? candidate : null;
}
