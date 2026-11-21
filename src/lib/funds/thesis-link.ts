/**
 * (TS-7): an address in "Få hjælp af Interlect" (Ny investeringstese). The address the
 * user wrote is found here, and the most important subpages on the same site are picked (about,
 * team, investments/portfolio, strategy, contact). At most `MAX_LINK_PAGES` pages in all, the
 * address included. Pure (no network), so every rule is tested; the fetching is in
 * `thesis-link.server.ts`, through the SSRF-safe `pinnedFetch`.
 *
 * The site's text is untrusted input: it is cleaned like team text, stands as data in the
 * user message, and nothing of it is stored.
 */
import { crawlableUrl, sameSite, siteHost } from "../brain/ingest/site.ts";

/** The address and its subpages together: never more than six pages per question. */
export const MAX_LINK_PAGES = 6;
/** Text kept per page and in all, so the call stays far below its price cap. */
export const MAX_LINK_PAGE_CHARS = 4_000;
export const MAX_LINK_TOTAL_CHARS = 14_000;
/** A page with less text than this says nothing about the investor (a cookie wall, a splash). */
export const MIN_LINK_TEXT_CHARS = 200;

/** An address as written: with a scheme, or a bare domain ("nordicseed.dk/om-os"). */
const WITH_SCHEME = /\bhttps?:\/\/[^\s<>"'()[\]{}]+/gi;
/**
 * A bare domain stands at the start or after a space or an opening bracket/quote, and its
 * top-level domain is lower case: "pers.Se", "investor.Vores" and "ASP.NET" are a missing space or
 * a product name, never an address.
 */
const BARE_DOMAIN =
  /(?<=^|[\s(«"'])(?:www\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}(?::\d{1,5})?(?:\/[^\s<>"'()[\]{}]*)?(?![\p{L}\p{N}@-])/giu;
/** Endings a sentence puts after an address, never part of it. */
const TRAILING = /[.,;:!?»"'’)\]]+$/;
/**
 * Endings of bare words that look like domains but are abbreviations or file names ("f.eks",
 * "bl.a", "mio.kr", "rapport.pdf"). Only bare domains are checked; an address with https:// is
 * always an address.
 */
const NOT_A_TLD =
  /\.(?:eks|a|ex|kr|mio|mia|pdf|docx?|xlsx?|pptx?|csv|txt|png|jpe?g|gif|svg|zip|js|ts|json|html?)$/i;

function asAddress(raw: string, withScheme: boolean): string | null {
  if (!withScheme) {
    const host = raw.split(/[/:]/)[0]!;
    if (NOT_A_TLD.test(host) || !/\.[a-z]{2,24}$/.test(host)) return null;
  }
  try {
    const url = new URL(withScheme ? raw : `https://${raw}`);
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname.includes(".")) return null;
    if (url.username || url.password) return null;
    url.hash = "";
    const address = url.toString();
    return address.length <= 2_000 ? address : null;
  } catch {
    return null;
  }
}

/** The first address in the text and exactly how it was written, or null. */
function firstLink(text: string): { raw: string; address: string } | null {
  for (const match of text.matchAll(WITH_SCHEME)) {
    const raw = match[0].replace(TRAILING, "");
    const address = asAddress(raw, true);
    if (address) return { raw, address };
  }
  // A rejected word ("f.eks.", "mio.kr") does not hide a real address later in the text.
  for (const match of text.matchAll(BARE_DOMAIN)) {
    const raw = match[0].replace(TRAILING, "");
    const address = asAddress(raw, false);
    if (address) return { raw, address };
  }
  return null;
}

/**
 * The first address in the user's text as an http(s) address, or null. A bare domain needs a dot and
 * a lower-case top-level domain of letters; an e-mail address is not a site.
 */
export function findLink(text: string): string | null {
  return firstLink(text)?.address ?? null;
}

/** The user's own words without the address: an address alone is no grounding for a suggestion. */
export function withoutLink(text: string): string {
  const link = firstLink(text);
  return link ? text.replace(link.raw, " ").replace(/\s+/g, " ").trim() : text;
}

/**
 * The sentences of the site that state an amount or a share (a number next to a currency, "mio."
 * or "%"). Only these count as written for the figure check (`checkSuggestion`), so a phone
 * number, a CVR number or a year on the site never lets an invented amount through.
 */
export function amountSentences(text: string): string {
  return text
    .split(/(?<=[.!?])\s+(?=\p{Lu})|\n+/u)
    .filter((sentence) =>
      /\d[\d.,\s]*\s?(?:%|procent|percent|mio\.?|millioner|millions?|mia\.?|bn|m\b|mn\b|k\b|m?dkk|kr\.?|kroner|m?eur|euro|€|m?usd|\$|m?gbp|£|M?NOK|M?SEK)|(?:m?dkk|kr\.?|m?eur|€|m?usd|\$|m?gbp|£)\s?\d/iu.test(
        sentence,
      ),
    )
    .join("\n");
}

/**
 * The kinds of subpage that say who the investor is, in the order they are taken. One page per
 * kind first, so five portfolio pages never crowd out the team and the strategy.
 */
const SUBPAGE_KINDS: Array<{ kind: string; path: RegExp }> = [
  { kind: "about", path: /(^|\/)(about|about-us|om|om-os|who-we-are|hvem-er-vi|company)(\/|$)/i },
  {
    kind: "strategy",
    path: /(strateg|thesis|tese|focus|fokus|approach|tilgang|what-we-do|hvad-vi-goer|invest(-|$|\/)|mandate|mandat)/i,
  },
  {
    kind: "investments",
    path: /(portfol|portef[øo]lj|investments|investeringer|companies|selskaber)/i,
  },
  {
    kind: "team",
    path: /(^|\/)(team|people|medarbejdere|folk|partners|our-team|vores-team)(\/|$)/i,
  },
  { kind: "contact", path: /(^|\/)(contact|kontakt|contact-us|kontakt-os)(\/|$)/i },
];

function kindOf(url: string): number {
  const path = new URL(url).pathname;
  return SUBPAGE_KINDS.findIndex((kind) => kind.path.test(path));
}

/**
 * The subpages to read after the start page: links on the same site (the host with or without
 * "www.", or a subdomain), no files, no login pages, no query; only the kinds above. One page per
 * kind first, then a second of a kind, shortest path first. Deterministic.
 */
export function pickSubpages(
  links: ReadonlyArray<{ url: string }>,
  pageUrl: string,
  startHost: string,
  max = MAX_LINK_PAGES - 1,
  /** For tests only: a local test server's port (as in `pinnedFetch`). */
  allowPort?: string,
): string[] {
  const start = new URL(pageUrl);
  const seen = new Set<string>([`${siteHost(start.hostname)}${start.pathname.replace(/\/$/, "")}`]);
  const candidates: Array<{ url: string; kind: number }> = [];
  for (const link of links) {
    const url = onSite(link.url, pageUrl, startHost, allowPort);
    if (!url || !sameSite(startHost, new URL(url).hostname)) continue;
    const parsed = new URL(url);
    const key = `${siteHost(parsed.hostname)}${parsed.pathname.replace(/\/$/, "")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // A deep page (a single portfolio company, a blog post) is not an overview of the investor.
    if (parsed.pathname.split("/").filter(Boolean).length > 2) continue;
    const kind = kindOf(url);
    if (kind >= 0) candidates.push({ url, kind });
  }
  const order = (a: { url: string; kind: number }, b: { url: string; kind: number }) =>
    a.kind - b.kind || a.url.length - b.url.length || a.url.localeCompare(b.url);
  candidates.sort(order);
  const first: typeof candidates = [];
  const rest: typeof candidates = [];
  const kinds = new Set<number>();
  for (const candidate of candidates) {
    if (kinds.has(candidate.kind)) rest.push(candidate);
    else {
      kinds.add(candidate.kind);
      first.push(candidate);
    }
  }
  return [...first, ...rest].slice(0, Math.max(0, max)).map((candidate) => candidate.url);
}

/** `crawlableUrl` (same site, no file, no login, no query), with the test server's port allowed. */
function onSite(raw: string, base: string, startHost: string, allowPort?: string): string | null {
  if (!allowPort) return crawlableUrl(raw, base, startHost);
  try {
    const url = new URL(raw, base);
    if (url.port !== allowPort) return crawlableUrl(raw, base, startHost);
    url.port = "";
    const checked = crawlableUrl(url.toString(), base, startHost);
    if (!checked) return null;
    const back = new URL(checked);
    back.port = allowPort;
    return back.toString();
  } catch {
    return null;
  }
}

export interface LinkedPage {
  url: string;
  title: string;
  text: string;
}

/** The pages as the model gets them: each clipped, all together clipped, empty pages dropped. */
export function clipPages(pages: readonly LinkedPage[]): LinkedPage[] {
  const out: LinkedPage[] = [];
  let used = 0;
  for (const page of pages) {
    const room = MAX_LINK_TOTAL_CHARS - used;
    if (room <= 0) break;
    const text = page.text.trim().slice(0, Math.min(MAX_LINK_PAGE_CHARS, room));
    if (!text) continue;
    used += text.length;
    out.push({ url: page.url, title: page.title.slice(0, 200), text });
  }
  return out;
}

/** Enough text on the site to build on (a page with real text, not only a cookie wall). */
export function siteHasText(pages: readonly LinkedPage[]): boolean {
  return pages.reduce((sum, page) => sum + page.text.trim().length, 0) >= MIN_LINK_TEXT_CHARS;
}
