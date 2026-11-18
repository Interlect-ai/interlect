/**
 * The server's messages to the person in the language their page is shown in: the
 * browser sends it with every server function call (`ui-language.ts`). A call without it (a
 * worker, a script, an old tab) gets Danish, as before. Display only, never access.
 * Server-only functions, so the helpers in `*.functions.ts` files can use them outside a handler.
 */
import { createServerOnlyFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { DEFAULT_LANGUAGE, parseLanguage, type Language } from "./language.ts";
import { translate, type MessageKey, type TranslateVars } from "./translate.ts";
import { LANGUAGE_HEADER } from "./ui-language.ts";

/** Where `language-scope.server.ts` keeps a worker's fund language (on `globalThis`). */
export const LANGUAGE_SCOPE_KEY = "__interlectLanguageScope";

/**
 * The language of the work in progress: a worker's fund language (`withFundLanguage`), else the
 * language of the page that made this request, else Danish.
 */
export const requestLanguage = createServerOnlyFn((): Language => {
  const scoped = (
    globalThis as unknown as Record<string, { getStore(): Language | undefined } | undefined>
  )[LANGUAGE_SCOPE_KEY]?.getStore();
  if (scoped) return scoped;
  try {
    return parseLanguage(getRequestHeader(LANGUAGE_HEADER));
  } catch {
    return DEFAULT_LANGUAGE;
  }
});

/** `t()` on the server, in the requesting page's language. */
export const serverText = createServerOnlyFn((key: MessageKey, vars?: TranslateVars): string =>
  translate(requestLanguage(), key, vars),
);
