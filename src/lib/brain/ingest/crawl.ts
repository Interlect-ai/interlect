/**
 * The crawl of the fund's own website (§5): robots.txt is respected, the
 * sitemap is read first (entries outside the site are ignored) and links only when there is no
 * sitemap, the most telling pages first (portfolio, about, team, strategy before news), at most
 * 40 pages, no login pages, a time limit for the whole crawl. No AI and no cost. The fetching is
 * passed in (site-fetch.server.ts in production), so the order and every rule are tested here.
 */
import robotsParser from "robots-parser";
import { BrainUserError } from "../errors.ts";
import {
  byPriority,
  crawlableUrl,
  dropRepeatedBlocks,
  MAX_PORTFOLIO,
  MAX_URL_CHARS,
  MAX_SITE_PAGES,
  parseSitemap,
  readPage,
  siteUrl,
  WEBSITE_FORMAT,
  type PortfolioCandidate,
  type SitePage,
  type WebsiteFile,
} from "./site.ts";
import { serverText } from "../../i18n/server-text.ts";

export const CRAWL_USER_AGENT = "Interlect.ai";

/** Fetches one address (redirects and SSRF rules are the fetcher's job); throws when it cannot. */
export type SiteFetcher = (
  url: string,
  kind: "html" | "text",
) => Promise<{ url: string; contentType: string; body: Uint8Array }>;

export interface CrawlOptions {
  maxPages?: number;
  /** For the whole crawl; the pages read so far are kept when it runs out. */
  deadlineMs?: number;
  concurrency?: number;
  now?: () => number;
}

/** Sitemaps read at most (an index and the sitemaps it names), and entries kept from them. */
const MAX_SITEMAPS = 4;
const MAX_SITEMAP_URLS = 500;
const MIN_PAGE_CHARS = 80;

const decode = (bytes: Uint8Array) => new TextDecoder("utf-8").decode(bytes);

async function readSitemaps(
  fetcher: SiteFetcher,
  first: string[],
  startUrl: string,
  startHost: string,
  timeLeft: () => boolean,
): Promise<string[]> {
  const queue = [...first];
  const pages = new Set<string>();
  let read = 0;
  while (queue.length && read < MAX_SITEMAPS && pages.size < MAX_SITEMAP_URLS && timeLeft()) {
    const next = siteUrl(queue.shift()!, startUrl, startHost)?.toString();
    if (!next) continue;
    read += 1;
    try {
      const response = await fetcher(next, "text");
      const parsed = parseSitemap(decode(response.body));
      for (const loc of parsed.pages) {
        const url = crawlableUrl(loc, startUrl, startHost);
        if (url && pages.size < MAX_SITEMAP_URLS) pages.add(url);
      }
      queue.push(...parsed.sitemaps);
    } catch {
      // No sitemap (or an unreadable one): the links on the pages are used instead.
    }
  }
  return [...pages];
}

export async function crawlSite(
  startUrl: string,
  fetcher: SiteFetcher,
  options: CrawlOptions = {},
): Promise<WebsiteFile> {
  const maxPages = Math.min(options.maxPages ?? MAX_SITE_PAGES, MAX_SITE_PAGES);
  const now = options.now ?? Date.now;
  const deadline = now() + (options.deadlineMs ?? 75_000);
  const concurrency = options.concurrency ?? 4;
  const startHost = new URL(startUrl).hostname;
  const notes: string[] = [];

  const robotsUrl = new URL("/robots.txt", startUrl).toString();
  let robots: ReturnType<typeof robotsParser> | null = null;
  try {
    robots = robotsParser(robotsUrl, decode((await fetcher(robotsUrl, "text")).body));
  } catch {
    robots = null;
  }
  // robots.txt is keyed to the typed origin, and the parser allows every other origin. A site that
  // moves fund.dk to www.fund.dk (or http to https) keeps its rules: the path is checked on the
  // robots origin, whichever host of the site the page is on.
  const allowed = (url: string) => {
    if (!robots) return true;
    const page = new URL(url);
    const onRobotsOrigin = new URL(`${page.pathname}${page.search}`, robotsUrl).toString();
    return robots.isAllowed(onRobotsOrigin, CRAWL_USER_AGENT) !== false;
  };
  if (!allowed(startUrl)) {
    throw new BrainUserError(serverText("brainServer.site.robots"));
  }

  const declared = robots?.getSitemaps() ?? [];
  const sitemapPages = await readSitemaps(
    fetcher,
    declared.length ? declared : [new URL("/sitemap.xml", startUrl).toString()],
    startUrl,
    startHost,
    () => now() < deadline,
  );
  const fromSitemap = sitemapPages.length > 0;
  const queue: string[] = [startUrl, ...byPriority(sitemapPages.filter((u) => u !== startUrl))];
  const queued = new Set(queue);

  const pages: Array<{ order: number; page: SitePage }> = [];
  const portfolio: PortfolioCandidate[] = [];
  const seenContent = new Set<string>();
  let siteName: string | null = null;
  let robotsSkipped = 0;
  let loginSkipped = 0;
  let failed = 0;
  let timedOut = false;
  let order = 0;

  const visit = async (url: string, at: number) => {
    if (!allowed(url)) {
      robotsSkipped += 1;
      return;
    }
    let response;
    try {
      response = await fetcher(url, "html");
    } catch (cause) {
      if (at === 0) {
        const reason = cause instanceof Error && cause.name === "SiteRefusedError";
        throw new BrainUserError(
          reason
            ? serverText("brainServer.site.notReadReason", {
                reason: (cause as Error).message.replace(/\.$/, ""),
              })
            : serverText("brainServer.site.notRead"),
        );
      }
      failed += 1;
      return;
    }
    if (!/text\/html|application\/xhtml/i.test(response.contentType)) return;
    if (response.url.length > MAX_URL_CHARS) return;
    const read = readPage(decode(response.body), response.url, startHost);
    if (read.hasPasswordField) {
      loginSkipped += 1;
      return;
    }
    if (at === 0) siteName = read.siteName;
    for (const candidate of read.portfolio) {
      if (portfolio.length < MAX_PORTFOLIO && !portfolio.some((c) => c.domain === candidate.domain))
        portfolio.push(candidate);
    }
    if (!fromSitemap) {
      const found = byPriority(
        read.links
          .map((link) => crawlableUrl(link.url, response.url, startHost))
          .filter((link): link is string => link !== null && !queued.has(link)),
      );
      for (const link of found) {
        if (queued.size >= MAX_SITEMAP_URLS) break;
        queued.add(link);
        queue.push(link);
      }
    }
    const content = read.blocks.map((block) => block.text).join("\n");
    if (content.length < MIN_PAGE_CHARS || seenContent.has(content)) return;
    seenContent.add(content);
    pages.push({ order: at, page: { url: response.url, title: read.title, blocks: read.blocks } });
  };

  while (queue.length > 0 && pages.length < maxPages) {
    // The first wave (with the front page) always runs, even when robots and sitemaps used the time.
    if (order > 0 && now() >= deadline) {
      timedOut = true;
      break;
    }
    // A wave never asks for more pages than are still missing.
    const wave = queue.splice(0, Math.min(concurrency, maxPages - pages.length));
    await Promise.all(wave.map((url) => visit(url, order++)));
  }

  if (pages.length === 0) {
    throw new BrainUserError(
      timedOut ? serverText("brainServer.site.slow") : serverText("brainServer.site.noPages"),
    );
  }
  if (robotsSkipped)
    notes.push(serverText("brainServer.site.robotsSkipped", { count: robotsSkipped }));
  if (loginSkipped)
    notes.push(serverText("brainServer.site.loginSkipped", { count: loginSkipped }));
  if (failed) notes.push(serverText("brainServer.site.failedPages", { count: failed }));
  if (timedOut) notes.push(serverText("brainServer.site.timedOut", { count: pages.length }));
  else if (queue.length > 0 && pages.length >= maxPages)
    notes.push(serverText("brainServer.site.morePages", { max: maxPages }));

  const ordered = pages
    .sort((a, b) => a.order - b.order)
    .slice(0, maxPages)
    .map((entry) => entry.page);
  return {
    format: WEBSITE_FORMAT,
    startUrl,
    siteName,
    pages: dropRepeatedBlocks(ordered),
    portfolio,
    notes,
  };
}
