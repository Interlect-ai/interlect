/**
 * The company's own website, read at Opret case (the homepage peek) and when a screening captures
 * the site. Every request goes through `pinnedFetch`: the host is resolved
 * once and the connection goes to exactly that checked address (no DNS rebinding); IPv4 written as
 * IPv6, NAT64, 6to4 and the other non-public ranges are refused; and a redirect may only stay on
 * the site the user typed (the host with or without "www.", or a subdomain of it). A redirect to
 * another domain is refused, not followed. Server only.
 */
import robotsParser from "robots-parser";
import { sameSite } from "../brain/ingest/site.ts";
import {
  pinnedFetch,
  type PinnedFetchOptions,
  type SiteResponse,
} from "../brain/ingest/site-fetch.server.ts";

/** For tests only: a resolver, an address rule and a local port (see site-fetch.test.ts). */
export type CompanySiteTesting = Pick<
  PinnedFetchOptions,
  "resolve" | "isBlockedAddress" | "allowPort"
>;

const ROBOTS_MAX_BYTES = 200_000;

/** One HTML page on the site that `startUrl` is on. */
export function companyPage(
  url: string,
  startUrl: string,
  maxBytes: number,
  testing: CompanySiteTesting = {},
): Promise<SiteResponse> {
  const startHost = new URL(startUrl).hostname;
  return pinnedFetch(url, {
    ...testing,
    allowHost: (host) => sameSite(startHost, host),
    maxBytes,
    accept: "text/html,application/xhtml+xml",
  });
}

/**
 * The site's robots.txt, or null when there is none or it cannot be read (then nothing is
 * forbidden, as before). Not followed through a redirect.
 */
export async function companyRobots(startUrl: string, testing: CompanySiteTesting = {}) {
  const robotsUrl = new URL("/robots.txt", startUrl).toString();
  const startHost = new URL(startUrl).hostname;
  try {
    const answer = await pinnedFetch(robotsUrl, {
      ...testing,
      allowHost: (host) => sameSite(startHost, host),
      maxBytes: ROBOTS_MAX_BYTES,
      accept: "text/plain",
      timeoutMs: 5_000,
      maxRedirects: 0,
    });
    return robotsParser(robotsUrl, new TextDecoder().decode(answer.body));
  } catch (cause) {
    console.warn("[company-site] robots.txt not read", {
      host: startHost,
      message: cause instanceof Error ? cause.message : "unknown",
    });
    return null;
  }
}
