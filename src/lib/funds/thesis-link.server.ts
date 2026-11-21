/**
 * (TS-7): reads the address the user wrote in "Få hjælp af Interlect", and the most important
 * subpages on the same site, with the SSRF-safe fetching (`assertPublicSite` first, then every page
 * through `pinnedFetch`, pinned to its checked public address). Robots.txt is
 * respected, redirects stay on the site, each page has its own time and byte limit, the whole read
 * has a deadline, and nothing is stored. Server only.
 */
import { readPage } from "../brain/ingest/site.ts";
import { assertPublicSite, SiteRefusedError } from "../brain/ingest/site-fetch.server.ts";
import {
  companyPage,
  companyRobots,
  type CompanySiteTesting,
} from "../cases/company-site.server.ts";
import { clipPages, MAX_LINK_PAGES, pickSubpages, type LinkedPage } from "./thesis-link.ts";

const PAGE_MAX_BYTES = 2_000_000;
const READ_DEADLINE_MS = 15_000;
const ROBOTS_AGENT = "Interlect.ai";

export interface LinkedSite {
  /** The address the user wrote, as read. */
  url: string;
  /**
   * "refused": the safety rules stopped it (not a public website, a redirect to another site, a
   * page too big). "failed": no page could be read (no answer, not HTML, a login page, robots.txt,
   * the deadline).
   */
  status: "read" | "refused" | "failed";
  pages: LinkedPage[];
}

function pageText(blocks: ReadonlyArray<{ text: string }>): string {
  return blocks.map((block) => block.text).join("\n");
}

function isHtml(contentType: string): boolean {
  return !contentType || /html|xml/i.test(contentType);
}

/**
 * The whole read has one deadline: when it passes, the answer is "failed" at once (each request
 * still ends by its own 10 s timeout, and its result is dropped).
 */
export async function readLinkedSite(
  address: string,
  testing: CompanySiteTesting = {},
  deadlineMs = READ_DEADLINE_MS,
): Promise<LinkedSite> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<LinkedSite>((resolve) => {
    timer = setTimeout(() => {
      console.warn("[thesis-link] deadline passed", { host: hostOf(address) });
      resolve({ url: address, status: "failed", pages: [] });
    }, deadlineMs);
  });
  try {
    return await Promise.race([readSite(address, testing, Date.now() + deadlineMs), late]);
  } finally {
    clearTimeout(timer);
  }
}

function hostOf(address: string): string {
  try {
    return new URL(address).hostname;
  } catch {
    return "";
  }
}

const skip = (host: string, url: string, why: string) => {
  console.warn("[thesis-link] page not read", {
    host,
    path: hostOf(url) ? new URL(url).pathname : "",
    why,
  });
  return null;
};

async function readSite(
  address: string,
  testing: CompanySiteTesting,
  ends: number,
): Promise<LinkedSite> {
  try {
    await assertPublicSite(address, testing);
  } catch (cause) {
    const refused = cause instanceof SiteRefusedError;
    console.warn("[thesis-link] address not read", { host: hostOf(address), refused });
    return { url: address, status: refused ? "refused" : "failed", pages: [] };
  }
  const startHost = new URL(address).hostname;
  const robots = await companyRobots(address, testing);
  const allowed = (url: string) => !robots || robots.isAllowed(url, ROBOTS_AGENT) !== false;

  const read = async (url: string) => {
    if (Date.now() >= ends) return skip(startHost, url, "deadline");
    if (!allowed(url)) return skip(startHost, url, "robots");
    const response = await companyPage(url, address, PAGE_MAX_BYTES, testing);
    // Robots.txt is asked again for where a redirect landed.
    if (response.url !== url && !allowed(response.url)) return skip(startHost, url, "robots");
    if (!isHtml(response.contentType)) return skip(startHost, url, "not_html");
    const html = new TextDecoder().decode(response.body);
    const page = readPage(html, response.url, startHost);
    // A login page is never read.
    if (page.hasPasswordField) return skip(startHost, url, "login");
    return { url: response.url, page };
  };

  let front: Awaited<ReturnType<typeof read>>;
  try {
    front = await read(address);
  } catch (cause) {
    console.warn("[thesis-link] start page not read", {
      host: startHost,
      refused: cause instanceof SiteRefusedError,
    });
    return {
      url: address,
      status: cause instanceof SiteRefusedError ? "refused" : "failed",
      pages: [],
    };
  }
  if (!front) return { url: address, status: "failed", pages: [] };

  // Pages robots.txt forbids are left out before picking, so they never take a place.
  const subpages = pickSubpages(
    front.page.links.filter((link) => {
      try {
        return allowed(new URL(link.url).toString());
      } catch {
        return false;
      }
    }),
    front.url,
    startHost,
    MAX_LINK_PAGES - 1,
    testing.allowPort,
  );
  const results = await Promise.allSettled(subpages.map((url) => read(url)));
  const pages: LinkedPage[] = [
    { url: front.url, title: front.page.title, text: pageText(front.page.blocks) },
  ];
  for (const result of results) {
    if (result.status === "rejected") {
      skip(startHost, "", result.reason instanceof SiteRefusedError ? "refused" : "failed");
      continue;
    }
    if (!result.value) continue;
    // A subpage that redirected to a page already read is not read twice.
    if (pages.some((page) => page.url === result.value!.url)) continue;
    pages.push({
      url: result.value.url,
      title: result.value.page.title,
      text: pageText(result.value.page.blocks),
    });
  }
  return { url: front.url, status: "read", pages: clipPages(pages).slice(0, MAX_LINK_PAGES) };
}
