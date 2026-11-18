/**
 * "Does the database have `cases.source_kind` yet?" (migration 0056). Staging and production
 * share one database, so a select or write of a missing column breaks the whole app; the UI and
 * the server function therefore ask first. Pure: the query and the clock come from outside, so
 * the cache rules are unit tested.
 *
 * - no error                       → present, cached 5 minutes
 * - 42703 (undefined column) or the column named in the message → missing, cached 20 seconds
 *   (a freshly run migration shows up within seconds)
 * - any other error                → treated as missing (never write on a guess), cached 20 s
 */
export const PROBE_TTL_PRESENT_MS = 5 * 60_000;
export const PROBE_TTL_MISSING_MS = 20_000;

export interface ProbeResult {
  error: { code?: string | null; message: string } | null;
}

export function createCaseOriginProbe(
  query: () => Promise<ProbeResult>,
  now: () => number = Date.now,
  log: (message: string, code: string | null | undefined) => void = () => undefined,
) {
  let cache: { value: boolean; expiresAt: number } | null = null;
  const probe = async (): Promise<boolean> => {
    const at = now();
    if (cache && cache.expiresAt > at) return cache.value;
    const { error } = await query();
    let present = false;
    if (!error) {
      present = true;
    } else if (error.code === "42703" || /source_kind/i.test(error.message)) {
      present = false;
    } else {
      log(error.message, error.code);
    }
    cache = {
      value: present,
      expiresAt: at + (present ? PROBE_TTL_PRESENT_MS : PROBE_TTL_MISSING_MS),
    };
    return present;
  };
  return probe;
}

/** Origin and owner may be set from intake by the creator within two hours, or by Lead/Admin. */
export const ORIGIN_EDIT_WINDOW_MS = 2 * 60 * 60_000;

export function mayEditCaseOrigin(input: {
  isLeadOrAdmin: boolean;
  callerId: string;
  createdBy: string | null;
  createdAt: string | null;
  now: number;
}): boolean {
  if (input.isLeadOrAdmin) return true;
  if (!input.createdBy || input.createdBy !== input.callerId || !input.createdAt) return false;
  const created = Date.parse(input.createdAt);
  return Number.isFinite(created) && input.now - created <= ORIGIN_EDIT_WINDOW_MS;
}
