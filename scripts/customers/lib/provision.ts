/**
 * Pure rules behind customer:new: the customer's input,
 * the steps and their saved progress, the Supabase project's name, region and auth configuration,
 * the database URL, and the Vercel project's settings and environment. No I/O, so it is unit
 * tested.
 */
import { createHash, randomBytes } from "node:crypto";
import { parseDkk } from "./credits.ts";
import type { RegistryEntry } from "./files.ts";
import { CUSTOMER_SLUG } from "./instance.ts";
import { OPERATOR } from "./operator.ts";

/**
 * EU regions only (GDPR, 09: "eget Supabase-projekt (EU)"). London (eu-west-2) and Zurich
 * (eu-central-2) are outside the EU and are left out on purpose.
 */
export const EU_REGIONS = ["eu-central-1", "eu-west-1", "eu-west-3", "eu-north-1"] as const;
export const DEFAULT_REGION = "eu-central-1";
/** Customers get <slug>.interlect.ai (domain bought 8 Oct 2026). */
export const CUSTOMER_DOMAIN = OPERATOR.customerDomain;
/** The fixed rate for EUR installations, the same as the app's DKK_PER_EUR. */
export const DEFAULT_DKK_PER_EUR = 7.46;
/** The app's own invitation lifetime (createInvitation). */
export const INVITATION_DAYS = 7;

/**
 * The steps in order. Every step is safe to run again from scratch, because a run in GitHub
 * Actions starts without the state file of an earlier, stopped run.
 */
export const STEPS = [
  "project",
  "database",
  "settings",
  "auth",
  "fund",
  "vercel",
  "env",
  "domain",
  "credits",
  "deploy",
  "health",
  "invite",
] as const;
export type Step = (typeof STEPS)[number];

/**
 * A test installation has a slug starting with "test-": it may run unreleased migrations
 * from qa-preview, and release.yml leaves it out. A real customer never gets this prefix.
 */
export const TEST_SLUG_PREFIX = "test-";
export const isTestSlug = (slug: string) => slug.startsWith(TEST_SLUG_PREFIX);

/** The repository every customer's Vercel project builds from (09: "samme repo"). */
export const DEFAULT_REPOSITORY = OPERATOR.repository;
/** The Vercel project whose build settings a customer's project copies (staging). */
export const DEFAULT_TEMPLATE_PROJECT = OPERATOR.templateProject;

export type CustomerOptions = {
  slug: string;
  name: string;
  adminEmail: string;
  region: string;
  language: "da" | "en";
  currency: "DKK" | "EUR";
  dkkPerEur: number;
  template: string;
  appUrl: string;
  /** The first, free credits (gift) that open the installation's AI. */
  freeCreditsDkk: number;
};

/** no secrets, only what was done and the ids it made. */
export type CustomerState = {
  options: CustomerOptions;
  supabaseRef?: string;
  /** The commit whose db/migrations were applied. */
  migrationsCommit?: string;
  fundId?: string;
  invitationId?: string;
  vercelProjectId?: string;
  /** The deployment that went live, and the commit it was built from. */
  deploymentId?: string;
  deployedCommit?: string;
  done: Partial<Record<Step, string>>;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Subdomains of interlect.ai that are not customers (the website, the demo, our own services). */
const RESERVED_SLUGS = new Set([
  "www",
  "demo",
  "app",
  "api",
  "admin",
  "staging",
  "status",
  "mail",
  // "one name, Interlect". interlect.ai is the product's own address and "ai" the bare label.
  "ai",
  "interlect",
]);

export function parseOptions(raw: Record<string, string | undefined>): CustomerOptions {
  const slug = (raw["slug"] ?? "").trim();
  if (!CUSTOMER_SLUG.test(slug)) {
    throw new Error(
      `--slug must be 1-40 lowercase letters, digits or dashes (it becomes <slug>.${CUSTOMER_DOMAIN}), got "${slug}"`,
    );
  }
  if (RESERVED_SLUGS.has(slug))
    throw new Error(`--slug "${slug}" is reserved for Interlect itself`);
  const name = (raw["name"] ?? "").trim();
  if (name.length < 2 || name.length > 160) throw new Error("--name must be 2-160 characters");
  const adminEmail = (raw["admin-email"] ?? "").trim().toLowerCase();
  if (!EMAIL.test(adminEmail) || adminEmail.length > 320)
    throw new Error(`--admin-email is not an e-mail address: "${adminEmail}"`);

  const region = raw["region"] ?? DEFAULT_REGION;
  if (!(EU_REGIONS as readonly string[]).includes(region))
    throw new Error(`--region must be an EU region: ${EU_REGIONS.join(", ")}`);
  // New installations, and so their teams, start in English.
  const language = raw["language"] ?? "en";
  if (language !== "da" && language !== "en") throw new Error("--language must be da or en");
  // Danish installations show DKK, all others EUR, unless it is stated ("auto" is
  // the workflow's default and means the same as leaving it out).
  const stated = raw["currency"] && raw["currency"] !== "auto" ? raw["currency"] : null;
  const currency = stated ?? (language === "da" ? "DKK" : "EUR");
  if (currency !== "DKK" && currency !== "EUR") throw new Error("--currency must be DKK or EUR");
  const rateText = (raw["dkk-per-eur"] ?? String(DEFAULT_DKK_PER_EUR)).replace(",", ".");
  const dkkPerEur = Number(rateText);
  if (!Number.isFinite(dkkPerEur) || dkkPerEur <= 0 || dkkPerEur > 100)
    throw new Error("--dkk-per-eur must be above 0 and at most 100");

  const appUrl = (raw["app-url"] ?? `https://${slug}.${CUSTOMER_DOMAIN}`).replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(appUrl);
  } catch {
    throw new Error(`--app-url is not a URL: "${appUrl}"`);
  }
  if (parsed.protocol !== "https:" || parsed.pathname !== "/" || parsed.search || parsed.hash)
    throw new Error("--app-url must be https://<host> without a path");
  const freeCreditsDkk = parseDkk(raw["free-credits-dkk"], "--free-credits-dkk");

  return {
    slug,
    name,
    adminEmail,
    region,
    language,
    currency,
    dkkPerEur: currency === "EUR" ? dkkPerEur : 1,
    template: raw["template"] ?? "venture",
    appUrl: parsed.origin,
    freeCreditsDkk,
  };
}

/**
 * A run that continues an earlier one must be for the same customer. The flags may be left out
 * (the saved ones are used), but a different value is refused, so two installations never mix.
 */
export function continueState(
  saved: CustomerState | null,
  given: Record<string, string | undefined>,
): CustomerState {
  if (!saved) return { options: parseOptions(given), done: {} };
  const merged: Record<string, string | undefined> = {
    slug: saved.options.slug,
    name: saved.options.name,
    "admin-email": saved.options.adminEmail,
    region: saved.options.region,
    language: saved.options.language,
    currency: saved.options.currency,
    "dkk-per-eur": String(saved.options.dkkPerEur),
    template: saved.options.template,
    "app-url": saved.options.appUrl,
    "free-credits-dkk": String(saved.options.freeCreditsDkk),
  };
  const options = parseOptions({
    ...merged,
    ...Object.fromEntries(Object.entries(given).filter(([, value]) => value !== undefined)),
  });
  const changed = (Object.keys(options) as Array<keyof CustomerOptions>).filter((key) =>
    key !== "dkkPerEur"
      ? options[key] !== saved.options[key]
      : options.currency === "EUR" && options.dkkPerEur !== saved.options.dkkPerEur,
  );
  if (changed.length > 0) {
    throw new Error(
      `customers/${saved.options.slug}.state.json was started with other values for ${changed.join(", ")}; ` +
        "leave those flags out to continue, or use another slug",
    );
  }
  return { ...saved, options };
}

/**
 * A slug in the registry is only continued while it is still being created, and only for the
 * same customer: an active or paused installation is never touched by customer:new. A run in
 * GitHub Actions has no state file from an earlier run, so the registry is what it checks.
 */
export function assertContinuable(listed: RegistryEntry | null, options: CustomerOptions) {
  if (!listed) return;
  if (listed.status !== "provisioning") {
    throw new Error(
      `"${listed.slug}" is already a customer (${listed.status}). customer:new only creates; ` +
        "change an existing customer with customer:settings, customer:topup or the pause/delete workflows.",
    );
  }
  const differs = [
    listed.name !== options.name && "name",
    listed.region !== options.region && "region",
    listed.appUrl !== options.appUrl && "app-url",
    listed.language !== undefined && listed.language !== options.language && "language",
    listed.currency !== undefined && listed.currency !== options.currency && "currency",
    listed.freeCreditsDkk !== undefined &&
      listed.freeCreditsDkk !== options.freeCreditsDkk &&
      `free credits (started with ${listed.freeCreditsDkk} kr)`,
  ].filter(Boolean);
  if (differs.length > 0) {
    throw new Error(
      `"${listed.slug}" is being created with another ${differs.join(", ")}; use the same values ` +
        "to continue, or another slug",
    );
  }
}

export function pendingSteps(state: CustomerState): Step[] {
  return STEPS.filter((step) => !state.done[step]);
}

export function projectName(slug: string) {
  return `interlect-${slug}`;
}

/** 32 random bytes; base64url, so it is safe in a URL without escaping. */
export function generateDbPassword() {
  return randomBytes(32).toString("base64url");
}

export type PoolerEntry = {
  database_type?: string;
  db_host: string;
  db_name?: string;
  db_user: string;
  db_port?: number;
};

/**
 * Session mode (port 5432) on the project's pooler with the postgres role: reachable over IPv4
 * (the direct host is IPv6 only) and able to run multi-statement migrations, unlike the
 * transaction mode on 6543. supabaseRefOf() (credits.ts) reads the ref back from this URL.
 */
export function poolerUrl(entry: PoolerEntry, password: string, ref: string) {
  if (!entry.db_host.endsWith(".pooler.supabase.com"))
    throw new Error(`Unexpected pooler host ${entry.db_host}`);
  if (entry.db_user !== `postgres.${ref}`)
    throw new Error(`Unexpected pooler user ${entry.db_user} for project ${ref}`);
  const user = encodeURIComponent(entry.db_user);
  return `postgresql://${user}:${encodeURIComponent(password)}@${entry.db_host}:5432/${entry.db_name ?? "postgres"}`;
}

/**
 * Invite only: nobody can sign up, an admin invites (the app's own invitation link, which creates
 * the account with a password). Password sign-in only; the app sends no auth e-mails (no magic
 * link or reset), so no SMTP is set up in 1.0. TOTP two-step sign-in is on.
 */
export function authConfigFor(appUrl: string) {
  return {
    disable_signup: true,
    external_email_enabled: true,
    external_phone_enabled: false,
    external_anonymous_users_enabled: false,
    site_url: appUrl,
    uri_allow_list: `${appUrl}/**`,
    // The invitation form requires 12 characters (acceptInvitationAsNewUser).
    password_min_length: 12,
    refresh_token_rotation_enabled: true,
    security_update_password_require_reauthentication: true,
    mailer_secure_email_change_enabled: true,
    // Two-step sign-in with an authenticator app: the app sets it up after the first
    // sign-in and asks for a code at every sign-in; the server and database (0094) require it.
    mfa_totp_enroll_enabled: true,
    mfa_totp_verify_enabled: true,
  };
}

/** The settings that did not take, so a run never reports an auth setup that is not there. */
export function authConfigProblems(
  actual: Record<string, unknown>,
  wanted: Record<string, unknown>,
) {
  return Object.entries(wanted)
    .filter(([key, value]) => actual[key] !== value)
    .map(
      ([key, value]) => `${key} is ${JSON.stringify(actual[key])}, not ${JSON.stringify(value)}`,
    );
}

/** The ai_settings flags for customer:settings' own parser (credits enforced from the start). */
export function settingFlags(options: CustomerOptions) {
  return {
    "credits-enforced": "on",
    "default-language": options.language,
    "display-currency": options.currency,
    ...(options.currency === "EUR" ? { "dkk-per-display-unit": String(options.dkkPerEur) } : {}),
  };
}

export function invitationUrl(appUrl: string, token: string) {
  return `${appUrl}/invitation/accept?token=${token}`;
}

/**
 * Vercel's function region next to the customer's database (EU only, as EU_REGIONS), so a
 * customer's data is processed where it is stored.
 */
const VERCEL_REGIONS: Record<(typeof EU_REGIONS)[number], string> = {
  "eu-central-1": "fra1",
  "eu-west-1": "dub1",
  "eu-west-3": "cdg1",
  "eu-north-1": "arn1",
};
export function vercelRegionFor(supabaseRegion: string) {
  const region = VERCEL_REGIONS[supabaseRegion as (typeof EU_REGIONS)[number]];
  if (!region) throw new Error(`No Vercel region for ${supabaseRegion}`);
  return region;
}

/**
 * A customer's project only builds the commit that release.yml (or customer:new) chose, never a
 * push: Vercel's "Ignored Build Step" builds (exit 1) only when the commit is the one in
 * INTERLECT_RELEASE_SHA, a production variable set right before the deployment is created. So a
 * merge to main never reaches a customer before their database is migrated (09), and branches
 * never make preview deployments with the customer's settings.
 */
export const RELEASE_SHA_VARIABLE = "INTERLECT_RELEASE_SHA";
export const IGNORE_BUILD_COMMAND = `[ "$VERCEL_GIT_COMMIT_SHA" = "$${RELEASE_SHA_VARIABLE}" ] && exit 1 || exit 0`;

export type EnvVariable = { key: string; value: string; type: "encrypted" | "sensitive" };

/** Shared keys copied from the workflow's own secrets when they are set (none is required). */
export const PASSTHROUGH_SECRETS = [
  "DATAFORDELER_API_KEY",
  "BOLAGSVERKET_CLIENT_ID",
  "BOLAGSVERKET_CLIENT_SECRET",
] as const;
export const PASSTHROUGH_SETTINGS = ["AI_SUPPORT_EMAIL", "AI_TOPUP_URL"] as const;

/**
 * The registers that need a key. Without it the installation still screens, but without
 * that country's company data and accounts, so a run says so plainly instead of skipping it.
 */
export const REGISTRY_SECRETS = [
  {
    country: "DK",
    keys: ["DATAFORDELER_API_KEY"],
    what: "Danish company register and accounts (CVR via Datafordeler)",
  },
  {
    country: "SE",
    keys: ["BOLAGSVERKET_CLIENT_ID", "BOLAGSVERKET_CLIENT_SECRET"],
    what: "Swedish company register and accounts (Bolagsverket)",
  },
] as const;

export type MissingRegistry = (typeof REGISTRY_SECRETS)[number];

export function missingRegistrySecrets(env: Record<string, string | undefined>): MissingRegistry[] {
  return REGISTRY_SECRETS.filter((registry) => registry.keys.some((key) => !env[key]?.trim()));
}

/**
 * A Danish customer (kroner) without the Danish key is stopped: its cases are Danish companies,
 * and screening without CVR would look fine while it misses the register and the accounts. A test
 * installation (test-…) only gets the warning.
 */
export function registryStop(
  options: Pick<CustomerOptions, "currency" | "slug">,
  missing: readonly MissingRegistry[],
): string | null {
  if (options.currency !== "DKK" || isTestSlug(options.slug)) return null;
  if (!missing.some((registry) => registry.country === "DK")) return null;
  return "DATAFORDELER_API_KEY is not set, so a Danish customer would screen without the Danish register and accounts. Add it as a GitHub secret (Settings → Secrets and variables → Actions) and run again.";
}

export function registryWarnings(missing: readonly MissingRegistry[]): string[] {
  return missing.map(
    (registry) =>
      `No ${registry.keys.join(" / ")}: the installation has no ${registry.what}. Add it as a GitHub secret for the next customers, and for this installation in its Vercel project (Production) followed by a redeploy.`,
  );
}

/**
 * The installation's production environment. Never AI_GATEWAY_API_KEY: the app falls back to the
 * project's own OIDC token, which is what the project budget counts, so each customer's
 * AI use is its own without a key to keep. Never MAINTENANCE_MODE (that is staging's switch).
 */
export function productionEnv(input: {
  supabaseRef: string;
  publishableKey: string;
  secretKey: string;
  cronSecret: string;
  env: Record<string, string | undefined>;
}): EnvVariable[] {
  const variables: EnvVariable[] = [
    {
      key: "PAP_SUPABASE_URL",
      value: `https://${input.supabaseRef}.supabase.co`,
      type: "encrypted",
    },
    { key: "PAP_SUPABASE_PUBLISHABLE_KEY", value: input.publishableKey, type: "encrypted" },
    { key: "PAP_SUPABASE_SERVICE_ROLE_KEY", value: input.secretKey, type: "sensitive" },
    { key: "CRON_SECRET", value: input.cronSecret, type: "sensitive" },
    // D4/: confidential calls only with ZDR; EU inference where the model has it.
    { key: "AI_GATEWAY_ENFORCE_ZDR", value: "true", type: "encrypted" },
    { key: "AI_GATEWAY_ENFORCE_EU_REGION", value: "true", type: "encrypted" },
    { key: "AI_FUND_MEMORY_ENABLED", value: "true", type: "encrypted" },
    { key: "BRAIN_ENABLED", value: "true", type: "encrypted" },
  ];
  for (const key of PASSTHROUGH_SECRETS) {
    const value = input.env[key]?.trim();
    if (value) variables.push({ key, value, type: "sensitive" });
  }
  for (const key of PASSTHROUGH_SETTINGS) {
    const value = input.env[key]?.trim();
    if (value) variables.push({ key, value, type: "encrypted" });
  }
  for (const variable of variables) {
    if (!variable.value) throw new Error(`${variable.key} would be empty`);
  }
  return variables;
}

/** A random secret for Vercel Cron's Authorization header. */
export function generateCronSecret() {
  return randomBytes(32).toString("base64url");
}

/**
 * The ref of the first, free credits: the same for every run of the same customer, so a run that
 * stopped after the credit was added never adds it twice (the ledger's unique ref, 0070).
 */
export function initialCreditRef(slug: string) {
  const hex = createHash("sha256")
    .update(`interlect:customer:new:free-credits:${slug}`)
    .digest("hex");
  // UUID layout with version 5 and the RFC 4122 variant, so it passes uuid checks.
  const variant = ((parseInt(hex.slice(16, 17), 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function healthUrl(appUrl: string) {
  return `${appUrl}/api/health`;
}

/** The host Vercel serves the customer on (<slug>.interlect.ai unless --app-url was given). */
export function appHost(appUrl: string) {
  return new URL(appUrl).host;
}
