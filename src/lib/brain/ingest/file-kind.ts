/**
 * File type check for Brain uploads: the type is read from the file's own bytes, never
 * from its name. A renamed program or script is refused, and the name must agree with the content.
 * Pure (no network, no database), so it is tested with node --test.
 */
import { unzipSync } from "fflate";
import { isWebsiteFile } from "./site.ts";
import { serverText } from "../../i18n/server-text.ts";

/** "website" is never uploaded: it is the server's own crawl of the fund's site (site.ts). */
export const SOURCE_KINDS = ["pdf", "docx", "xlsx", "csv", "text", "website"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

/** Upload limits. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export { MAX_PDF_PAGES } from "./limits.ts";
export const MAX_TABLE_ROWS = 10_000;
export const MAX_TEXT_CHARS = 50_000;
/** A zip claiming to unpack to more than this is refused (zip bomb). */
export const MAX_UNZIPPED_BYTES = 200 * 1024 * 1024;

const EXTENSION_KIND: Record<string, SourceKind> = {
  pdf: "pdf",
  docx: "docx",
  xlsx: "xlsx",
  csv: "csv",
  txt: "text",
  md: "text",
  json: "website",
};

export type FileKindResult =
  { ok: true; kind: SourceKind; mime: string } | { ok: false; reason: string };

const MIME: Record<SourceKind, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  text: "text/plain",
  website: "application/json",
};

/** The extension of a file name in lower case, without the dot ("" when there is none). */
/** The name the file's kind is checked against; a source without one gets its kind's extension. */
export function ingestFileName(fileName: string | null, kind: string): string {
  return fileName ?? `fil.${kind === "text" ? "txt" : kind === "website" ? "json" : kind}`;
}

export function extensionOf(fileName: string): string {
  const match = /\.([A-Za-z0-9]{1,8})$/.exec(fileName.trim());
  return match?.[1]?.toLowerCase() ?? "";
}

/** A file name that is safe as the last part of a Storage path. */
export function safeFileName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .normalize("NFC")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[^\p{L}\p{N}._ -]+/gu, "_")
    .trim()
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 120);
  return cleaned || "fil";
}

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  return signature.every((value, index) => bytes[offset + index] === value);
}

/** Programs, scripts and other things that must never be stored as a source, whatever their name. */
function refusedSignature(bytes: Uint8Array): string | null {
  if (startsWith(bytes, [0x4d, 0x5a])) return serverText("brainServer.fileKind.programWindows");
  if (startsWith(bytes, [0x7f, 0x45, 0x4c, 0x46]))
    return serverText("brainServer.fileKind.programLinux");
  if (
    startsWith(bytes, [0xfe, 0xed, 0xfa, 0xce]) ||
    startsWith(bytes, [0xfe, 0xed, 0xfa, 0xcf]) ||
    startsWith(bytes, [0xcf, 0xfa, 0xed, 0xfe]) ||
    startsWith(bytes, [0xca, 0xfe, 0xba, 0xbe])
  ) {
    return serverText("brainServer.fileKind.programMac");
  }
  if (startsWith(bytes, [0x23, 0x21])) return serverText("brainServer.fileKind.script");
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47]) || startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return serverText("brainServer.fileKind.image");
  }
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return serverText("brainServer.fileKind.image");
  return null;
}

function looksLikePdf(bytes: Uint8Array): boolean {
  const head = bytes.subarray(0, 1024);
  for (let index = 0; index + 4 < head.length; index += 1) {
    if (startsWith(head, [0x25, 0x50, 0x44, 0x46, 0x2d], index)) return true;
  }
  return false;
}

function officeKind(bytes: Uint8Array, maxUnzippedBytes: number): FileKindResult {
  let total = 0;
  try {
    unzipSync(bytes, {
      filter: (file) => {
        total += file.originalSize;
        return false;
      },
    });
  } catch {
    return { ok: false, reason: serverText("brainServer.fileKind.damaged") };
  }
  if (total > maxUnzippedBytes) {
    return { ok: false, reason: serverText("brainServer.fileKind.zipBomb") };
  }
  let contentTypes = "";
  try {
    const entries = unzipSync(bytes, { filter: (file) => file.name === "[Content_Types].xml" });
    const raw = entries["[Content_Types].xml"];
    contentTypes = raw ? new TextDecoder().decode(raw) : "";
  } catch {
    return { ok: false, reason: serverText("brainServer.fileKind.damaged") };
  }
  if (contentTypes.includes("wordprocessingml.document.main")) {
    return { ok: true, kind: "docx", mime: MIME.docx };
  }
  if (contentTypes.includes("spreadsheetml.sheet.main")) {
    return { ok: true, kind: "xlsx", mime: MIME.xlsx };
  }
  return {
    ok: false,
    reason: serverText("brainServer.fileKind.zipUnsupported"),
  };
}

function textKind(bytes: Uint8Array, extension: string): FileKindResult {
  const head = bytes.subarray(0, Math.min(bytes.length, 8192));
  if (head.includes(0)) return { ok: false, reason: serverText("brainServer.fileKind.notText") };
  let controls = 0;
  for (const value of head) {
    if (value < 0x09 || (value > 0x0d && value < 0x20)) controls += 1;
  }
  if (head.length > 0 && controls / head.length > 0.02) {
    return { ok: false, reason: serverText("brainServer.fileKind.notText") };
  }
  const lower = new TextDecoder("utf-8", { fatal: false })
    .decode(head.subarray(0, 512))
    .toLowerCase();
  if (/^\s*(<!doctype html|<html|<svg|<\?xml|<script)/.test(lower)) {
    return { ok: false, reason: serverText("brainServer.fileKind.markup") };
  }
  return extension === "csv"
    ? { ok: true, kind: "csv", mime: MIME.csv }
    : { ok: true, kind: "text", mime: MIME.text };
}

/**
 * The kind of a file from its bytes. The name only has to agree with it: a PDF named .docx, or a
 * program named .pdf, is refused with a reason that can be shown to the user.
 */
export function detectFileKind(
  bytes: Uint8Array,
  fileName: string,
  options: { maxUnzippedBytes?: number } = {},
): FileKindResult {
  if (bytes.length === 0) return { ok: false, reason: serverText("brainServer.sources.empty") };
  if (bytes.length > MAX_UPLOAD_BYTES) {
    return { ok: false, reason: serverText("brainServer.sources.tooBig") };
  }
  const extension = extensionOf(fileName);
  const expected = EXTENSION_KIND[extension];
  if (!expected) {
    return {
      ok: false,
      reason: serverText("brainServer.sources.unsupportedType"),
    };
  }
  const refused = refusedSignature(bytes);
  if (refused)
    return { ok: false, reason: serverText("brainServer.fileKind.refused", { what: refused }) };

  let detected: FileKindResult;
  if (expected === "website") {
    // Only the crawl's own file passes; any other JSON is refused.
    return isWebsiteFile(bytes)
      ? { ok: true, kind: "website", mime: MIME.website }
      : { ok: false, reason: serverText("brainServer.fileKind.unsupported") };
  }
  if (looksLikePdf(bytes)) detected = { ok: true, kind: "pdf", mime: MIME.pdf };
  else if (
    startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) ||
    startsWith(bytes, [0x50, 0x4b, 0x05, 0x06])
  ) {
    detected = officeKind(bytes, options.maxUnzippedBytes ?? MAX_UNZIPPED_BYTES);
  } else detected = textKind(bytes, extension);

  if (!detected.ok) return detected;
  if (detected.kind !== expected) {
    return { ok: false, reason: serverText("brainServer.sources.extensionMismatch") };
  }
  // A .txt that is really a CSV stays text; a .csv is a table.
  return { ok: true, kind: expected, mime: MIME[expected] };
}
