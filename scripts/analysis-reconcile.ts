/**
 * Afstemning af analysekørslernes pris for en måned (spec B.4 test 7): trin = kørsel =
 * kreditbog inden for få øre, og Vercels regning ved siden af kreditbogens samlede forbrug.
 *
 *   node --env-file=.env.local --import ./scripts/lib/register-alias.mjs scripts/analysis-reconcile.ts \
 *     [--month 2026-11] [--fund <id>] [--vercel-usd 12.34] [--tolerance 0.05]
 *
 * Reads with the service key (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY) and writes nothing (it
 * does not settle first: a finished run whose row is still reserved is reported as pending). The
 * month is UTC, like the ledger (0125). --vercel-usd is the AI Gateway amount on Vercel's bill for
 * the same month. Exits 1 when a run does not reconcile. On staging: tests/e2e/t1074-reconcile.ts.
 */
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  isRunRow,
  reconcile,
  reconcileReport,
  RECONCILE_TOLERANCE_DKK,
  type ReconcileLedgerRow,
  type ReconcileRunRow,
  type ReconcileStepRow,
} from "./lib/analysis-reconcile.ts";

const PAGE = 1000;
const CHUNK = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface ReconcileOptions {
  /** "YYYY-MM"; the current UTC month when not given. */
  month?: string | undefined;
  fundId?: string | undefined;
  vercelUsd?: number | null | undefined;
  toleranceDkk?: number | undefined;
  title?: string | undefined;
}

/** The month [start, end) in UTC. */
export function monthBounds(month: string | undefined, now: Date = new Date()): [Date, Date] {
  const match = /^(\d{4})-(\d{2})$/.exec(month ?? "");
  const year = match ? Number(match[1]) : now.getUTCFullYear();
  const index = match ? Number(match[2]) - 1 : now.getUTCMonth();
  if (month !== undefined && (!match || index < 0 || index > 11)) {
    throw new Error(`--month must be YYYY-MM, got "${month}"`);
  }
  return [new Date(Date.UTC(year, index, 1)), new Date(Date.UTC(year, index + 1, 1))];
}

/** Every row of a query, a page at a time (PostgREST returns at most 1000). */
async function allRows<T>(
  query: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
  what: string,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query(from, from + PAGE - 1);
    if (error) throw new Error(`${what}: ${error.message}`);
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

export async function runReconcile(
  service: SupabaseClient,
  options: ReconcileOptions = {},
): Promise<{ lines: string[]; problems: number }> {
  const [start, end] = monthBounds(options.month);
  const startIso = start.toISOString();
  const endIso = end.toISOString();
  const { data: settings, error: settingsError } = await service
    .from("ai_settings")
    .select("usd_to_dkk")
    .maybeSingle();
  if (settingsError || !settings) {
    throw new Error(`ai_settings: ${settingsError?.message ?? "no row"}`);
  }
  const rate = Number(settings["usd_to_dkk"]);

  const runs = await allRows<ReconcileRunRow>((from, to) => {
    let query = service
      .from("analysis_runs")
      .select("id, fund_id, kind, status, actual_cost, usd_to_dkk, validation_result")
      .in("kind", ["screening", "deep"])
      .in("status", ["complete", "awaiting_approval", "failed", "cancelled"])
      .gte("created_at", startIso)
      .lt("created_at", endIso)
      .order("created_at")
      .order("id");
    if (options.fundId) query = query.eq("fund_id", options.fundId);
    return query.range(from, to);
  }, "analysis_runs");

  const steps: ReconcileStepRow[] = [];
  for (let index = 0; index < runs.length; index += CHUNK) {
    const ids = runs.slice(index, index + CHUNK).map((run) => run.id);
    steps.push(
      ...(await allRows<ReconcileStepRow>(
        (from, to) =>
          service
            .from("analysis_run_steps")
            .select("run_id, actual_cost, charged_cost")
            .in("run_id", ids)
            .order("id")
            .range(from, to),
        "analysis_run_steps",
      )),
    );
  }

  // A run reserves just before it is created, so its row may be a little older than the run.
  const ledger = await allRows<ReconcileLedgerRow & { created_at: string }>((from, to) => {
    let query = service
      .from("ai_credit_ledger")
      .select("ref_id, kind, scope, status, loop, amount_dkk, note, created_at")
      .eq("kind", "usage")
      // Reserved too: a finished run whose row is not settled yet is "pending", not missing.
      .in("status", ["final", "reserved"])
      .gte("created_at", new Date(start.getTime() - DAY_MS).toISOString())
      .lt("created_at", endIso)
      .order("id");
    if (options.fundId) query = query.eq("fund_id", options.fundId);
    return query.range(from, to);
  }, "ai_credit_ledger");

  const result = reconcile({
    runs,
    steps,
    ledger,
    defaultRate: rate,
    toleranceDkk: options.toleranceDkk,
  });
  const otherBookedDkk = ledger
    .filter((row) => !isRunRow(row) && row.status === "final" && row.created_at >= startIso)
    .reduce((sum, row) => sum + Number(row.amount_dkk ?? 0), 0);
  const month = startIso.slice(0, 7);
  const lines = reconcileReport({
    title:
      options.title ??
      `Afstemning af analysekørsler · ${month}${options.fundId ? ` · team ${options.fundId}` : " · alle teams"}`,
    result,
    otherBookedDkk,
    vercelUsd: options.vercelUsd ?? null,
    rate,
  });
  return { lines, problems: result.problems.length };
}

export function serviceClientFrom(env: Record<string, string | undefined>): SupabaseClient {
  const url = env["SUPABASE_URL"];
  const key = env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function printReport(lines: string[]): void {
  for (const line of lines) console.log(line);
  const summary = process.env["GITHUB_STEP_SUMMARY"];
  if (summary) appendFileSync(summary, `${lines.join("\n")}\n\n`);
}

async function main() {
  const { values } = parseArgs({
    options: {
      month: { type: "string" },
      fund: { type: "string" },
      "vercel-usd": { type: "string" },
      tolerance: { type: "string" },
    },
  });
  const vercelUsd = values["vercel-usd"] === undefined ? null : Number(values["vercel-usd"]);
  const toleranceDkk =
    values.tolerance === undefined ? RECONCILE_TOLERANCE_DKK : Number(values.tolerance);
  if (vercelUsd !== null && !(Number.isFinite(vercelUsd) && vercelUsd >= 0)) {
    throw new Error("--vercel-usd must be a number of dollars");
  }
  if (!(Number.isFinite(toleranceDkk) && toleranceDkk >= 0)) {
    throw new Error("--tolerance must be a number of kroner");
  }
  const { lines, problems } = await runReconcile(serviceClientFrom(process.env), {
    month: values.month,
    fundId: values.fund,
    vercelUsd,
    toleranceDkk,
  });
  printReport(lines);
  if (problems > 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((cause: unknown) => {
    console.error(cause instanceof Error ? cause.message : cause);
    process.exitCode = 1;
  });
}
