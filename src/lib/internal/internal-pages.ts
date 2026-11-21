/**
 * The internal pages (/intern/*: design system, charts, orbs, Velaris, Brain test tools) hold
 * example data and operator tools, so nobody but a developer may see them ("det er ikke noget
 * brugeren skal have adgang til at se"). They exist only in
 * local development (`vite dev`, also the CI runner of staging-live.yml): every Vercel
 * deployment (customers, staging production and staging previews) answers 404, and no
 * environment variable opens them again.
 */
export function internalPagesEnabled(env: Record<string, string | undefined>): boolean {
  if (env["VERCEL"] || env["VERCEL_ENV"]) return false;
  return env["NODE_ENV"] === "development";
}
