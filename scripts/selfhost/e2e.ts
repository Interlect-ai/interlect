/**
 * The self-host path end to end, without any account (.github/workflows/selfhost-e2e.yml).
 * Runs against a local Supabase (scripts/selfhost/local, Supabase CLI) and a local production
 * build; it refuses any database or app that is not on this machine.
 *
 *   node --import ./scripts/lib/register-alias.mjs scripts/selfhost/e2e.ts install
 *     The database steps of npm run setup, with setup's own helpers: every migration
 *     (scripts/run-migrations.mjs), the installation check, the settings (credits off), the
 *     first fund from the Venture template and the admin's invitation. Reads DATABASE_URL and
 *     APP_URL; writes the invitation link to E2E_STATE (default .selfhost/e2e-state.json).
 *     Then the workflow runs npm run seed:demo, builds and starts the app.
 *
 *   node --import ./scripts/lib/register-alias.mjs scripts/selfhost/e2e.ts browser
 *     A browser at 1440 × 900, light, as the admin would: opens the invitation, creates the
 *     access with a password, turns on two-step sign-in (the TOTP code is computed from the key
 *     the page shows), then takes pictures of the case list with the demo banner, a screening and
 *     a deep analysis, clicks "Delete demo data" and takes a picture of the empty case list (the
 *     first case in five steps). Fails on any console error, page error, blocked paid call, an
 *     empty chart or a missing element. Pictures go to E2E_SHOTS (default .selfhost/e2e-shots).
 *
 * No AI is called (the paid-call guard from tests/e2e/lib.ts blocks it) and nothing is paid.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import pg from "pg";
import type { Page } from "playwright-core";
import { fundConfigTemplateIn } from "../../src/lib/funds/config-templates.ts";
import { charts as chartTexts } from "../../src/lib/i18n/dictionaries/en/charts.ts";
import { settingChanges } from "../customers/lib/credits.ts";
import {
  connect,
  ensureFirstFund,
  installationProblems,
  inviteAdmin,
  migrationFiles,
  runMigrations,
} from "../customers/lib/installation.ts";
import { updateSettings } from "../customers/lib/ledger.ts";
import { invitationUrl } from "../customers/lib/provision.ts";
import { blockedPaidCalls, guardContext, launch, pageErrors } from "../../tests/e2e/lib.ts";
import { parseAnswers, projectNameFor, settingFlagsFor } from "./lib/plan.ts";
import { totp, totpMsLeft } from "./lib/totp.ts";

const ROOT = resolve(import.meta.dirname, "..", "..");
const STATE_FILE = resolve(process.env["E2E_STATE"] ?? join(ROOT, ".selfhost", "e2e-state.json"));
const SHOTS = resolve(process.env["E2E_SHOTS"] ?? join(ROOT, ".selfhost", "e2e-shots"));
const VIEWPORT = { width: 1440, height: 900 };

/** Fictional answers, as a self-hoster would type them into npm run setup. */
const ANSWERS = parseAnswers({
  fundName: "Nordic Seed I",
  adminEmail: "admin@selfhost.test",
  language: "en",
  region: "eu-central-1",
});
/** Only for the throwaway local database; never a real account. */
const ADMIN_PASSWORD = "local-e2e-password-1";

type State = { fundId: string; invitation: string; email: string };

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

function localUrl(name: string): string {
  const raw = process.env[name]?.trim();
  if (!raw) throw new Error(`${name} must be set`);
  const host = new URL(raw).hostname;
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(`${name} must point at this machine (127.0.0.1), not ${host}`);
  }
  return raw.replace(/\/$/, "");
}

// ---------------------------------------------------------------------------------------------
// install: setup's database steps
// ---------------------------------------------------------------------------------------------

async function install() {
  const databaseUrl = localUrl("DATABASE_URL");
  const appUrl = localUrl("APP_URL");
  runMigrations(ROOT, databaseUrl);
  const client = await connect(databaseUrl, { timeoutMs: 60_000 });
  try {
    const problems = await installationProblems(client, migrationFiles(ROOT));
    if (problems.length > 0) {
      throw new Error(`The installation is not complete:\n- ${problems.join("\n- ")}`);
    }
    console.log("ok  every migration applied; the installation check passes");
    await updateSettings(client, settingChanges(settingFlagsFor(ANSWERS)));
    const fund = await ensureFirstFund(client, {
      name: ANSWERS.fundName,
      slug: projectNameFor(ANSWERS).replace(/^interlect-/, ""),
      language: ANSWERS.language,
      template: fundConfigTemplateIn("venture", ANSWERS.language),
    });
    console.log(`ok  fund "${ANSWERS.fundName}" (${fund.created ? "created" : "existed"})`);
    const invite = await inviteAdmin(client, {
      fundId: fund.fundId,
      email: ANSWERS.adminEmail,
      reinvite: true,
      exclusive: true,
      by: "selfhost-e2e",
    });
    if (invite.status !== "created") {
      throw new Error(`The admin's invitation was not made (${invite.status})`);
    }
    const state: State = {
      fundId: fund.fundId,
      invitation: invitationUrl(appUrl, invite.token),
      email: ANSWERS.adminEmail,
    };
    mkdirSync(dirname(STATE_FILE), { recursive: true });
    writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    console.log(`ok  admin invitation for ${ANSWERS.adminEmail} (link in ${STATE_FILE})`);
  } finally {
    await client.end().catch(() => {});
  }
}

// ---------------------------------------------------------------------------------------------
// browser
// ---------------------------------------------------------------------------------------------

const results: string[] = [];
function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
  results.push(message);
  console.log(`ok  ${message}`);
}

/** Every "empty" text the charts can show (the English dictionary, so a new one is covered). */
function emptyChartTexts(): string[] {
  const found: string[] = [];
  const walk = (value: unknown, key: string) => {
    if (typeof value === "string") {
      if (/empty|nodata/i.test(key)) found.push(value);
    } else if (value && typeof value === "object") {
      for (const [child, inner] of Object.entries(value)) walk(inner, child);
    }
  };
  walk(chartTexts, "");
  return found;
}

/**
 * Charts on the page are drawn: no chart's "empty" text is visible, nothing is still loading, and
 * every chart-sized SVG (at least 80 × 48 px, so not an icon) draws at least one mark that is not
 * a grid line or a background covering the whole chart. Returns how many charts it checked.
 */
async function assertChartsDrawn(page: Page, where: string): Promise<number> {
  const empties = emptyChartTexts();
  const visibleEmpty: string[] = [];
  for (const text of empties) {
    const hits = page.getByText(text, { exact: true });
    for (let index = 0; index < (await hits.count()); index++) {
      if (await hits.nth(index).isVisible()) visibleEmpty.push(text);
    }
  }
  check(
    visibleEmpty.length === 0,
    `${where}: no chart says it is empty (${visibleEmpty.join(" | ")})`,
  );
  const report = await page.evaluate(() => {
    const busy = document.querySelectorAll('main [aria-busy="true"]').length;
    const empty: string[] = [];
    let charts = 0;
    for (const svg of Array.from(document.querySelectorAll("main svg"))) {
      const box = svg.getBoundingClientRect();
      if (box.width < 80 || box.height < 48) continue;
      if (getComputedStyle(svg).visibility === "hidden" || svg.closest("[aria-hidden=true]"))
        continue;
      charts += 1;
      const area = box.width * box.height;
      const marks = Array.from(
        svg.querySelectorAll("path, rect, circle, ellipse, polygon, polyline"),
      ).filter((element) => {
        const shape = element as SVGGraphicsElement;
        const rect = shape.getBoundingClientRect();
        if (rect.width <= 0 && rect.height <= 0) return false;
        if (getComputedStyle(shape).opacity === "0") return false;
        // A background (or clip) covering the whole chart is not data.
        if (shape.tagName === "rect" && rect.width * rect.height >= area * 0.95) return false;
        return true;
      });
      if (marks.length === 0) {
        const label =
          svg.getAttribute("aria-label") ??
          svg.closest("[aria-label]")?.getAttribute("aria-label") ??
          svg.getAttribute("class") ??
          "svg";
        empty.push(`${label} (${Math.round(box.width)}×${Math.round(box.height)})`);
      }
    }
    return { busy, empty, charts };
  });
  check(report.busy === 0, `${where}: nothing is still loading (${report.busy} busy)`);
  check(report.empty.length === 0, `${where}: every chart draws (${report.empty.join(" | ")})`);
  return report.charts;
}

async function settle(page: Page) {
  await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {});
  // The page's reveal animations are at most ~0.8 s; charts animate in a little longer.
  await page.waitForTimeout(2_500);
}

async function shot(page: Page, name: string) {
  const path = join(SHOTS, `${name}.png`);
  await page.screenshot({ path, fullPage: true });
  console.log(`    picture ${path}`);
}

async function demoCases(databaseUrl: string, fundId: string) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const deep = await client.query<{ id: string; name: string }>(
      `select c.id, co.name from public.cases c
         join public.companies co on co.id = c.company_id
        where c.fund_id = $1
          and exists (select 1 from public.analysis_runs r
                       where r.case_id = c.id and r.kind = 'deep' and r.status = 'complete')
        order by co.name limit 1`,
      [fundId],
    );
    const screening = await client.query<{ id: string; name: string }>(
      `select c.id, co.name from public.cases c
         join public.companies co on co.id = c.company_id
        where c.fund_id = $1
          and exists (select 1 from public.analysis_runs r
                       where r.case_id = c.id and r.kind = 'screening' and r.status = 'complete')
          and not exists (select 1 from public.analysis_runs r
                           where r.case_id = c.id and r.kind = 'deep')
        order by co.name limit 1`,
      [fundId],
    );
    const counted = await client.query<{ total: number }>(
      "select count(*)::int as total from public.cases where fund_id = $1",
      [fundId],
    );
    return { deep: deep.rows[0], screening: screening.rows[0], total: counted.rows[0]!.total };
  } finally {
    await client.end();
  }
}

async function browser() {
  const appUrl = localUrl("APP_URL");
  const databaseUrl = localUrl("DATABASE_URL");
  const state = JSON.parse(readFileSync(STATE_FILE, "utf8")) as State;
  const cases = await demoCases(databaseUrl, state.fundId);
  check(cases.total >= 10, `seed:demo wrote the demo cases (${cases.total})`);
  check(cases.screening, "a demo case has a screening and no deep analysis");
  check(cases.deep, "a demo case has a finished deep analysis");
  mkdirSync(SHOTS, { recursive: true });

  const consoleErrors: string[] = [];
  const instance = await launch();
  try {
    const context = await instance.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 1,
      colorScheme: "light",
      locale: "en-US",
      reducedMotion: "no-preference",
    });
    await guardContext(context);
    const page = await context.newPage();
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      const where = message.location()?.url ?? "";
      consoleErrors.push(`${message.text()}${where ? ` (${where})` : ""}`);
      console.error(`[console error] ${message.text()}`);
    });

    // 1. The invitation: a new access with a password, as the admin opens the link from setup.
    await page.goto(state.invitation, { timeout: 120_000 });
    await page.getByLabel("Your name").fill("Self-host Admin", { timeout: 60_000 });
    const email = page.getByLabel(/E-mail/).first();
    if (await email.isEditable()) await email.fill(state.email);
    await page.getByLabel("Choose a password").fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: "Create access" }).click();
    await page.waitForURL(/\/mfa/, { timeout: 60_000 });
    check(true, "the invitation creates the access and signs in");

    // 2. Two-step sign-in: the key the page shows, a code from it, as an authenticator app.
    const label = page.getByText("Can't scan? Enter this key in the app:");
    await label.waitFor({ timeout: 60_000 });
    const secret = (await label.locator("xpath=following-sibling::*[1]").innerText()).replace(
      /\s/g,
      "",
    );
    check(/^[A-Z2-7]{16,}$/.test(secret), "the two-step page shows a TOTP key");
    if (totpMsLeft() < 5_000) await page.waitForTimeout(totpMsLeft() + 500);
    await page.getByLabel("Code from the app").fill(totp(secret));
    await page.getByRole("button", { name: "Confirm" }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/mfa"), { timeout: 60_000 });
    check(true, "two-step sign-in is turned on and the app opens");

    // 3. The case list with the demo banner.
    await page.goto(`${appUrl}/cases`, { timeout: 120_000 });
    const banner = page.getByRole("status").filter({ hasText: "Demo data" });
    await banner.waitFor({ timeout: 60_000 });
    await page.getByText(cases.screening!.name).first().waitFor({ timeout: 60_000 });
    await settle(page);
    check(
      (await banner.innerText()).includes(`${cases.total} fictional cases`),
      `the banner says ${cases.total} fictional cases`,
    );
    check(
      await banner.getByRole("button", { name: "Delete demo data" }).isVisible(),
      "the admin sees Delete demo data",
    );
    await assertChartsDrawn(page, "case list");
    await shot(page, "01-case-list-demo-banner");

    // 4. A screening.
    await page.goto(`${appUrl}/cases/${cases.screening!.id}?view=screening`, { timeout: 120_000 });
    await page
      .getByRole("heading", { name: cases.screening!.name })
      .first()
      .waitFor({ timeout: 60_000 });
    await settle(page);
    const screeningCharts = await assertChartsDrawn(page, `screening (${cases.screening!.name})`);
    check(screeningCharts > 0, `the screening shows charts (${screeningCharts})`);
    await shot(page, "02-screening");

    // 5. The deep analysis report.
    await page.goto(`${appUrl}/cases/${cases.deep!.id}?view=deep`, { timeout: 120_000 });
    await page.getByRole("tab", { name: "Conclusion" }).waitFor({ timeout: 60_000 });
    await settle(page);
    const deepCharts = await assertChartsDrawn(page, `deep analysis (${cases.deep!.name})`);
    check(deepCharts > 0, `the deep analysis shows charts (${deepCharts})`);
    await shot(page, "03-deep-analysis");

    // 6. Delete demo data, then the empty case list: the first case in five steps.
    await page.goto(`${appUrl}/cases`, { timeout: 120_000 });
    await banner.waitFor({ timeout: 60_000 });
    await banner.getByRole("button", { name: "Delete demo data" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Delete demo data" }).click();
    await page
      .getByRole("heading", { name: "Your first case in five steps" })
      .waitFor({ timeout: 90_000 });
    await settle(page);
    check(
      (await page.getByRole("status").filter({ hasText: "Demo data" }).count()) === 0,
      "the demo banner is gone",
    );
    for (const step of [
      "Finish the investment thesis",
      "Invite your team",
      "Create a case",
      "Let Interlect screen it",
      "Decide the next step",
    ]) {
      check(await page.getByText(step, { exact: true }).isVisible(), `empty state step: ${step}`);
    }
    const left = await demoCases(databaseUrl, state.fundId);
    check(left.total === 0, `no case is left after Delete demo data (${left.total})`);
    await shot(page, "04-empty-state-five-steps");
  } finally {
    await instance.close();
  }

  check(pageErrors.length === 0, `no page errors (${pageErrors.join(" | ")})`);
  check(consoleErrors.length === 0, `no console errors (${consoleErrors.join(" | ")})`);
  check(
    blockedPaidCalls.length === 0,
    `no paid call was attempted (${blockedPaidCalls.join(", ")})`,
  );
  writeFileSync(join(SHOTS, "result.txt"), `${results.map((line) => `ok  ${line}`).join("\n")}\n`);
  console.log(`\nAll ${results.length} checks passed.`);
}

const command = process.argv[2];
const run = command === "install" ? install : command === "browser" ? browser : null;
if (!run) {
  console.error("Usage: scripts/selfhost/e2e.ts install | browser");
  process.exitCode = 2;
} else {
  run().catch((cause: unknown) => {
    console.error(cause instanceof Error ? cause.message : cause);
    process.exitCode = 1;
  });
}
