/**
 * Brain · Sider (for): what the page list and a single page show. The database rows
 * (brain_pages, brain_page_versions, 0062) are checked and turned into view data; versions are
 * compared section by section with a line diff. Pure, so it is tested without a database; the
 * reads and the edit are in `pages.functions.ts`.
 */

import { translate, type MessageKey } from "../i18n/translate.ts";
import type { Language } from "../i18n/language.ts";

/** The page kinds as the words a page shows (Danish: what the server writes into the list). */
export const PAGE_KIND_KEY: Record<string, MessageKey> = {
  company: "brainKnowledge.card.kind.company",
  person: "brainKnowledge.card.kind.person",
  case: "brainKnowledge.card.kind.case",
  sector: "brainKnowledge.card.kind.sector",
  market: "brainKnowledge.card.kind.market",
  theme: "brainKnowledge.card.kind.theme",
  investor: "brainKnowledge.card.kind.investor",
  thesis: "brainKnowledge.card.kind.thesis",
  fund_overview: "brainKnowledge.card.kind.fund_overview",
};

/** The kind's word in a language, or undefined for a kind it does not know. */
export const pageKindLabel = (kind: string, language: Language = "da"): string | undefined =>
  PAGE_KIND_KEY[kind] ? translate(language, PAGE_KIND_KEY[kind]) : undefined;

export interface ViewSection {
  key: string;
  heading: string;
  bodyMd: string;
  factIds: string[];
  updatedAt: string | null;
  locked: boolean;
  /** Drawn from the database; cannot be edited or locked. */
  computed: boolean;
}

export interface PageSummary {
  id: string;
  kind: string;
  kindLabel: string;
  title: string;
  version: number;
  updatedAt: string;
  /** "L4" (Brain) or the id of the user who edited last. */
  editedByUser: boolean;
  sectionCount: number;
  lockedCount: number;
  /** The first lines of the first written section, for the list. */
  snippet: string;
}

export interface PageVersion {
  version: number;
  changedBy: string;
  editedByUser: boolean;
  changeNote: string | null;
  createdAt: string;
  sections: ViewSection[];
}

export interface PageDetail {
  id: string;
  kind: string;
  kindLabel: string;
  title: string;
  version: number;
  updatedAt: string;
  editedByUser: boolean;
  sections: ViewSection[];
  /** Newest first; the current version is the first entry. */
  versions: PageVersion[];
}

/** The longest text a user may keep in a section (the database refuses more than 5.000). */
export const MAX_USER_SECTION_CHARS = 5_000;
export const MAX_PAGE_LIST = 300;
export const MAX_PAGE_VERSIONS = 30;

const asString = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

/** A stored sections array as view data; malformed entries are dropped, never thrown on. */
export function shapeSections(raw: unknown): ViewSection[] {
  if (!Array.isArray(raw)) return [];
  const out: ViewSection[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;
    const key = asString(entry["key"]);
    if (!key) continue;
    out.push({
      key,
      heading: asString(entry["heading"], key),
      bodyMd: asString(entry["body_md"]),
      factIds: Array.isArray(entry["fact_ids"])
        ? entry["fact_ids"].filter((id): id is string => typeof id === "string")
        : [],
      updatedAt: typeof entry["updated_at"] === "string" ? entry["updated_at"] : null,
      locked: entry["locked_by_user"] === true,
      computed: entry["computed"] === true,
    });
  }
  return out;
}

const isUserEdit = (updatedBy: string) => updatedBy.startsWith("user:");

/** First words of the first written (else any) section without fact references. */
export function pageSnippet(sections: readonly ViewSection[], max = 140): string {
  const pick = sections.find((s) => !s.computed && s.bodyMd.trim()) ?? sections[0];
  if (!pick) return "";
  const text = pick.bodyMd
    .replace(/\s*\[f:[^\]\s]+\]/g, "")
    .replace(/^\s*[-*>#]+\s*/gm, "")
    .replace(/[*_`]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** `language` is the fund's: the kind word and the fallback title are written in it. */
export function shapePageSummary(
  row: Record<string, unknown>,
  language: Language = "da",
): PageSummary | null {
  const id = asString(row["id"]);
  if (!id) return null;
  const sections = shapeSections(row["sections"]);
  const kind = asString(row["kind"]);
  return {
    id,
    kind,
    kindLabel: pageKindLabel(kind, language) ?? kind,
    title: asString(row["title"], translate(language, "brainServer.pageServer.untitled")),
    version: Number(row["version"]) || 1,
    updatedAt: asString(row["updated_at"]),
    editedByUser: isUserEdit(asString(row["updated_by"])),
    sectionCount: sections.length,
    lockedCount: sections.filter((s) => s.locked).length,
    snippet: pageSnippet(sections),
  };
}

export function shapePageDetail(
  page: Record<string, unknown>,
  versionRows: ReadonlyArray<Record<string, unknown>>,
  language: Language = "da",
): PageDetail | null {
  const summary = shapePageSummary(page, language);
  if (!summary) return null;
  const versions = versionRows
    .map((row): PageVersion => {
      const changedBy = asString(row["changed_by"]);
      return {
        version: Number(row["version"]) || 0,
        changedBy,
        editedByUser: isUserEdit(changedBy),
        changeNote: typeof row["change_note"] === "string" ? row["change_note"] : null,
        createdAt: asString(row["created_at"]),
        sections: shapeSections(row["sections"]),
      };
    })
    .sort((a, b) => b.version - a.version);
  return {
    id: summary.id,
    kind: summary.kind,
    kindLabel: summary.kindLabel,
    title: summary.title,
    version: summary.version,
    updatedAt: summary.updatedAt,
    editedByUser: summary.editedByUser,
    sections: shapeSections(page["sections"]),
    versions,
  };
}

// --- Diff between two versions ----------------------------------------------------------------

export type DiffLine = { type: "same" | "add" | "del"; text: string };
export type SectionDiff = {
  key: string;
  heading: string;
  status: "added" | "removed" | "changed" | "same";
  lines: DiffLine[];
};

const linesOf = (text: string): string[] =>
  text
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line, i, all) => line || (i > 0 && i < all.length - 1));

/** A line diff by longest common subsequence; texts are short (a section is at most 5.000 chars). */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = linesOf(before);
  const b = linesOf(after);
  const table: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i]![j] =
        a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ type: "same", text: a[i]! });
      i++;
      j++;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      out.push({ type: "del", text: a[i++]! });
    } else {
      out.push({ type: "add", text: b[j++]! });
    }
  }
  while (i < a.length) out.push({ type: "del", text: a[i++]! });
  while (j < b.length) out.push({ type: "add", text: b[j++]! });
  return out;
}

/** Section by section: what an older version said and what the newer one says, in page order. */
export function diffSections(
  before: readonly ViewSection[],
  after: readonly ViewSection[],
): SectionDiff[] {
  const beforeByKey = new Map(before.map((s) => [s.key, s]));
  const out: SectionDiff[] = [];
  for (const section of after) {
    const old = beforeByKey.get(section.key);
    beforeByKey.delete(section.key);
    if (!old) {
      out.push({
        key: section.key,
        heading: section.heading,
        status: "added",
        lines: diffLines("", section.bodyMd),
      });
      continue;
    }
    const lines = diffLines(old.bodyMd, section.bodyMd);
    out.push({
      key: section.key,
      heading: section.heading,
      status: lines.some((line) => line.type !== "same") ? "changed" : "same",
      lines,
    });
  }
  for (const old of beforeByKey.values()) {
    out.push({
      key: old.key,
      heading: old.heading,
      status: "removed",
      lines: diffLines(old.bodyMd, ""),
    });
  }
  return out;
}

// --- Search and edit input --------------------------------------------------------------------

/** A search text for PostgREST filters: no characters that change the filter's meaning. */
export function cleanSearch(raw: string): string {
  return raw
    .replace(/[%,()*\\:"'`]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

export type EditCheck = { ok: true; body: string } | { ok: false; message: string };

export function checkEditBody(raw: string, language: Language = "da"): EditCheck {
  const body = raw.replace(/\r\n/g, "\n").trim();
  if (!body) return { ok: false, message: translate(language, "brainKnowledge.card.writeText") };
  if (body.length > MAX_USER_SECTION_CHARS) {
    return {
      ok: false,
      message: translate(language, "brainKnowledge.card.tooLongMax", {
        max: MAX_USER_SECTION_CHARS,
      }),
    };
  }
  return { ok: true, body };
}

// --- "Hvem var det nu lige?" -----------------------------------------------------

/** The sections the compact card shows per page kind, in this order (the rest stays on the page). */
export const CARD_SECTION_KEYS: Record<string, readonly string[]> = {
  company: ["overview", "our_history", "key_metrics", "risks_open_questions"],
  person: ["overview", "roles", "connections", "notes"],
};

/** Plain-language headings for the card; a short label is clearer than the page's own heading. */
export const CARD_HEADING_KEY: Record<string, MessageKey> = {
  our_history: "brainKnowledge.card.heading.our_history",
  risks_open_questions: "brainKnowledge.card.heading.risks_open_questions",
};

/** The card heading for a section key in a language, or undefined when the page's own is used. */
export const cardHeading = (key: string, language: Language = "da"): string | undefined =>
  CARD_HEADING_KEY[key] ? translate(language, CARD_HEADING_KEY[key]) : undefined;

export function cardSections(kind: string, sections: readonly ViewSection[]): ViewSection[] {
  const keys = CARD_SECTION_KEYS[kind] ?? [];
  const byKey = new Map(sections.map((section) => [section.key, section]));
  return keys
    .map((key) => byKey.get(key))
    .filter((section): section is ViewSection => Boolean(section && section.bodyMd.trim()))
    .map((section) => ({ ...section, heading: cardHeading(section.key) ?? section.heading }));
}

export interface BrainCard {
  /** "ok": a page exists; "no_page": the entity is known but has no page yet; "unknown": no entity. */
  state: "ok" | "no_page" | "unknown";
  /** The name to show even without a page. */
  title: string;
  kind: string | null;
  kindLabel: string | null;
  pageId: string | null;
  version: number | null;
  updatedAt: string | null;
  editedByUser: boolean;
  sections: ViewSection[];
  canEdit: boolean;
  /** The person's entity when the viewer may forget the person; absent otherwise. */
  forgetEntityId?: string;
}

export const emptyCard = (
  state: "no_page" | "unknown",
  title: string,
  canEdit: boolean,
): BrainCard => ({
  state,
  title,
  kind: null,
  kindLabel: null,
  pageId: null,
  version: null,
  updatedAt: null,
  editedByUser: false,
  sections: [],
  canEdit,
});

export function shapeCard(
  row: Record<string, unknown>,
  canEdit: boolean,
  language: Language = "da",
): BrainCard | null {
  const summary = shapePageSummary(row, language);
  if (!summary) return null;
  return {
    state: "ok",
    title: summary.title,
    kind: summary.kind,
    kindLabel: summary.kindLabel,
    pageId: summary.id,
    version: summary.version,
    updatedAt: summary.updatedAt,
    editedByUser: summary.editedByUser,
    sections: cardSections(summary.kind, shapeSections(row["sections"])),
    canEdit,
  };
}
