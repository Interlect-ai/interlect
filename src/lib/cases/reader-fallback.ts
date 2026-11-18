/**
 * a site that cannot be read directly (Veo, 16 Oct: veo.co redirects to veo.com, another domain,
 * which the pinned fetch refuses) was read through the reader fallback as the homepage
 * only, because the fallback never gave any links. The fallback now asks the reader for the page's
 * link list too and reads the most useful subpages (pricing, about, product) the same way.
 * Pure logic with an injectable fetch, so it can be tested without the network.
 */
import { sameSite } from "../brain/ingest/site.ts";

export const READER_USER_AGENT = "Interlect.ai/1.0 (+investment-research)";
export const READER_MAX_BYTES = 3_000_000;
const READER_TIMEOUT_MS = 15_000;
const PAGE_TEXT_LIMIT = 18_000;
const LINKS_HEADING = /^Links\/Buttons:\s*$/m;

/** Same words as the direct crawl uses to pick the pages worth reading. */
export const LINK_PRIORITY =
  /\b(about|company|team|product|solution|technology|customers|pricing|impact|mission|contact|om|hold|produkt|loesning|løsning)\b/i;

export interface ReaderPage {
  url: string;
  title: string;
  text: string;
  sourceDate: string | null;
}

type FetchLike = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal },
) => Promise<Pick<Response, "ok" | "headers" | "arrayBuffer">>;

export function cleanText(value: string): string {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseHttpDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

/** The links the reader lists at the end of a page ("- [label](url)"), without their hash. */
export function parseReaderLinks(raw: string): Array<{ url: string; label: string }> {
  const start = raw.search(LINKS_HEADING);
  if (start < 0) return [];
  const links: Array<{ url: string; label: string }> = [];
  for (const line of raw.slice(start).split("\n")) {
    const match = line.match(/^- \[(.*)\]\((\S+?)\)\s*$/);
    if (!match) continue;
    try {
      const url = new URL(match[2] as string);
      if (!/^https?:$/.test(url.protocol)) continue;
      url.hash = "";
      links.push({ url: url.toString(), label: cleanText(match[1] as string) });
    } catch {
      // A link that is not a URL is skipped.
    }
  }
  return links;
}

/** Page text without the reader's header block and its link list. */
function readerBody(raw: string): string {
  const marker = "Markdown Content:";
  const markerAt = raw.indexOf(marker);
  const body = markerAt >= 0 ? raw.slice(markerAt + marker.length) : raw;
  const linksAt = body.search(LINKS_HEADING);
  return linksAt >= 0 ? body.slice(0, linksAt) : body;
}

/** One page through the reader. Null when it cannot be read or has too little text. */
export async function readerPage(
  url: string,
  options: { withLinks?: boolean; fetchImpl?: FetchLike | undefined } = {},
): Promise<{ page: ReaderPage; links: Array<{ url: string; label: string }> } | null> {
  const fetchImpl = options.fetchImpl ?? (fetch as unknown as FetchLike);
  // Jina Reader turns public, JavaScript-heavy pages into plain text. It is a no-key, no-token
  // fallback only; the original URL remains the cited source.
  try {
    const response = await fetchImpl(`https://r.jina.ai/${url}`, {
      headers: {
        "user-agent": READER_USER_AGENT,
        accept: "text/plain",
        ...(options.withLinks ? { "x-with-links-summary": "true" } : {}),
      },
      signal: AbortSignal.timeout(READER_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    if (Number(response.headers.get("content-length") ?? 0) > READER_MAX_BYTES) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > READER_MAX_BYTES) return null;
    const raw = new TextDecoder().decode(bytes);
    // [ \t] (not \s) so an empty "Title:" line does not swallow the next line as the title.
    const title = cleanText(raw.match(/^Title:[ \t]*(.+)$/m)?.[1] ?? "Virksomhedens website");
    const text = cleanText(readerBody(raw)).slice(0, PAGE_TEXT_LIMIT);
    if (text.length < 80) return null;
    return {
      page: {
        url,
        title,
        text,
        sourceDate: parseHttpDate(response.headers.get("last-modified")),
      },
      links: options.withLinks ? parseReaderLinks(raw) : [],
    };
  } catch (cause) {
    console.warn("[reader-fallback] page not read", {
      message: cause instanceof Error ? cause.message.slice(0, 200) : "unknown",
    });
    return null;
  }
}

/** Pricing first, then who they are, then the product, then anything else that matched. */
const CATEGORIES = [
  /\bpricing\b|\bpriser?\b/i,
  /\b(about|company|team|mission|om|hold)\b/i,
  /\b(product|solution|technology|produkt|loesning|løsning)\b/i,
];
const CATEGORY_CAP = 2;

/** Up to `max` subpages worth reading, from the homepage's links. Same site, no repeats. */
export function pickSubpages(
  links: ReadonlyArray<{ url: string; label: string }>,
  input: { startUrl: string; max: number; exclude?: ReadonlySet<string> | undefined },
): string[] {
  const startHost = new URL(input.startUrl).hostname;
  const seen = new Set<string>([input.startUrl, ...(input.exclude ?? [])]);
  const buckets: string[][] = [[], [], [], []];
  for (const { url, label } of links) {
    if (seen.has(url)) continue;
    const parsed = new URL(url);
    if (!sameSite(startHost, parsed.hostname)) continue;
    const haystack = `${label} ${parsed.pathname}`;
    if (!LINK_PRIORITY.test(haystack)) continue;
    seen.add(url);
    const index = CATEGORIES.findIndex((pattern) => pattern.test(haystack));
    (buckets[index < 0 ? CATEGORIES.length : index] as string[]).push(url);
  }
  const picked: string[] = [];
  // First a few from each kind, so many product pages cannot crowd out pricing and about.
  for (const bucket of buckets) picked.push(...bucket.slice(0, CATEGORY_CAP));
  for (const bucket of buckets) picked.push(...bucket.slice(CATEGORY_CAP));
  return picked.slice(0, input.max);
}

/**
 * The homepage and its most useful subpages through the reader. `allowed` is the site's robots
 * rule, asked for each subpage; the homepage is the caller's to check. Empty when the homepage
 * cannot be read.
 */
export async function readSiteViaReader(
  startUrl: string,
  input: {
    maxPages: number;
    allowed: (url: string) => Promise<boolean>;
    exclude?: ReadonlySet<string> | undefined;
    fetchImpl?: FetchLike | undefined;
  },
): Promise<ReaderPage[]> {
  const home = await readerPage(startUrl, { withLinks: true, fetchImpl: input.fetchImpl });
  if (!home) return [];
  const candidates = pickSubpages(home.links, {
    startUrl,
    max: Math.max(0, input.maxPages - 1),
    exclude: input.exclude,
  });
  const allowed = await Promise.all(candidates.map((url) => input.allowed(url)));
  const subpages = await Promise.all(
    candidates
      .filter((_, index) => allowed[index])
      .map((url) => readerPage(url, { fetchImpl: input.fetchImpl })),
  );
  return [home.page, ...subpages.flatMap((result) => (result ? [result.page] : []))];
}
