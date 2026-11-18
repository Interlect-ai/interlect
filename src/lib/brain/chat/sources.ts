/**
 * The chat's sources ("Svar-kontrakt"), pure: every row a tool returns that may be cited
 * gets a number once per answer, the model cites it as [n], and after the stream the code checks
 * that each [n] points to a row a tool really returned. Only cited rows become citations; an [n]
 * without a row marks the answer "Nogle påstande mangler kilde". Entities are never sources:
 * their summary is derived, so tools give them to the model without a number.
 */
import type { Language } from "../../i18n/language.ts";
import { translate } from "../../i18n/translate.ts";
import type { ChatCitation, CitationKind, CitationTrust } from "../chat-contract.ts";

export type SourceItem = {
  kind: Extract<CitationKind, "chunk" | "fact" | "case" | "event" | "web">;
  id: string;
  label: string;
  quote?: string | null;
  trustTier?: string | null;
  /** "table:id" of the raw row behind it (episodes), so the UI can open the target. */
  ref?: string | null;
  caseId?: string | null;
  /** ISO date or timestamp of the source. */
  at?: string | null;
};

export type NumberedSource = SourceItem & { n: number };

/** The contract allows n up to 999; one answer never needs more than this. */
export const MAX_SOURCES = 300;
const LABEL_MAX = 400;
const QUOTE_MAX = 2000;

export type SourceRegistry = {
  /** The item's number; the same kind and id keep their first number. Null when full. */
  add(item: SourceItem): number | null;
  get(n: number): NumberedSource | undefined;
  readonly size: number;
};

export function createSourceRegistry(limit = MAX_SOURCES): SourceRegistry {
  const byKey = new Map<string, number>();
  const byN = new Map<number, NumberedSource>();
  return {
    add(item) {
      const key = `${item.kind}:${item.id}`;
      const known = byKey.get(key);
      if (known !== undefined) return known;
      if (byN.size >= limit) return null;
      const n = byN.size + 1;
      byKey.set(key, n);
      byN.set(n, { ...item, n });
      return n;
    },
    get(n) {
      return byN.get(n);
    },
    get size() {
      return byN.size;
    },
  };
}

/** "[3]" and, leniently, "[1, 4]"; numbers inside words or links are not markers. */
const MARKER = /\[(\d{1,3}(?:\s*,\s*\d{1,3})*)\]/g;

export type CitationCheck = {
  /** Cited numbers that exist, in order of first appearance. */
  cited: number[];
  /** Numbers in the text that no tool returned. */
  unknown: number[];
  /** Made-up markers that are not numbers, e.g. "[get_case-data]" (live test 4 Oct 2026). */
  invalid: string[];
};

/** A bracketed word without spaces is a citation attempt; "[påstand fra selskabet]" is not. */
const FAKE_MARKER = /\[([A-Za-z_][\w.:-]{1,60})\]/g;

export function checkCitations(text: string, registry: Pick<SourceRegistry, "get">): CitationCheck {
  const cited: number[] = [];
  const unknown: number[] = [];
  const invalid = [...new Set([...text.matchAll(FAKE_MARKER)].map((match) => match[0]))];
  const seen = new Set<number>();
  for (const match of text.matchAll(MARKER)) {
    for (const part of (match[1] ?? "").split(",")) {
      const n = Number(part.trim());
      if (!Number.isInteger(n) || seen.has(n)) continue;
      seen.add(n);
      (registry.get(n) ? cited : unknown).push(n);
    }
  }
  return { cited, unknown, invalid };
}

/** Earlier answers go back to the model without their markers: their numbers meant other rows. */
export function stripCitationMarkers(text: string): string {
  return text
    .replace(MARKER, "")
    .replace(/[ \t]+([.,;:!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** Only these tiers are shown with a mark; the rest carry no trust label (contract). */
export function citationTrust(tier: string | null | undefined): CitationTrust | null {
  switch (tier) {
    case "official":
      return "verified";
    case "customer_doc":
    case "company_claim":
    case "public_web":
      return tier;
    default:
      return null;
  }
}

export function toCitation(source: NumberedSource, caseNames?: Map<string, string>): ChatCitation {
  const company = source.caseId ? caseNames?.get(source.caseId) : undefined;
  const label =
    company && !source.label.startsWith(company) ? `${company} · ${source.label}` : source.label;
  return {
    n: source.n,
    kind: source.kind,
    id: source.id,
    label: clip(label, LABEL_MAX) || "Kilde",
    quote: source.quote ? clip(source.quote, QUOTE_MAX) : null,
    trust: citationTrust(source.trustTier),
    ref: source.ref ?? null,
    caseId: source.caseId ?? null,
    at: source.at ?? null,
  };
}

/** The cited sources as citations, in order of first appearance in the answer. */
export function citationsFor(
  check: CitationCheck,
  registry: Pick<SourceRegistry, "get">,
  caseNames?: Map<string, string>,
): ChatCitation[] {
  return check.cited.flatMap((n) => {
    const source = registry.get(n);
    return source ? [toCitation(source, caseNames)] : [];
  });
}

export function clip(text: string, max: number): string {
  const flat = text.trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

const EPISODE_KINDS = [
  "evidence",
  "finding",
  "risk",
  "recommendation",
  "category_score",
  "calculation",
  "case_note",
  "document_page",
  "analysis_summary",
  "decision",
  "identity",
  "source_chunk",
  "historical_decision",
  "answer",
  "watch_signal",
] as const;

/**
 * The label of an episode kind (the chunk's origin) in the team's language: it is saved
 * with the answer's sources and shown as it was saved.
 */
export function episodeLabel(kind: string | null | undefined, language: Language): string {
  const known = (EPISODE_KINDS as readonly string[]).includes(kind ?? "")
    ? (kind as (typeof EPISODE_KINDS)[number])
    : "source_chunk";
  return translate(language, `brainServer.chat.sourceKind.${known}`);
}
