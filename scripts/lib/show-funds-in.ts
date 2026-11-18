/**
 * Shows the signed-in person's teams in another language in one test browser only (moved out of
 * scripts/visual-compare.ts so the proof scripts in tests/e2e can use it): Danish is proven
 * on "Interlect Demo" this way, never with a Danish test team (beslutningslog 25 Oct).
 */
import type { BrowserContext } from "playwright-core";
import { fromCrossJSON, toCrossJSON } from "seroval";
import { serverFnNameFromUrl } from "./server-fn-id.mjs";

/**
 * --language: every fund in `listMemberFunds`' answer gets this language, in this browser only.
 * An error or an unexpected answer passes through untouched; `rewritten` says whether it worked.
 */
export async function showFundsIn(context: BrowserContext, language: string) {
  const state = { rewritten: 0 };
  await context.route("**/_serverFn/**", async (route) => {
    if (serverFnNameFromUrl(route.request().url()) !== "listMemberFunds") return route.fallback();
    const response = await route.fetch();
    if (!response.ok()) return route.fulfill({ response });
    let decoded: { result?: unknown };
    try {
      decoded = fromCrossJSON(await response.json(), { refs: new Map() }) as { result?: unknown };
    } catch {
      return route.fulfill({ response });
    }
    if (!Array.isArray(decoded.result)) return route.fulfill({ response });
    for (const fund of decoded.result as Array<Record<string, unknown>>)
      fund["language"] = language;
    state.rewritten += 1;
    const headers = { ...response.headers() };
    delete headers["content-length"];
    delete headers["content-encoding"];
    return route.fulfill({
      status: response.status(),
      headers,
      contentType: "application/json",
      body: JSON.stringify(toCrossJSON(decoded, { refs: new Map() })),
    });
  });
  return state;
}
