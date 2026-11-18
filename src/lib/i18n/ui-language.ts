/**
 * The language the interface is shown in right now, outside React: the browser sends
 * it with every server function call (`X-Interlect-Language`), so the server's messages to the
 * person come back in the same language as the page (`serverText`). Display only; it never
 * decides access or what AI writes (that is the fund's own setting).
 */
import { DEFAULT_LANGUAGE, type Language } from "./language.ts";

export const LANGUAGE_HEADER = "X-Interlect-Language";

let current: Language = DEFAULT_LANGUAGE;

export function setUiLanguage(language: Language): void {
  current = language;
}

export function uiLanguage(): Language {
  return current;
}
