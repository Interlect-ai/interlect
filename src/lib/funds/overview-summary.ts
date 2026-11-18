/**
 * Batch 1: the numbers and short texts the "Se" view of /fond draws on its cards. Pure file
 * (no database), so the rules can be tested with node --test. Everything here is derived from
 * the fund's real active version; nothing is invented.
 */

import { translate } from "../i18n/translate.ts";
import { LANGUAGE_TAGS, type Language } from "../i18n/language.ts";

/** The first sentence of a text, as the quote on the "Tese og risiko" card. */
export function firstSentence(text: string, maxChars = 190): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return "";
  const match = /^.*?[.!?](?=\s|$)/.exec(clean);
  const sentence = match ? match[0] : clean;
  if (sentence.length <= maxChars) return sentence;
  const cut = sentence.slice(0, maxChars - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 60 ? cut.slice(0, lastSpace) : cut).replace(/[,;:\s]+$/, "")}…`;
}

function compactEur(value: number, language: Language): string {
  const number = (n: number) =>
    new Intl.NumberFormat(LANGUAGE_TAGS[language], { maximumFractionDigits: 1 }).format(n);
  if (value >= 1_000_000) {
    return translate(language, "fundSetup.summary.eurMillion", { n: number(value / 1_000_000) });
  }
  if (value >= 1_000) {
    return translate(language, "fundSetup.summary.eurThousand", { n: number(value / 1_000) });
  }
  return `€${number(value)}`;
}

/** "€0,5 mio. – €2 mio.", or just one bound, or null when no ticket is set. */
export function ticketLine(
  minEur: number | null,
  maxEur: number | null,
  language: Language = "da",
): string | null {
  if (minEur == null && maxEur == null) return null;
  if (minEur != null && maxEur != null)
    return `${compactEur(minEur, language)} – ${compactEur(maxEur, language)}`;
  if (minEur != null) {
    return translate(language, "fundSetup.summary.ticketFrom", {
      value: compactEur(minEur, language),
    });
  }
  return translate(language, "fundSetup.summary.ticketUpTo", {
    value: compactEur(maxEur as number, language),
  });
}

export interface ScoreCount {
  above: number;
  total: number;
}

/** "3 af 8 over tærsklen": counted in code over the screened cases. */
export function aboveThreshold(scores: readonly number[], threshold: number | null): ScoreCount {
  const total = scores.length;
  if (threshold === null) return { above: 0, total };
  return { above: scores.filter((score) => score >= threshold).length, total };
}

/**
 * The visible part of the 0-100 score line on "Effekt af den aktive version": the scores and
 * the threshold with 5 points of air, rounded out to tens and at least 40 points wide.
 */
export function scoreDomain(
  scores: readonly number[],
  threshold: number | null,
): { lo: number; hi: number } {
  const values = [...scores, ...(threshold === null ? [] : [threshold])];
  if (values.length === 0) return { lo: 0, hi: 100 };
  let lo = Math.max(0, Math.floor((Math.min(...values) - 5) / 10) * 10);
  let hi = Math.min(100, Math.ceil((Math.max(...values) + 5) / 10) * 10);
  while (hi - lo < 40) {
    if (lo > 0) lo = Math.max(0, lo - 10);
    if (hi - lo < 40 && hi < 100) hi = Math.min(100, hi + 10);
  }
  return { lo, hi };
}

/** Where a score sits on that line (percent from the left), clamped onto the line. */
export function dotPosition(score: number, domain: { lo: number; hi: number }): number {
  const percent = ((score - domain.lo) / (domain.hi - domain.lo)) * 100;
  return Math.min(100, Math.max(0, percent));
}

export function gateCounts(gates: ReadonlyArray<{ treatment: "hard" | "review" }>): {
  hard: number;
  review: number;
} {
  const hard = gates.filter((gate) => gate.treatment === "hard").length;
  return { hard, review: gates.length - hard };
}

export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export interface VersionInput {
  version: number;
  status: string;
  sourceBasis: string;
  activatedAt: string | null;
  createdAt: string;
}

export interface VersionRow {
  label: string;
  title: string;
  meta: string;
}

const VERSION_TITLE_KEY = {
  active: "fundSetup.summary.versionActive",
  draft: "fundSetup.summary.versionDraft",
} as const;

/** `source_basis` the editor writes for its own drafts: a machine value, shown in words. */
const EDITOR_SOURCE_BASIS = "administrator_configuration";

/** The Danish sentence `fundDraftRows` saved for a fund made in Danish (fund-draft.ts). */
const DANISH_TEMPLATE_BASIS =
  /^(.+)-skabelon oprettet i Interlect\.ai\. Kræver menneskelig gennemgang og publicering\.$/;

/** A template note saved in Danish reads in English in an English team; own text is left alone. */
function sourceText(source: string, language: Language): string {
  const template = language === "en" ? DANISH_TEMPLATE_BASIS.exec(source) : null;
  return template
    ? `${template[1]} template created in Interlect.ai. Requires human review and publishing.`
    : source;
}

/** A version has no title of its own (only `source_basis`): status, source and date instead. */
export function versionRow(
  input: VersionInput,
  formatDate: (iso: string) => string,
  language: Language = "da",
): VersionRow {
  const source = sourceText(input.sourceBasis.trim(), language);
  return {
    label: `v${input.version}`,
    title: translate(
      language,
      input.status === "active" || input.status === "draft"
        ? VERSION_TITLE_KEY[input.status]
        : "fundSetup.summary.versionPrevious",
    ),
    meta: `${
      source === EDITOR_SOURCE_BASIS
        ? translate(language, "fundSetup.summary.sourceSetup")
        : source || translate(language, "fundSetup.summary.noSource")
    } · ${formatDate(input.activatedAt ?? input.createdAt)}`,
  };
}
