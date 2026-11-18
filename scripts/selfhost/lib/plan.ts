/**
 * Pure rules behind `npm run setup` (a self-hosted installation on the operator's OWN Supabase
 * and Vercel accounts): the answers, the steps and their saved progress, the names, the Vercel
 * project's settings, the production variables and which files are deployed. No I/O, so it is
 * unit tested. Nothing here names the vendor: no team id, repository, domain or address.
 */
import { isExcludedFromCodeExport } from "../../customers/lib/code-excludes.ts";
import { EU_REGIONS, productionEnv, type EnvVariable } from "../../customers/lib/provision.ts";

export const STEPS = [
  "supabase-project",
  "database",
  "settings",
  "fund",
  "vercel-project",
  "env",
  "deploy",
  "auth",
  "health",
  "admin",
] as const;
export type Step = (typeof STEPS)[number];

export type SetupAnswers = {
  fundName: string;
  adminEmail: string;
  language: "da" | "en";
  region: (typeof EU_REGIONS)[number];
};

/** .selfhost/state.json: no secrets (no token, key or password), only answers, ids and progress. */
export type SetupState = {
  version: 1;
  answers?: SetupAnswers;
  supabaseOrg?: string;
  /** Set right before the project is created, so a run that crashed mid-create may adopt it. */
  supabaseCreating?: string;
  supabaseRef?: string;
  /** null: the token's personal account; a string: a Vercel team. */
  vercelTeamId?: string | null;
  vercelCreating?: string;
  vercelProjectId?: string;
  fundId?: string;
  appUrl?: string;
  done: Partial<Record<Step, string>>;
};

export const EMPTY_STATE: SetupState = { version: 1, done: {} };

export const TOKEN_LINKS = {
  supabase: "https://supabase.com/dashboard/account/tokens",
  vercel: "https://vercel.com/account/tokens",
} as const;

/** Answers can also come from the environment, for a run without a terminal. */
export const ANSWER_ENV = {
  fundName: "SETUP_FUND_NAME",
  adminEmail: "SETUP_ADMIN_EMAIL",
  language: "SETUP_LANGUAGE",
  region: "SETUP_REGION",
} as const;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseAnswers(raw: {
  fundName?: string;
  adminEmail?: string;
  language?: string;
  region?: string;
}): SetupAnswers {
  const fundName = (raw.fundName ?? "").trim();
  if (fundName.length < 2 || fundName.length > 160)
    throw new Error("The fund's name must be 2-160 characters");
  const adminEmail = (raw.adminEmail ?? "").trim().toLowerCase();
  if (!EMAIL.test(adminEmail) || adminEmail.length > 320)
    throw new Error(`"${adminEmail}" is not an e-mail address`);
  const language = (raw.language ?? "en").trim().toLowerCase();
  if (language !== "da" && language !== "en") throw new Error("The language must be da or en");
  const region = (raw.region ?? "eu-central-1").trim();
  if (!(EU_REGIONS as readonly string[]).includes(region))
    throw new Error(`The region must be one of ${EU_REGIONS.join(", ")} (EU only)`);
  return { fundName, adminEmail, language, region: region as SetupAnswers["region"] };
}

/**
 * Which answers may still change. The fund's name and the region are fixed once the Supabase
 * project exists (its name and place come from them); the language once the settings are
 * written. The admin's e-mail may always be corrected (a new invitation closes the old one).
 */
export function fixedAnswers(state: SetupState): Array<keyof SetupAnswers> {
  const fixed: Array<keyof SetupAnswers> = [];
  if (state.supabaseRef || state.supabaseCreating) fixed.push("fundName", "region");
  if (state.done.settings) fixed.push("language");
  return fixed;
}

export function assertFixedAnswers(state: SetupState, given: SetupAnswers) {
  const saved = state.answers;
  if (!saved) return;
  const changed = fixedAnswers(state).filter((key) => saved[key] !== given[key]);
  if (changed.length > 0) {
    throw new Error(
      `${changed.join(" and ")} cannot change any more: the installation was already created with ` +
        `${changed.map((key) => `"${saved[key]}"`).join(" and ")}.`,
    );
  }
}

/** A URL- and project-safe slug from the fund's name ("Århus Ø-Fond I" → "aarhus-oe-fond-i"). */
export function slugOf(name: string) {
  const slug = name
    .replace(/æ/gi, "ae")
    .replace(/ø/gi, "oe")
    .replace(/å/gi, "aa")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return slug || "fund";
}

/** The Supabase and Vercel project name; the same on every run, so a rerun finds them. */
export function projectNameFor(answers: SetupAnswers) {
  return `interlect-${slugOf(answers.fundName)}`.slice(0, 52).replace(/-+$/g, "");
}

export function pendingSteps(state: SetupState): Step[] {
  return STEPS.filter((step) => !state.done[step]);
}

/**
 * A project found by name is only used when this setup created it (the saved id, or the name it
 * was creating when a run stopped). Anything else with the same name belongs to someone else.
 */
export function mayAdopt(
  found: { id: string } | null,
  saved: { id?: string | undefined; creating?: string | undefined },
  name: string,
) {
  if (!found) return true;
  return found.id === saved.id || saved.creating === name;
}

/** The ai_settings flags (customer:settings' parser): language and currency, credits OFF. */
export function settingFlagsFor(answers: SetupAnswers) {
  return {
    "credits-enforced": "off",
    "default-language": answers.language,
    "display-currency": answers.language === "da" ? "DKK" : "EUR",
    ...(answers.language === "da" ? {} : { "dkk-per-display-unit": "7.46" }),
  };
}

/**
 * Vercel's framework preset for the build. TanStack Start with Nitro's Vercel preset writes the
 * Build Output API folder itself; SELFHOST_VERCEL_FRAMEWORK overrides it if Vercel renames it.
 */
export function vercelBuildSettings(env: Record<string, string | undefined>) {
  return {
    framework: env["SELFHOST_VERCEL_FRAMEWORK"]?.trim() || "tanstack-start",
    nodeVersion: "24.x",
  };
}

/**
 * Standard Protection (available on every plan): Vercel's login in front of previews and the
 * generated deployment URLs, but not in front of the production domains, so the app's own
 * <project>.vercel.app address is public and protected by the app's sign-in.
 */
export const SELFHOST_PROTECTION = "prod_deployment_urls_and_all_previews";

export function vercelProjectPatch(functionRegion: string) {
  return {
    resourceConfig: { functionDefaultRegions: [functionRegion] },
    // The AI Gateway identity: the app calls models with the project's OIDC token, no API key.
    oidcTokenConfig: { enabled: true, issuerMode: "team" },
    ssoProtection: { deploymentType: SELFHOST_PROTECTION },
  };
}

/**
 * The installation's production variables: exactly a customer installation's (productionEnv:
 * the project's own Supabase keys, CRON_SECRET, ZDR and EU inference, Brain on, the optional
 * register keys and top-up settings; never AI_GATEWAY_API_KEY or MAINTENANCE_MODE), plus the
 * self-host switches: credits and internal pages off, and the operator's own User-Agent if set.
 */
export function selfhostEnv(input: Parameters<typeof productionEnv>[0]): EnvVariable[] {
  const variables: EnvVariable[] = [
    ...productionEnv(input),
    { key: "INTERLECT_CREDITS", value: "off", type: "encrypted" },
    { key: "INTERLECT_INTERNAL_PAGES", value: "off", type: "encrypted" },
  ];
  const userAgent = input.env["INTERLECT_USER_AGENT"]?.trim();
  if (userAgent)
    variables.push({ key: "INTERLECT_USER_AGENT", value: userAgent, type: "encrypted" });
  return variables;
}

/**
 * Folders that are not part of the app (the vendor's notes, the website, the video, design
 * handoff, tests) are not uploaded: smaller deployment, nothing private. Secrets never are.
 */
const NOT_DEPLOYED = [
  "video",
  "website",
  "design-handoff",
  "docs",
  "tests",
  "customers",
  ".github",
  ".selfhost",
] as const;

export function isDeployed(path: string) {
  const normal = path.replace(/^\.\//, "");
  if (isExcludedFromCodeExport(normal)) return false;
  return !NOT_DEPLOYED.some((dir) => normal === dir || normal.startsWith(`${dir}/`));
}

/** The installation's own address: the shortest <name>.vercel.app production host. */
export function pickProductionHost(hosts: string[]) {
  const own = hosts.filter((host) => host.endsWith(".vercel.app"));
  own.sort((a, b) => a.length - b.length || a.localeCompare(b));
  return own[0] ?? null;
}

/** True when an API error means the token itself was refused (not a network or server error). */
export function isTokenRefused(cause: unknown) {
  return /\((401|403)\)/.test(cause instanceof Error ? cause.message : String(cause));
}

/** The lines of a local .env.local for `npm run dev` and the seed (never committed: *.local). */
export function envLocalText(input: {
  supabaseRef: string;
  publishableKey: string;
  secretKey: string;
}) {
  const url = `https://${input.supabaseRef}.supabase.co`;
  return [
    "# Written by npm run setup. Never commit this file (*.local is in .gitignore).",
    `SUPABASE_URL=${url}`,
    `SUPABASE_PUBLISHABLE_KEY=${input.publishableKey}`,
    `SUPABASE_SERVICE_ROLE_KEY=${input.secretKey}`,
    `PAP_SUPABASE_URL=${url}`,
    `PAP_SUPABASE_PUBLISHABLE_KEY=${input.publishableKey}`,
    `PAP_SUPABASE_SERVICE_ROLE_KEY=${input.secretKey}`,
    "INTERLECT_CREDITS=off",
    "INTERLECT_INTERNAL_PAGES=off",
    "",
  ].join("\n");
}
