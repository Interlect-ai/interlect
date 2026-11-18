/**
 * The User-Agent the server sends to public registers and accounts APIs. Registers ask callers to
 * say who they are, so it names the installation's own address, never a fixed one: an operator
 * sets INTERLECT_USER_AGENT, otherwise Vercel's own production address of the project
 * (VERCEL_PROJECT_PRODUCTION_URL, set by Vercel on every deployment) is used, so every
 * installation identifies itself without any setup.
 */
export const BASE_USER_AGENT = "Interlect/1.0";

export function outboundUserAgent(
  env: Record<string, string | undefined> = typeof process === "undefined" ? {} : process.env,
): string {
  const own = env["INTERLECT_USER_AGENT"]?.trim();
  if (own) return own;
  const host = env["VERCEL_PROJECT_PRODUCTION_URL"]?.trim().replace(/^https?:\/\//, "");
  return host && /^[a-z0-9.-]+$/i.test(host)
    ? `${BASE_USER_AGENT} (+https://${host})`
    : BASE_USER_AGENT;
}
