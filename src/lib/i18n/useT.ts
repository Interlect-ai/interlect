import { createContext, useCallback, useContext } from "react";
import { DEFAULT_LANGUAGE, LANGUAGE_TAGS, type Language } from "./language";
import { translate, type MessageKey, type TranslateVars } from "./translate";

/** The active fund's language, provided by `FundLanguageProvider` in the root route. */
export const LanguageContext = createContext<Language>(DEFAULT_LANGUAGE);

/** The active fund's language ("da" until a fund is known). */
export function useLanguage(): Language {
  return useContext(LanguageContext);
}

/** `t("nav.cases")` in the active fund's language. */
export function useT(): (key: MessageKey, vars?: TranslateVars) => string {
  const language = useLanguage();
  return useCallback(
    (key: MessageKey, vars?: TranslateVars) => translate(language, key, vars),
    [language],
  );
}

/** The BCP 47 tag for `Intl` formatting of numbers and dates in the active language. */
export function useLocaleTag(): string {
  return LANGUAGE_TAGS[useLanguage()];
}
