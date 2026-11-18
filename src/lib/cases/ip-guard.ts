/**
 * Non-public address ranges for the SSRF guard. Pure, so it is unit tested. Alone it does not
 * know IPv4 written as IPv6 in hex form, NAT64 or 6to4: requests use `isNotPublicAddress`
 * (brain/ingest/site-fetch.server.ts), which adds those.
 * Covers loopback, private (RFC 1918), link-local, carrier-grade NAT (100.64.0.0/10),
 * benchmarking (198.18.0.0/15), IETF protocol assignments (192.0.0.0/24), multicast/reserved
 * (224+), and the IPv6 equivalents (loopback, unspecified, ULA fc00::/7, link-local fe80::/10),
 * also when an IPv4 address is written as an IPv4-mapped IPv6 address.
 */
export function isPrivateAddress(address: string): boolean {
  const value = address.toLowerCase();
  if (value === "::1" || value === "::" || /^f[cd]/.test(value) || /^fe[89ab]/.test(value)) {
    return true;
  }
  const ipv4 = value.startsWith("::ffff:") ? value.slice(7) : value;
  const parts = ipv4.split(".").map(Number);
  if (parts.length !== 4 || parts.some(Number.isNaN)) return false;
  const [a = 0, b = 0, c = 0] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}
