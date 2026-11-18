import { gatewayToken } from "@/lib/ai/gateway-token";
import { cachedFor, withTimeout } from "@/lib/health-cache";
import { stalledRunIds } from "@/lib/health-runs";
import { STALE_DEEP_MS } from "@/lib/cases/run-stall";
import { getServiceClient } from "@/lib/supabase/admin.server";
import {
  serverSupabasePublishableKey,
  serverSupabaseServiceRoleKey,
  serverSupabaseUrl,
} from "@/lib/supabase/env";

/**
 * The installation's health for customer:new and release.yml: the Supabase
 * settings are there, the database answers with the service role, and the AI Gateway can be
 * reached with a key or the project's OIDC token. Public and without detail (no names, ids or
 * messages), so it tells an outsider nothing but up or down. The answer is kept for 30 s and the
 * database call has a 5 s limit. 503 when anything is missing.
 * `runs` is false when an analysis run stands queued or running with no new step for
 * longer than a run may (the queue lost it): the answer is then "degraded" (503), so the watch,
 * the release check and the handover see a standstill that the database check cannot.
 * `registries` says whether the keyed registers (CVR via Datafordeler, Bolagsverket) have
 * their keys; it is reported, not counted in `ok`, since an installation screens without them.
 */
export type HealthChecks = {
  config: boolean;
  database: boolean;
  ai: boolean;
  runs: boolean;
  registries: boolean;
};

/** The registers that need a key; the others are open (src/lib/analysis/registries). */
export function registryKeysSet(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(
    env["DATAFORDELER_API_KEY"]?.trim() &&
    env["BOLAGSVERKET_CLIENT_ID"]?.trim() &&
    env["BOLAGSVERKET_CLIENT_SECRET"]?.trim(),
  );
}

/** The database must answer within this, or the installation counts as down. */
const DATABASE_TIMEOUT_MS = 5_000;
/** One real check per window: the public address cannot be used to open a database call per hit. */
const CACHE_MS = 30_000;

/** At most this many open runs are read per check; one stalled run is enough to report. */
const OPEN_RUNS_LIMIT = 50;

/**
 * True when no open run is stalled. A read error counts as fine here (the database check reports
 * an outage) but is logged, so it is not silent.
 */
async function noStalledRun(): Promise<boolean> {
  try {
    const service = getServiceClient();
    const cutoff = new Date(Date.now() - STALE_DEEP_MS).toISOString();
    const { data: runs, error } = await withTimeout(
      Promise.resolve(
        service
          .from("analysis_runs")
          .select("id, created_at")
          .in("status", ["queued", "running"])
          .lt("created_at", cutoff)
          .limit(OPEN_RUNS_LIMIT),
      ),
      DATABASE_TIMEOUT_MS,
      "run check timed out",
    );
    if (error) throw new Error(error.message);
    if (!runs?.length) return true;
    const { data: steps, error: stepsError } = await withTimeout(
      Promise.resolve(
        service
          .from("analysis_run_steps")
          .select("run_id, started_at, completed_at")
          .in(
            "run_id",
            runs.map((run) => run.id),
          ),
      ),
      DATABASE_TIMEOUT_MS,
      "run step check timed out",
    );
    if (stepsError) throw new Error(stepsError.message);
    return stalledRunIds(runs, steps ?? [], Date.now()).length === 0;
  } catch (cause) {
    console.error("[health] runs", cause instanceof Error ? cause.message : cause);
    return true;
  }
}

async function checkInstallation(): Promise<HealthChecks> {
  const config = Boolean(
    serverSupabaseUrl() && serverSupabasePublishableKey() && serverSupabaseServiceRoleKey(),
  );
  const ai = Boolean(gatewayToken());
  let database = false;
  let runs = true;
  if (config) {
    try {
      // The settings row exists in every installation (0070); one row, no customer data.
      const { error } = await withTimeout(
        Promise.resolve(getServiceClient().from("ai_settings").select("id").limit(1)),
        DATABASE_TIMEOUT_MS,
        "database check timed out",
      );
      database = !error;
      if (error) console.error("[health] database", error.message);
    } catch (cause) {
      console.error("[health] database", cause instanceof Error ? cause.message : cause);
    }
    if (database) runs = await noStalledRun();
  }
  return { config, database, ai, runs, registries: registryKeysSet() };
}

export const installationHealth = cachedFor(checkInstallation, CACHE_MS);

export async function handleHealth(): Promise<Response> {
  const checks = await installationHealth();
  const up = checks.config && checks.database && checks.ai;
  const ok = up && checks.runs;
  return Response.json(
    { ok, ...(up && !ok ? { degraded: true } : {}), checks },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
