/**
 * Accept tests: every SSRF point against a real local HTTP server. Test hosts are
 * resolved by a fake resolver; the test's own server (127.0.0.1) is the only "public" address, so
 * the private-range rule itself is still exercised on every other address.
 * Kør: npm test
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { gzipSync } from "node:zlib";
import { isPrivateAddress } from "../../cases/ip-guard.ts";
import {
  isNotPublicAddress,
  pinnedFetch,
  SiteRefusedError,
  type PinnedFetchOptions,
} from "./site-fetch.server.ts";
import { sameSite } from "./site.ts";

let server: http.Server;
let port = "";
const hits: Array<{ host: string; path: string }> = [];

before(async () => {
  server = http.createServer((request, response) => {
    hits.push({ host: request.headers.host ?? "", path: request.url ?? "" });
    const path = request.url ?? "/";
    const redirect = (to: string) => {
      response.writeHead(302, { location: to });
      response.end();
    };
    if (path === "/") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<html><body><p>Fonden investerer i klimateknologi.</p></body></html>");
    } else if (path === "/to-www") redirect(`http://www.fund.test:${port}/`);
    else if (path === "/to-other") redirect(`http://other.test:${port}/`);
    else if (path === "/to-metadata") redirect("http://169.254.169.254/latest/meta-data/");
    else if (path === "/to-internal-name") redirect(`http://intern.fund.test:${port}/`);
    else if (path.startsWith("/chain/")) {
      const step = Number(path.slice("/chain/".length));
      redirect(`/chain/${step + 1}`);
    } else if (path === "/big") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("x".repeat(5_000));
    } else if (path === "/gzip-bomb") {
      response.writeHead(200, { "content-type": "text/html", "content-encoding": "gzip" });
      response.end(gzipSync(Buffer.alloc(200_000, 65)));
    } else if (path === "/gzip") {
      response.writeHead(200, { "content-type": "text/html", "content-encoding": "gzip" });
      response.end(gzipSync(Buffer.from("<p>komprimeret</p>")));
    } else if (path === "/stall-body") {
      response.writeHead(200, { "content-type": "text/html" });
      response.write("<p>begyndelsen");
      // The rest never comes.
    } else if (path === "/slow") {
      // Never answers: the timeout must end it.
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

/** fund.test and its subdomains are on the test server, except the names that resolve inside. */
const DNS: Record<string, string[]> = {
  "fund.test": ["127.0.0.1"],
  "www.fund.test": ["127.0.0.1"],
  "other.test": ["127.0.0.1"],
  "intern.fund.test": ["10.0.0.7"],
  "meta.fund.test": ["169.254.169.254"],
  "mixed.fund.test": ["127.0.0.1", "192.168.1.20"],
  "v6.fund.test": ["::1"],
  "dual.fund.test": ["::1", "127.0.0.1"],
};

function options(extra: Partial<PinnedFetchOptions> = {}): PinnedFetchOptions {
  return {
    allowHost: (host) => sameSite("fund.test", host),
    maxBytes: 1_000,
    accept: "text/html",
    timeoutMs: 2_000,
    allowPort: port,
    resolve: async (host) => {
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

test("a page on the site is fetched", async () => {
  const page = await pinnedFetch(url("fund.test"), options());
  assert.equal(page.status, 200);
  assert.match(new TextDecoder().decode(page.body), /klimateknologi/);
});

test("private, loopback and link-local addresses and 169.254.169.254 are refused before connecting", async () => {
  const before = hits.length;
  for (const host of ["intern.fund.test", "meta.fund.test", "v6.fund.test", "mixed.fund.test"]) {
    await refused(pinnedFetch(url(host), options()), /ikke på en offentlig server/);
  }
  // With the real rule, the loopback address itself is refused too.
  await refused(
    pinnedFetch(url("fund.test"), options({ isBlockedAddress: isNotPublicAddress })),
    /ikke på en offentlig server/,
  );
  for (const literal of [
    "http://169.254.169.254/latest/meta-data/",
    "http://[::1]/",
    "http://10.0.0.1/",
  ]) {
    await refused(pinnedFetch(literal, options({ allowHost: () => true })), /offentlig server/);
  }
  assert.equal(hits.length, before, "nothing reached a server");
});

test("the same checks hold after a redirect (metadata address, internal name, other domain)", async () => {
  await refused(
    pinnedFetch(url("fund.test", "/to-metadata"), options()),
    /169\.254\.169\.254, som er et andet domæne/,
  );
  await refused(
    pinnedFetch(url("fund.test", "/to-metadata"), options({ allowHost: () => true })),
    /offentlig server/,
  );
  await refused(pinnedFetch(url("fund.test", "/to-internal-name"), options()), /offentlig server/);
  await refused(
    pinnedFetch(url("fund.test", "/to-other"), options()),
    /other\.test, som er et andet domæne/,
  );
  const www = await pinnedFetch(url("fund.test", "/to-www"), options());
  assert.equal(new URL(www.url).hostname, "www.fund.test");
});

test("the connection goes to the address that was checked (no second DNS answer: rebinding)", async () => {
  let calls = 0;
  const rebinding = options({
    // First answer: the (test) public server. Any later answer: the cloud metadata address.
    resolve: async () => (calls++ === 0 ? ["127.0.0.1"] : ["169.254.169.254"]),
  });
  const page = await pinnedFetch(url("fund.test"), rebinding);
  assert.equal(page.status, 200);
  assert.equal(calls, 1, "the host is resolved once per request");
  assert.equal(hits.at(-1)?.host, `fund.test:${port}`, "the Host header keeps the name");
});

test("at most 3 redirects", async () => {
  const error = await pinnedFetch(url("fund.test", "/chain/0"), options({ maxRedirects: 3 })).catch(
    (error: unknown) => error,
  );
  assert.ok(error instanceof SiteRefusedError);
  assert.match(error.message, /for mange gange/);
});

test("only http(s), no login in the address, no other port", async () => {
  for (const address of [
    "file:///etc/passwd",
    "ftp://fund.test/",
    "gopher://fund.test/",
    "http://user:pw@fund.test/",
    "http://fund.test:8080/",
    "http://localhost/",
  ]) {
    await assert.rejects(pinnedFetch(address, options()), SiteRefusedError, address);
  }
});

test("the size cap counts the bytes received, also after decompression", async () => {
  await refused(pinnedFetch(url("fund.test", "/big"), options()), /for stor/);
  await refused(pinnedFetch(url("fund.test", "/gzip-bomb"), options()), /for stor/);
  const small = await pinnedFetch(url("fund.test", "/gzip"), options());
  assert.equal(new TextDecoder().decode(small.body), "<p>komprimeret</p>");
});

test("a server that never answers is stopped by the timeout", async () => {
  const started = Date.now();
  await assert.rejects(pinnedFetch(url("fund.test", "/slow"), options({ timeoutMs: 300 })));
  assert.ok(Date.now() - started < 2_000);
});

test("a body that stalls after the headers is stopped by the same timeout", async () => {
  const started = Date.now();
  await assert.rejects(pinnedFetch(url("fund.test", "/stall-body"), options({ timeoutMs: 300 })));
  assert.ok(Date.now() - started < 2_000);
});

test("IPv4 in any IPv6 form, NAT64, 6to4 and other non-public IPv6 ranges are refused", () => {
  for (const address of [
    "::ffff:7f00:1",
    "::ffff:a9fe:a9fe",
    "::127.0.0.1",
    "64:ff9b::a9fe:a9fe",
    "2002:a9fe:a9fe::",
    "fec0::1",
    "ff02::1",
    "2001:db8::1",
    "2001:2::1",
    "192.0.2.1",
    "198.51.100.1",
    "203.0.113.1",
    "169.254.169.254",
    "not-an-ip",
  ]) {
    assert.equal(isNotPublicAddress(address), true, address);
  }
  for (const address of ["8.8.8.8", "2606:4700::1111", "::ffff:8.8.8.8", "2a00:1450:4001::1"]) {
    assert.equal(isNotPublicAddress(address), false, address);
  }
});

test("a dual-stack host is reached over IPv4 when it lists IPv6 first (T-816)", async () => {
  // The test server listens on 127.0.0.1 only, so connecting to ::1 would fail.
  const page = await pinnedFetch(
    url("dual.fund.test"),
    options({ isBlockedAddress: (address) => address !== "127.0.0.1" && address !== "::1" }),
  );
  assert.equal(page.status, 200);
});

test("a DNS lookup that hangs is stopped by the request's timeout", async () => {
  const started = Date.now();
  await assert.rejects(
    pinnedFetch(
      url("fund.test"),
      options({ timeoutMs: 300, resolve: () => new Promise(() => {}) }),
    ),
  );
  assert.ok(Date.now() - started < 2_000);
});
