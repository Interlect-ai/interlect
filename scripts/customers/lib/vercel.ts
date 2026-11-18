/**
 * The Vercel REST calls behind a customer's installation: the AI Gateway project budget (PUT
 * /ai-gateway/budgets, checked against Vercel's API reference 8 Oct 2026), the project's
 * environment variable names (never their values), and the project itself, its production
 * variables, domain and deployments (checked against Vercel's API reference 11 Oct 2026).
 *
 * Authentication: VERCEL_TOKEN (+ VERCEL_TEAM_ID) when set, as in CI and the cloud; otherwise the
 * logged-in Vercel CLI (`vercel api`), so the scripts run on the product owner's Mac without a
 * token on disk.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { OPERATOR } from "./operator.ts";

export type VercelRequest = (
  method: "GET" | "PUT" | "DELETE" | "POST" | "PATCH",
  path: string,
  body?: unknown,
) => Promise<unknown>;

export type GatewayBudget = {
  scopeType: string;
  scopeId: string;
  limitAmount: number;
  currentSpend: number;
  refreshPeriod: string;
  archived?: boolean;
  /** "default" when the project only inherits the team's default budget. */
  source?: string;
};

type Fetch = (url: URL, init: RequestInit) => Promise<Response>;

export function vercelTransport(
  env: Record<string, string | undefined>,
  fetchImpl: Fetch = fetch,
): VercelRequest {
  const token = env["VERCEL_TOKEN"];
  const teamId = env["VERCEL_TEAM_ID"];
  if (token) {
    return async (method, path, body) => {
      const url = new URL(path, "https://api.vercel.com");
      if (teamId) url.searchParams.set("teamId", teamId);
      const response = await fetchImpl(url, {
        method,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const text = await response.text();
      if (!response.ok)
        throw new Error(
          `Vercel ${method} ${url.pathname} failed (${response.status}): ${text.slice(0, 300)}`,
        );
      return text ? JSON.parse(text) : null;
    };
  }
  return (method, path, body) =>
    new Promise((resolve, reject) => {
      const args = [
        "--no-install",
        "vercel",
        "api",
        path,
        "-X",
        method,
        "--raw",
        "--non-interactive",
      ];
      if (teamId) args.push("--scope", teamId);
      if (body !== undefined) args.push("--input", "-");
      if (method === "DELETE") args.push("--dangerously-skip-permissions");
      const child = execFile(
        "npx",
        args,
        { maxBuffer: 10 * 1024 * 1024 },
        (error, stdout, stderr) => {
          if (error) {
            const detail =
              `${stderr}`
                .split("\n")
                .filter((line) => /error/i.test(line))
                .join(" ") || error.message;
            reject(
              new Error(`Vercel ${method} ${path.split("?")[0]} failed: ${detail.slice(0, 300)}`),
            );
            return;
          }
          try {
            resolve(stdout.trim() ? JSON.parse(stdout) : null);
          } catch {
            reject(
              new Error(
                `Vercel ${method} ${path.split("?")[0]} answered with something that is not JSON`,
              ),
            );
          }
        },
      );
      child.stdin?.end(body === undefined ? undefined : JSON.stringify(body));
    });
}

/**
 * Interlect's own Vercel team (where staging and every customer's project live). Not a secret.
 * A token made for one team, as the workflows' VERCEL_TOKEN is, cannot list teams (403), so the
 * team is not looked up: VERCEL_TEAM_ID (a repository variable) wins, otherwise this one.
 */
export const DEFAULT_VERCEL_TEAM_ID = OPERATOR.vercelTeamId;

export async function withVercelTeam(
  env: Record<string, string | undefined>,
): Promise<Record<string, string | undefined>> {
  if (!env["VERCEL_TOKEN"] || env["VERCEL_TEAM_ID"]) return env;
  return { ...env, VERCEL_TEAM_ID: DEFAULT_VERCEL_TEAM_ID };
}

function isBudget(value: unknown): value is GatewayBudget {
  const budget = value as Partial<GatewayBudget> | null;
  return (
    typeof budget?.scopeId === "string" &&
    typeof budget.limitAmount === "number" &&
    typeof budget.currentSpend === "number" &&
    typeof budget.refreshPeriod === "string"
  );
}

/** The project's own budget; null when it has none (an inherited default does not count). */
export async function getProjectBudget(request: VercelRequest, projectId: string) {
  const answer = (await request("GET", "/ai-gateway/budgets/list?scopeType=project")) as {
    budgets?: unknown;
  };
  if (!Array.isArray(answer?.budgets)) throw new Error("Vercel listed no budgets array");
  const own = answer.budgets.find(
    (budget) =>
      isBudget(budget) &&
      budget.scopeId === projectId &&
      !budget.archived &&
      budget.source !== "default",
  );
  return (own as GatewayBudget | undefined) ?? null;
}

/**
 * Creates or changes the project's cumulative budget. Changing it keeps the spend Vercel has
 * already metered. Vercel emails the team owner at 75 % and 100 %, so a customer running low is
 * visible before the net stops anything.
 */
export async function setProjectBudget(
  request: VercelRequest,
  projectId: string,
  limitUsd: number,
) {
  const budget = await request("PUT", "/ai-gateway/budgets", {
    scopeType: "project",
    projectId,
    limitAmount: limitUsd,
    refreshPeriod: "none",
    alertThresholds: [75, 100],
  });
  if (!isBudget(budget) || budget.scopeId !== projectId) {
    throw new Error("Vercel did not confirm the project budget");
  }
  return budget;
}

/**
 * A project budget only counts calls made with the project's OIDC token; a call with an AI
 * Gateway API key is never attributed to a project. Returns the deployment targets where
 * AI_GATEWAY_API_KEY is set, which would let the installation spend past its budget. It never
 * decides on a partial list: hidden production variables or a further page are errors.
 */
export async function gatewayKeyTargets(request: VercelRequest, projectId: string) {
  const answer = (await request("GET", `/v10/projects/${encodeURIComponent(projectId)}/env`)) as {
    envs?: Array<{ key?: unknown; target?: unknown }>;
    hiddenProductionEnvCount?: unknown;
    pagination?: { next?: unknown };
  };
  if (!Array.isArray(answer?.envs)) throw new Error("Vercel listed no environment variables array");
  if (typeof answer.hiddenProductionEnvCount === "number" && answer.hiddenProductionEnvCount > 0) {
    throw new Error(
      "Vercel hides this project's production variables from this login, so AI_GATEWAY_API_KEY " +
        "cannot be ruled out; use a team owner's token or CLI login",
    );
  }
  if (answer.pagination?.next)
    throw new Error("Vercel listed only part of the project's variables");
  return answer.envs
    .filter((variable) => variable.key === "AI_GATEWAY_API_KEY")
    .flatMap((variable) => {
      if (typeof variable.target === "string") return [variable.target];
      return Array.isArray(variable.target) ? variable.target.map(String) : [];
    });
}

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/** True when a Vercel call failed because the thing does not exist. */
export function isNotFound(cause: unknown) {
  return /\(404\)|not[ _]found/i.test(cause instanceof Error ? cause.message : String(cause));
}

export type VercelProject = {
  id: string;
  name: string;
  framework?: string | null;
  buildCommand?: string | null;
  installCommand?: string | null;
  outputDirectory?: string | null;
  rootDirectory?: string | null;
  devCommand?: string | null;
  nodeVersion?: string;
  commandForIgnoringBuildStep?: string | null;
  serverlessFunctionRegion?: string | null;
  resourceConfig?: { functionDefaultRegions?: string[] };
  ssoProtection?: { deploymentType?: string } | null;
  link?: { type?: string; repo?: string; org?: string; repoId?: number; productionBranch?: string };
  oidcTokenConfig?: { enabled?: boolean; issuerMode?: string };
};

export async function findProject(request: VercelRequest, idOrName: string) {
  try {
    return (await request("GET", `/v9/projects/${encodeURIComponent(idOrName)}`)) as VercelProject;
  } catch (cause) {
    if (isNotFound(cause)) return null;
    throw cause;
  }
}

/** The build settings a customer's project copies from staging, so it builds exactly the same. */
export const COPIED_SETTINGS = [
  "framework",
  "buildCommand",
  "installCommand",
  "outputDirectory",
  "rootDirectory",
  "nodeVersion",
] as const;

export function buildSettingsOf(project: VercelProject) {
  return Object.fromEntries(
    COPIED_SETTINGS.filter((key) => project[key] !== undefined).map((key) => [key, project[key]]),
  ) as Pick<VercelProject, (typeof COPIED_SETTINGS)[number]>;
}

/**
 * Creates the customer's project from the repository, with the template's build settings, the
 * function region next to the database, the OIDC token on (the AI Gateway identity, a), the
 * release-only build step, and Vercel's login in front of everything but the custom domain.
 * nodeVersion is set afterwards (the create call does not take it).
 */
export async function createProject(
  request: VercelRequest,
  input: {
    name: string;
    repository: string;
    settings: ReturnType<typeof buildSettingsOf>;
    functionRegion: string;
    ignoreBuildCommand: string;
  },
) {
  const { nodeVersion, ...settings } = input.settings;
  const project = (await request("POST", "/v11/projects", {
    name: input.name,
    ...settings,
    gitRepository: { type: "github", repo: input.repository },
    ...protectedSettings(input),
  })) as VercelProject | null;
  if (!project?.id?.startsWith("prj_")) throw new Error("Vercel did not return the new project");
  if (nodeVersion) return updateProject(request, project.id, { nodeVersion });
  return project;
}

/**
 * The settings that keep a customer's installation safe; set at creation and again when a run
 * finds them changed, and always read back (projectProblems).
 */
export const LOGIN_EXCEPT_CUSTOM_DOMAINS = "all_except_custom_domains";
export function protectedSettings(input: { functionRegion: string; ignoreBuildCommand: string }) {
  return {
    commandForIgnoringBuildStep: input.ignoreBuildCommand,
    // Only the current setting: Vercel refuses it together with serverlessFunctionRegion (400).
    resourceConfig: { functionDefaultRegions: [input.functionRegion] },
    oidcTokenConfig: { enabled: true, issuerMode: "team" },
    ssoProtection: { deploymentType: LOGIN_EXCEPT_CUSTOM_DOMAINS },
  };
}

/** Where the project's functions run: the default regions, or the older single setting. */
export function functionRegionsOf(project: VercelProject) {
  const regions = project.resourceConfig?.functionDefaultRegions;
  if (regions && regions.length > 0) return regions;
  return project.serverlessFunctionRegion ? [project.serverlessFunctionRegion] : [];
}

export async function updateProject(
  request: VercelRequest,
  projectId: string,
  patch: Record<string, unknown>,
) {
  return (await request(
    "PATCH",
    `/v9/projects/${encodeURIComponent(projectId)}`,
    patch,
  )) as VercelProject;
}

/** What is not as wanted on the customer's project; empty when it is right. */
export function projectProblems(
  project: VercelProject,
  wanted: {
    repository: string;
    settings: ReturnType<typeof buildSettingsOf>;
    functionRegion: string;
    ignoreBuildCommand: string;
  },
) {
  const problems: string[] = [];
  const repo =
    project.link?.org && project.link.repo
      ? `${project.link.org}/${project.link.repo}`
      : project.link?.repo;
  if (project.link?.type !== "github" || repo?.toLowerCase() !== wanted.repository.toLowerCase())
    problems.push(`not connected to GitHub ${wanted.repository}`);
  if (typeof project.link?.repoId !== "number") problems.push("Vercel knows no repository id");
  if (project.commandForIgnoringBuildStep !== wanted.ignoreBuildCommand)
    problems.push("the release-only build step is not set");
  if (project.oidcTokenConfig?.enabled !== true) problems.push("the OIDC token is off");
  const regions = functionRegionsOf(project);
  if (regions.length !== 1 || regions[0] !== wanted.functionRegion)
    problems.push(
      `functions run in ${regions.join(", ") || "Vercel's default region"}, not ${wanted.functionRegion}`,
    );
  if (project.ssoProtection?.deploymentType !== LOGIN_EXCEPT_CUSTOM_DOMAINS)
    problems.push("Vercel's login does not protect the deployment URLs");
  for (const key of COPIED_SETTINGS) {
    if (
      wanted.settings[key] !== undefined &&
      (project[key] ?? null) !== (wanted.settings[key] ?? null)
    )
      problems.push(`${key} differs from the template`);
  }
  return problems;
}

/** Adds or replaces the production variables (values never logged). */
export async function upsertProductionEnv(
  request: VercelRequest,
  projectId: string,
  variables: Array<{ key: string; value: string; type: "encrypted" | "sensitive" }>,
) {
  if (variables.length === 0) return;
  await request(
    "POST",
    `/v10/projects/${encodeURIComponent(projectId)}/env?upsert=true`,
    variables.map((variable) => ({ ...variable, target: ["production"] })),
  );
}

/** The names of the variables set for production (never their values). */
export async function productionEnvKeys(request: VercelRequest, projectId: string) {
  const answer = (await request("GET", `/v10/projects/${encodeURIComponent(projectId)}/env`)) as {
    envs?: Array<{ key?: unknown; target?: unknown }>;
    pagination?: { next?: unknown };
  };
  if (!Array.isArray(answer?.envs)) throw new Error("Vercel listed no environment variables array");
  if (answer.pagination?.next)
    throw new Error("Vercel listed only part of the project's variables");
  return new Set(
    answer.envs
      .filter((variable) => {
        const target = variable.target;
        return target === "production" || (Array.isArray(target) && target.includes("production"));
      })
      .map((variable) => String(variable.key)),
  );
}

/**
 * Puts the customer's host on the project. interlect.ai's DNS is Vercel's own, so a
 * subdomain is verified and gets its certificate without a DNS step. Safe to repeat.
 */
type ProjectDomain = { name?: string; verified?: boolean; projectId?: string };

export async function ensureDomain(request: VercelRequest, projectId: string, host: string) {
  const path = `/v9/projects/${encodeURIComponent(projectId)}/domains/${encodeURIComponent(host)}`;
  let domain: ProjectDomain | null = null;
  try {
    domain = (await request("GET", path)) as ProjectDomain | null;
  } catch (cause) {
    if (!isNotFound(cause)) throw cause;
  }
  if (!domain) {
    domain = (await request("POST", `/v10/projects/${encodeURIComponent(projectId)}/domains`, {
      name: host,
    })) as ProjectDomain | null;
  }
  if (domain?.name !== host) throw new Error(`Vercel did not put ${host} on the project`);
  return { verified: domain.verified === true };
}

export type Deployment = {
  id: string;
  url?: string;
  readyState?: string;
  target?: string | null;
  errorMessage?: string;
};

/**
 * A production deployment of exactly this commit from the repository (no files uploaded). The
 * project's build step only builds it because INTERLECT_RELEASE_SHA was set to the same commit.
 */
export async function createProductionDeployment(
  request: VercelRequest,
  input: { projectId: string; name: string; repoId: number; ref: string; sha: string },
) {
  const deployment = (await request(
    "POST",
    "/v13/deployments?forceNew=1&skipAutoDetectionConfirmation=1",
    {
      name: input.name,
      project: input.projectId,
      target: "production",
      gitSource: { type: "github", repoId: input.repoId, ref: input.ref, sha: input.sha },
    },
  )) as Deployment | null;
  if (!deployment?.id) throw new Error("Vercel did not return the deployment");
  return deployment;
}

const FAILED_STATES = new Set(["ERROR", "CANCELED", "DELETED"]);

/** Waits until the deployment is READY; a failed or skipped build stops at once. */
export async function waitForDeployment(
  request: VercelRequest,
  deploymentId: string,
  options: {
    timeoutMs?: number;
    intervalMs?: number;
    wait?: (ms: number) => Promise<void>;
    now?: () => number;
    onWait?: (state: string) => void;
  } = {},
) {
  const {
    timeoutMs = 25 * 60_000,
    intervalMs = 15_000,
    wait = sleep,
    now = Date.now,
    onWait = () => {},
  } = options;
  const deadline = now() + timeoutMs;
  for (;;) {
    const deployment = (await request(
      "GET",
      `/v13/deployments/${encodeURIComponent(deploymentId)}`,
    )) as Deployment;
    const state = deployment.readyState ?? "UNKNOWN";
    if (state === "READY") return deployment;
    if (FAILED_STATES.has(state)) {
      const why =
        state === "CANCELED"
          ? "the build was skipped or cancelled (is INTERLECT_RELEASE_SHA the deployed commit?)"
          : (deployment.errorMessage ?? "see the build log in Vercel");
      throw new Error(`Deployment ${deploymentId} is ${state}: ${why}`);
    }
    if (now() >= deadline) {
      throw new Error(
        `Deployment ${deploymentId} was not ready after ${Math.round(timeoutMs / 60_000)} minutes (${state})`,
      );
    }
    onWait(state);
    await wait(intervalMs);
  }
}

/** The commit the project's live production deployment was built from; null when none. */
export async function productionCommit(request: VercelRequest, projectId: string) {
  const answer = (await request(
    "GET",
    `/v6/deployments?projectId=${encodeURIComponent(projectId)}&target=production&state=READY&limit=1`,
  )) as { deployments?: Array<{ meta?: { githubCommitSha?: string } }> };
  return answer.deployments?.[0]?.meta?.githubCommitSha ?? null;
}

/**
 * Vercel's pause: the production deployment is blocked and the crons stop, so nobody
 * signs in and nothing is spent; unpause brings the same deployment back. Safe to repeat.
 */
export async function pauseProject(request: VercelRequest, projectId: string) {
  await request("POST", `/v1/projects/${encodeURIComponent(projectId)}/pause`, {});
}

export async function unpauseProject(request: VercelRequest, projectId: string) {
  await request("POST", `/v1/projects/${encodeURIComponent(projectId)}/unpause`, {});
}

/** Deletes the project with its deployments and domains; a project already gone is fine. */
export async function deleteVercelProject(request: VercelRequest, projectId: string) {
  try {
    await request("DELETE", `/v9/projects/${encodeURIComponent(projectId)}`);
  } catch (cause) {
    if (!isNotFound(cause)) throw cause;
  }
}

/**
 * The customer's own project on the handover day (method K): in the CUSTOMER's team and
 * without a git link, because the code it runs is the customer's own copy (customer:code-export),
 * deployed from files; the customer connects their own GitHub repository afterwards. The same
 * function region, OIDC token (the AI Gateway identity, billed to the customer's team) and
 * Vercel login in front of everything but the custom domain as a customer:new project. No
 * release-only build step: the customer's own pushes are meant to build.
 */
export async function createDirectProject(
  request: VercelRequest,
  input: { name: string; settings: ReturnType<typeof buildSettingsOf>; functionRegion: string },
) {
  const { nodeVersion, ...settings } = input.settings;
  const project = (await request("POST", "/v11/projects", {
    name: input.name,
    ...settings,
    ...directProjectSettings(input.functionRegion),
  })) as VercelProject | null;
  if (!project?.id?.startsWith("prj_")) throw new Error("Vercel did not return the new project");
  if (nodeVersion) return updateProject(request, project.id, { nodeVersion });
  return project;
}

export function directProjectSettings(functionRegion: string) {
  return {
    resourceConfig: { functionDefaultRegions: [functionRegion] },
    oidcTokenConfig: { enabled: true, issuerMode: "team" },
    ssoProtection: { deploymentType: LOGIN_EXCEPT_CUSTOM_DOMAINS },
  };
}

/** What is not as wanted on the customer's own project; empty when it is right. */
export function directProjectProblems(
  project: VercelProject,
  wanted: { settings: ReturnType<typeof buildSettingsOf>; functionRegion: string },
) {
  const problems: string[] = [];
  if (project.oidcTokenConfig?.enabled !== true) problems.push("the OIDC token is off");
  const regions = functionRegionsOf(project);
  if (regions.length !== 1 || regions[0] !== wanted.functionRegion)
    problems.push(
      `functions run in ${regions.join(", ") || "Vercel's default region"}, not ${wanted.functionRegion}`,
    );
  if (project.ssoProtection?.deploymentType !== LOGIN_EXCEPT_CUSTOM_DOMAINS)
    problems.push("Vercel's login does not protect the deployment URLs");
  for (const key of COPIED_SETTINGS) {
    if (
      wanted.settings[key] !== undefined &&
      (project[key] ?? null) !== (wanted.settings[key] ?? null)
    )
      problems.push(`${key} differs from the pilot's project`);
  }
  return problems;
}

export type FileUpload = (bytes: Buffer, sha: string) => Promise<void>;

/** Uploads one deployment file (POST /v2/files, raw bytes with their SHA-1); retried twice. */
export function vercelFileUploader(
  env: Record<string, string | undefined>,
  fetchImpl: Fetch = fetch,
  wait: (ms: number) => Promise<void> = sleep,
): FileUpload {
  const token = env["VERCEL_TOKEN"];
  if (!token) throw new Error("A Vercel token is needed to upload deployment files");
  const teamId = env["VERCEL_TEAM_ID"];
  return async (bytes, sha) => {
    const url = new URL("/v2/files", "https://api.vercel.com");
    if (teamId) url.searchParams.set("teamId", teamId);
    for (let attempt = 1; ; attempt += 1) {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/octet-stream",
          "x-vercel-digest": sha,
        },
        body: new Uint8Array(bytes),
      });
      if (response.ok) {
        await response.text();
        return;
      }
      const text = await response.text();
      if ((response.status === 429 || response.status >= 500) && attempt < 3) {
        await wait(attempt * 5_000);
        continue;
      }
      throw new Error(`Vercel POST /v2/files failed (${response.status}): ${text.slice(0, 300)}`);
    }
  };
}

export type DeploymentFile = { file: string; sha: string; size: number };

/**
 * A deployment of a folder's files (the customer's code copy, the website): every file is uploaded
 * once (by SHA-1), then the deployment lists them; Vercel builds it with the project's settings.
 * Production unless target is "preview" (the website's PR previews): Vercel makes a
 * deployment without a target a preview, which gets its own address and never a domain.
 */
export async function deployFiles(
  request: VercelRequest,
  upload: FileUpload,
  input: {
    projectId: string;
    name: string;
    files: Array<{ file: string; bytes: Buffer }>;
    target?: "production" | "preview";
    onProgress?: (done: number, total: number) => void;
    concurrency?: number;
  },
) {
  const listed: DeploymentFile[] = [];
  const unique = new Map<string, Buffer>();
  for (const entry of input.files) {
    const sha = createHash("sha1").update(entry.bytes).digest("hex");
    listed.push({ file: entry.file, sha, size: entry.bytes.length });
    unique.set(sha, entry.bytes);
  }
  const queue = [...unique.entries()];
  let done = 0;
  const worker = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      await upload(next[1], next[0]);
      done += 1;
      if (done % 200 === 0 || done === unique.size) input.onProgress?.(done, unique.size);
    }
  };
  await Promise.all(Array.from({ length: input.concurrency ?? 8 }, worker));
  const deployment = (await request(
    "POST",
    "/v13/deployments?forceNew=1&skipAutoDetectionConfirmation=1",
    {
      name: input.name,
      project: input.projectId,
      ...(input.target === "preview" ? {} : { target: "production" }),
      files: listed,
    },
  )) as Deployment | null;
  if (!deployment?.id) throw new Error("Vercel did not return the deployment");
  return deployment;
}

/** The project's production addresses Vercel serves (verified, not redirects). */
export async function productionHosts(request: VercelRequest, projectId: string) {
  const answer = (await request(
    "GET",
    `/v9/projects/${encodeURIComponent(projectId)}/domains?production=true&redirects=false`,
  )) as { domains?: Array<{ name?: string; verified?: boolean; gitBranch?: string | null }> };
  return (answer.domains ?? [])
    .filter((domain) => domain.verified && domain.name && !domain.gitBranch)
    .map((domain) => domain.name!);
}

/**
 * A protection bypass for automation (header x-vercel-protection-bypass), so the handover's smoke
 * test reaches an address behind Vercel's login (a test account's vercel.app address). Revoked
 * again when the run ends.
 */
export async function addAutomationBypass(
  request: VercelRequest,
  projectId: string,
  secret: string,
  note: string,
) {
  // Vercel takes exactly 32 letters or digits (400 otherwise, 17 Oct 2026).
  if (!/^[A-Za-z0-9]{32}$/.test(secret))
    throw new Error("A protection bypass secret must be 32 letters or digits");
  await request("PATCH", `/v1/projects/${encodeURIComponent(projectId)}/protection-bypass`, {
    generate: { secret, note },
  });
}

export async function revokeAutomationBypass(
  request: VercelRequest,
  projectId: string,
  secret: string,
) {
  await request("PATCH", `/v1/projects/${encodeURIComponent(projectId)}/protection-bypass`, {
    revoke: { secret, regenerate: false },
  });
}
