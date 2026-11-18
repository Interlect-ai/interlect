import { useEffect, useState, type ReactNode } from "react";
import { useRouterState } from "@tanstack/react-router";
import { useActiveFund } from "@/lib/funds/useActiveFund";
import { DEFAULT_LANGUAGE, isLanguage, type Language } from "./language";
import { pageForRoutes, pageHead } from "./page-head";
import { setUiLanguage } from "./ui-language";
import { LanguageContext } from "./useT";

/** The last fund language this browser showed, for pages before a fund is known. */
const STORAGE_KEY = "interlect.language";

function readRemembered(fallback: Language): Language {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isLanguage(stored) ? stored : fallback;
  } catch {
    return fallback;
  }
}

/**
 * The interface's language is the active fund's: one choice per team. Before a fund
 * is known (log ind, invitation, loading) it is the language this browser last saw a fund in,
 * else the installation's language for new teams (Danish when unknown); only the language
 * is remembered, never which fund. Sets `<html lang>` so screen readers and the browser's spelling
 * follow the choice. Read it with `useT()` / `useLanguage()`.
 */
export function FundLanguageProvider({
  children,
  installationLanguage = DEFAULT_LANGUAGE,
}: {
  children: ReactNode;
  installationLanguage?: Language;
}) {
  const { fund } = useActiveFund();
  const fundLanguage = fund?.language ?? null;
  // Read after hydration, so the server's and the browser's first render agree (the
  // installation's language, which the server sends with the page).
  const [remembered, setRemembered] = useState<Language>(installationLanguage);
  useEffect(() => setRemembered(readRemembered(installationLanguage)), [installationLanguage]);
  const language = fundLanguage ?? remembered;
  useEffect(() => {
    document.documentElement.lang = language;
    setUiLanguage(language);
  }, [language]);
  useEffect(() => {
    if (!fundLanguage) return;
    setRemembered(fundLanguage);
    try {
      window.localStorage.setItem(STORAGE_KEY, fundLanguage);
    } catch {
      /* storage may be unavailable (private mode, blocked cookies) */
    }
  }, [fundLanguage]);
  return (
    <LanguageContext.Provider value={language}>
      <PageHeadSync language={language} />
      {children}
    </LanguageContext.Provider>
  );
}

/**
 * The tab title and description in the active language. `head()` renders them in
 * Danish, and `HeadContent` writes them again after a navigation (sometimes after this effect),
 * so a small observer puts the active language's text back whenever the head changes.
 */
function PageHeadSync({ language }: { language: Language }) {
  const page = useRouterState({
    select: (state) => pageForRoutes(state.matches.map((match) => match.routeId)),
  });
  useEffect(() => {
    if (!page) return;
    const { title, description } = pageHead(page, language);
    const apply = () => {
      if (document.title !== title) document.title = title;
      const meta = document.querySelector('meta[name="description"]');
      if (meta && meta.getAttribute("content") !== description) {
        meta.setAttribute("content", description);
      }
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.head, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["content"],
    });
    return () => observer.disconnect();
  }, [page, language]);
  return null;
}
