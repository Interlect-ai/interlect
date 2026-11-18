/**
 * npm run setup: a complete Interlect installation on YOUR OWN Supabase and Vercel accounts.
 *
 * Asks for two tokens only (a Supabase access token and a Vercel token, with links) plus the
 * fund's name, the admin's e-mail, the language and an EU region. Then, by itself:
 *   supabase-project  a new Supabase project in the EU, healthy
 *   database          every migration, then the installation check (RLS, buckets, grants)
 *   settings          language and currency; the credit system OFF
 *   fund              the first fund with a draft setup from the Venture template
 *   vercel-project    a Vercel project with the function region next to the database, the OIDC
 *                     token on (the AI Gateway identity, so no AI key is needed) and Standard
 *                     Protection (the production address is public, previews are not)
 *   env               the production variables: the project's own Supabase keys, a new
 *                     CRON_SECRET, ZDR and EU inference, credits and internal pages off
 *   deploy            this checkout's tracked files, built by Vercel, ready
 *   auth              invite only, password sign-in, site URL = the new address
 *   health            /api/health answers ok
 *   admin             the admin's invitation link (shown once, valid 7 days)
 * and finally offers .env.local for local development and the fictional demo data (default yes).
 *
 * Idempotent: progress is saved in .selfhost/state.json (no secrets), every step is safe to run
 * again, and a rerun continues where the last one stopped. It only ever uses projects it created
 * itself; a project with the same name that it did not create stops the run. The tokens are
 * never written to disk. Without a terminal, everything comes from the environment:
 * SUPABASE_ACCESS_TOKEN, VERCEL_TOKEN (+ VERCEL_TEAM_ID), SUPABASE_ORG_SLUG and SETUP_FUND_NAME,
 * SETUP_ADMIN_EMAIL, SETUP_LANGUAGE, SETUP_REGION; a missing answer stops with exit code 1.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface, type Interface } from "node:readline/promises";
import { Writable } from "node:stream";
import type pg from "pg";
import { fundConfigTemplateIn } from "../../src/lib/funds/config-templates.ts";
import { settingChanges } from "../customers/lib/credits.ts";
import { waitForHealth } from "../customers/lib/health.ts";
import {
  connect,
  ensureFirstFund,
  installationProblems,
  inviteAdmin,
  migrationFiles,
  runMigrations,
} from "../customers/lib/installation.ts";
import { updateSettings } from "../customers/lib/ledger.ts";
import {
  authConfigFor,
  authConfigProblems,
  EU_REGIONS,
  generateCronSecret,
  generateDbPassword,
  healthUrl,
  invitationUrl,
  vercelRegionFor,
} from "../customers/lib/provision.ts";
import {
  createProject as createSupabaseProject,
  findProjectByName,
  freshDatabaseUrl,
  getProject,
  projectApiKeys,
  setAuthConfigUntilTaken,
  supabaseTransport,
  waitUntilHealthy,
  type SupabaseRequest,
} from "../customers/lib/supabase.ts";
import {
  deployFiles,
  findProject,
  productionEnvKeys,
  productionHosts,
  updateProject,
  upsertProductionEnv,
  vercelFileUploader,
  vercelTransport,
  waitForDeployment,
  type VercelProject,
  type VercelRequest,
} from "../customers/lib/vercel.ts";
import {
  ANSWER_ENV,
  assertFixedAnswers,
  EMPTY_STATE,
  envLocalText,
  fixedAnswers,
  isDeployed,
  isTokenRefused,
  mayAdopt,
  parseAnswers,
  pendingSteps,
  pickProductionHost,
  projectNameFor,
  SELFHOST_PROTECTION,
  selfhostEnv,
  settingFlagsFor,
  TOKEN_LINKS,
  vercelBuildSettings,
  vercelProjectPatch,
  type SetupAnswers,
  type SetupState,
  type Step,
} from "./lib/plan.ts";

const ROOT = resolve(import.meta.dirname, "..", "..");
const STATE_DIR = join(ROOT, ".selfhost");
const STATE_FILE = join(STATE_DIR, "state.json");
const log = (message = "") => console.log(message);

// ---------------------------------------------------------------------------------------------
// Prompts: only with a terminal; without one, a missing answer is an error (never a silent exit)
// ---------------------------------------------------------------------------------------------

const INTERACTIVE = Boolean(process.stdin.isTTY && process.stdout.isTTY);
let muted = false;
let rl: Interface | null = null;

function prompts(): Interface {
  if (rl) return rl;
  const output = new Writable({
    write(chunk, _encoding, done) {
      if (!muted) process.stdout.write(chunk);
      done();
    },
  });
  // historySize 0: a pasted token is never one arrow-key away in a later question.
  rl = createInterface({ input: process.stdin, output, terminal: true, historySize: 0 });
  rl.on("SIGINT", () => {
    process.stdout.write("\nStopped. Run npm run setup again to continue where it stopped.\n");
    process.exit(130);
  });
  return rl;
}

function needsTerminal(what: string, variable?: string): never {
  throw new Error(
    `${what} needs an answer: run npm run setup in a terminal` +
      (variable ? `, or set ${variable}` : "") +
      ".",
  );
}

async function ask(question: string, fallback?: string, variable?: string) {
  const given = variable ? process.env[variable]?.trim() : undefined;
  if (given) return given;
  if (!INTERACTIVE) {
    if (fallback) return fallback;
    needsTerminal(question, variable);
  }
  const suffix = fallback ? ` [${fallback}]` : "";
  const answer = (await prompts().question(`${question}${suffix}: `)).trim();
  return answer || fallback || "";
}

async function askSecret(question: string, variable: string) {
  if (!INTERACTIVE) needsTerminal(question, variable);
  for (;;) {
    process.stdout.write(`${question}: `);
    muted = true;
    let answer: string;
    try {
      answer = (await prompts().question("")).trim();
    } finally {
      muted = false;
      process.stdout.write("\n");
    }
    if (answer) return answer;
    log("     Nothing was pasted; paste the token and press Enter.");
  }
}

async function confirm(question: string, fallback: boolean) {
  if (!INTERACTIVE) return fallback;
  const answer = (await ask(`${question} (${fallback ? "Y/n" : "y/N"})`)).toLowerCase();
  if (!answer) return fallback;
  return ["y", "yes", "j", "ja"].includes(answer);
}

async function choose(
  question: string,
  options: Array<{ value: string; label: string }>,
  variable: string,
) {
  const given = process.env[variable]?.trim();
  if (given !== undefined && given !== "") {
    if (!options.some((option) => option.value === given))
      throw new Error(
        `${variable}=${given} is not one of: ${options.map((o) => o.value || "(personal)").join(", ")}`,
      );
    return given;
  }
  if (options.length === 1) return options[0]!.value;
  if (!INTERACTIVE) needsTerminal(question, variable);
  log(question);
  options.forEach((option, index) => log(`  ${index + 1}. ${option.label}`));
  for (;;) {
    const picked = Number(await ask("Number", "1"));
    if (Number.isInteger(picked) && picked >= 1 && picked <= options.length)
      return options[picked - 1]!.value;
    log(`Type a number from 1 to ${options.length}.`);
  }
}

// ---------------------------------------------------------------------------------------------
// State (no secrets)
// ---------------------------------------------------------------------------------------------

function readState(): SetupState {
  if (!existsSync(STATE_FILE)) return structuredClone(EMPTY_STATE);
  const parsed = JSON.parse(readFileSync(STATE_FILE, "utf8")) as SetupState;
  if (parsed.version !== 1) throw new Error(`${STATE_FILE} has an unknown version`);
  return { ...parsed, done: parsed.done ?? {} };
}

function writeState(state: SetupState) {
  mkdirSync(STATE_DIR, { recursive: true });
  const temporary = `${STATE_FILE}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`);
  renameSync(temporary, STATE_FILE);
}

// ---------------------------------------------------------------------------------------------
// Tokens: an empty token is never used (the Vercel helper would fall back to a logged-in CLI)
// ---------------------------------------------------------------------------------------------

async function supabaseToken(): Promise<SupabaseRequest> {
  let token = process.env["SUPABASE_ACCESS_TOKEN"]?.trim() ?? "";
  for (;;) {
    if (!token) {
      log("");
      log("1/2  Supabase access token");
      log(`     Create one at ${TOKEN_LINKS.supabase} ("Generate new token").`);
      log("     It lets this script create the database project; it is never saved.");
      token = await askSecret("     Paste the token", "SUPABASE_ACCESS_TOKEN");
    }
    const api = supabaseTransport({ SUPABASE_ACCESS_TOKEN: token });
    try {
      await api("GET", "/v1/organizations");
      return api;
    } catch (cause) {
      if (!isTokenRefused(cause) || !INTERACTIVE) throw cause;
      log("     Supabase refused this token; create a new one and paste it.");
      token = "";
    }
  }
}

async function vercelToken(): Promise<{ token: string; user: string }> {
  let token = process.env["VERCEL_TOKEN"]?.trim() ?? "";
  for (;;) {
    if (!token) {
      log("");
      log("2/2  Vercel token");
      log(
        `     Create one at ${TOKEN_LINKS.vercel} ("Create Token", scope: your account or team).`,
      );
      log("     It lets this script create and deploy the app; it is never saved.");
      token = await askSecret("     Paste the token", "VERCEL_TOKEN");
    }
    try {
      const me = (await vercelTransport({ VERCEL_TOKEN: token })("GET", "/v2/user")) as {
        user?: { username?: string };
      };
      return { token, user: me.user?.username ?? "you" };
    } catch (cause) {
      if (!isTokenRefused(cause) || !INTERACTIVE) throw cause;
      log("     Vercel refused this token; create a new one and paste it.");
      token = "";
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------------------------

/** A database connection for one group of steps, with a password made for this run only. */
async function withDatabase<T>(
  supabase: SupabaseRequest,
  ref: string,
  work: (client: pg.Client, databaseUrl: string) => Promise<T>,
) {
  const databaseUrl = await freshDatabaseUrl(supabase, ref);
  const client = await connect(databaseUrl, {
    authRetryMs: 2 * 60_000,
    onWait: (message) => log(`  the database is not reachable yet (${message}); retrying`),
  });
  // A dropped idle connection must not crash the script with an unhandled 'error' event.
  (client as unknown as NodeJS.EventEmitter).on("error", (cause: Error) =>
    log(`  database connection closed (${cause.message})`),
  );
  try {
    return await work(client, databaseUrl);
  } finally {
    await client.end().catch(() => {});
  }
}

async function readAnswers(state: SetupState): Promise<SetupAnswers> {
  const saved = state.answers;
  const fixed = new Set(fixedAnswers(state));
  const value = async (
    key: keyof SetupAnswers,
    question: string,
    fallback?: string,
  ): Promise<string> => {
    if (saved && fixed.has(key)) return saved[key];
    return ask(question, saved?.[key] ?? fallback, ANSWER_ENV[key]);
  };
  const answers = parseAnswers({
    fundName: await value("fundName", "The fund's name (e.g. Nordic Seed I)"),
    adminEmail: await value("adminEmail", "The admin's e-mail (you)"),
    language: await value("language", "Language, en or da", "en"),
    region: await value("region", `Region (EU only: ${EU_REGIONS.join(", ")})`, "eu-central-1"),
  });
  assertFixedAnswers(state, answers);
  return answers;
}

async function main() {
  process.exitCode = 1;
  log("Interlect setup: your own installation on your own Supabase and Vercel accounts.");
  log("Progress is saved in .selfhost/state.json, so you can stop and run it again at any time.");
  try {
    execFileSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: ROOT, stdio: "ignore" });
  } catch {
    throw new Error(
      "This folder is not a git checkout. Clone the repository with git (not a ZIP download): " +
        "the deployment uploads the files git tracks.",
    );
  }
  const state = readState();
  const save = () => writeState(state);
  const mark = (step: Step) => {
    state.done[step] = new Date().toISOString();
    save();
    log(`✓ ${step}`);
  };

  const supabase = await supabaseToken();
  const vercelLogin = await vercelToken();

  log("");
  const answers = await readAnswers(state);
  state.answers = answers;
  save();
  const name = projectNameFor(answers);
  log(
    `Installation "${answers.fundName}" → projects named ${name}. Steps left: ${pendingSteps(state).join(", ") || "none"}`,
  );

  // Supabase organisation and project.
  if (!state.supabaseOrg) {
    const orgs = (await supabase("GET", "/v1/organizations")) as Array<{
      id: string;
      slug?: string;
      name?: string;
    }>;
    if (orgs.length === 0)
      throw new Error("The Supabase token sees no organisation; create one at supabase.com first");
    state.supabaseOrg = await choose(
      "Which Supabase organisation should hold the database?",
      orgs.map((org) => ({ value: org.slug ?? org.id, label: org.name ?? org.slug ?? org.id })),
      "SUPABASE_ORG_SLUG",
    );
    save();
  }
  if (!state.done["supabase-project"]) {
    let project = state.supabaseRef
      ? await getProject(supabase, state.supabaseRef)
      : await findProjectByName(supabase, state.supabaseOrg, name);
    if (
      project &&
      !mayAdopt(
        { id: project.ref },
        { id: state.supabaseRef, creating: state.supabaseCreating },
        name,
      )
    ) {
      throw new Error(
        `Your Supabase account already has a project named ${name} that this setup did not create. ` +
          "Setup never touches someone else's project: rename or delete it, or use another fund name.",
      );
    }
    if (!project) {
      log(`Creating Supabase project ${name} in ${answers.region} ...`);
      state.supabaseCreating = name;
      save();
      project = await createSupabaseProject(supabase, {
        orgSlug: state.supabaseOrg,
        name,
        region: answers.region,
        // Replaced before the first use (freshDatabaseUrl), so it is never kept.
        dbPass: generateDbPassword(),
      });
    }
    if (project.region && project.region !== answers.region)
      throw new Error(`${name} exists in ${project.region}, not ${answers.region}`);
    state.supabaseRef = project.ref;
    save();
    log(`Waiting until ${project.ref} is healthy (a new project takes a few minutes) ...`);
    await waitUntilHealthy(supabase, project.ref, { onWait: (what) => log(`  ${what}`) });
    mark("supabase-project");
  }
  const ref = state.supabaseRef!;

  if (!state.done.database || !state.done.settings || !state.done.fund) {
    await withDatabase(supabase, ref, async (client, databaseUrl) => {
      if (!state.done.database) {
        runMigrations(ROOT, databaseUrl);
        const problems = await installationProblems(client, migrationFiles(ROOT));
        if (problems.length > 0)
          throw new Error(`The installation is not complete:\n- ${problems.join("\n- ")}`);
        mark("database");
      }
      if (!state.done.settings) {
        await updateSettings(client, settingChanges(settingFlagsFor(answers)));
        mark("settings");
      }
      if (!state.done.fund) {
        const fund = await ensureFirstFund(client, {
          name: answers.fundName,
          slug: name.replace(/^interlect-/, ""),
          language: answers.language,
          template: fundConfigTemplateIn("venture", answers.language),
        });
        state.fundId = fund.fundId;
        mark("fund");
      }
    });
  }

  const keys = await projectApiKeys(supabase, ref);
  if (!keys.publishable || !keys.secret)
    throw new Error("Supabase did not give the project's API keys");

  // Vercel: account or team, project, variables, deployment.
  if (state.vercelTeamId === undefined) state.vercelTeamId = await pickVercelScope(vercelLogin);
  save();
  const vercelEnv = {
    VERCEL_TOKEN: vercelLogin.token,
    ...(state.vercelTeamId ? { VERCEL_TEAM_ID: state.vercelTeamId } : {}),
  };
  const vercel = vercelTransport(vercelEnv);
  const functionRegion = vercelRegionFor(answers.region);

  if (!state.done["vercel-project"]) {
    const project = await ensureVercelProject(vercel, state, save, name, functionRegion);
    state.vercelProjectId = project.id;
    mark("vercel-project");
  }
  const projectId = state.vercelProjectId!;

  if (!state.done.env) {
    const variables = selfhostEnv({
      supabaseRef: ref,
      publishableKey: keys.publishable,
      secretKey: keys.secret,
      cronSecret: generateCronSecret(),
      env: process.env,
    });
    await upsertProductionEnv(vercel, projectId, variables);
    const present = await productionEnvKeys(vercel, projectId);
    const missing = variables.filter((variable) => !present.has(variable.key));
    if (missing.length > 0)
      throw new Error(`Vercel is missing ${missing.map((variable) => variable.key).join(", ")}`);
    log(`  production variables: ${variables.map((variable) => variable.key).join(", ")}`);
    mark("env");
  }

  if (!state.done.deploy) {
    const files = deployableFiles();
    log(`Uploading ${files.length} files and building on Vercel (5-10 minutes) ...`);
    const deployment = await deployFiles(vercel, vercelFileUploader(vercelEnv), {
      projectId,
      name,
      files,
      onProgress: (done, total) => log(`  uploaded ${done}/${total}`),
    });
    await waitForDeployment(vercel, deployment.id, { onWait: (what) => log(`  ${what}`) });
    mark("deploy");
  }

  if (!state.appUrl) {
    const host = pickProductionHost(await productionHosts(vercel, projectId));
    if (!host) throw new Error("Vercel gave the project no vercel.app address");
    state.appUrl = `https://${host}`;
    save();
  }
  const appUrl = state.appUrl;

  if (!state.done.auth) {
    const wanted = authConfigFor(appUrl);
    const problems = await setAuthConfigUntilTaken(supabase, ref, wanted, (actual) =>
      authConfigProblems(actual, wanted),
    );
    if (problems.length > 0)
      throw new Error(`The sign-in settings did not take:\n- ${problems.join("\n- ")}`);
    mark("auth");
  }

  if (!state.done.health) {
    await waitForHealth(healthUrl(appUrl), {
      onWait: (why) => log(`  waiting for ${appUrl} (${why})`),
    }).catch((cause: Error) => {
      throw new Error(
        `${cause.message}\nIf it answers 401, Vercel's login is in front of the address: check ` +
          "Settings → Deployment Protection in the Vercel project (Standard Protection).",
      );
    });
    mark("health");
  }

  // The admin's invitation: the app's own link, shown once.
  await withDatabase(supabase, ref, async (client) => {
    const invite = (reinvite: boolean) =>
      inviteAdmin(client, {
        fundId: state.fundId!,
        email: answers.adminEmail,
        reinvite,
        exclusive: true,
        by: "setup",
      });
    let result = await invite(false);
    if (
      result.status === "pending" &&
      (await confirm(
        "Your invitation link was made earlier and is only shown once. Make a new one?",
        true,
      ))
    ) {
      result = await invite(true);
    }
    log("");
    if (result.status === "created") {
      log("Open this link to create your admin account (valid 7 days, shown only now):");
      log(`  ${invitationUrl(appUrl, result.token)}`);
    } else if (result.status === "pending") {
      log(`Your earlier invitation link is still valid until ${result.expiresAt}.`);
    } else {
      log(`The admin account exists; sign in at ${appUrl}`);
    }
  });
  mark("admin");

  if (
    !existsSync(join(ROOT, ".env.local")) &&
    (await confirm("Write .env.local for local development (npm run dev)?", INTERACTIVE))
  ) {
    writeFileSync(
      join(ROOT, ".env.local"),
      envLocalText({ supabaseRef: ref, publishableKey: keys.publishable, secretKey: keys.secret }),
      { mode: 0o600 },
    );
    log("  .env.local written (it holds keys and is never committed).");
  }

  await offerDemoData({
    supabaseRef: ref,
    secretKey: keys.secret,
    publishableKey: keys.publishable,
    fundId: state.fundId!,
  });

  log("");
  log(`Done. ${answers.fundName} runs at ${appUrl}`);
  log(`  Supabase ${ref} (${answers.region}), Vercel ${projectId}, functions in ${functionRegion}`);
  process.exitCode = 0;
}

/**
 * The Vercel account or team. VERCEL_TEAM_ID wins. A token made for one team cannot list teams
 * (403): then the team must be named, never guessed, and nothing is saved until it is.
 */
async function pickVercelScope(login: { token: string; user: string }): Promise<string | null> {
  const given = process.env["VERCEL_TEAM_ID"]?.trim();
  if (given) return given;
  let teams: Array<{ id: string; name?: string; slug?: string }>;
  try {
    const answer = (await vercelTransport({ VERCEL_TOKEN: login.token })("GET", "/v2/teams")) as {
      teams?: Array<{ id: string; name?: string; slug?: string }>;
    };
    teams = answer.teams ?? [];
  } catch (cause) {
    if (!isTokenRefused(cause)) throw cause;
    log("  This Vercel token is limited to one team, so it cannot list teams.");
    const team = await ask(
      "  The team's id (Vercel → Team Settings → General → Team ID, starts with team_)",
      undefined,
      "VERCEL_TEAM_ID",
    );
    if (!/^team_[A-Za-z0-9]+$/.test(team)) throw new Error(`"${team}" is not a Vercel team id`);
    return team;
  }
  const picked = await choose(
    "Which Vercel account should run the app?",
    [
      { value: "", label: `Your personal account (${login.user})` },
      ...teams.map((team) => ({
        value: team.id,
        label: `Team ${team.name ?? team.slug ?? team.id}`,
      })),
    ],
    "VERCEL_TEAM_ID",
  );
  return picked || null;
}

/** Finds the project this setup made, or makes it, puts the self-host settings on it, checks. */
async function ensureVercelProject(
  vercel: VercelRequest,
  state: SetupState,
  save: () => void,
  name: string,
  functionRegion: string,
): Promise<VercelProject> {
  const settings = vercelBuildSettings(process.env);
  let project = await findProject(vercel, state.vercelProjectId ?? name);
  if (
    project &&
    !mayAdopt(project, { id: state.vercelProjectId, creating: state.vercelCreating }, name)
  ) {
    throw new Error(
      `Your Vercel account already has a project named ${name} that this setup did not create. ` +
        "Setup never changes someone else's project: rename or delete it, or use another fund name.",
    );
  }
  if (!project) {
    log(`Creating Vercel project ${name} ...`);
    state.vercelCreating = name;
    save();
    const made = (await vercel("POST", "/v11/projects", {
      name,
      framework: settings.framework,
      ...vercelProjectPatch(functionRegion),
    })) as VercelProject | null;
    if (!made?.id?.startsWith("prj_")) throw new Error("Vercel did not return the new project");
    project = made;
    state.vercelProjectId = made.id;
    save();
  }
  await updateProject(vercel, project.id, {
    framework: settings.framework,
    nodeVersion: settings.nodeVersion,
    ...vercelProjectPatch(functionRegion),
  });
  const checked = await findProject(vercel, project.id);
  if (!checked) throw new Error(`Vercel project ${project.id} disappeared right after it was made`);
  const problems = [
    checked.oidcTokenConfig?.enabled !== true && "the OIDC token is off",
    checked.ssoProtection?.deploymentType !== SELFHOST_PROTECTION &&
      `deployment protection is ${checked.ssoProtection?.deploymentType ?? "off"}, not ${SELFHOST_PROTECTION}`,
    !(checked.resourceConfig?.functionDefaultRegions ?? []).includes(functionRegion) &&
      `functions do not run in ${functionRegion}`,
  ].filter(Boolean);
  if (problems.length > 0)
    throw new Error(`The Vercel project is not set up right:\n- ${problems.join("\n- ")}`);
  return checked;
}

/** This checkout's tracked files (with local edits), without secrets or non-app folders. */
function deployableFiles() {
  const listed = execFileSync("git", ["ls-files", "-z", "--cached"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\0")
    .filter(Boolean);
  return listed
    .filter((file) => isDeployed(file) && existsSync(join(ROOT, file)))
    .map((file) => ({ file, bytes: readFileSync(join(ROOT, file)) }));
}

/** Setup's last question: load the fictional demo cases (default yes). */
async function offerDemoData(input: {
  supabaseRef: string;
  secretKey: string;
  publishableKey: string;
  fundId: string;
}) {
  const scripts =
    (
      JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
        scripts?: Record<string, string>;
      }
    ).scripts ?? {};
  if (!scripts["seed:demo"]) {
    log(
      "Demo data comes in a later version (npm run seed:demo); your installation is ready without it.",
    );
    return;
  }
  if (!(await confirm("Load 10 fictional demo cases so every screen has content?", true))) return;
  const result = spawnSync("npm", ["run", "seed:demo", "--", "--fund", input.fundId], {
    cwd: ROOT,
    stdio: "inherit",
    env: {
      ...process.env,
      SUPABASE_URL: `https://${input.supabaseRef}.supabase.co`,
      SUPABASE_SERVICE_ROLE_KEY: input.secretKey,
      SUPABASE_PUBLISHABLE_KEY: input.publishableKey,
    },
  });
  if (result.status !== 0)
    log("Loading the demo data failed (see above); run npm run seed:demo later.");
}

main()
  .catch((cause: unknown) => {
    process.exitCode = 1;
    console.error("");
    console.error(cause instanceof Error ? cause.message : cause);
    console.error("Nothing is lost: fix the problem and run npm run setup again to continue.");
  })
  .finally(() => rl?.close());
