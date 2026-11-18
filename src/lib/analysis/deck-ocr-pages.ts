/**
 * B7: ren logik for tekstgenkendelse af deck-sider (hvilke sider, og hvad det højst kan
 * koste). Ingen database eller netværk, så den kan testes med node --test.
 */

import { serverText } from "../i18n/server-text.ts";
import type { MessageKey, TranslateVars } from "../i18n/translate.ts";

/** Messages to the person, in the page's language or the fund's in a worker. */
function msg(key: string, vars?: TranslateVars) {
  return serverText(`analysisServer.deck.${key}` as MessageKey, vars);
}
// i18n-keep: stored as the evidence's source ("stated by"), and matched on.
export const DECK_OCR_STATED_BY = "Virksomhedens pitch deck (tekst genkendt fra billede)";

const THIN_PAGE_CHARS = 200;
/** Højst så mange sider pr. kald, så svaret når frem inden for tidsgrænsen; resten tages ved næste screening. */
const MAX_OCR_PAGES = 12;
/** Forsigtigt skøn: hver PDF-side sendes som billede plus tekst. */
const INPUT_TOKENS_PER_PAGE = 2_500;
const OUTPUT_TOKENS_PER_PAGE = 500;
/** openai/gpt-5.4-mini, jf. budgets.ts. */
const PRICE_PER_MILLION = { input: 0.75, output: 4.5 };

/**
 * Sider med under 200 tegn tekst, som ikke allerede er læst eller forsøgt læst (en side
 * uden læsbar tekst betales ikke igen ved næste screening). Sider uden række tæller som tomme.
 */
export function thinPages(input: {
  pageCount: number;
  rows: Array<{ slideRef: number | null; excerpt: string | null; statedBy: string | null }>;
  attempted?: number[];
}): number[] {
  const chars = new Map<number, number>();
  const done = new Set<number>(input.attempted ?? []);
  for (const row of input.rows) {
    if (row.slideRef === null) continue;
    if (row.statedBy === DECK_OCR_STATED_BY) done.add(row.slideRef);
    chars.set(row.slideRef, (chars.get(row.slideRef) ?? 0) + (row.excerpt?.trim().length ?? 0));
  }
  const pages: number[] = [];
  for (let page = 1; page <= input.pageCount && pages.length < MAX_OCR_PAGES; page += 1) {
    if (!done.has(page) && (chars.get(page) ?? 0) < THIN_PAGE_CHARS) pages.push(page);
  }
  return pages;
}

/** Højeste pris for ét kald: de sendte sider som input (hele PDF'en kun som nødløsning), output pr. ønsket side. */
export function estimateDeckOcrUsd(pageCount: number, requestedPages: number) {
  const maxInputTokens = pageCount * INPUT_TOKENS_PER_PAGE + 1_000;
  const maxOutputTokens = Math.min(8_000, requestedPages * OUTPUT_TOKENS_PER_PAGE + 200);
  const maxCostUsd =
    Math.ceil(
      ((maxInputTokens * PRICE_PER_MILLION.input + maxOutputTokens * PRICE_PER_MILLION.output) /
        1_000_000) *
        10_000,
    ) / 10_000;
  return { maxCostUsd, maxInputTokens, maxOutputTokens };
}

/** Pris ud fra det faktiske tokenforbrug, når gatewayen ikke oplyser prisen. */
export function usageCostUsd(inputTokens: number | null, outputTokens: number | null) {
  if (inputTokens === null || outputTokens === null) return null;
  return (
    (inputTokens * PRICE_PER_MILLION.input + outputTokens * PRICE_PER_MILLION.output) / 1_000_000
  );
}

export type RecognisedPages =
  | { ok: true; pages: Array<{ page: number; text: string }>; dropped: number }
  | { ok: false; reason: string };

/**
 * Kontrollér modellens svar. Et sidenummer uden for decket betyder, at modellen har talt
 * forkert (fx fra 0 eller efter de trykte slide-numre), så hele svaret afvises i stedet for
 * at gemme tekst på forkerte sider. Ikke-ønskede sider, dubletter og tomme tekster tælles.
 */
export function recognisedPages(
  output: Array<{ page: number; text: string }>,
  requested: number[],
  pageCount: number,
  maxChars: number,
): RecognisedPages {
  if (
    output.some((item) => !Number.isInteger(item.page) || item.page < 1 || item.page > pageCount)
  ) {
    return { ok: false, reason: msg("pages.mismatch") };
  }
  const wanted = new Set(requested);
  const seen = new Set<number>();
  const pages: Array<{ page: number; text: string }> = [];
  for (const item of output) {
    const text = String(item.text ?? "")
      .trim()
      .slice(0, maxChars);
    if (!wanted.has(item.page) || seen.has(item.page) || !text) continue;
    seen.add(item.page);
    pages.push({ page: item.page, text });
  }
  return { ok: true, pages, dropped: output.length - pages.length };
}
