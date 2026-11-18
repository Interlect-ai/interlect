/** The crawl order and rules (sitemap, robots.txt, login pages, 40 pages), no network. Kør: npm test */
import assert from "node:assert/strict";
import { test } from "node:test";
import { BrainUserError } from "../errors.ts";
import { chunkDocument } from "./chunk.ts";
import { crawlSite, type SiteFetcher } from "./crawl.ts";
import { extractDocument } from "./extract.ts";
import { detectFileKind } from "./file-kind.ts";
import {
  crawlableUrl,
  decodeWebsiteFile,
  encodeWebsiteFile,
  isLoginPath,
  isPortfolioPage,
  nameFitsDomain,
  readPage,
  websiteStartUrl,
} from "./site.ts";

const START = "https://fund.test/";
const page = (title: string, body: string, extra = "") =>
  `<html><head><title>${title}</title></head><body><nav><a href="/team">Team</a></nav><main><h1>${title}</h1><p>${body}</p>${extra}</main><footer>Fund ApS · CVR 12345678</footer></body></html>`;
const words = (topic: string) =>
  `Fonden skriver her om ${topic}, og teksten er lang nok til at tælle som en rigtig side med indhold.`;

function siteFetcher(site: Record<string, string>, requested: string[] = []): SiteFetcher {
  return async (url) => {
    requested.push(url);
    const body = site[url];
    if (body === undefined) throw new Error("status 404");
    const isXml = url.endsWith(".xml");
    const isText = url.endsWith(".txt");
    return {
      url,
      contentType: isXml ? "application/xml" : isText ? "text/plain" : "text/html; charset=utf-8",
      body: new TextEncoder().encode(body),
    };
  };
}

test("the sitemap comes first, its entries outside the site are ignored, important pages first", async () => {
  const requested: string[] = [];
  const file = await crawlSite(
    START,
    siteFetcher(
      {
        "https://fund.test/robots.txt":
          "User-agent: *\nDisallow: /intern\nSitemap: https://fund.test/sitemap.xml",
        "https://fund.test/sitemap.xml": `<?xml version="1.0"?><urlset>
          <url><loc>https://fund.test/blog/nyhed-1</loc></url>
          <url><loc>https://fund.test/portfolio</loc></url>
          <url><loc>https://evil.test/steal</loc></url>
          <url><loc>http://169.254.169.254/latest/meta-data/</loc></url>
          <url><loc>https://fund.test/intern/plan</loc></url>
          <url><loc>https://fund.test/login</loc></url>
          <url><loc>https://fund.test/rapport.pdf</loc></url>
        </urlset>`,
        "https://fund.test/": page("Forside", words("klima")),
        "https://fund.test/portfolio": page(
          "Portefølje",
          words("porteføljen"),
          `<a href="https://acme.io/">Acme</a><a href="https://www.linkedin.com/company/x">LinkedIn</a><a href="https://beta.dk">Læs mere</a>`,
        ),
        "https://fund.test/blog/nyhed-1": page("Nyhed", words("en nyhed")),
        "https://fund.test/intern/plan": page("Intern", words("noget hemmeligt")),
      },
      requested,
    ),
  );
  assert.deepEqual(
    file.pages.map((p) => p.url),
    ["https://fund.test/", "https://fund.test/portfolio", "https://fund.test/blog/nyhed-1"],
  );
  assert.ok(!requested.some((url) => /evil|169\.254|login|\.pdf/.test(url)), requested.join(" "));
  assert.ok(!requested.includes("https://fund.test/intern/plan"), "robots.txt is respected");
  assert.deepEqual(file.portfolio, [
    { name: "Acme", domain: "acme.io" },
    { name: "Beta", domain: "beta.dk" },
  ]);
  assert.ok(file.notes.some((note) => /robots\.txt/.test(note)));
  // Menus and footers are not read as text.
  assert.ok(!JSON.stringify(file.pages).includes("CVR 12345678"));
});

test("without a sitemap the links are followed, at most 40 pages", async () => {
  const site: Record<string, string> = {
    "https://fund.test/": page(
      "Forside",
      words("forsiden"),
      Array.from({ length: 60 }, (_, i) => `<a href="/side-${i}">Side ${i}</a>`).join("") +
        `<a href="/min-side/login">Log ind</a><a href="https://andet.test/x">Ude</a>`,
    ),
  };
  for (let i = 0; i < 60; i += 1)
    site[`https://fund.test/side-${i}`] = page(`Side ${i}`, words(`emne ${i}`));
  const requested: string[] = [];
  const file = await crawlSite(START, siteFetcher(site, requested));
  assert.equal(file.pages.length, 40);
  assert.ok(file.notes.some((note) => /flere end 40/.test(note)));
  assert.ok(!requested.some((url) => /login|andet\.test/.test(url)));
});

test("a page with a password field is a login page and is skipped", async () => {
  const file = await crawlSite(
    START,
    siteFetcher({
      "https://fund.test/": page("Forside", words("forsiden"), `<a href="/portal">Portal</a>`),
      "https://fund.test/portal": page(
        "Portal",
        words("portalen"),
        `<form><input type="password"></form>`,
      ),
    }),
  );
  assert.deepEqual(
    file.pages.map((p) => p.title),
    ["Forside"],
  );
  assert.ok(file.notes.some((note) => /login-sider/.test(note)));
});

test("a site that forbids robots, or cannot be reached, gives a Danish refusal", async () => {
  await assert.rejects(
    crawlSite(START, siteFetcher({ "https://fund.test/robots.txt": "User-agent: *\nDisallow: /" })),
    (error: unknown) => error instanceof BrainUserError && /robots\.txt/.test(error.message),
  );
  await assert.rejects(
    crawlSite(START, siteFetcher({})),
    (error: unknown) => error instanceof BrainUserError && /kunne ikke læses/.test(error.message),
  );
});

test("the time limit keeps the pages read so far", async () => {
  let clock = 0;
  const site: Record<string, string> = {
    "https://fund.test/": page(
      "Forside",
      words("forsiden"),
      `<a href="/a">A</a><a href="/b">B</a>`,
    ),
    "https://fund.test/a": page("A", words("a")),
    "https://fund.test/b": page("B", words("b")),
  };
  const fetcher: SiteFetcher = async (url, kind) => {
    clock += 50;
    return siteFetcher(site)(url, kind);
  };
  const file = await crawlSite(START, fetcher, {
    deadlineMs: 120,
    concurrency: 1,
    now: () => clock,
  });
  assert.ok(file.pages.length >= 1 && file.pages.length < 3);
  assert.ok(file.notes.some((note) => /Tiden løb ud/.test(note)));
});

test("the stored file is read by INGEST page by page, and a page never shares a chunk", async () => {
  const file = await crawlSite(
    START,
    siteFetcher({
      "https://fund.test/": page("Forside", words("forsiden"), `<a href="/team">Team</a>`),
      "https://fund.test/team": page("Team", words("holdet")),
    }),
  );
  const bytes = encodeWebsiteFile(file);
  const kind = detectFileKind(bytes, "fund.test.json");
  assert.deepEqual(kind.ok && kind.kind, "website");
  // Another JSON file is not a website.
  assert.equal(detectFileKind(new TextEncoder().encode('{"a":1}'), "x.json").ok, false);
  const doc = await extractDocument(bytes, "website");
  assert.equal(doc.pageCount, 2);
  const chunks = chunkDocument(doc);
  assert.deepEqual(
    chunks.map((c) => [c.pageFrom, c.pageTo]),
    [
      [1, 1],
      [2, 2],
    ],
  );
  assert.match(chunks[1]!.content, /^Team \(https:\/\/fund\.test\/team\)/);
  const first = await extractDocument(bytes, "website", { maxPages: 1 });
  assert.equal(first.pageCount, 1);
  assert.equal(first.truncatedFrom, 2);
  assert.throws(
    () => decodeWebsiteFile(new TextEncoder().encode('{"format":"x"}')),
    BrainUserError,
  );
});

test("address rules: the user's input, links on the site, login paths", () => {
  assert.equal(websiteStartUrl("fund.dk"), "https://fund.dk/");
  assert.equal(websiteStartUrl("https://www.fund.dk/om?x=1#a"), "https://www.fund.dk/om");
  assert.equal(websiteStartUrl("javascript:alert(1)"), null);
  assert.equal(websiteStartUrl("https://user:pw@fund.dk"), null);
  assert.equal(websiteStartUrl("ikke en adresse"), null);
  assert.equal(crawlableUrl("/team?utm=1#top", START, "fund.test"), "https://fund.test/team");
  assert.equal(
    crawlableUrl("https://en.fund.test/about", START, "fund.test"),
    "https://en.fund.test/about",
  );
  assert.equal(crawlableUrl("https://fund.test.evil.io/", START, "fund.test"), null);
  assert.equal(crawlableUrl("https://notfund.test/", START, "fund.test"), null);
  assert.equal(crawlableUrl("mailto:hej@fund.test", START, "fund.test"), null);
  assert.equal(crawlableUrl("https://fund.test:8443/", START, "fund.test"), null);
  for (const path of ["/login", "/da/log-ind", "/wp-admin/", "/account/settings", "/min-side"]) {
    assert.ok(isLoginPath(path), path);
  }
  for (const path of ["/blog/logistics", "/about", "/portfolio/authentic"]) {
    assert.ok(!isLoginPath(path), path);
  }
});

test("a detail page names the company by its heading when the link only says 'website'", () => {
  const read = readPage(
    page("Acme | Fund", words("Acme"), `<a href="https://acme.io">Visit website</a>`).replace(
      "<h1>Acme | Fund</h1>",
      "<h1>Acme Robotics</h1>",
    ),
    "https://fund.test/portfolio/acme",
    "fund.test",
  );
  assert.deepEqual(read.portfolio, [{ name: "Acme Robotics", domain: "acme.io" }]);
});

test("a portfolio card's name is its heading or logo text when it fits the domain, never a slogan", () => {
  const card = (inner: string) =>
    `<div class="card"><h3>FLATPAY</h3><p>Betaling uden skjulte gebyrer.</p><div><strong>Founders:</strong> A og B</div>${inner}</div>`;
  const html = page(
    "Our family",
    words("porteføljen"),
    card(`<a href="https://flatpay.dk/">Visit website</a>`) +
      `<div class="card"><div class="title">Rethinking the banking experience</div><a href="https://lunar.app/"><svg></svg></a></div>` +
      `<div class="card"><img alt="Vivino logo"><a href="https://www.vivino.com/">→</a></div>` +
      `<a href="https://jobs.breezy.hr/p/1">career page</a><a href="https://fund.test/om">Om os</a>`,
  );
  const read = readPage(html, "https://fund.test/our-family", "fund.test");
  assert.deepEqual(read.portfolio, [
    { name: "FLATPAY", domain: "flatpay.dk" },
    { name: "Lunar", domain: "lunar.app" },
    { name: "Vivino", domain: "vivino.com" },
  ]);
  assert.ok(nameFitsDomain("Blackbird", "blackbirdcoffee.dk"));
  assert.ok(nameFitsDomain("Trustpilot", "uk.trustpilot.com"));
  assert.ok(!nameFitsDomain("Rethinking the banking experience", "lunar.app"));
  assert.ok(!nameFitsDomain("Founders:", "flatpay.dk"));
  // Only the page's own section counts, not a news article about investments.
  assert.ok(isPortfolioPage("https://fund.test/portfolio/acme"));
  assert.ok(isPortfolioPage("https://fund.test/da/portefolje"));
  assert.ok(!isPortfolioPage("https://fund.test/stories/the-final-investments-of-the-decade"));
});

test("robots.txt still holds when the site moves to www (the rules follow the path)", async () => {
  const requested: string[] = [];
  const fetcher: SiteFetcher = async (url, kind) => {
    // fund.test redirects every address to www.fund.test.
    const moved = url.replace("https://fund.test/", "https://www.fund.test/");
    const answer = await siteFetcher(
      {
        "https://www.fund.test/robots.txt": "User-agent: *\nDisallow: /privat",
        "https://www.fund.test/": page(
          "Forside",
          words("forsiden"),
          `<a href="/privat/plan">Plan</a><a href="/team">Team</a>`,
        ),
        "https://www.fund.test/privat/plan": page("Plan", words("noget privat")),
        "https://www.fund.test/team": page("Team", words("holdet")),
      },
      requested,
    )(moved, kind);
    return answer;
  };
  const file = await crawlSite(START, fetcher);
  assert.deepEqual(
    file.pages.map((p) => p.url),
    ["https://www.fund.test/", "https://www.fund.test/team"],
  );
  assert.ok(!requested.includes("https://www.fund.test/privat/plan"));
});

test("an over-long site name, address or domain never makes a file the reader refuses", async () => {
  const long = "x".repeat(700);
  const file = await crawlSite(
    START,
    siteFetcher({
      "https://fund.test/": page(
        "Forside",
        words("forsiden"),
        `<a href="/${"a".repeat(2_100)}">Lang</a>`,
      ).replace("<head>", `<head><meta property="og:site_name" content="${long}">`),
    }),
  );
  assert.ok(file.siteName !== null && file.siteName.length <= 300);
  const bytes = encodeWebsiteFile(file);
  assert.equal(decodeWebsiteFile(bytes).pages.length, 1);
  assert.equal(websiteStartUrl(`fund.dk/${"a".repeat(2_100)}`), null);
});

test("the front page is always tried, even when robots and sitemaps used the time", async () => {
  let clock = 0;
  const fetcher: SiteFetcher = async () => {
    clock += 1_000;
    throw new Error("status 503");
  };
  await assert.rejects(
    crawlSite(START, fetcher, { deadlineMs: 10, now: () => clock }),
    (error: unknown) => error instanceof BrainUserError && /kunne ikke læses/.test(error.message),
  );
});
