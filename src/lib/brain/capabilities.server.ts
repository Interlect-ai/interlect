/**
 * `getBrainCapabilities` (batch 0): what Brain can do for this user in this fund RIGHT NOW.
 * Staging and production share one database and only some Brain migrations have run, so no
 * Brain page or menu item may read a Brain table without asking here first. The answer never
 * throws for database reasons: if a probe cannot be asked, that part is "no".
 *
 * Probes use the service client with `select <column> limit 0` (no rows, no cost). Rules and
 * cache in `capabilities.ts` (5 minutes when present, 20 seconds when missing).
 */
import type { Access } from "@/lib/auth/access.server";
import {
  createCachedProbe,
  deriveBrainCapabilities,
  type BrainCapabilities,
  type BrainProbes,
  type ProbeResult,
} from "./capabilities";
import { CHAT_ROUTE_READY } from "./chat-contract";
import { isBrainEnabled } from "./flags";

const BRAIN_SOURCES_BUCKET = "brain-sources";

const warn = (name: string) => (message: string, code: string | null | undefined) =>
  console.warn(`[brain-capabilities] ${name} probe failed`, code, message);

async function service() {
  const { getServiceClient } = await import("@/lib/supabase/admin.server");
  return getServiceClient();
}

const columnProbe = (name: string, table: string, column: string) =>
  createCachedProbe(
    async (): Promise<ProbeResult> => {
      const { error } = await (await service()).from(table).select(column).limit(0);
      return { error };
    },
    Date.now,
    warn(name),
  );

const probeSettings = columnProbe("settings", "brain_fund_settings", "fund_id");
const probeEpisodesTable = columnProbe("episodes", "brain_episodes", "id");
const probeThreads = columnProbe("threads", "brain_threads", "id");
const probeIngestColumns = columnProbe("ingest", "brain_sources", "upload_completed_at");

/** Any episode for the fund (a cheap one-row read; cached per fund). */
const probeFundEpisodes = createCachedProbe(
  async (fundId): Promise<ProbeResult> => {
    const { data, error } = await (
      await service()
    )
      .from("brain_episodes")
      .select("id")
      .eq("fund_id", fundId)
      .limit(1);
    if (error) return { error };
    return { error: data && data.length > 0 ? null : { code: "EMPTY", message: "no episodes" } };
  },
  Date.now,
  (message, code) => {
    if (code !== "EMPTY") warn("fund episodes")(message, code);
  },
);

const probeBucket = createCachedProbe(
  async (): Promise<ProbeResult> => {
    const { error } = await (await service()).storage.getBucket(BRAIN_SOURCES_BUCKET);
    return { error: error ? { message: error.message } : null };
  },
  Date.now,
  warn("bucket"),
);

/** Everything the probes and the role say about Brain for one fund. Never throws for database reasons. */
export async function computeBrainCapabilities(
  fundId: string,
  access: Pick<Access, "roles" | "settings">,
): Promise<BrainCapabilities> {
  const flagOn = isBrainEnabled();
  // Nothing is read from the database while Brain is off (production today).
  const probes: BrainProbes = flagOn
    ? await (async () => {
        const settingsTable = await probeSettings();
        const [episodesTable, threadsTable, ingestColumns, bucket] = await Promise.all([
          probeEpisodesTable(),
          probeThreads(),
          probeIngestColumns(),
          probeBucket(),
        ]);
        return {
          flagOn,
          settingsTable,
          episodesTable,
          fundHasEpisodes: episodesTable ? await probeFundEpisodes(fundId) : false,
          threadsTable,
          chatRouteReady: CHAT_ROUTE_READY,
          ingestColumns,
          bucket: ingestColumns ? bucket : false,
        };
      })()
    : {
        flagOn,
        settingsTable: false,
        episodesTable: false,
        fundHasEpisodes: false,
        threadsTable: false,
        chatRouteReady: CHAT_ROUTE_READY,
        ingestColumns: false,
        bucket: false,
      };
  return deriveBrainCapabilities(probes, access.roles, access.settings);
}
