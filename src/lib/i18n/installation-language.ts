/**
 * The installation's language for new teams (`ai_settings.default_language`, 0085; customer:new
 * sets it), for the pages before a team is known: log ind and the invitation. Only
 * the language, nothing else. Pure, so the cache is tested without a database.
 */
import { DEFAULT_LANGUAGE, type Language } from "./language.ts";

/** How long a read is kept per server instance; a failed read is tried again sooner. */
const KEEP_MS = 5 * 60_000;
const RETRY_MS = 30_000;

/**
 * `read` once per few minutes. A read that fails is logged and gives Danish, as: the
 * page is then shown in Danish rather than not at all.
 */
export function cachedInstallationLanguage(
  read: () => Promise<Language>,
  now: () => number = Date.now,
): () => Promise<Language> {
  let cached: { language: Language; until: number } | null = null;
  return async () => {
    if (cached && now() < cached.until) return cached.language;
    try {
      const language = await read();
      cached = { language, until: now() + KEEP_MS };
    } catch (cause) {
      console.error("[installationLanguage]", cause instanceof Error ? cause.message : cause);
      cached = { language: DEFAULT_LANGUAGE, until: now() + RETRY_MS };
    }
    return cached.language;
  };
}
