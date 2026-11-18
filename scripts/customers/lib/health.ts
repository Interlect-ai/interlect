/**
 * Waits until an installation answers ok on /api/health (src/lib/health.server.ts), for
 * customer:new and release.yml. A new address can need a few minutes for its
 * certificate, so it tries for 5 minutes; anything but { ok: true } with 200 is not healthy.
 */
type Fetch = (url: string, init: RequestInit) => Promise<Response>;

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

export async function waitForHealth(
  url: string,
  options: {
    timeoutMs?: number;
    intervalMs?: number;
    fetchImpl?: Fetch;
    wait?: (ms: number) => Promise<void>;
    now?: () => number;
    onWait?: (why: string) => void;
  } = {},
) {
  const {
    timeoutMs = 5 * 60_000,
    intervalMs = 15_000,
    fetchImpl = fetch,
    wait = sleep,
    now = Date.now,
    onWait = () => {},
  } = options;
  const deadline = now() + timeoutMs;
  for (;;) {
    let why: string;
    try {
      const response = await fetchImpl(url, { headers: { "Cache-Control": "no-store" } });
      const body = (await response.json().catch(() => null)) as {
        ok?: unknown;
        checks?: Record<string, unknown>;
      } | null;
      if (response.ok && body?.ok === true) return;
      why = `${response.status} ${JSON.stringify(body?.checks ?? {})}`;
    } catch (cause) {
      why = cause instanceof Error ? cause.message : String(cause);
    }
    if (now() >= deadline) throw new Error(`${url} is not healthy: ${why}`);
    onWait(why);
    await wait(intervalMs);
  }
}
