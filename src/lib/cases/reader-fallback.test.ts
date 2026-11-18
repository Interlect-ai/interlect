/**
 * A site that is only readable through the reader fallback gives its subpages too, not just
 * the homepage (Veo: veo.co redirects to veo.com, so every direct request is refused). The reader is
 * replaced by a fake that answers like Jina Reader. Kør: npm test
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseReaderLinks, pickSubpages, readSiteViaReader } from "./reader-fallback.ts";

const HOME = "https://www.veo.co/";
const FILLER = "Veo records, streams and analyses matches for football clubs around the world. ";

function readerAnswer(title: string, url: string, links = "") {
  return `Title: ${title}\n\nURL Source: ${url}\n\nMarkdown Content:\n${FILLER.repeat(3)}\n${links}`;
}

const HOME_LINKS = `
Links/Buttons:
- [Buy now](https://app.veo.co/checkout)
- [Veo Cam 3Record and analyse](https://www.veo.co/product/veo-cam-3)
- [Veo Go](https://www.veo.co/product/veo-go)
- [Veo Editor](https://www.veo.co/product/veo-editor)
- [Veo Analytics 2](https://www.veo.co/product/veo-analytics-2)
- [Cam 3 again](https://www.veo.co/product/veo-cam-3#specs)
- [Blog](https://www.veo.co/blog)
- [Pricing](https://www.veo.co/pricing)
- [Elsewhere](https://competitor.example/pricing)
- [Press](mailto:press@veo.co)
- [About Us](https://www.veo.co/about-us)
`;

function fakeReader(pages: Record<string, string>, requested: string[] = []) {
  return async (readerUrl: string, init: { headers: Record<string, string> }) => {
    const url = readerUrl.replace("https://r.jina.ai/", "");
    requested.push(`${url}|${init.headers["x-with-links-summary"] ?? ""}`);
    const body = pages[url];
    return {
      ok: body !== undefined,
      headers: new Headers(),
      arrayBuffer: async () => new TextEncoder().encode(body ?? "").buffer as ArrayBuffer,
    };
  };
}

test("parseReaderLinks reads the link list, drops hashes and non-web links", () => {
  const links = parseReaderLinks(readerAnswer("Veo", HOME, HOME_LINKS));
  assert.equal(links.length, 10);
  assert.ok(links.some((link) => link.url === "https://www.veo.co/product/veo-cam-3"));
  assert.ok(links.every((link) => !link.url.includes("#") && link.url.startsWith("http")));
  assert.deepEqual(parseReaderLinks("no list here"), []);
});

test("pickSubpages: same site only, pricing and about before many product pages, no repeats", () => {
  const picked = pickSubpages(parseReaderLinks(readerAnswer("Veo", HOME, HOME_LINKS)), {
    startUrl: HOME,
    max: 5,
  });
  assert.equal(picked.length, 5);
  assert.equal(picked[0], "https://www.veo.co/pricing");
  assert.equal(picked[1], "https://www.veo.co/about-us");
  assert.equal(new Set(picked).size, 5);
  assert.ok(picked.every((url) => url.startsWith("https://www.veo.co/")));
  assert.ok(!picked.includes("https://www.veo.co/blog"));
});

test("readSiteViaReader gives the homepage and its subpages, and asks the links only once", async () => {
  const requested: string[] = [];
  const pages = {
    [HOME]: readerAnswer("Veo Sports Cameras", HOME, HOME_LINKS),
    "https://www.veo.co/pricing": readerAnswer("Pricing", "https://www.veo.co/pricing"),
    "https://www.veo.co/about-us": readerAnswer("About us", "https://www.veo.co/about-us"),
    "https://www.veo.co/product/veo-cam-3": readerAnswer("Veo Cam 3", "x"),
    "https://www.veo.co/product/veo-go": readerAnswer("Veo Go", "x"),
  };
  const result = await readSiteViaReader(HOME, {
    maxPages: 6,
    allowed: async () => true,
    fetchImpl: fakeReader(pages, requested),
  });
  assert.ok(result.length >= 5, `expected at least 5 pages, got ${result.length}`);
  assert.equal(result[0]?.url, HOME);
  assert.equal(result[0]?.title, "Veo Sports Cameras");
  assert.ok(result.some((page) => page.url === "https://www.veo.co/pricing"));
  assert.ok(result.some((page) => page.url === "https://www.veo.co/about-us"));
  // The reader's link list is not part of the stored text, and only the homepage asked for it.
  assert.ok(result.every((page) => !page.text.includes("Links/Buttons")));
  assert.deepEqual(
    requested.filter((entry) => entry.endsWith("|true")),
    [`${HOME}|true`],
  );
});

test("readSiteViaReader respects robots, skips pages that fail and stops at maxPages", async () => {
  const pages = {
    [HOME]: readerAnswer("Veo", HOME, HOME_LINKS),
    "https://www.veo.co/about-us": readerAnswer("About us", "x"),
    "https://www.veo.co/product/veo-cam-3": readerAnswer("Veo Cam 3", "x"),
  };
  const result = await readSiteViaReader(HOME, {
    maxPages: 3,
    allowed: async (url) => !url.endsWith("/pricing"),
    fetchImpl: fakeReader(pages),
  });
  assert.ok(result.length <= 3);
  assert.ok(result.every((page) => !page.url.endsWith("/pricing")));
  assert.ok(result.some((page) => page.url.endsWith("/about-us")));
});

test("readSiteViaReader gives nothing when the homepage cannot be read", async () => {
  const result = await readSiteViaReader(HOME, {
    maxPages: 6,
    allowed: async () => true,
    fetchImpl: fakeReader({}),
  });
  assert.deepEqual(result, []);
});
