/**
 * ét kig på selskabets forside, før casen findes. Bruges kun til at finde CVR-nummer og
 * navn i kode (ingen AI, ingen lagring): Find-trinnet i Opret case.
 *
 * Samme beskyttelse som screeningens website-oplæsning (`company-site.server.ts`): kun
 * offentlige http(s)-adresser, forbindelsen går til den kontrollerede adresse (ingen DNS-rebinding),
 * viderestillinger kun inden for selskabets eget domæne, robots.txt respekteres, timeout og
 * størrelsesloft. Footeren beholdes, fordi CVR-nummeret typisk står dér (screeningens
 * website-oplæsning fjerner den).
 */
import { load } from "cheerio";
import { findCvrNumbers, hostOf } from "@/lib/analysis/identity";
import { companyPage, companyRobots } from "@/lib/cases/company-site.server";
import { SiteRedirectError } from "@/lib/brain/ingest/site-fetch.server";
import { USER_AGENT, cleanText, normalizeUrl } from "@/lib/cases/website-capture.server";

const MAX_BYTES = 1_500_000;
const MAX_TEXT_CHARS = 60_000;

export interface HomepagePeek {
  host: string;
  finalUrl: string;
  title: string;
  siteName: string | null;
  text: string;
  /** CVR-numre på siden, der består kontrolcifferet (endnu ikke slået op). */
  cvrNumbers: string[];
}

/**
 * Forsiden viderestiller til et andet domæne (selskab.dk → selskab.com). Den følges ikke;
 * adressen vises i Opret case med "Brug den adresse", så et menneske vælger den.
 */
export interface HomepageRedirect {
  redirectsTo: string;
}

export function isHomepageRedirect(
  value: HomepagePeek | HomepageRedirect | null,
): value is HomepageRedirect {
  return value !== null && "redirectsTo" in value;
}

/** Gør brugerens indtastning til en https-adresse, eller null, hvis den ikke ligner en. */
export function websiteUrlFromInput(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  const host = hostOf(trimmed);
  if (!host || !host.includes(".")) return null;
  try {
    return normalizeUrl(/^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
}

/**
 * `null` når siden ikke kan eller må læses; årsagen logges, aldrig vist som rå fejl. En
 * viderestilling til et andet domæne giver adressen (kun en offentlig http(s)-adresse, der kan
 * stå i feltet), ikke siden.
 */
export async function peekHomepage(
  rawWebsite: string,
): Promise<HomepagePeek | HomepageRedirect | null> {
  const url = websiteUrlFromInput(rawWebsite);
  if (!url) return null;
  try {
    const robots = await companyRobots(url);
    if (robots && !robots.isAllowed(url, USER_AGENT)) return null;
    // Refused (not followed) when it redirects to another domain; a page over MAX_BYTES (counted
    // on the bytes received, after decompression) is refused too.
    const response = await companyPage(url, url, MAX_BYTES);
    if (!response.contentType.includes("text/html")) return null;
    // A redirect to another host on the site (www., a subdomain) must be allowed by THAT host's
    // robots.txt as well.
    if (hostOf(response.url) && hostOf(response.url) !== hostOf(url)) {
      const finalRobots = await companyRobots(response.url);
      if (finalRobots && !finalRobots.isAllowed(response.url, USER_AGENT)) return null;
    }
    const $ = load(new TextDecoder().decode(response.body));
    const siteName = cleanText(
      // i18n-keep: a CSS selector, not a text.
      $('meta[property="og:site_name"]').attr("content") ??
        $('meta[name="application-name"]').attr("content") ??
        "",
    );
    const title = cleanText($("title").first().text());
    $("script, style, noscript, svg").remove();
    const text = cleanText($("body").text()).slice(0, MAX_TEXT_CHARS);
    const host = hostOf(response.url) ?? hostOf(url);
    if (!host) return null;
    return {
      host,
      finalUrl: response.url,
      title,
      siteName: siteName || null,
      text,
      cvrNumbers: findCvrNumbers(text).slice(0, 3),
    };
  } catch (cause) {
    if (cause instanceof SiteRedirectError) {
      // Without the query (tracking such as utm_source): the address is shown and typed in.
      const location = new URL(cause.location);
      location.search = "";
      const target = websiteUrlFromInput(location.toString());
      const parsed = target ? new URL(target) : null;
      if (
        target &&
        parsed &&
        /^https?:$/.test(parsed.protocol) &&
        !parsed.username &&
        !parsed.password &&
        target.length <= 300 &&
        hostOf(target) !== hostOf(url)
      ) {
        return { redirectsTo: target };
      }
    }
    console.warn("[homepage-peek] not read", {
      host: hostOf(url),
      message: cause instanceof Error ? cause.message : "unknown",
    });
    return null;
  }
}
