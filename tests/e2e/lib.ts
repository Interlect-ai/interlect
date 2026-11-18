/**
 * Shared helpers for the end-to-end flows in tests/e2e.
 * Signs in as an E2E test user without typing a password: the service role creates a
 * magic-link token, it is verified in Node, and the session is put in localStorage before
 * the app loads (same as scripts/visual-compare.ts --auth). Needs .env.local with
 * E2E_<ROLE>_EMAIL and the Supabase keys. Runs against a local dev or production build.
 * Paid AI runs are blocked in the browser, in dev and production builds (see blockPaidRuns).
 */
import { readFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { decideServerFnCall, isPaidApiCall } from "./server-fn-guard.ts";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";

export const ROOT = resolve(import.meta.dirname, "..", "..");
const AUTH_STORAGE_KEY = "pap-intelligence-auth";
const THEME_STORAGE_KEY = "pap-theme";

export function readEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of readFileSync(join(ROOT, ".env.local"), "utf8").split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match?.[1]) env[match[1]] = (match[2] ?? "").replace(/^"(.*)"$/, "$1");
  }
  return env;
}

/**
 * One session per role per process: every magic link counts against Supabase's auth rate limit,
 * and a flow with many pages (batch 3) would otherwise be refused after a few of them.
 */
const sessionCache = new Map<string, ReturnType<typeof createSession>>();
export function sessionFor(role: string, env = readEnv()) {
  let session = sessionCache.get(role);
  if (!session) {
    session = createSession(role, env);
    sessionCache.set(role, session);
    // A failed attempt must not be remembered.
    session.catch(() => sessionCache.delete(role));
  }
  return session;
}

/** Drops the cached session, so the next `sessionFor` signs in again (a long run). */
export function forgetSession(role: string) {
  sessionCache.delete(role);
}

async function createSession(role: string, env: Record<string, string>) {
  const email = env[`E2E_${role.toUpperCase()}_EMAIL`];
  const url = env["SUPABASE_URL"];
  const serviceKey = env["SUPABASE_SERVICE_ROLE_KEY"];
  const publishableKey = env["SUPABASE_PUBLISHABLE_KEY"];
  if (!email || !url || !serviceKey || !publishableKey) {
    throw new Error(`E2E_${role.toUpperCase()}_EMAIL and the Supabase keys must be in .env.local`);
  }
  // Only reserved test addresses: a typo must never open a session for a real person.
  if (!/@[a-z0-9.-]+\.test$/i.test(email)) {
    throw new Error(`E2E_${role.toUpperCase()}_EMAIL must be a .test address`);
  }
  const { createClient } = await import("@supabase/supabase-js");
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (link.error) throw new Error(`${role}: ${link.error.message}`);
  const anon = createClient(url, publishableKey, { auth: { persistSession: false } });
  const verified = await anon.auth.verifyOtp({
    type: "magiclink",
    token_hash: link.data.properties.hashed_token,
  });
  if (verified.error || !verified.data.session) {
    throw new Error(`${role}: ${verified.error?.message ?? "no session"}`);
  }
  return verified.data.session;
}

/**
 * A Supabase client signed in as the E2E role (row-level security applies). Works against any
 * base URL, dev or Vercel preview: scripts use this instead of importing app modules into the
 * page, which only works on the dev server.
 */
export async function userClient(role: string) {
  const env = readEnv();
  const session = await sessionFor(role, env);
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(env["SUPABASE_URL"]!, env["SUPABASE_PUBLISHABLE_KEY"]!, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${session.access_token}` } },
  });
}

/** Id of the first fund the role can see whose name starts with `name` ("" when none; throws on a failed query). */
export async function fundIdByName(role: string, name: string): Promise<string> {
  const client = await userClient(role);
  const { data, error } = await client
    .from("funds")
    .select("id")
    .ilike("name", `${name}%`)
    .limit(1);
  if (error) throw new Error(`fundIdByName(${role}, ${name}): ${error.message}`);
  return (data?.[0]?.["id"] as string | undefined) ?? "";
}

export async function launch(): Promise<Browser> {
  const chromePath =
    process.env["CHROME_PATH"] ??
    (process.platform === "linux" ? "/opt/pw-browsers/chromium" : undefined);
  return chromium.launch({
    headless: process.env["HEADED"] !== "1",
    ...(chromePath ? { executablePath: chromePath } : { channel: "chrome" }),
  });
}

/**
 * A protected Vercel preview: E2E_VERCEL_SHARE is a share link from Vercel
 * (`…vercel.app/?_vercel_share=…`, made with the Vercel MCP tool `get_access_to_vercel_url`).
 * Opening it once sets the bypass cookie in the context, so the flows can run against the real
 * staging deployment, queue included. Without it nothing happens (dev server, local build).
 */
export async function allowVercelPreview(context: BrowserContext) {
  const share = process.env["E2E_VERCEL_SHARE"];
  if (!share) return;
  const response = await context.request.get(share, { maxRedirects: 0 });
  const cookies = await context.cookies(new URL(share).origin);
  if (!cookies.some((cookie) => cookie.name === "_vercel_jwt")) {
    throw new Error(`E2E_VERCEL_SHARE gave no bypass cookie (HTTP ${response.status()})`);
  }
}

/**
 * The preview cookie and the paid-call guard for a context of its own (the invited person's
 * browser, which has no session yet). `signedInPage` uses it too.
 */
export async function guardContext(context: BrowserContext) {
  await allowVercelPreview(context);
  await blockPaidRuns(context);
  context.on("page", (page) =>
    page.on("pageerror", (error) => {
      pageErrors.push(error.message);
      console.error(`[page error] ${error.message}`);
    }),
  );
}

export async function signedInPage(
  browser: Browser,
  role: string,
  options: {
    width?: number;
    height?: number;
    theme?: "light" | "dark";
    /** Pins the active fund (`interlect.activeFundId`) for a user in more than one fund. */
    fundId?: string;
    /** Device pixels per CSS pixel; 2 for sharp pictures (the website's product screens). */
    scale?: number;
  } = {},
): Promise<Page> {
  const session = await sessionFor(role);
  const context = await browser.newContext({
    viewport: { width: options.width ?? 1440, height: options.height ?? 900 },
    deviceScaleFactor: options.scale ?? 1,
    colorScheme: options.theme ?? "light",
  });
  await guardContext(context);
  await context.addInitScript(
    ({ authKey, themeKey, session, theme, fundId }) => {
      // The page's first, empty document (about:blank) has no storage; the app's origin does.
      if (window.location.protocol !== "http:" && window.location.protocol !== "https:") return;
      window.localStorage.setItem(authKey, JSON.stringify(session));
      window.localStorage.setItem(themeKey, theme);
      if (fundId) window.localStorage.setItem("interlect.activeFundId", fundId);
    },
    {
      authKey: AUTH_STORAGE_KEY,
      themeKey: THEME_STORAGE_KEY,
      session,
      theme: options.theme ?? "light",
      fundId: options.fundId ?? "",
    },
  );
  return context.newPage();
}

/** Uncaught errors in any page; a flow fails when this is not empty at the end. */
export const pageErrors: string[] = [];

/**
 * Paid-call guard. Every flow blocks server functions that start a paid AI run unless
 * E2E_ALLOW_PAID=1 (a keyboard slip in a harden pass once started a screening, E9). Works against
 * the dev server AND production builds/previews: the function name is read from the URL (dev:
 * base64 JSON; production: the readable id from scripts/lib/server-fn-id.mjs). Fail closed: a
 * call whose name cannot be read, or that is on neither list in server-fn-classes.ts, is blocked
 * with a loud error. E2E_ALLOW_FUNCTIONS (comma-separated names, read at call time) lets one
 * named paid function through (createManualCase). The paid API routes (the Brain chat,
 * `PAID_API_ROUTES`) are blocked too, unless their path is in E2E_ALLOW_FUNCTIONS; a fixture's
 * own `page.route` still answers them first.
 * Blocked calls are counted in `blockedPaidCalls`; flows that must not block anything assert it
 * is empty.
 */
export const blockedPaidCalls: string[] = [];

/** The export name in a server-function URL (dev and production builds); kept here for r11-brain. */
export { serverFunctionName } from "./server-fn-guard.ts";

async function blockPaidRuns(context: BrowserContext) {
  if (process.env["E2E_ALLOW_PAID"] === "1") return;
  await context.route("**/_serverFn/**", (route) => {
    const decision = decideServerFnCall(route.request().url(), {
      allowFunctions: (process.env["E2E_ALLOW_FUNCTIONS"] ?? "").split(",").filter(Boolean),
    });
    if (decision.action === "allow") return route.continue();
    const label = decision.name ?? "unreadable id";
    blockedPaidCalls.push(label);
    console.error(
      decision.reason === "paid"
        ? `[blocked paid call] ${label}`
        : `[GUARD ERROR] blocked server call (${decision.reason}): ${label}. ` +
            `Rebuild the target with the current vite.config.ts or classify the function in tests/e2e/server-fn-classes.ts.`,
    );
    return route.abort("blockedbyclient");
  });
  await context.route(
    (url) => isPaidApiCall(url.href),
    (route) => {
      const label = new URL(route.request().url()).pathname;
      // A paid API route can be named in E2E_ALLOW_FUNCTIONS too ("/api/brain/chat").
      if ((process.env["E2E_ALLOW_FUNCTIONS"] ?? "").split(",").includes(label)) {
        return route.continue();
      }
      blockedPaidCalls.push(label);
      console.error(`[blocked paid call] ${label}`);
      return route.abort("blockedbyclient");
    },
  );
}

export function shotDir(name: string): string {
  const dir = join(ROOT, "docs", "visual-qa", name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`ok  ${message}`);
}
