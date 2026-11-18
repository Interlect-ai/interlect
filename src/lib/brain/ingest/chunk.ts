/**
 * The "chunk" step of INGEST: extracted blocks become chunks of about 700 tokens with 80
 * tokens of overlap, cut at headings, with tables kept together and one chunk per row for Excel
 * and CSV. Every chunk later becomes an episode (kind source_chunk) with its own embedding.
 * Pure: the same blocks always give the same chunks (the step can be repeated).
 */
import { getEncoding } from "js-tiktoken";
import type { Block, ExtractedDocument } from "./extract.ts";

export const CHUNK_TARGET_TOKENS = 700;
export const CHUNK_OVERLAP_TOKENS = 80;
/** No chunk is longer than this (brain_chunks.content holds at most 8.000 characters). */
export const CHUNK_MAX_TOKENS = 1_300;
const MAX_CHUNK_CHARS = 7_500;
/** A heading only starts a new chunk when the one before it has this much (else they are merged). */
const MIN_TOKENS_BEFORE_HEADING_CUT = 120;

const encoding = getEncoding("o200k_base");

export function countTokens(text: string): number {
  return encoding.encode(text).length;
}

export interface Chunk {
  ordinal: number;
  heading: string | null;
  pageFrom: number | null;
  pageTo: number | null;
  /** Heading line (when there is one) followed by the text. */
  content: string;
  tokenCount: number;
  /** The text was longer than a chunk may be and was cut. */
  truncated: boolean;
}

interface Piece {
  text: string;
  tokens: number;
  page: number | undefined;
}

interface Counted {
  text: string;
  tokens: number;
}

/**
 * Greedy packing of `parts` (joined by `separator`) into pieces of at most `limit` tokens. Tokens
 * add up at a separator (the tokenizer splits there), so a piece's count is a running sum of its
 * parts; counting the growing text again for every part made a 300-page PDF take ~45 s.
 * `start` (a table's header row) begins every piece and is never a piece on its own.
 */
function pack(
  parts: readonly string[],
  separator: string,
  limit: number,
  start: Counted | null = null,
): Counted[] {
  const out: Counted[] = [];
  let current: Counted | null = start;
  let onlyStart = start !== null;
  for (const part of parts) {
    if (current === null || (start === null && !current.text)) {
      current = { text: part, tokens: countTokens(part) };
      continue;
    }
    const added = countTokens(`${separator}${part}`);
    const tokens = current.tokens + added;
    if (!onlyStart && tokens > limit) {
      out.push(current);
      current = start
        ? { text: `${start.text}${separator}${part}`, tokens: start.tokens + added }
        : { text: part, tokens: countTokens(part) };
    } else current = { text: `${current.text}${separator}${part}`, tokens };
    onlyStart = false;
  }
  if (current && current.text && (!onlyStart || out.length === 0)) out.push(current);
  return out;
}

/** A long paragraph is cut at sentence ends into pieces of at most `limit` tokens. */
function splitLong(text: string, limit: number): Counted[] {
  const tokens = countTokens(text);
  if (tokens <= limit) return [{ text, tokens }];
  const pieces = pack(text.split(/(?<=[.!?])\s+/), " ", limit);
  // A single "sentence" can still be too long (no punctuation): cut by words.
  return pieces.flatMap((piece) =>
    piece.tokens <= limit ? [piece] : pack(piece.text.split(/\s+/), " ", limit),
  );
}

/** A table longer than the limit is cut between rows, repeating the first (header) row. */
function splitTable(text: string, limit: number): Counted[] {
  const tokens = countTokens(text);
  if (tokens <= limit) return [{ text, tokens }];
  const rows = text.split("\n");
  const header = rows[0] ?? "";
  return pack(rows.slice(1), "\n", limit, { text: header, tokens: countTokens(header) });
}

/** The last words of a chunk (about `tokens` tokens), kept for the next chunk's overlap. */
function overlapTail(text: string, tokens: number): string {
  const words = text.split(/\s+/);
  let tail = "";
  /** Counted with a space before every word, as inside a text (a running sum, see `pack`). */
  let counted = 0;
  for (let index = words.length - 1; index >= 0; index -= 1) {
    const word = words[index] ?? "";
    counted += countTokens(` ${word}`);
    if (counted > tokens) break;
    tail = tail ? `${word} ${tail}` : word;
  }
  return tail;
}

/**
 * `pageBreaks`: a new page always starts a new chunk (the pages of a website are separate texts;
 * a PDF's pages are not, so its chunks run across them).
 */
export function chunkBlocks(
  blocks: readonly Block[],
  options: { targetTokens?: number; overlapTokens?: number; pageBreaks?: boolean } = {},
): Chunk[] {
  const target = options.targetTokens ?? CHUNK_TARGET_TOKENS;
  const overlap = options.overlapTokens ?? CHUNK_OVERLAP_TOKENS;
  const chunks: Chunk[] = [];
  let heading: string | null = null;
  let pieces: Piece[] = [];
  /** The end of the previous chunk, repeated at the start of the next one cut on size (same section). */
  let overlapPrefix = "";

  const emit = (rows: {
    heading: string | null;
    text: string;
    pageFrom?: number;
    pageTo?: number;
  }) => {
    const body = rows.text.trim();
    if (!body) return;
    const full = rows.heading ? `${rows.heading}\n\n${body}` : body;
    const content = full.slice(0, MAX_CHUNK_CHARS);
    chunks.push({
      ordinal: chunks.length,
      heading: rows.heading,
      pageFrom: rows.pageFrom ?? null,
      pageTo: rows.pageTo ?? rows.pageFrom ?? null,
      content,
      tokenCount: countTokens(content),
      truncated: full.length > MAX_CHUNK_CHARS,
    });
  };

  const total = () => pieces.reduce((sum, piece) => sum + piece.tokens, 0);

  /** `bySize`: the chunk was full (the next one overlaps it); otherwise a heading or row ended it. */
  const flush = (bySize: boolean) => {
    if (pieces.length === 0) return;
    const text = pieces.map((piece) => piece.text).join("\n\n");
    const pages = pieces
      .map((piece) => piece.page)
      .filter((page): page is number => page !== undefined);
    emit({
      heading,
      text: overlapPrefix ? `${overlapPrefix}\n\n${text}` : text,
      ...(pages.length ? { pageFrom: Math.min(...pages), pageTo: Math.max(...pages) } : {}),
    });
    overlapPrefix = bySize ? overlapTail(text, overlap) : "";
    pieces = [];
  };

  for (const block of blocks) {
    if (options.pageBreaks && pieces.length > 0 && block.page !== pieces.at(-1)?.page) {
      flush(false);
    }
    if (block.kind === "row") {
      // Spreadsheet rows are their own chunks (one episode per row).
      flush(false);
      emit({ heading: block.sheet ?? null, text: block.text });
      continue;
    }
    if (block.kind === "heading") {
      if (total() >= MIN_TOKENS_BEFORE_HEADING_CUT) flush(false);
      heading = block.text;
      continue;
    }
    const parts =
      block.kind === "table"
        ? splitTable(block.text, CHUNK_MAX_TOKENS)
        : splitLong(block.text, Math.min(target, CHUNK_MAX_TOKENS));
    for (const { text: part, tokens } of parts) {
      // A table stays whole: when it does not fit, the current chunk ends and the table starts the next.
      if (pieces.length > 0 && total() + tokens > target) flush(block.kind !== "table");
      pieces.push({ text: part, tokens, page: block.page });
    }
  }
  flush(false);
  return chunks;
}

/** The chunks of an extracted document (a website's pages never share a chunk). */
export function chunkDocument(doc: Pick<ExtractedDocument, "kind" | "blocks">): Chunk[] {
  return chunkBlocks(doc.blocks, { pageBreaks: doc.kind === "website" });
}
