/**
 * The internal pages (/intern/*: design system, charts, orbs, prompts, Brain test tools) hold
 * example data and operator tools, so a customer must never see them (an admin in a customer
 * installation could open them). Every customer runs Vercel production, so
 * they are closed there. Staging's previews and local development keep them; staging's own
 * production can open them with INTERLECT_INTERNAL_PAGES=on, which customer:new never sets.
 */
export function internalPagesEnabled(env: Record<string, string | undefined>): boolean {
  if (env["INTERLECT_INTERNAL_PAGES"] === "on") return true;
  return env["VERCEL_ENV"] !== "production";
}
