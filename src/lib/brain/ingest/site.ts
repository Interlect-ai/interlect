/**
 * The fund's own website as a Brain source (§5): which addresses may be read,
 * how a page becomes text blocks, how a sitemap is read, which links on a portfolio page are
 * portfolio companies, and the stored file (`website.json`) that INGEST reads like any upload.
 * Pure (no network), so every rule is tested; the fetching is in site-fetch.server.ts and the
 * crawl order in crawl.ts.
 */
import { load } from "cheerio";
import { BrainUserError } from "../errors.ts";
import type { Block } from "./extract.ts";
import { MAX_SITE_PAGES } from "./limits.ts";
import { serverText } from "../../i18n/server-text.ts";

/** At most 40 pages and 3 MB per page. */
export { MAX_SITE_PAGES };
export const MAX_SITE_PAGE_BYTES = 3_000_000;
/** The stored file's field limits: the crawl cuts to them, so it never writes a file it refuses. */
export const MAX_URL_CHARS = 2_000;
const MAX_TITLE_CHARS = 300;
const MAX_DOMAIN_CHARS = 253;
/** Text kept per page (a long page is cut; the chunker splits the rest). */
const MAX_PAGE_CHARS = 40_000;
export const MAX_PORTFOLIO = 150;

export const WEBSITE_FORMAT = "interlect-website-v1";

export interface SitePage {
  url: string;
  title: string;
  /** In page order; `level` (1-6) marks a heading. */
  blocks: Array<{ text: string; level?: number }>;
}

export interface PortfolioCandidate {
  name: string;
  /** Without "www.", lower case: the key of the company in Brain (`domain:…`). */
  domain: string;
}

/** What is stored in Storage and read by INGEST. No timestamps: the same site gives the same file. */
export interface WebsiteFile {
  format: typeof WEBSITE_FORMAT;
  startUrl: string;
  siteName: string | null;
  pages: SitePage[];
  portfolio: PortfolioCandidate[];
  /** User-facing notes in Danish (pages skipped, time ran out). */
  notes: string[];
}

export function cleanText(value: string): string {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The host without "www.", lower case. */
export function siteHost(host: string): string {
  return host
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/^www\./, "");
}

/**
 * True when `host` belongs to the site the user typed: the same host (with or without "www.") or a
 * subdomain of it. Stricter than "same registrable domain", so a redirect to another customer of a
 * shared suffix (fund.co.uk → evil.co.uk) can never pass.
 */
export function sameSite(startHost: string, host: string): boolean {
  const base = siteHost(startHost);
  const candidate = siteHost(host);
  return candidate === base || candidate.endsWith(`.${base}`);
}

/** The user's input as an https address on the site's front page, or null when it is not one. */
export function websiteStartUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname.includes(".")) return null;
    if (url.username || url.password) return null;
    url.hash = "";
    url.search = "";
    const address = url.toString();
    return address.length <= MAX_URL_CHARS ? address : null;
  } catch {
    return null;
  }
}

const LOGIN_PATH =
  /(^|[/_.-])(log-?in|log-?ind|sign-?in|sign-?up|logon|auth|account|konto|min-side|admin|wp-admin|wp-login|password|register|registrer|cart|kurv|checkout)([/_.-]|$)/i;

/** No login, account or shop pages. */
export function isLoginPath(pathname: string): boolean {
  return LOGIN_PATH.test(pathname);
}

const SKIP_EXTENSION =
  /\.(pdf|jpe?g|png|gif|webp|svg|ico|zip|gz|rar|mp4|mov|mp3|wav|docx?|xlsx?|pptx?|csv|xml|json|rss|txt|js|css|woff2?|ttf|dmg|exe)$/i;

/** An address on the site itself (http(s), no login in it, port 80/443), or null. */
export function siteUrl(raw: string, base: string, startHost: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw, base);
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(url.protocol)) return null;
  if (url.username || url.password || (url.port && !["80", "443"].includes(url.port))) return null;
  if (!sameSite(startHost, url.hostname)) return null;
  url.hash = "";
  return url;
}

/**
 * A link or sitemap entry as a page to crawl (no fragment, no query), or null when it is outside
 * the site, a file, or a login page.
 */
export function crawlableUrl(raw: string, base: string, startHost: string): string | null {
  const url = siteUrl(raw, base, startHost);
  if (!url || SKIP_EXTENSION.test(url.pathname) || isLoginPath(url.pathname)) return null;
  url.search = "";
  const address = url.toString();
  return address.length <= MAX_URL_CHARS ? address : null;
}

const IMPORTANT =
  /(portfol|portef[øo]lj|investments?|investeringer|companies|selskaber|about|om-os|\/om\b|team|people|medarbejdere|strateg|thesis|tese|focus|fokus|approach|tilgang|founders|iv[æa]rks[æa]tter|funds?\b|fonde?\b|kontakt|contact)/i;
const MINOR =
  /(blog|news|nyheder|insights|press|presse|artikler|articles|events|podcast|tag|category|kategori|page\/\d)/i;

/** Higher first: the pages that tell what the fund invests in come before news and blog posts. */
export function pagePriority(url: string): number {
  const path = new URL(url).pathname;
  const depth = path.split("/").filter(Boolean).length;
  let score = 10 - Math.min(depth, 6);
  if (IMPORTANT.test(path)) score += 20;
  if (MINOR.test(path)) score -= 15;
  return score;
}

/** Sorts addresses by priority, then shortest path, then alphabetically (deterministic). */
export function byPriority(urls: readonly string[]): string[] {
  return [...urls].sort(
    (a, b) => pagePriority(b) - pagePriority(a) || a.length - b.length || a.localeCompare(b),
  );
}

/** The `<loc>` entries of a sitemap, split into pages and nested sitemaps (a sitemap index). */
export function parseSitemap(xml: string): { pages: string[]; sitemaps: string[] } {
  const $ = load(xml, { xml: true });
  const locs = (selector: string) =>
    $(selector)
      .toArray()
      .map((element) => cleanText($(element).text()))
      .filter(Boolean);
  return { pages: locs("urlset > url > loc"), sitemaps: locs("sitemapindex > sitemap > loc") };
}

const PORTFOLIO_PAGE =
  /(portfol|portef[øo]lj|investments|investeringer|our-companies|vores-selskaber|companies|selskaber|family|familien)/i;

/** Only the page's own section counts ("/portfolio/acme", "/da/portefolje"), not a news slug. */
export function isPortfolioPage(url: string): boolean {
  const segments = new URL(url).pathname.split("/").filter(Boolean);
  const section = /^[a-z]{2}$/i.test(segments[0] ?? "") ? segments[1] : segments[0];
  return PORTFOLIO_PAGE.test(section ?? "");
}

/** Links to these are never portfolio companies (social media, platforms, tools). */
const NOT_A_COMPANY =
  /(^|\.)(linkedin|twitter|x|facebook|fb|instagram|youtube|youtu|vimeo|medium|github|tiktok|crunchbase|google|goo|apple|spotify|soundcloud|wa|t|bit|linktr|eventbrite|typeform|hubspot|mailchimp|wordpress|wix|squarespace|webflow|cookiebot|calendly|pinterest|threads|bsky|substack|dealroom|pitchbook|breezy|teamtailor|workable|recruitee|greenhouse|lever|jobindex|thehub)\.[a-z.]+$/i;

/** Links on a portfolio page that are about something else (jobs, policies). */
const NOT_A_COMPANY_LABEL =
  /(career|karriere|\bjobs?\b|ledige stillinger|privacy|cookie|privatliv)/i;

/** The company part of a domain: the longest label before the top-level domain. */
function domainLabel(domain: string): string {
  return domain
    .split(".")
    .slice(0, -1)
    .reduce((longest, label) => (label.length > longest.length ? label : longest), "");
}

/** "uk.trustpilot.com" → "Trustpilot" (when no name on the page fits the domain). */
function nameFromDomain(domain: string): string {
  const label = domainLabel(domain) || domain;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function fold(text: string): string {
  return text
    .toLowerCase()
    .replace(/æ/g, "ae")
    .replace(/ø/g, "oe")
    .replace(/å/g, "aa")
    .normalize("NFD")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * A name from the page is used only when it looks like the company's domain ("FLATPAY" and
 * flatpay.dk, "Blackbird" and blackbirdcoffee.dk); a slogan in the same card never does.
 */
export function nameFitsDomain(name: string, domain: string): boolean {
  const a = fold(name);
  const b = fold(domainLabel(domain));
  if (a.length < 2 || b.length < 2 || name.split(/\s+/).length > 6) return false;
  return (
    a.includes(b) ||
    b.includes(a) ||
    (a.length >= 4 && b.length >= 4 && a.slice(0, 4) === b.slice(0, 4))
  );
}

export interface ReadPage {
  title: string;
  siteName: string | null;
  blocks: SitePage["blocks"];
  /** Every link on the page, resolved (also links outside the site). */
  links: Array<{ url: string; label: string }>;
  /** A password field: a login page that must not be read. */
  hasPasswordField: boolean;
  /** External links in the page's main content that may be portfolio companies. */
  portfolio: PortfolioCandidate[];
}

const TEXT_SELECTOR = "h1, h2, h3, h4, h5, h6, p, li, blockquote, dd, dt, figcaption, td, th";

/** One HTML page as headings and paragraphs (menus, footers, scripts and cookie banners removed). */
export function readPage(html: string, pageUrl: string, startHost: string): ReadPage {
  const $ = load(html);
  // i18n-keep: CSS selectors, not text.
  const siteName =
    cleanText(
      $('meta[property="og:site_name"]').attr("content") ??
        $('meta[name="application-name"]').attr("content") ??
        "",
    ).slice(0, MAX_TITLE_CHARS) || null;
  const hasPasswordField = $('input[type="password"]').length > 0;
  const linkOf = (element: Parameters<typeof $>[0]) => {
    try {
      const url = new URL($(element).attr("href") ?? "", pageUrl);
      url.hash = "";
      const label = cleanText(
        $(element).text() ||
          $(element).attr("aria-label") ||
          $(element).attr("title") ||
          $(element).find("img[alt]").first().attr("alt") ||
          "",
      );
      return [{ url: url.toString(), label }];
    } catch {
      return [];
    }
  };
  // Menus and footers link to the site's pages too, so links are read before they are removed.
  const links = $("a[href]").toArray().flatMap(linkOf);

  $(
    "script, style, noscript, svg, template, iframe, form, nav, header, footer, aside, [role=navigation], [aria-hidden=true]",
  ).remove();
  $("[id*=cookie i], [class*=cookie i], [id*=consent i], [class*=consent i]").remove();
  const main = $("main").first();
  const root = main.length && cleanText(main.text()).length >= 200 ? main : $("body");

  const blocks: SitePage["blocks"] = [];
  const seen = new Set<string>();
  let chars = 0;
  const push = (text: string, level?: number) => {
    if (text.length < 3 || seen.has(text) || chars >= MAX_PAGE_CHARS) return;
    seen.add(text);
    const kept = text.slice(0, MAX_PAGE_CHARS - chars);
    chars += kept.length;
    blocks.push(level ? { text: kept, level } : { text: kept });
  };
  root.find(TEXT_SELECTOR).each((_, element) => {
    // The innermost element carries the text (a <li> holding a <p> is read once, as the <p>).
    if ($(element).find(TEXT_SELECTOR).length > 0) return;
    const tag = element.tagName.toLowerCase();
    const heading = /^h([1-6])$/.exec(tag);
    push(cleanText($(element).text()), heading ? Number(heading[1]) : undefined);
  });
  // Sites built mostly of <div>s: when the elements above hold under half of the text, the whole
  // text is one paragraph instead (the chunker splits it). A space after every element keeps
  // neighbouring words apart.
  root.find("*").each((_, element) => {
    $(element).append(" ");
  });
  const whole = cleanText(root.text());
  if (chars < whole.length / 2) {
    blocks.length = 0;
    seen.clear();
    chars = 0;
    push(whole);
  }

  const title =
    cleanText($("title").first().text()) ||
    blocks.find((block) => block.level === 1)?.text ||
    new URL(pageUrl).pathname;

  // The name on a portfolio card whose link only says "Visit website": in the smallest ancestor
  // that holds no other outside link (beyond that it is the whole list), a heading, a logo's alt
  // text or a title/name element; a bold label ("Founders:") only as the last resort.
  const cardName = (link: Parameters<typeof $>[0], domain: string): string | null => {
    const usable = (text: string | undefined) => {
      // A logo's alt text often says "Acme logo".
      const value = cleanText((text ?? "").replace(/\blogo(type)?\b/gi, ""));
      return value.length <= 80 && nameFitsDomain(value, domain) ? value : null;
    };
    for (const pick of [
      (node: ReturnType<typeof $>) =>
        usable(node.find("h1, h2, h3, h4, h5, h6").first().text()) ??
        usable(node.find("img[alt]").first().attr("alt")) ??
        usable(node.find("[class*=title i], [class*=name i]").first().text()),
      (node: ReturnType<typeof $>) => usable(node.find("strong, b").first().text()),
    ]) {
      let node = $(link).parent();
      for (let depth = 0; depth < 4 && node.length > 0; depth += 1) {
        if (node.find("a[href^='http']").length > 1) break;
        const name = pick(node);
        if (name) return name;
        node = node.parent();
      }
    }
    return null;
  };

  const portfolio: PortfolioCandidate[] = [];
  if (isPortfolioPage(pageUrl)) {
    const h1 = cleanText(root.find("h1").first().text()) || null;
    const isDetail = new URL(pageUrl).pathname.split("/").filter(Boolean).length >= 2;
    root.find("a[href]").each((_, element) => {
      const link = linkOf(element)[0];
      if (!link) return;
      const url = new URL(link.url);
      if (!["http:", "https:"].includes(url.protocol) || sameSite(startHost, url.hostname)) return;
      const domain = siteHost(url.hostname);
      if (domain.length > MAX_DOMAIN_CHARS) return;
      if (NOT_A_COMPANY.test(domain) || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return;
      if (NOT_A_COMPANY_LABEL.test(link.label)) return;
      if (portfolio.some((candidate) => candidate.domain === domain)) return;
      const label = link.label.slice(0, 80);
      const name =
        (nameFitsDomain(label, domain) ? label : null) ??
        cardName(element, domain) ??
        (isDetail && h1 && nameFitsDomain(h1, domain) ? h1.slice(0, 80) : null) ??
        nameFromDomain(domain);
      portfolio.push({ name, domain });
    });
  }

  return {
    title: title.slice(0, MAX_TITLE_CHARS),
    siteName,
    blocks,
    links,
    hasPasswordField,
    portfolio,
  };
}

/**
 * Blocks that stand on most pages (a repeated call to action, a newsletter box) are noise in
 * every chunk; like running headers in a PDF they are removed when the site has 4 pages or more.
 */
export function dropRepeatedBlocks(pages: SitePage[]): SitePage[] {
  if (pages.length < 4) return pages;
  const counts = new Map<string, number>();
  for (const page of pages) {
    for (const text of new Set(page.blocks.map((block) => block.text))) {
      counts.set(text, (counts.get(text) ?? 0) + 1);
    }
  }
  const threshold = Math.ceil(pages.length * 0.6);
  return pages.map((page) => ({
    ...page,
    blocks: page.blocks.filter((block) => (counts.get(block.text) ?? 0) < threshold),
  }));
}

export function encodeWebsiteFile(file: WebsiteFile): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(file));
}

/** True when the bytes are a website file this code wrote (the type check of file-kind.ts). */
export function isWebsiteFile(bytes: Uint8Array): boolean {
  try {
    return decodeWebsiteFile(bytes) !== null;
  } catch {
    return false;
  }
}

/** The stored file, checked field by field; throws BrainUserError when it is not one. */
export function decodeWebsiteFile(bytes: Uint8Array): WebsiteFile {
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new BrainUserError(serverText("brainServer.site.fileUnreadable"));
  }
  const file = raw as Partial<WebsiteFile> | null;
  const text = (value: unknown, max: number) => typeof value === "string" && value.length <= max;
  const valid =
    file !== null &&
    typeof file === "object" &&
    file.format === WEBSITE_FORMAT &&
    text(file.startUrl, MAX_URL_CHARS) &&
    (file.siteName === null || text(file.siteName, MAX_TITLE_CHARS)) &&
    Array.isArray(file.pages) &&
    file.pages.length <= MAX_SITE_PAGES &&
    file.pages.every(
      (page) =>
        text(page?.url, MAX_URL_CHARS) &&
        text(page?.title, MAX_TITLE_CHARS) &&
        Array.isArray(page.blocks) &&
        page.blocks.every(
          (block) =>
            text(block?.text, MAX_PAGE_CHARS) &&
            (block.level === undefined ||
              (Number.isInteger(block.level) && block.level >= 1 && block.level <= 6)),
        ),
    ) &&
    Array.isArray(file.portfolio) &&
    file.portfolio.length <= MAX_PORTFOLIO &&
    file.portfolio.every(
      (company) => text(company?.name, MAX_TITLE_CHARS) && text(company?.domain, MAX_DOMAIN_CHARS),
    ) &&
    Array.isArray(file.notes) &&
    file.notes.every((note) => text(note, 500));
  if (!valid) throw new BrainUserError(serverText("brainServer.site.fileUnreadable"));
  return file as WebsiteFile;
}

/**
 * The pages as blocks for the chunker: each page has one heading, its title and address, so every
 * chunk of the page starts with where it came from (the page's own headings stay as lines of
 * text). Every block carries the page number, so "læs kun de første N sider" works as for a PDF.
 */
export function websiteBlocks(file: WebsiteFile, maxPages?: number): Block[] {
  const blocks: Block[] = [];
  file.pages.slice(0, maxPages ?? MAX_SITE_PAGES).forEach((page, index) => {
    const number = index + 1;
    blocks.push({ kind: "heading", text: `${page.title} (${page.url})`, level: 1, page: number });
    for (const block of page.blocks) {
      blocks.push({ kind: "paragraph", text: block.text, page: number });
    }
  });
  return blocks;
}
