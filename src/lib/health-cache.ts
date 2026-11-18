/**
 * Small helpers for the health check: a time limit for a call that may hang, and a short
 * cache, so /api/health and /status do not open a database call for every hit (a watch calls
 * every 15 minutes, but anyone may call a public address). Pure; tested with node --test.
 */

/** Rejects with `Error(label)` when `work` has not finished after `ms`. */
export function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(label)), ms);
  });
  return Promise.race([work, limit]).finally(() => clearTimeout(timer));
}

/**
 * Runs `load` at most once per `ttlMs`; callers meanwhile share the result, and callers that
 * arrive during a load share that load. A rejected load is not kept.
 */
export function cachedFor<T>(load: () => Promise<T>, ttlMs: number, now: () => number = Date.now) {
  let value: { at: number; data: T } | null = null;
  let loading: Promise<T> | null = null;
  return async (): Promise<T> => {
    if (value && now() - value.at < ttlMs) return value.data;
    loading ??= load()
      .then((data) => {
        value = { at: now(), data };
        return data;
      })
      .finally(() => {
        loading = null;
      });
    return loading;
  };
}
