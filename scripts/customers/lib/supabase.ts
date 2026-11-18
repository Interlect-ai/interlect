/**
 * The Supabase Management API calls behind customer:new: the
 * customer's own project in the EU, its health, its session pooler and its auth configuration.
 * Checked against the API's OpenAPI document (api.supabase.com/api/v1-json, 8 Oct 2026).
 *
 * Authentication: SUPABASE_ACCESS_TOKEN, a personal access token for the product owner's Supabase
 * organisation (supabase.com/dashboard/account/tokens). These scripts never write it to disk.
 */
import { generateDbPassword, poolerUrl, type PoolerEntry } from "./provision.ts";

export type SupabaseRequest = (
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
) => Promise<unknown>;

type Fetch = (url: URL, init: RequestInit) => Promise<Response>;

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

export function supabaseTransport(
  env: Record<string, string | undefined>,
  fetchImpl: Fetch = fetch,
  wait: (ms: number) => Promise<void> = sleep,
): SupabaseRequest {
  const token = env["SUPABASE_ACCESS_TOKEN"];
  if (!token) {
    throw new Error(
      "SUPABASE_ACCESS_TOKEN is not set: create a personal access token at supabase.com/dashboard/account/tokens",
    );
  }
  return async (method, path, body) => {
    const url = new URL(path, "https://api.supabase.com");
    // The Management API allows 120 calls a minute; a 429 is retried after a pause, twice.
    for (let attempt = 1; ; attempt += 1) {
      const response = await fetchImpl(url, {
        method,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const text = await response.text();
      if (response.status === 429 && attempt < 3) {
        await wait(attempt * 10_000);
        continue;
      }
      if (!response.ok) {
        throw new Error(
          `Supabase ${method} ${url.pathname} failed (${response.status}): ${text.slice(0, 300)}`,
        );
      }
      return text ? JSON.parse(text) : null;
    }
  };
}

/**
 * The handover scripts work in the CUSTOMER's organisation, which Interlect's own token (scoped to
 * Interlect's organisation) cannot see: HANDOVER_SUPABASE_TOKEN, a token from the product owner's
 * account
 * that sees every organisation he is a member of, wins when it is set.
 */
export function handoverSupabaseEnv(env: Record<string, string | undefined>) {
  const token = env["HANDOVER_SUPABASE_TOKEN"];
  return token ? { ...env, SUPABASE_ACCESS_TOKEN: token } : env;
}

export type SupabaseProject = {
  ref: string;
  name: string;
  region: string;
  status: string;
  organization_slug?: string;
};

/** The organisation the projects go in: SUPABASE_ORG_SLUG, or the token's only organisation. */
export async function organizationSlug(
  api: SupabaseRequest,
  env: Record<string, string | undefined>,
) {
  const wanted = env["SUPABASE_ORG_SLUG"];
  const orgs = (await api("GET", "/v1/organizations")) as Array<{ id: string; slug?: string }>;
  const slugs = orgs.map((org) => org.slug ?? org.id);
  if (wanted) {
    if (!slugs.includes(wanted))
      throw new Error(`The token cannot see Supabase organisation ${wanted}`);
    return wanted;
  }
  if (slugs.length !== 1) {
    throw new Error(
      `The token sees ${slugs.length} Supabase organisations; set SUPABASE_ORG_SLUG to one of: ${slugs.join(", ")}`,
    );
  }
  return slugs[0]!;
}

export async function findProjectByName(api: SupabaseRequest, orgSlug: string, name: string) {
  const projects = (await api("GET", "/v1/projects")) as SupabaseProject[];
  const matches = projects.filter(
    (project) =>
      project.name === name &&
      (project.organization_slug === undefined || project.organization_slug === orgSlug),
  );
  if (matches.length > 1) throw new Error(`Supabase has ${matches.length} projects named ${name}`);
  return matches[0] ?? null;
}

export async function createProject(
  api: SupabaseRequest,
  input: { orgSlug: string; name: string; region: string; dbPass: string },
) {
  const project = (await api("POST", "/v1/projects", {
    name: input.name,
    organization_slug: input.orgSlug,
    db_pass: input.dbPass,
    region_selection: { type: "specific", code: input.region },
  })) as SupabaseProject | null;
  if (!project?.ref) throw new Error("Supabase did not return the new project's ref");
  return project;
}

export async function getProject(api: SupabaseRequest, ref: string) {
  return (await api("GET", `/v1/projects/${ref}`)) as SupabaseProject;
}

const FAILED = new Set(["INIT_FAILED", "REMOVED", "RESTORE_FAILED", "PAUSE_FAILED", "INACTIVE"]);
export const SERVICES = ["db", "pooler", "auth", "rest", "storage"] as const;

/**
 * Waits until the project is ACTIVE_HEALTHY and every service it needs reports healthy (Supabase
 * recommends this before configuring auth). A failed project stops at once instead of waiting.
 */
export async function waitUntilHealthy(
  api: SupabaseRequest,
  ref: string,
  options: {
    timeoutMs?: number;
    intervalMs?: number;
    wait?: (ms: number) => Promise<void>;
    now?: () => number;
    onWait?: (what: string) => void;
  } = {},
) {
  const {
    timeoutMs = 15 * 60_000,
    intervalMs = 10_000,
    wait = sleep,
    now = Date.now,
    onWait = () => {},
  } = options;
  const deadline = now() + timeoutMs;
  let last = "";
  for (;;) {
    const project = await getProject(api, ref);
    if (FAILED.has(project.status)) {
      throw new Error(`Supabase project ${ref} is ${project.status}; it will not become healthy`);
    }
    if (project.status === "ACTIVE_HEALTHY") {
      const health = (await api(
        "GET",
        `/v1/projects/${ref}/health?services=${SERVICES.join(",")}`,
      )) as Array<{ name: string; healthy: boolean; status: string }>;
      const waiting = SERVICES.filter(
        (service) => !health.some((entry) => entry.name === service && entry.healthy),
      );
      if (waiting.length === 0) return project;
      last = `waiting for ${waiting.join(", ")}`;
    } else {
      last = `project is ${project.status}`;
    }
    if (now() >= deadline) {
      throw new Error(
        `Supabase project ${ref} was not healthy after ${Math.round(timeoutMs / 60_000)} minutes (${last}); run again to keep waiting`,
      );
    }
    onWait(last);
    await wait(intervalMs);
  }
}

/** The session-mode pooler URL with the postgres role, as the migrations workflow uses. */
export async function sessionPoolerUrl(api: SupabaseRequest, ref: string, dbPass: string) {
  const entries = (await api("GET", `/v1/projects/${ref}/config/database/pooler`)) as PoolerEntry[];
  const primary = entries.find((entry) => entry.database_type === "PRIMARY") ?? entries[0];
  if (!primary) throw new Error(`Supabase project ${ref} has no pooler configuration`);
  return poolerUrl(primary, dbPass, ref);
}

/**
 * A database URL for this run only (the keys live only in GitHub's secrets). The postgres role gets
 * a new random password, used for this run and never written
 * anywhere, so no workflow or folder ever holds a customer's database password. The app itself
 * never uses this password (it signs in with the project's API keys), so changing it on every
 * run disturbs nothing; the customer workflows run one at a time (concurrency group customers).
 */
export async function freshDatabaseUrl(api: SupabaseRequest, ref: string) {
  const password = generateDbPassword();
  await api("PATCH", `/v1/projects/${ref}/database/password`, { password });
  return sessionPoolerUrl(api, ref, password);
}

export async function getAuthConfig(api: SupabaseRequest, ref: string) {
  return (await api("GET", `/v1/projects/${ref}/config/auth`)) as Record<string, unknown>;
}

export async function setAuthConfig(
  api: SupabaseRequest,
  ref: string,
  config: Record<string, unknown>,
) {
  await api("PATCH", `/v1/projects/${ref}/config/auth`, config);
  return getAuthConfig(api, ref);
}

/**
 * Sets the auth configuration and reads it back until every wanted value is there. A project
 * that was made minutes ago can answer a PATCH and still read back its defaults for a while
 * (seen 17 Oct 2026), so it is set again every 15 s for up to two minutes. Returns what still
 * differs (empty when it took).
 */
export async function setAuthConfigUntilTaken(
  api: SupabaseRequest,
  ref: string,
  wanted: Record<string, unknown>,
  problemsOf: (actual: Record<string, unknown>) => string[],
  options: { timeoutMs?: number; wait?: (ms: number) => Promise<void>; now?: () => number } = {},
) {
  const { timeoutMs = 2 * 60_000, wait = sleep, now = Date.now } = options;
  const deadline = now() + timeoutMs;
  for (;;) {
    const problems = problemsOf(await setAuthConfig(api, ref, wanted));
    if (problems.length === 0 || now() >= deadline) return problems;
    await wait(15_000);
  }
}

/** The project's API keys (never printed): the publishable/anon key and the secret/service key. */
export async function projectApiKeys(api: SupabaseRequest, ref: string) {
  const keys = (await api("GET", `/v1/projects/${ref}/api-keys?reveal=true`)) as Array<{
    name?: string;
    type?: string;
    api_key?: string;
  }>;
  const find = (types: string[], names: string[]) =>
    keys.find((key) => types.includes(key.type ?? "") && key.api_key)?.api_key ??
    keys.find((key) => names.includes(key.name ?? "") && key.api_key)?.api_key ??
    null;
  return {
    publishable: find(["publishable"], ["anon"]),
    secret: find(["secret"], ["service_role"]),
  };
}

export async function deleteProject(api: SupabaseRequest, ref: string) {
  await api("DELETE", `/v1/projects/${ref}`);
}
