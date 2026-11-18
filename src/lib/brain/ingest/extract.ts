/**
 * Text out of an uploaded file (-2, the "extract" step of INGEST): PDF page by page, Word as
 * headings, paragraphs and tables, Excel and CSV as one row per block, plain text as paragraphs.
 * No AI and no database: the same file always gives the same blocks, so the step can be repeated.
 * Problems the user can fix (a password-protected PDF, too many pages) are BrainUserError with a
 * Danish text; pages that are only images are counted and reported ("delvist læst").
 */
import { load } from "cheerio";
import ExcelJS from "exceljs";
import mammoth from "mammoth";
import Papa from "papaparse";
import { BrainUserError } from "../errors.ts";
import { MAX_PDF_PAGES, MAX_TABLE_ROWS, type SourceKind } from "./file-kind.ts";
import { decodeWebsiteFile, websiteBlocks } from "./site.ts";
import { serverText } from "../../i18n/server-text.ts";

export type BlockKind = "heading" | "paragraph" | "table" | "row";

export interface Block {
  kind: BlockKind;
  text: string;
  /** PDF page (1-based). */
  page?: number;
  /** Heading level 1-6. */
  level?: number;
  /** Excel sheet name. */
  sheet?: string;
}

export interface ExtractedDocument {
  kind: SourceKind;
  blocks: Block[];
  pageCount: number | null;
  /** The PDF's real number of pages when only the first ones were read (else null). */
  truncatedFrom: number | null;
  rowCount: number | null;
  /** PDF pages with so little text that they are probably images ("delvist læst"). */
  imagePages: number[];
  /** User-facing notes in Danish. */
  warnings: string[];
  charCount: number;
}

/** Fewer characters than this on a PDF page means an image page. */
export const IMAGE_PAGE_CHARS = 200;

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

const PAGE_NUMBER_LINE = /^\s*(?:side|page|s\.)?\s*\d{1,4}(?:\s*(?:\/|af|of)\s*\d{1,4})?\s*$/i;

const PAGE_COUNTER = /\b(?:side|page|s\.)\s*\d+|\b\d+\s*(?:\/|af|of)\s*\d+\b/i;

/** Comparison key for a header/footer candidate; numbers only vary on lines that look like page counters. */
function normalizeRepeat(line: string): string {
  const collapsed = line.toLowerCase().replace(/\s+/g, " ").trim();
  return PAGE_COUNTER.test(collapsed) ? collapsed.replace(/\d+/g, "#") : collapsed;
}

/**
 * Removes page numbers and the lines that repeat as the first or last lines of most pages
 * (running headers and footers), so they do not end up in every chunk.
 */
export function stripRepeatedHeadersFooters(pages: string[][]): string[][] {
  const cleaned = pages.map((lines) => lines.filter((line) => !PAGE_NUMBER_LINE.test(line)));
  if (cleaned.length < 4) return cleaned;
  const counts = new Map<string, number>();
  for (const lines of cleaned) {
    const edge = new Set(
      [...lines.slice(0, 2), ...lines.slice(-2)]
        .map(normalizeRepeat)
        .filter((line) => line.length > 0),
    );
    for (const key of edge) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const threshold = Math.ceil(cleaned.length * 0.6);
  const repeated = new Set(
    [...counts].filter(([, count]) => count >= threshold).map(([key]) => key),
  );
  if (repeated.size === 0) return cleaned;
  return cleaned.map((lines) =>
    lines.filter((line, index) => {
      const atEdge = index < 2 || index >= lines.length - 2;
      return !(atEdge && repeated.has(normalizeRepeat(line)));
    }),
  );
}

const HEADING_LINE = /^(?:\d+(?:\.\d+)*\.?\s+)?[A-ZÆØÅ0-9][^.!?;:]{1,78}$/;

function looksLikeHeading(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length < 3 || trimmed.length > 80) return false;
  if (trimmed.split(/\s+/).length > 10) return false;
  if (/[,;]$/.test(trimmed)) return false;
  return HEADING_LINE.test(trimmed);
}

/** Lines of one page into blocks: blank lines split paragraphs, a short title-like line is a heading. */
export function pageToBlocks(lines: string[], page: number): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    const text = paragraph.join(" ").replace(/\s+/g, " ").trim();
    if (text) blocks.push({ kind: "paragraph", text, page });
    paragraph = [];
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    if (looksLikeHeading(line) && paragraph.length === 0) {
      blocks.push({ kind: "heading", text: line, page, level: 2 });
      continue;
    }
    paragraph.push(line);
    if (/[.!?]$/.test(line) && paragraph.join(" ").length > 400) flush();
  }
  flush();
  return blocks;
}

/** A PDF with more pages than this is refused before any text is read (parser cost and memory). */
export const HARD_MAX_PDF_PAGES = 5_000;

async function extractPdf(
  bytes: Uint8Array,
  maxPages: number | undefined,
): Promise<ExtractedDocument> {
  const { getDocumentProxy } = await import("unpdf");
  const limit = Math.min(maxPages ?? MAX_PDF_PAGES, MAX_PDF_PAGES);
  let totalPages: number;
  let pages: string[] = [];
  try {
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    totalPages = pdf.numPages;
    // The page count is known before any text is read, so a huge PDF costs nothing beyond this.
    if (totalPages > HARD_MAX_PDF_PAGES) {
      throw new BrainUserError(
        serverText("brainServer.extract.pdfTooLong", { pages: totalPages, max: MAX_PDF_PAGES }),
      );
    }
    if (totalPages > limit && maxPages === undefined) {
      throw new BrainUserError(
        serverText("brainServer.extract.pdfChooseFirst", { pages: totalPages, max: MAX_PDF_PAGES }),
      );
    }
    // Only the pages that will be read are parsed (the same text as unpdf's extractText gives).
    for (let number = 1; number <= Math.min(totalPages, limit); number += 1) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      pages.push(
        content.items
          .filter((item) => "str" in item && item.str != null)
          .map((item) => ("str" in item ? item.str + (item.hasEOL ? "\n" : "") : ""))
          .join(""),
      );
      page.cleanup();
    }
  } catch (cause) {
    if (cause instanceof BrainUserError) throw cause;
    const message = cause instanceof Error ? `${cause.name} ${cause.message}` : String(cause);
    if (/password/i.test(message)) {
      throw new BrainUserError(serverText("brainServer.extract.password"));
    }
    throw new BrainUserError(serverText("brainServer.extract.notPdf"));
  }
  pages = pages.slice(0, limit);
  const lines = stripRepeatedHeadersFooters(pages.map((page) => page.split(/\r?\n/)));
  const imagePages: number[] = [];
  const blocks: Block[] = [];
  lines.forEach((pageLines, index) => {
    const page = index + 1;
    const chars = pageLines.join(" ").replace(/\s+/g, " ").trim().length;
    if (chars < IMAGE_PAGE_CHARS) imagePages.push(page);
    blocks.push(...pageToBlocks(pageLines, page));
  });
  const warnings: string[] = [];
  if (imagePages.length > 0) {
    warnings.push(
      serverText(
        imagePages.length === 1
          ? "brainServer.extract.imagePagesOne"
          : "brainServer.extract.imagePagesMany",
        { count: imagePages.length },
      ),
    );
  }
  if (totalPages > limit) {
    warnings.push(serverText("brainServer.extract.firstPages", { limit, total: totalPages }));
  }
  return finish("pdf", blocks, {
    pageCount: Math.min(totalPages, limit),
    truncatedFrom: totalPages > limit ? totalPages : null,
    imagePages,
    warnings,
  });
}

// ---------------------------------------------------------------------------
// Word
// ---------------------------------------------------------------------------

async function extractDocx(bytes: Uint8Array): Promise<ExtractedDocument> {
  let html: string;
  let images = 0;
  try {
    const result = await mammoth.convertToHtml(
      { buffer: Buffer.from(bytes) },
      {
        convertImage: mammoth.images.imgElement(async () => {
          images += 1;
          return { src: "" };
        }),
      },
    );
    html = result.value;
  } catch {
    throw new BrainUserError(serverText("brainServer.extract.word"));
  }
  const $ = load(html);
  const blocks: Block[] = [];
  const text = (element: Parameters<typeof $>[0]) => $(element).text().replace(/\s+/g, " ").trim();
  $("body")
    .children()
    .each((_, element) => {
      const tag = element.type === "tag" ? element.name.toLowerCase() : "";
      if (/^h[1-6]$/.test(tag)) {
        const value = text(element);
        if (value) blocks.push({ kind: "heading", text: value, level: Number(tag.slice(1)) });
      } else if (tag === "p") {
        const value = text(element);
        if (value) blocks.push({ kind: "paragraph", text: value });
      } else if (tag === "ul" || tag === "ol") {
        $(element)
          .find("li")
          .each((__, item) => {
            const value = text(item);
            if (value) blocks.push({ kind: "paragraph", text: `- ${value}` });
          });
      } else if (tag === "table") {
        const rows = $(element)
          .find("tr")
          .map((__, row) =>
            $(row)
              .find("th,td")
              .map((___, cell) => text(cell))
              .get()
              .join(" | "),
          )
          .get()
          .filter((row) => row.replace(/[\s|]/g, "").length > 0);
        if (rows.length > 0) blocks.push({ kind: "table", text: rows.join("\n") });
      }
    });
  const warnings =
    images > 0
      ? [
          serverText(
            images === 1 ? "brainServer.extract.imagesOne" : "brainServer.extract.imagesMany",
            { count: images },
          ),
        ]
      : [];
  return finish("docx", blocks, { warnings });
}

// ---------------------------------------------------------------------------
// Excel and CSV
// ---------------------------------------------------------------------------

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    if ("result" in value && value.result !== undefined)
      return cellText(value.result as ExcelJS.CellValue);
    if ("richText" in value) return value.richText.map((part) => part.text).join("");
    if ("text" in value && typeof value.text === "string") return value.text;
    if ("error" in value) return "";
    return "";
  }
  return String(value).trim();
}

function rowBlock(sheet: string | null, headers: string[], cells: string[]): Block | null {
  const parts = cells
    .map((cell, index) => (cell ? `${headers[index] || `Kolonne ${index + 1}`}: ${cell}` : ""))
    .filter(Boolean);
  if (parts.length === 0) return null;
  return {
    kind: "row",
    text: `${sheet ? `Ark: ${sheet} · ` : ""}${parts.join(" · ")}`,
    ...(sheet ? { sheet } : {}),
  };
}

function tooManyRows(rows: number): BrainUserError {
  return new BrainUserError(
    serverText("brainServer.extract.tooManyRows", { rows, max: MAX_TABLE_ROWS }),
  );
}

async function extractXlsx(bytes: Uint8Array): Promise<ExtractedDocument> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(Buffer.from(bytes) as unknown as ExcelJS.Buffer);
  } catch {
    throw new BrainUserError(serverText("brainServer.extract.excel"));
  }
  const blocks: Block[] = [];
  let rows = 0;
  // The workbook's own row counts are checked before any row is read.
  const declaredRows = workbook.worksheets.reduce((sum, sheet) => sum + (sheet.rowCount ?? 0), 0);
  if (declaredRows > MAX_TABLE_ROWS * 5) throw tooManyRows(declaredRows);
  const hidden: string[] = [];
  let unreadFormulas = 0;
  for (const sheet of workbook.worksheets) {
    if (sheet.state && sheet.state !== "visible") {
      hidden.push(sheet.name);
      continue;
    }
    let headers: string[] | null = null;
    // Only rows that exist are visited (a formatted empty area is not walked cell by cell).
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell, column) => {
        const value = cell.value;
        if (
          value !== null &&
          typeof value === "object" &&
          "formula" in value &&
          (value as { result?: unknown }).result === undefined
        ) {
          unreadFormulas += 1;
        }
        cells[column - 1] = cellText(value);
      });
      for (let index = 0; index < cells.length; index += 1) cells[index] ??= "";
      if (cells.every((cell) => !cell)) return;
      if (!headers) {
        headers = cells;
        return;
      }
      const block = rowBlock(sheet.name, headers, cells);
      if (!block) return;
      rows += 1;
      if (rows > MAX_TABLE_ROWS) throw tooManyRows(rows);
      blocks.push(block);
    });
  }
  const warnings: string[] = [];
  if (hidden.length > 0) {
    warnings.push(
      serverText("brainServer.extract.hiddenSheets", { sheets: hidden.slice(0, 5).join(", ") }),
    );
  }
  if (unreadFormulas > 0) {
    warnings.push(serverText("brainServer.extract.formulas", { count: unreadFormulas }));
  }
  return finish("xlsx", blocks, { rowCount: rows, warnings });
}

/** UTF-8, or Windows-1252 when the bytes are not valid UTF-8 (Danish exports often are). */
export function decodeText(bytes: Uint8Array): string {
  // A UTF-16 byte order mark (Excel's "Unicode text") is read as UTF-16.
  if (bytes[0] === 0xff && bytes[1] === 0xfe)
    return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff)
    return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder("windows-1252").decode(bytes);
  }
  // A byte order mark at the start is not part of the text.
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function extractCsv(bytes: Uint8Array): ExtractedDocument {
  const parsed = Papa.parse<string[]>(decodeText(bytes), {
    header: false,
    skipEmptyLines: "greedy",
    dynamicTyping: false,
  });
  if (parsed.errors.some((error) => error.type === "Quotes")) {
    throw new BrainUserError(serverText("brainServer.extract.csvQuote"));
  }
  const table = parsed.data.filter((row) => Array.isArray(row));
  if (table.length === 0) throw new BrainUserError(serverText("brainServer.extract.csvEmpty"));
  const headers = (table[0] ?? []).map((cell) => String(cell ?? "").trim());
  const body = table.slice(1);
  if (body.length > MAX_TABLE_ROWS) throw tooManyRows(body.length);
  const blocks: Block[] = [];
  for (const row of body) {
    const block = rowBlock(
      null,
      headers,
      row.map((cell) => String(cell ?? "").trim()),
    );
    if (block) blocks.push(block);
  }
  return finish("csv", blocks, { rowCount: blocks.length });
}

// ---------------------------------------------------------------------------
// Plain text
// ---------------------------------------------------------------------------

function extractPlainText(bytes: Uint8Array): ExtractedDocument {
  const blocks: Block[] = [];
  for (const part of decodeText(bytes)
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)) {
    const value = part.trim();
    if (!value) continue;
    const heading = /^(#{1,6})\s+(.+)$/.exec(value);
    if (heading && !value.includes("\n")) {
      blocks.push({ kind: "heading", text: heading[2]!.trim(), level: heading[1]!.length });
    } else {
      blocks.push({ kind: "paragraph", text: value.replace(/[ \t]*\n[ \t]*/g, " ") });
    }
  }
  return finish("text", blocks, {});
}

// ---------------------------------------------------------------------------
// The fund's website (the crawl's own file, site.ts): one "page" per web page
// ---------------------------------------------------------------------------

function extractWebsite(bytes: Uint8Array, maxPages: number | undefined): ExtractedDocument {
  const file = decodeWebsiteFile(bytes);
  const blocks = websiteBlocks(file, maxPages);
  const read = Math.min(file.pages.length, maxPages ?? file.pages.length);
  return finish("website", blocks, {
    pageCount: read,
    truncatedFrom: read < file.pages.length ? file.pages.length : null,
    warnings: [...file.notes],
  });
}

// ---------------------------------------------------------------------------

function finish(
  kind: SourceKind,
  blocks: Block[],
  extra: Partial<
    Pick<ExtractedDocument, "pageCount" | "truncatedFrom" | "rowCount" | "imagePages" | "warnings">
  >,
): ExtractedDocument {
  const charCount = blocks.reduce((sum, block) => sum + block.text.length, 0);
  if (charCount === 0) {
    throw new BrainUserError(
      kind === "pdf"
        ? serverText("brainServer.extract.pdfNoText")
        : serverText("brainServer.extract.noText"),
    );
  }
  return {
    kind,
    blocks,
    pageCount: extra.pageCount ?? null,
    truncatedFrom: extra.truncatedFrom ?? null,
    rowCount: extra.rowCount ?? null,
    imagePages: extra.imagePages ?? [],
    warnings: extra.warnings ?? [],
    charCount,
  };
}

export async function extractDocument(
  bytes: Uint8Array,
  kind: SourceKind,
  options: { maxPages?: number } = {},
): Promise<ExtractedDocument> {
  switch (kind) {
    case "pdf":
      return extractPdf(bytes, options.maxPages);
    case "docx":
      return extractDocx(bytes);
    case "xlsx":
      return extractXlsx(bytes);
    case "csv":
      return extractCsv(bytes);
    case "text":
      return extractPlainText(bytes);
    case "website":
      return extractWebsite(bytes, options.maxPages);
  }
}
