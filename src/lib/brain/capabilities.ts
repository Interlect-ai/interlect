/**
 * Brain capability probe (batch 0), pure part. Staging and production share ONE database
 * and only migrations 0040-0045 have run, so a page that selects a missing Brain table breaks
 * for everybody. The UI therefore asks first (`getBrainCapabilities`) and shows Brain only when
 * the answer is yes. Pure: the query and the clock come from outside, so the rules are unit
 * tested (same pattern as `createCaseOriginProbe`, src/lib/cases/intake-probe.ts).
 *
 * - no error                                  -> present, cached 5 minutes
 * - 42P01 (missing table), 42703 (missing column) or PGRST205/PGRST204 (the REST layer's
 *   "not in schema cache")                    -> missing, cached 20 seconds
 * - any other error                           -> treated as missing (never show on a guess),
 *   logged, cached 20 seconds
 */
import { hasCapability, type FundSettings } from "../domain/workflow.ts";
import type { AppRole } from "../supabase/types.ts";

export const PROBE_TTL_PRESENT_MS = 5 * 60_000;
export const PROBE_TTL_MISSING_MS = 20_000;

export interface ProbeResult {
  error: { code?: string | null; message: string } | null;
}

/** Postgres and PostgREST codes that mean "this table or column does not exist (yet)". */
const MISSING_CODES = new Set(["42P01", "42703", "PGRST205", "PGRST204"]);

export function isMissingError(error: { code?: string | null; message: string }): boolean {
  if (error.code && MISSING_CODES.has(error.code)) return true;
  return /does not exist|schema cache/i.test(error.message);
}

/** A cached yes/no probe. `key` lets one probe keep separate answers (for example per fund). */
export function createCachedProbe(
  query: (key: string) => Promise<ProbeResult>,
  now: () => number = Date.now,
  log: (message: string, code: string | null | undefined) => void = () => undefined,
) {
  const cache = new Map<string, { value: boolean; expiresAt: number }>();
  return async (key = ""): Promise<boolean> => {
    const at = now();
    const hit = cache.get(key);
    if (hit && hit.expiresAt > at) return hit.value;
    let present = false;
    try {
      const { error } = await query(key);
      if (!error) present = true;
      else if (!isMissingError(error)) log(error.message, error.code);
    } catch (cause) {
      log(cause instanceof Error ? cause.message : "probe threw", null);
    }
    cache.set(key, {
      value: present,
      expiresAt: at + (present ? PROBE_TTL_PRESENT_MS : PROBE_TTL_MISSING_MS),
    });
    return present;
  };
}

export interface BrainCapabilities {
  /** `BRAIN_ENABLED` is on and the settings table (0040) exists. */
  enabled: boolean;
  /** There is something to search: at least one episode for the fund (0041). */
  memory: boolean;
  /** Threads can be saved and answered: `brain_threads` (0047) and the chat route is live. */
  chat: boolean;
  /** Attaching files works: 0053 columns and the bucket exist. */
  ingest: boolean;
  canChat: boolean;
  canIngest: boolean;
  canForget: boolean;
}

/** What the database and the code say, before the role is looked at. */
export interface BrainProbes {
  flagOn: boolean;
  settingsTable: boolean;
  episodesTable: boolean;
  fundHasEpisodes: boolean;
  threadsTable: boolean;
  chatRouteReady: boolean;
  ingestColumns: boolean;
  bucket: boolean;
}

export function deriveBrainCapabilities(
  probes: BrainProbes,
  roles: readonly AppRole[],
  settings: FundSettings,
): BrainCapabilities {
  const enabled = probes.flagOn && probes.settingsTable;
  return {
    enabled,
    memory: enabled && probes.episodesTable && probes.fundHasEpisodes,
    chat: enabled && probes.threadsTable && probes.chatRouteReady,
    ingest: enabled && probes.ingestColumns && probes.bucket,
    canChat: hasCapability(roles, "brain_chat", settings),
    canIngest: hasCapability(roles, "brain_ingest", settings),
    canForget: hasCapability(roles, "brain_forget", settings),
  };
}

/** Everything off: the answer when the probe could not be asked. */
export const NO_BRAIN: BrainCapabilities = {
  enabled: false,
  memory: false,
  chat: false,
  ingest: false,
  canChat: false,
  canIngest: false,
  canForget: false,
};

/** The menu item "Brain" and the "Spørg Interlect" pill: only when chat works AND the role may. */
export function showBrain(caps: BrainCapabilities | null | undefined): boolean {
  return Boolean(caps && caps.enabled && caps.chat && caps.canChat);
}
