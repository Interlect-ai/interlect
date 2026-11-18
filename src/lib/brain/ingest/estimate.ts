/**
 * The price shown before an upload is read: "Anslået pris: X kr. (maks. Y kr.)". The
 * maximum is what the budget reserves (every L1 batch at its cap, the classification at its
 * maximum); the typical figure is what a finished source has cost so far. Pure, so it is tested.
 */
import { AI_BUDGETS } from "../../analysis/budgets.ts";
import { batchEpisodes, L1_BATCH_CAP_USD } from "../extract.ts";
import type { Chunk } from "./chunk.ts";
import { LANGUAGE_TAGS, type Language } from "../../i18n/language.ts";
import { translate } from "../../i18n/translate.ts";

/** The limits per document, per website and per batch of uploads. */
export const INGEST_LIMITS_DKK = { document: 3, website: 10, batch: 25 } as const;

/** The limit for one source: a website has its own, every file the document limit. */
export function ingestLimitDkk(kind: string): number {
  return kind === "website" ? INGEST_LIMITS_DKK.website : INGEST_LIMITS_DKK.document;
}

const EMBEDDING_USD_PER_TOKEN = 0.02 / 1_000_000;
/** One classification call (the first ~3.000 tokens, a small model). */
const CLASSIFY_TYPICAL_USD = 0.004;
const CLASSIFY_MAX_USD = 0.012;
/** What an L1 batch has cost on average (about 6k tokens in, 1,5k out on gpt-5.4-mini). */
const L1_BATCH_TYPICAL_USD = 0.012;

export interface IngestEstimate {
  chunks: number;
  tokens: number;
  batches: number;
  typicalUsd: number;
  maxUsd: number;
  typicalDkk: number;
  maxDkk: number;
  limitDkk: number;
  /** The maximum is over the limit: the user must choose to read only the first pages. */
  overLimit: boolean;
}

function dkk(usd: number): number {
  return Math.round(usd * AI_BUDGETS.exchangeRateDkkPerUsd * 100) / 100;
}

export function estimateIngest(
  chunks: readonly Chunk[],
  options: { limitDkk?: number; withFacts?: boolean } = {},
): IngestEstimate {
  const limitDkk = options.limitDkk ?? INGEST_LIMITS_DKK.document;
  const tokens = chunks.reduce((sum, chunk) => sum + chunk.tokenCount, 0);
  const batches = options.withFacts === false ? 0 : batchEpisodes(chunks).length;
  const embed = tokens * EMBEDDING_USD_PER_TOKEN;
  const typicalUsd = embed + CLASSIFY_TYPICAL_USD + batches * L1_BATCH_TYPICAL_USD;
  const maxUsd = embed + CLASSIFY_MAX_USD + batches * L1_BATCH_CAP_USD;
  return {
    chunks: chunks.length,
    tokens,
    batches,
    typicalUsd: Number(typicalUsd.toFixed(6)),
    maxUsd: Number(maxUsd.toFixed(6)),
    typicalDkk: dkk(typicalUsd),
    maxDkk: dkk(maxUsd),
    limitDkk,
    overLimit: dkk(maxUsd) > limitDkk,
  };
}

/**
 * The most pages that can be read inside the limit (the choice "læs kun de første N sider"),
 * or null when not even the first page fits or the chunks carry no page numbers.
 */
export function pagesWithinLimit(
  chunks: readonly Chunk[],
  limitDkk: number = INGEST_LIMITS_DKK.document,
): number | null {
  const lastPage = Math.max(0, ...chunks.map((chunk) => chunk.pageTo ?? 0));
  if (lastPage === 0) return null;
  const within = (pages: number) =>
    estimateIngest(
      chunks.filter((chunk) => (chunk.pageTo ?? 0) <= pages),
      { limitDkk },
    ).maxDkk <= limitDkk;
  if (within(lastPage)) return lastPage;
  let low = 0;
  let high = lastPage;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (within(middle)) low = middle;
    else high = middle - 1;
  }
  return low >= 1 ? low : null;
}

/** "Anslået pris: 0,70 kr. (maks. 2,10 kr.)" */
export function formatEstimate(
  estimate: Pick<IngestEstimate, "typicalDkk" | "maxDkk">,
  language: Language = "da",
): string {
  const format = (value: number) =>
    new Intl.NumberFormat(LANGUAGE_TAGS[language], {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
      useGrouping: false,
    }).format(value);
  return translate(language, "brainKnowledge.ingest.estimate", {
    typical: format(estimate.typicalDkk),
    max: format(estimate.maxDkk),
  });
}
