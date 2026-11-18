/**
 * The upload flow of Brain · Kilder (-2, §4-5), as plain functions over an `IngestAdmin`
 * (the database, Storage, the queue and the audit log). The rules live here and are tested
 * without a database; ingest-admin.server.ts is the Supabase implementation.
 *
 *   request  → a signed upload URL and a source row (nothing is read yet)
 *   complete → the file is read back, its type checked on its bytes, its sha256 compared with the
 *              fund's other sources, and the price estimated (no AI)
 *   approve  → a human accepts the price (or a page limit); only then INGEST is queued
 *   retry    → from the failed step, as a new run
 */
import { BrainUserError } from "../errors.ts";
import { ingestKey } from "./keys.ts";
import { chunkDocument } from "./chunk.ts";
import {
  estimateIngest,
  ingestLimitDkk,
  pagesWithinLimit,
  type IngestEstimate,
} from "./estimate.ts";
import { extractDocument } from "./extract.ts";
import {
  detectFileKind,
  extensionOf,
  MAX_TEXT_CHARS,
  MAX_UPLOAD_BYTES,
  safeFileName,
  type SourceKind,
} from "./file-kind.ts";
import { maxPagesOf } from "./limits.ts";
import { sha256Hex } from "./pipeline.ts";
import { encodeWebsiteFile, siteHost, type WebsiteFile } from "./site.ts";
import { requestLanguage, serverText } from "../../i18n/server-text.ts";
import { LANGUAGE_TAGS } from "../../i18n/language.ts";

export const TRUST_CHOICES = ["customer_doc", "company_claim"] as const;
export type TrustChoice = (typeof TRUST_CHOICES)[number];

/** Sources that are read page by page, so the user can choose "only the first N pages". */
const PAGED_KINDS: readonly SourceKind[] = ["pdf", "website"];

/** Uploads that were requested but never completed count against this limit, so a stuck page cannot flood. */
export const MAX_OPEN_UPLOADS = 20;

/**
 * What a user may upload. Never "json": a website file is only written by the server's own crawl
 * (submitWebsite), so an uploaded file can never pose as one (with made-up portfolio proposals).
 */
const EXTENSION_KIND: Record<string, SourceKind> = {
  pdf: "pdf",
  docx: "docx",
  xlsx: "xlsx",
  csv: "csv",
  txt: "text",
  md: "text",
};

export interface SourceRecord {
  id: string;
  fundId: string;
  kind: SourceKind;
  title: string;
  fileName: string | null;
  storagePath: string | null;
  sha256: string | null;
  status: string;
  uploadCompletedAt: string | null;
  approvedAt: string | null;
  pageLimit: number | null;
  maxCostUsd: number | null;
  failedStep: string | null;
  /** The text shown for a failed source (restored if a retry cannot be queued). */
  errorMessage: string | null;
}

export interface NewSource {
  id: string;
  fundId: string;
  kind: SourceKind;
  title: string;
  trustTier: TrustChoice;
  fileName: string;
  storagePath: string;
  sizeBytes: number;
  createdBy: string;
  /** The address a website was read from. */
  originUrl?: string;
}

export interface SourceUpdate {
  sha256?: string;
  sizeBytes?: number;
  pageCount?: number | null;
  chunkCount?: number;
  estimatedCostUsd?: number;
  maxCostUsd?: number;
  pageLimit?: number | null;
  warnings?: string[];
  uploadCompletedAt?: string;
  approvedBy?: string | null;
  approvedAt?: string | null;
  status?: "queued" | "failed";
  errorMessage?: string | null;
}

/** Everything the upload flow touches outside itself. */
export interface IngestAdmin {
  newId(): string;
  now(): Date;
  countOpenUploads(fundId: string): Promise<number>;
  insertSource(source: NewSource): Promise<void>;
  getSource(fundId: string, sourceId: string): Promise<SourceRecord | null>;
  /**
   * "duplicate": the sha256 already belongs to another source of the fund. With `only`, the update
   * is a compare-and-set: it changes nothing and gives "conflict" when the row is not as expected,
   * so two clicks at once cannot both win.
   */
  updateSource(
    fundId: string,
    sourceId: string,
    update: SourceUpdate,
    only?: { approvedAtNull?: boolean; status?: string },
  ): Promise<"ok" | "duplicate" | "conflict">;
  deleteSource(fundId: string, sourceId: string): Promise<void>;
  /** Deletes the row only while the price is still not approved; false = it was approved meanwhile. */
  deleteUnapprovedSource(fundId: string, sourceId: string): Promise<boolean>;
  findBySha(
    fundId: string,
    sha256: string,
    exceptId: string,
  ): Promise<{ id: string; title: string; status: string } | null>;
  signedUploadUrl(path: string): Promise<{ url: string; token: string }>;
  download(path: string): Promise<Uint8Array | null>;
  removeObject(path: string): Promise<void>;
  /** Writes a file to Storage (a pasted text becomes a .txt file like any other source). */
  putObject(path: string, bytes: Uint8Array, contentType: string): Promise<void>;
  /** The highest run number among the source's INGEST jobs (0 = only the first run, -1 = no job). */
  highestIngestRun(fundId: string, sourceId: string): Promise<number>;
  enqueueIngest(fundId: string, key: string): Promise<void>;
  audit(event: {
    action: string;
    sourceId: string | null;
    payload: Record<string, unknown>;
  }): Promise<void>;
}

export interface UploadTicket {
  sourceId: string;
  path: string;
  kind: SourceKind;
  uploadUrl: string;
  token: string;
}

export async function requestUpload(
  admin: IngestAdmin,
  input: {
    fundId: string;
    userId: string;
    fileName: string;
    sizeBytes: number;
    trustTier: string;
    title?: string | undefined;
  },
): Promise<UploadTicket> {
  const kind = EXTENSION_KIND[extensionOf(input.fileName)];
  if (!kind) {
    throw new BrainUserError(serverText("brainServer.sources.unsupportedType"));
  }
  if (!Number.isFinite(input.sizeBytes) || input.sizeBytes <= 0) {
    throw new BrainUserError(serverText("brainServer.sources.empty"));
  }
  if (input.sizeBytes > MAX_UPLOAD_BYTES)
    throw new BrainUserError(serverText("brainServer.sources.tooBig"));
  if (!(TRUST_CHOICES as readonly string[]).includes(input.trustTier)) {
    throw new BrainUserError(serverText("brainServer.sources.chooseOwner"));
  }
  if ((await admin.countOpenUploads(input.fundId)) >= MAX_OPEN_UPLOADS) {
    throw new BrainUserError(serverText("brainServer.sources.tooManyOpen"));
  }
  const name = safeFileName(input.fileName);
  const title = (input.title?.trim() || name.replace(/\.[A-Za-z0-9]{1,8}$/, "")).slice(0, 500);
  const sourceId = admin.newId();
  const path = `${input.fundId}/${sourceId}/${name}`;
  await admin.insertSource({
    id: sourceId,
    fundId: input.fundId,
    kind,
    title,
    trustTier: input.trustTier as TrustChoice,
    fileName: name,
    storagePath: path,
    sizeBytes: input.sizeBytes,
    createdBy: input.userId,
  });
  try {
    await admin.audit({
      action: "brain_source_upload_requested",
      sourceId,
      payload: { kind, sizeBytes: input.sizeBytes },
    });
    const signed = await admin.signedUploadUrl(path);
    return { sourceId, path, kind, uploadUrl: signed.url, token: signed.token };
  } catch (cause) {
    await admin.deleteSource(input.fundId, sourceId).catch(() => {});
    throw cause;
  }
}

export type CompleteResult =
  | {
      status: "duplicate";
      existing: { id: string; title: string; status: string };
    }
  | {
      status: "awaiting_approval";
      sourceId: string;
      kind: SourceKind;
      pages: number | null;
      chunks: number;
      estimate: IngestEstimate;
      /** The most pages that fit the limit when the estimate is over it (PDF and website). */
      suggestedPages: number | null;
      pageLimit: number | null;
      warnings: string[];
    };

/** Throws BrainUserError after removing the file and the row: a refused file is never kept. */
async function refuse(admin: IngestAdmin, source: SourceRecord, message: string): Promise<never> {
  if (source.storagePath) await admin.removeObject(source.storagePath).catch(() => {});
  await admin.deleteSource(source.fundId, source.id).catch(() => {});
  throw new BrainUserError(message);
}

/**
 * The suggestion from the whole document's chunks, checked the way approval prices it: only the
 * first pages are read and chunked again, and the last chunk can then end elsewhere and cost one
 * batch more. When it does not fit, the most pages that fit are searched for (halving, so a run of
 * image-only pages costs a few reads, not one per page), so "læs kun de første N sider" is never
 * refused. A read that fails here gives no suggestion; the same bytes were read before.
 */
async function pagesThatFit(
  bytes: Uint8Array,
  kind: SourceKind,
  suggested: number | null,
  limitDkk: number,
): Promise<number | null> {
  if (suggested === null || suggested < 1) return null;
  const fits = async (pages: number) => {
    const chunks = chunkDocument(await extractDocument(bytes, kind, { maxPages: pages }));
    return !estimateIngest(chunks, { limitDkk }).overLimit;
  };
  try {
    if (await fits(suggested)) return suggested;
    let low = 0;
    let high = suggested - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (await fits(middle)) low = middle;
      else high = middle - 1;
    }
    return low >= 1 ? low : null;
  } catch (cause) {
    if (cause instanceof BrainUserError) return null;
    throw cause;
  }
}

export async function completeUpload(
  admin: IngestAdmin,
  input: { fundId: string; sourceId: string },
): Promise<CompleteResult> {
  const source = await admin.getSource(input.fundId, input.sourceId);
  if (!source) throw new BrainUserError(serverText("brainServer.common.sourceGone"));
  if (source.uploadCompletedAt)
    throw new BrainUserError(serverText("brainServer.sources.uploadDone"));
  if (!source.storagePath) throw new BrainUserError(serverText("brainServer.common.sourceNoFile"));

  const bytes = await admin.download(source.storagePath);
  if (!bytes) {
    throw new BrainUserError(serverText("brainServer.sources.notArrived"));
  }
  const detected = detectFileKind(bytes, source.fileName ?? source.storagePath);
  if (!detected.ok) return refuse(admin, source, detected.reason);
  if (detected.kind !== source.kind) {
    return refuse(admin, source, serverText("brainServer.sources.extensionMismatch"));
  }

  const sha256 = sha256Hex(bytes);
  const existing = await admin.findBySha(source.fundId, sha256, source.id);
  if (existing) {
    if (source.storagePath) await admin.removeObject(source.storagePath).catch(() => {});
    await admin.deleteSource(source.fundId, source.id).catch(() => {});
    return { status: "duplicate", existing };
  }

  let doc;
  const maxPages = maxPagesOf(detected.kind);
  try {
    // A PDF over the page limit is read up to the limit; the user is told in the notes.
    doc = await extractDocument(bytes, detected.kind, { maxPages });
  } catch (cause) {
    if (cause instanceof BrainUserError) return refuse(admin, source, cause.message);
    throw cause;
  }
  const chunks = chunkDocument(doc);
  const limitDkk = ingestLimitDkk(detected.kind);
  const estimate = estimateIngest(chunks, { limitDkk });
  const suggestedPages = estimate.overLimit
    ? await pagesThatFit(bytes, detected.kind, pagesWithinLimit(chunks, limitDkk), limitDkk)
    : null;
  // A PDF over the page limit is read up to the limit, and the source remembers it.
  const pageLimit = doc.truncatedFrom !== null ? maxPages : null;

  const outcome = await admin.updateSource(source.fundId, source.id, {
    sha256,
    sizeBytes: bytes.length,
    pageCount: doc.pageCount,
    chunkCount: chunks.length,
    estimatedCostUsd: estimate.typicalUsd,
    maxCostUsd: estimate.maxUsd,
    pageLimit,
    warnings: doc.warnings,
    uploadCompletedAt: admin.now().toISOString(),
  });
  if (outcome === "duplicate") {
    // Two uploads of the same file finished at the same time: the other one won.
    const winner = await admin.findBySha(source.fundId, sha256, source.id);
    if (source.storagePath) await admin.removeObject(source.storagePath).catch(() => {});
    await admin.deleteSource(source.fundId, source.id).catch(() => {});
    if (winner) return { status: "duplicate", existing: winner };
    throw new BrainUserError("Filen findes allerede.");
  }
  return {
    status: "awaiting_approval",
    sourceId: source.id,
    kind: source.kind,
    pages: doc.pageCount,
    chunks: chunks.length,
    estimate,
    suggestedPages,
    pageLimit,
    warnings: doc.warnings,
  };
}

export interface ApproveResult {
  sourceId: string;
  maxDkk: number;
  pageLimit: number | null;
}

export async function approveIngest(
  admin: IngestAdmin,
  input: { fundId: string; sourceId: string; userId: string; pageLimit?: number | undefined },
): Promise<ApproveResult> {
  const source = await admin.getSource(input.fundId, input.sourceId);
  if (!source) throw new BrainUserError(serverText("brainServer.common.sourceGone"));
  if (!source.uploadCompletedAt)
    throw new BrainUserError(serverText("brainServer.sources.uploadNotDone"));
  if (source.approvedAt) throw new BrainUserError(serverText("brainServer.sources.priceApproved"));
  if (!source.storagePath) throw new BrainUserError(serverText("brainServer.common.sourceNoFile"));

  // The price is recomputed from the file itself, with the page choice, never trusted from the client.
  const bytes = await admin.download(source.storagePath);
  if (!bytes) throw new BrainUserError(serverText("brainServer.common.fileGoneInStorage"));
  const requested = input.pageLimit ?? source.pageLimit ?? undefined;
  const maxPages = maxPagesOf(source.kind);
  if (
    requested !== undefined &&
    (!Number.isInteger(requested) || requested < 1 || requested > maxPages)
  ) {
    throw new BrainUserError(serverText("brainServer.sources.pagesRange", { max: maxPages }));
  }
  if (requested !== undefined && !PAGED_KINDS.includes(source.kind)) {
    throw new BrainUserError(serverText("brainServer.sources.onlyPdfOrSite"));
  }
  const doc = await extractDocument(bytes, source.kind, { maxPages: requested ?? maxPages });
  const chunks = chunkDocument(doc);
  const limitDkk = ingestLimitDkk(source.kind);
  const estimate = estimateIngest(chunks, { limitDkk });
  if (estimate.overLimit) {
    throw new BrainUserError(serverText("brainServer.sources.overLimit", { limit: limitDkk }));
  }
  const pageLimit = PAGED_KINDS.includes(source.kind) && requested !== undefined ? requested : null;
  // Compare-and-set: only the first approval of an unapproved source takes effect.
  const claimed = await admin.updateSource(
    source.fundId,
    source.id,
    {
      chunkCount: chunks.length,
      estimatedCostUsd: estimate.typicalUsd,
      maxCostUsd: estimate.maxUsd,
      pageLimit,
      warnings: doc.warnings,
      approvedBy: input.userId,
      approvedAt: admin.now().toISOString(),
      status: "queued",
      errorMessage: null,
    },
    { approvedAtNull: true },
  );
  if (claimed === "conflict")
    throw new BrainUserError(serverText("brainServer.sources.priceApproved"));
  try {
    await admin.audit({
      action: "brain_ingest_approved",
      sourceId: source.id,
      payload: { maxDkk: estimate.maxDkk, pageLimit },
    });
    await admin.enqueueIngest(source.fundId, ingestKey(source.id, 0));
  } catch (cause) {
    // Nothing was started: the approval is withdrawn so the user can approve again.
    await admin
      .updateSource(source.fundId, source.id, { approvedBy: null, approvedAt: null })
      .catch(() => {});
    throw cause;
  }
  return { sourceId: source.id, maxDkk: estimate.maxDkk, pageLimit };
}

export async function retryIngest(
  admin: IngestAdmin,
  input: { fundId: string; sourceId: string; userId: string },
): Promise<{ sourceId: string; run: number; fromStep: string | null }> {
  const source = await admin.getSource(input.fundId, input.sourceId);
  if (!source) throw new BrainUserError(serverText("brainServer.common.sourceGone"));
  if (source.status !== "failed") {
    throw new BrainUserError(serverText("brainServer.sources.onlyFailedRetry"));
  }
  if (!source.approvedAt)
    throw new BrainUserError(serverText("brainServer.sources.priceNotApproved"));
  const previousError = source.errorMessage;
  // The first run used the bare source id as its key; a retry always takes a number nobody used.
  const run = Math.max(await admin.highestIngestRun(source.fundId, source.id), 0) + 1;
  // Compare-and-set: only a source that is still failed can be retried (two clicks start one run).
  const claimed = await admin.updateSource(
    source.fundId,
    source.id,
    { status: "queued", errorMessage: null },
    { status: "failed" },
  );
  if (claimed === "conflict") {
    throw new BrainUserError(serverText("brainServer.sources.onlyFailedRetry"));
  }
  try {
    await admin.audit({
      action: "brain_ingest_retried",
      sourceId: source.id,
      payload: { run, fromStep: source.failedStep },
    });
    await admin.enqueueIngest(source.fundId, ingestKey(source.id, run));
  } catch (cause) {
    // Nothing was started: the source is failed again, so the user can retry.
    await admin
      .updateSource(
        source.fundId,
        source.id,
        { status: "failed", errorMessage: previousError },
        { status: "queued" },
      )
      .catch(() => {});
    throw cause;
  }
  return { sourceId: source.id, run, fromStep: source.failedStep };
}

/**
 * A card closed before "Læs ind": the upload that nobody approved is removed, row and file,
 * so it does not stay for ever. A source whose price is approved is read or being read and is
 * removed with "Glem denne kilde" instead. Repeated calls are fine (nothing is left to remove).
 */
export async function discardUpload(
  admin: IngestAdmin,
  input: { fundId: string; sourceId: string; userId: string },
): Promise<{ discarded: boolean }> {
  const source = await admin.getSource(input.fundId, input.sourceId);
  if (!source) return { discarded: false };
  if (source.approvedAt) throw new BrainUserError(serverText("brainServer.sources.alreadyRead"));
  // The audit first: no event, no deletion (the same order as "Glem denne kilde"). The log is
  // immutable, so it holds id, kind and hash, never the title ("Referat møde med Jane Doe").
  await admin.audit({
    action: "brain_upload_discarded",
    sourceId: source.id,
    payload: { kind: source.kind, sha256: source.sha256 },
  });
  // The row goes first, guarded: a price approved in the meantime keeps the row and the file.
  if (!(await admin.deleteUnapprovedSource(source.fundId, source.id))) {
    throw new BrainUserError(serverText("brainServer.sources.alreadyRead"));
  }
  if (source.storagePath) await admin.removeObject(source.storagePath).catch(() => {});
  return { discarded: true };
}

/**
 * Pasted text ("Fritekst", up to 50.000 characters): stored as a .txt file under the same path
 * rules, then handled exactly like an upload (type check, hash, estimate), so one pipeline reads
 * every source.
 */
export async function submitText(
  admin: IngestAdmin,
  input: {
    fundId: string;
    userId: string;
    title: string;
    text: string;
    trustTier: string;
  },
): Promise<CompleteResult> {
  const text = input.text.replace(/\r\n?/g, "\n");
  if (!text.trim()) throw new BrainUserError(serverText("brainServer.sources.textEmpty"));
  if (text.length > MAX_TEXT_CHARS) {
    throw new BrainUserError(
      serverText("brainServer.sources.textTooLong", {
        max: MAX_TEXT_CHARS.toLocaleString(LANGUAGE_TAGS[requestLanguage()]),
      }),
    );
  }
  const title = input.title.trim();
  if (!title) throw new BrainUserError(serverText("brainServer.sources.textTitle"));
  const bytes = new TextEncoder().encode(text);
  const ticket = await requestUpload(admin, {
    fundId: input.fundId,
    userId: input.userId,
    fileName: `${safeFileName(title).replace(/\.[A-Za-z0-9]{1,8}$/, "")}.txt`,
    sizeBytes: bytes.length,
    trustTier: input.trustTier,
    title,
  });
  try {
    await admin.putObject(ticket.path, bytes, "text/plain");
  } catch (cause) {
    await admin.deleteSource(input.fundId, ticket.sourceId).catch(() => {});
    throw cause;
  }
  return completeUpload(admin, { fundId: input.fundId, sourceId: ticket.sourceId });
}

/**
 * The fund's own website: the crawl (crawl.ts) is stored as one file under the same path
 * rules and handled exactly like an upload (type check, hash, price before anything is read). It
 * is the fund's own published material, so it is `customer_doc`. The same site read twice
 * with nothing changed gives "Findes allerede".
 */
export async function submitWebsite(
  admin: IngestAdmin,
  input: { fundId: string; userId: string; file: WebsiteFile },
): Promise<CompleteResult> {
  if ((await admin.countOpenUploads(input.fundId)) >= MAX_OPEN_UPLOADS) {
    throw new BrainUserError(serverText("brainServer.sources.tooManyOpen"));
  }
  const bytes = encodeWebsiteFile(input.file);
  const host = siteHost(new URL(input.file.startUrl).hostname);
  const fileName = safeFileName(`${host}.json`);
  const sourceId = admin.newId();
  const path = `${input.fundId}/${sourceId}/${fileName}`;
  await admin.insertSource({
    id: sourceId,
    fundId: input.fundId,
    kind: "website",
    title: (input.file.siteName?.trim() || host).slice(0, 500),
    trustTier: "customer_doc",
    fileName,
    storagePath: path,
    sizeBytes: bytes.length,
    createdBy: input.userId,
    originUrl: input.file.startUrl,
  });
  try {
    await admin.audit({
      action: "brain_website_read",
      sourceId,
      payload: { host, pages: input.file.pages.length, portfolio: input.file.portfolio.length },
    });
    await admin.putObject(path, bytes, "application/json");
  } catch (cause) {
    await admin.deleteSource(input.fundId, sourceId).catch(() => {});
    throw cause;
  }
  return completeUpload(admin, { fundId: input.fundId, sourceId });
}
