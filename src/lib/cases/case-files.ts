/**
 * Files on a case (Filer, and files attached to a task answer). Pure and client-safe: the
 * upload in the browser and the server's check share these rules.
 *
 * The private bucket ("pitch-decks") accepts PDF and PowerPoint today (0004/0006). Spreadsheets
 * and Word files need a storage change first (in gap/R-5-screening.md); add them to
 * CASE_FILE_TYPES when it has run.
 */

import { translate } from "../i18n/translate.ts";
import type { Language } from "../i18n/language.ts";

export interface CaseFileType {
  extension: string;
  mimeType: string;
}

export const CASE_FILE_TYPES: readonly CaseFileType[] = [
  { extension: "pdf", mimeType: "application/pdf" },
  {
    extension: "pptx",
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  },
];

/** Same ceiling as the documents table (0004). */
export const CASE_FILE_MAX_BYTES = 52_428_800;

/** For the file input's `accept`. */
export const CASE_FILE_ACCEPT = CASE_FILE_TYPES.map((type) => `.${type.extension}`).join(",");

export function fileExtension(name: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(name.trim());
  return match ? match[1]!.toLowerCase() : "";
}

export function caseFileType(name: string): CaseFileType | null {
  const extension = fileExtension(name);
  return CASE_FILE_TYPES.find((type) => type.extension === extension) ?? null;
}

/** Why a file cannot be added, or null when it can. */
export function caseFileProblem(file: { name: string; size: number }): string | null {
  return caseFileProblemIn(file, "da");
}

/** The same, worded in the fund's language (`.map(caseFileProblem)` stays Danish). */
export function caseFileProblemIn(
  file: { name: string; size: number },
  language: Language,
): string | null {
  const vars = { name: file.name };
  if (!caseFileType(file.name)) return translate(language, "caseView.files.badType", vars);
  if (file.size <= 0) return translate(language, "caseView.files.empty", vars);
  if (file.size > CASE_FILE_MAX_BYTES) return translate(language, "caseView.files.tooLarge", vars);
  return null;
}

/** The storage path: fund and case folders (the bucket's policies read them), a random prefix. */
export function caseFileStoragePath(
  fundId: string,
  caseId: string,
  fileName: string,
  random: string,
): string {
  const safe =
    fileName
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "fil";
  return `${fundId}/${caseId}/${random}-${safe}`;
}
