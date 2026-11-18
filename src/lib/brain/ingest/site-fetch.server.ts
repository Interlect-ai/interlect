/**
 * SSRF-safe fetching of the fund's website. Every point is here:
 *
 * - only http(s), no login in the address, only port 80/443, no "localhost"/".local"/".internal";
 * - the host is resolved ONCE and every address checked (private, loopback, link-local and
 *   169.254.169.254 are refused); the connection then goes to exactly that checked address, so a
 *   second DNS answer (DNS rebinding) can never move it to an internal server;
 * - the same checks again on every redirect, at most 3 redirects, and only within the site;
 * - 10 s per request (headers and body) and a hard byte cap counted on the bytes received.
 *
 * Built on node:http(s) (not fetch), because only there the checked address can be pinned.
 */
import http from "node:http";
import https from "node:https";
import { lookup } from "node:dns/promises";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import type { Readable } from "node:stream";
import { isPrivateAddress } from "../../cases/ip-guard.ts";
import { serverText } from "../../i18n/server-text.ts";

export const SITE_USER_AGENT = "Interlect.ai/1.0 (+investment-research)";

/** The address was refused before anything was sent (the user can see why). */
export class SiteRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SiteRefusedError";
  }
}

/**
 * A redirect to another site, refused (not followed); `location` is where it pointed. Its
 * name stays "SiteRefusedError": the fund website's crawl shows the reason by that name.
 */
export class SiteRedirectError extends SiteRefusedError {
  readonly location: string;
  constructor(message: string, location: string) {
    super(message);
    this.location = location;
  }
}

export interface SiteResponse {
  /** The address that answered (after redirects). */
  url: string;
  status: number;
  contentType: string;
  body: Uint8Array;
  /** The page's own `last-modified` header, when it sent one. */
  lastModified: string | null;
}

export interface PinnedFetchOptions {
  /** Hosts a request (also a redirect) may go to. */
  allowHost: (host: string) => boolean;
  maxBytes: number;
  accept: string;
  timeoutMs?: number;
  maxRedirects?: number;
  /** For tests only: a resolver and an address rule instead of DNS and the private ranges. */
  resolve?: (host: string) => Promise<string[]>;
  isBlockedAddress?: (address: string) => boolean;
  /** For tests only: a local test server's port. */
  allowPort?: string;
}

/**
 * More than the shared private ranges (cases/ip-guard.ts): Node's BlockList also matches IPv4
 * written as IPv6 in any form ("::ffff:7f00:1"), and IPv6 ranges that can carry an internal IPv4
 * address (NAT64, 6to4, IPv4-compatible) or are never a public server.
 */
const NOT_PUBLIC = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 3],
] as const) {
  NOT_PUBLIC.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 96],
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001:2::", 48],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
] as const) {
  NOT_PUBLIC.addSubnet(network, prefix, "ipv6");
}

export function isNotPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return true;
  return isPrivateAddress(address) || NOT_PUBLIC.check(address, family === 6 ? "ipv6" : "ipv4");
}

async function dnsAddresses(host: string): Promise<string[]> {
  return (await lookup(host, { all: true, verbatim: true })).map((entry) => entry.address);
}

function checkShape(url: URL, options: PinnedFetchOptions): void {
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new SiteRefusedError(serverText("brainServer.site.onlyPublic"));
  }
  if (url.username || url.password) {
    throw new SiteRefusedError(serverText("brainServer.site.credentials"));
  }
  if (url.port && !["80", "443", options.allowPort].includes(url.port)) {
    throw new SiteRefusedError(serverText("brainServer.site.port"));
  }
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new SiteRefusedError(serverText("brainServer.site.local"));
  }
  if (!options.allowHost(host.replace(/^\[|\]$/g, ""))) {
    throw new SiteRefusedError(serverText("brainServer.site.outsideDomain"));
  }
}

/** Resolves the host once and returns the address to connect to, after checking all of them. */
async function checkedAddress(
  url: URL,
  options: PinnedFetchOptions,
  signal: AbortSignal,
): Promise<string> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const blocked = options.isBlockedAddress ?? isNotPublicAddress;
  let addresses: string[];
  try {
    // The lookup counts against the request's timeout too.
    addresses = isIP(host)
      ? [host]
      : await Promise.race([
          (options.resolve ?? dnsAddresses)(host),
          new Promise<never>((_, reject) =>
            signal.addEventListener("abort", () => reject(new Error("timeout")), { once: true }),
          ),
        ]);
  } catch (cause) {
    if (signal.aborted) throw cause;
    throw new SiteRefusedError(serverText("brainServer.site.noDomain"));
  }
  if (addresses.length === 0 || addresses.some((address) => blocked(address))) {
    throw new SiteRefusedError(serverText("brainServer.site.notPublic"));
  }
  // All answers are checked; connect over IPv4 when there is one, as plain fetch would, since a
  // dual-stack host listing AAAA first is unreachable from an IPv4-only runtime.
  return addresses.find((address) => isIP(address) === 4) ?? addresses[0]!;
}

function decoded(response: http.IncomingMessage): Readable {
  switch ((response.headers["content-encoding"] ?? "").toLowerCase()) {
    case "gzip":
      return response.pipe(createGunzip());
    case "deflate":
      return response.pipe(createInflate());
    case "br":
      return response.pipe(createBrotliDecompress());
    default:
      return response;
  }
}

function requestOnce(
  url: URL,
  address: string,
  options: PinnedFetchOptions,
  signal: AbortSignal,
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Uint8Array | null }> {
  const family = isIP(address);
  // The socket gets the checked address; DNS is never asked again for this connection.
  const pinned: LookupFunction = (_host, lookupOptions, callback) => {
    if (lookupOptions.all) callback(null, [{ address, family }]);
    else callback(null, address, family);
  };
  const client = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const request = client.request(
      {
        protocol: url.protocol,
        hostname: url.hostname.replace(/^\[|\]$/g, ""),
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        agent: false,
        lookup: pinned,
        signal,
        headers: {
          "user-agent": SITE_USER_AGENT,
          accept: options.accept,
          "accept-encoding": "gzip, deflate, br",
        },
      },
      (response) => {
        const status = response.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          response.resume();
          resolve({ status, headers: response.headers, body: null });
          return;
        }
        const announced = Number(response.headers["content-length"] ?? 0);
        if (announced > options.maxBytes) {
          response.destroy();
          reject(new SiteRefusedError(serverText("brainServer.site.tooBig")));
          return;
        }
        const chunks: Buffer[] = [];
        let total = 0;
        const stream = decoded(response);
        stream.on("data", (chunk: Buffer) => {
          total += chunk.byteLength;
          // The cap counts what is received after decompression; the announced size is never trusted.
          if (total > options.maxBytes) {
            response.destroy();
            stream.destroy();
            reject(new SiteRefusedError(serverText("brainServer.site.tooBig")));
            return;
          }
          chunks.push(chunk);
        });
        stream.on("end", () =>
          resolve({
            status,
            headers: response.headers,
            body: new Uint8Array(Buffer.concat(chunks)),
          }),
        );
        stream.on("error", reject);
        response.on("error", reject);
      },
    );
    request.on("error", reject);
    // A server that sends its headers and then stalls the body is stopped by the same timeout.
    signal.addEventListener("abort", () => reject(new Error("timeout")), { once: true });
    request.end();
  });
}

/** GET with every SSRF rule. Throws SiteRefusedError, or a network error. */
export async function pinnedFetch(
  rawUrl: string,
  options: PinnedFetchOptions,
): Promise<SiteResponse> {
  const maxRedirects = options.maxRedirects ?? 3;
  let current = new URL(rawUrl);
  for (let redirects = 0; ; redirects += 1) {
    checkShape(current, options);
    const signal = AbortSignal.timeout(options.timeoutMs ?? 10_000);
    const address = await checkedAddress(current, options, signal);
    const answer = await requestOnce(current, address, options, signal);
    if (answer.status >= 300 && answer.status < 400) {
      const location = answer.headers.location;
      if (!location) throw new SiteRefusedError(serverText("brainServer.site.redirectNoAddress"));
      if (redirects >= maxRedirects) {
        throw new SiteRefusedError(serverText("brainServer.site.tooManyRedirects"));
      }
      const next = new URL(location, current);
      if (!options.allowHost(next.hostname.replace(/^\[|\]$/g, ""))) {
        // Named, so the user can type the new address (an old domain that moved).
        throw new SiteRedirectError(
          serverText("brainServer.site.redirectOther", { host: next.hostname }),
          next.toString(),
        );
      }
      current = next;
      continue;
    }
    if (answer.status < 200 || answer.status >= 300) {
      throw new Error(`status ${answer.status}`);
    }
    const contentType = answer.headers["content-type"];
    return {
      url: current.toString(),
      status: answer.status,
      contentType: Array.isArray(contentType) ? (contentType[0] ?? "") : (contentType ?? ""),
      body: answer.body ?? new Uint8Array(0),
      lastModified: answer.headers["last-modified"] ?? null,
    };
  }
}

/**
 * The shape and address checks of `pinnedFetch` without a request, for a clear refusal before
 * anything else runs (Opret case and screening). The request itself still goes through
 * `pinnedFetch`, which checks again and pins the address.
 */
export async function assertPublicSite(
  rawUrl: string,
  options: Pick<PinnedFetchOptions, "resolve" | "isBlockedAddress" | "allowPort"> = {},
): Promise<void> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SiteRefusedError(serverText("brainServer.site.invalidUrl"));
  }
  const checks: PinnedFetchOptions = { ...options, allowHost: () => true, maxBytes: 0, accept: "" };
  checkShape(url, checks);
  await checkedAddress(url, checks, AbortSignal.timeout(10_000));
}
