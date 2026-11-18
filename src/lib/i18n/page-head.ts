/**
 * Page titles and descriptions in the fund's language. `head()` runs on the server
 * before any fund is known, so it renders Danish (`pageMeta`); in the browser `PageHeadSync`
 * replaces the title and description with the active language's, from the same dictionary keys.
 * Link previews (og:) stay Danish: a crawler never knows a fund's language.
 */
import type { FileRoutesById } from "../../routeTree.gen";
import { DEFAULT_LANGUAGE, type Language } from "./language.ts";
import { translate, type MessageKey } from "./translate.ts";

type PageKey = keyof typeof PAGE_HEADS;

const PAGE_HEADS = {
  overview: { title: "pages.overview.title" },
  cases: { title: "pages.cases.title" },
  case: { title: "pages.case.title" },
  brain: { title: "pages.brain.title" },
  createCase: { title: "pages.createCase.title", description: "pages.createCase.description" },
  fundSetup: { title: "pages.fundSetup.title", description: "pages.fundSetup.description" },
  newThesis: { title: "pages.newThesis.title", description: "pages.newThesis.description" },
  users: { title: "pages.users.title", description: "pages.users.description" },
  security: { title: "pages.security.title", description: "pages.security.description" },
  status: { title: "pages.status.title" },
  login: { title: "pages.login.title", description: "pages.login.description" },
  invitation: { title: "pages.invitation.title", description: "pages.invitation.description" },
  passwordReset: {
    title: "pages.passwordReset.title",
    description: "pages.passwordReset.description",
  },
  mfa: { title: "pages.mfa.title", description: "pages.mfa.description" },
} as const satisfies Record<string, { title: MessageKey; description?: MessageKey }>;

/** The routes whose head comes from the dictionary (internal pages stay Danish on purpose). */
export const ROUTE_PAGES: Partial<Record<keyof FileRoutesById, PageKey>> = {
  "/": "overview",
  "/cases/": "cases",
  "/cases/$caseId": "case",
  "/brain": "brain",
  "/opret-case": "createCase",
  "/fond/": "fundSetup",
  "/fond/ny": "newThesis",
  "/brugere": "users",
  "/sikkerhed": "security",
  "/status": "status",
  "/login": "login",
  "/invitation/accept": "invitation",
  "/nulstil-adgangskode": "passwordReset",
  "/mfa": "mfa",
};

export interface PageHead {
  title: string;
  description: string;
}

/** The page's title and description in `language` (the app's own description when it has none). */
export function pageHead(page: PageKey, language: Language): PageHead {
  const head: { title: MessageKey; description?: MessageKey } = PAGE_HEADS[page];
  return {
    title: translate(language, head.title),
    description: translate(language, head.description ?? "pages.root.description"),
  };
}

/** The title (and description) meta for a route's `head()`, rendered in Danish on the server. */
export function pageMeta(
  page: PageKey,
): Array<{ title: string } | { name: string; content: string }> {
  const { title, description } = pageHead(page, DEFAULT_LANGUAGE);
  return "description" in PAGE_HEADS[page]
    ? [{ title }, { name: "description", content: description }]
    : [{ title }];
}

/** The page of the deepest matched route that has one (null on internal and unknown pages). */
export function pageForRoutes(routeIds: readonly string[]): PageKey | null {
  for (let index = routeIds.length - 1; index >= 0; index--) {
    const page = ROUTE_PAGES[routeIds[index] as keyof FileRoutesById];
    if (page) return page;
  }
  return null;
}
