/**
 * The company's own website (Opret case and screening) is read through pinnedFetch, against
 * a real local HTTP server. Test hosts are resolved by a fake resolver; the test's own server
 * (127.0.0.1) is the only "public" address. Kør: npm test
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { isPrivateAddress } from "./ip-guard.ts";
import { companyPage, companyRobots, type CompanySiteTesting } from "./company-site.server.ts";
import {
  assertPublicSite,
  isNotPublicAddress,
  SiteRedirectError,
  SiteRefusedError,
} from "../brain/ingest/site-fetch.server.ts";

let server: http.Server;
let port = "";
const hits: Array<{ host: string; path: string }> = [];

before(async () => {
  server = http.createServer((request, response) => {
    hits.push({ host: (request.headers.host ?? "").split(":")[0] ?? "", path: request.url ?? "" });
    const path = request.url ?? "/";
    const redirect = (to: string) => {
      response.writeHead(302, { location: to });
      response.end();
    };
    if (path === "/") {
      response.writeHead(200, {
        "content-type": "text/html",
        "last-modified": "Tue, 06 Oct 2026 10:00:00 GMT",
      });
      response.end("<html><body><p>Solsejl ApS, CVR 12345678.</p></body></html>");
    } else if (path === "/to-www") redirect(`http://www.solsejl.test:${port}/`);
    else if (path === "/to-other") redirect(`http://other.test:${port}/`);
    else if (path === "/robots.txt") {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("User-agent: *\nDisallow: /privat\n");
    } else if (path === "/big") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("x".repeat(5_000));
    } else {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = String((server.address() as AddressInfo).port);
});

after(() => {
  server.closeAllConnections();
  server.close();
});

const DNS: Record<string, string[]> = {
  "solsejl.test": ["127.0.0.1"],
  "www.solsejl.test": ["127.0.0.1"],
  "other.test": ["127.0.0.1"],
  "intern.solsejl.test": ["10.0.0.7"],
  "moved.test": ["127.0.0.1"],
};
let lookups: string[] = [];

function testing(extra: Partial<CompanySiteTesting> = {}): CompanySiteTesting {
  return {
    allowPort: port,
    resolve: async (host) => {
      lookups.push(host);
      const found = DNS[host];
      if (!found) throw new Error("ENOTFOUND");
      return found;
    },
    // Only the test server's loopback address counts as public; every other range is the real rule.
    isBlockedAddress: (address) => address !== "127.0.0.1" && isPrivateAddress(address),
    ...extra,
  };
}

const url = (host: string, path = "/") => `http://${host}:${port}${path}`;

async function refused(promise: Promise<unknown>, pattern: RegExp) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof SiteRefusedError, String(error));
    assert.match(error.message, pattern);
    return true;
  });
}

test("a page on the company's site is read, with its last-modified date", async () => {
  const page = await companyPage(url("solsejl.test"), url("solsejl.test"), 10_000, testing());
  assert.equal(page.status, 200);
  assert.match(page.contentType, /text\/html/);
  assert.match(new TextDecoder().decode(page.body), /CVR 12345678/);
  assert.equal(page.lastModified, "Tue, 06 Oct 2026 10:00:00 GMT");
});

test("the host is looked up once per request and the connection goes to that address", async () => {
  lookups = [];
  // A resolver that would answer an internal address the second time (DNS rebinding).
  let calls = 0;
  const rebinding = testing({
    resolve: async (host) => {
      lookups.push(host);
      calls += 1;
      return calls === 1 ? ["127.0.0.1"] : ["10.0.0.7"];
    },
  });
  const page = await companyPage(url("solsejl.test"), url("solsejl.test"), 10_000, rebinding);
  assert.equal(page.status, 200);
  assert.deepEqual(lookups, ["solsejl.test"]);
});

test("a redirect within the site (www.) is followed", async () => {
  const page = await companyPage(
    url("solsejl.test", "/to-www"),
    url("solsejl.test"),
    10_000,
    testing(),
  );
  assert.match(page.url, /www\.solsejl\.test/);
});

test("a redirect to another domain is refused, not followed", async () => {
  const before = hits.filter((hit) => hit.host === "other.test").length;
  await refused(
    companyPage(url("solsejl.test", "/to-other"), url("solsejl.test"), 10_000, testing()),
    /andet domæne/,
  );
  assert.equal(hits.filter((hit) => hit.host === "other.test").length, before);
});

test("T-817: the refused redirect names where it pointed, so Opret case can offer it", async () => {
  const error = await companyPage(
    url("solsejl.test", "/to-other"),
    url("solsejl.test"),
    10_000,
    testing(),
  ).catch((cause: unknown) => cause);
  assert.ok(error instanceof SiteRedirectError && error instanceof SiteRefusedError);
  assert.equal(error.location, `http://other.test:${port}/`);
});

test("a host on an internal address is refused before anything is sent", async () => {
  const before = hits.length;
  await refused(
    companyPage(url("intern.solsejl.test"), url("solsejl.test"), 10_000, testing()),
    /offentlig server/,
  );
  assert.equal(hits.length, before);
});

test("a page larger than the cap is refused", async () => {
  await refused(
    companyPage(url("solsejl.test", "/big"), url("solsejl.test"), 1_000, testing()),
    /for stor/,
  );
});

test("robots.txt is read from the site, and its rules apply", async () => {
  const robots = await companyRobots(url("solsejl.test"), testing());
  assert.ok(robots);
  assert.equal(robots.isAllowed(url("solsejl.test", "/privat"), "Interlect.ai"), false);
  assert.equal(robots.isAllowed(url("solsejl.test", "/om"), "Interlect.ai"), true);
  // A site without a reachable robots.txt forbids nothing (as before).
  assert.equal(await companyRobots(url("nowhere.test"), testing()), null);
});

test("the early check refuses internal addresses in every form, also NAT64 and 6to4", async () => {
  for (const literal of [
    "http://10.0.0.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://[::1]/",
    "http://[::ffff:7f00:1]/",
    "http://[64:ff9b::a00:1]/",
    "http://[2002:a00:1::]/",
  ]) {
    await refused(assertPublicSite(literal), /offentlig server/);
  }
  await refused(assertPublicSite("http://localhost/"), /Lokale adresser/);
  await refused(assertPublicSite("ftp://solsejl.test/"), /http\(s\)/);
  await refused(assertPublicSite("http://bruger:kode@solsejl.test/"), /loginoplysninger/);
  await refused(assertPublicSite("http://solsejl.test:8080/"), /port/);
  // The same rule the requests use.
  assert.equal(isNotPublicAddress("::ffff:7f00:1"), true);
});
