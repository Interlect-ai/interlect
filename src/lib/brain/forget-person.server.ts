import { createHmac } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BrainUserError } from "./errors.ts";
import type { Redactor } from "../ai/redact.ts";
import type { BrainEmbedder } from "./embeddings.server.ts";
import { serverText } from "../i18n/server-text.ts";
import { BRAIN_SOURCES_BUCKET } from "./ingest/bucket.ts";

/** Counts per store, as returned by gdpr_forget_person (0072). Names are never part of it. */
export interface ForgetPersonResult {
  peopleDeleted: number;
  factsDeleted: number;
  episodesMasked: number;
  /** Episodes only about the person, and the person's own identity episode. */
  episodesDeleted: number;
  chunksMasked: number;
  rawRowsMasked: number;
  logRowsMasked: number;
  memoryEntriesReembedded: number;
  /** Brain pages: the person's own pages deleted, other pages masked. */
  pagesDeleted: number;
  pagesMasked: number;
  /** Lessons whose text, evidence or scope named the person; those with a new text get a new vector. */
  lessonsMasked: number;
  lessonsReembedded: number;
  /** AI log rows whose payload named the person; the payload is removed. */
  aiLogPayloadsRemoved: number;
  /** Files that named the person, deleted from Storage, or left because they were not chosen. */
  filesRemoved: number;
  filesKept: number;
  /** Keys (0097): "first_name_alone", "files_kept". */
  notCovered: string[];
}

/** A file whose text or name names the person (0097); bucket and path stay on the server. */
export interface PersonFile {
  kind: "document" | "brain_source";
  id: string;
  name: string;
  bucket: string;
  path: string;
}

/** A Brain source whose file is not read in yet (0117): its text is in no table. */
export interface UnreadSource {
  id: string;
  kind: string;
  name: string;
  fileName: string | null;
  path: string;
  pageLimit: number | null;
}

/**
 * Reads an unread source's text the way the ingest would. Null: nothing the ingest would
 * read (the file is gone, or it would be refused). Throws when the file cannot be read now; the
 * file then counts as naming the person, since nothing shows that it does not.
 */
export type ReadSourceText = (source: UnreadSource) => Promise<string | null>;

/** What "Glem person" shows before anything is changed. */
export interface ForgetPersonPreview {
  name: string;
  files: Array<{ kind: PersonFile["kind"]; name: string }>;
}

/** The buckets "Glem person" may delete from; anything else in a reply is never touched. */
const FILE_BUCKETS = new Set(["pitch-decks", "brain-sources"]);

export interface ForgetPersonDeps {
  service: SupabaseClient;
  embed: BrainEmbedder;
  /** The fund's masking for the new vectors. */
  redactor: (fundId: string) => Promise<Redactor>;
  /** Writes the audit event; must throw when it cannot (the action is then refused). */
  audit: (event: { action: string; payload: Record<string, unknown> }) => Promise<void>;
  /** Deletes objects from a Storage bucket; must throw when it cannot (a missing object is fine). */
  removeFiles: (bucket: string, paths: string[]) => Promise<void>;
  /** Reads the files not read in yet. */
  readSource: ReadSourceText;
}

type Target = { personId?: string | undefined; entityId?: string | undefined };

function personGoneOr(error: { code?: string; message: string }, where: string): Error {
  if (error.code === "P0002")
    return new BrainUserError(serverText("brainServer.forget.personGone"));
  if (error.code === "GD001")
    return new BrainUserError(serverText("brainServer.forget.personNoName"));
  return new Error(`${where}: ${error.code ?? ""} ${error.message}`);
}

async function personFiles(
  service: SupabaseClient,
  fundId: string,
  target: Target,
): Promise<{ name: string; files: PersonFile[] }> {
  const { data, error } = await service.rpc("gdpr_person_preview", {
    _fund_id: fundId,
    _person_id: target.personId ?? null,
    _entity_id: target.entityId ?? null,
  });
  if (error) throw personGoneOr(error, "gdpr_person_preview");
  const value = (data ?? {}) as { name?: unknown; files?: unknown };
  const files = (Array.isArray(value.files) ? value.files : []).flatMap((raw): PersonFile[] => {
    const file = raw as Record<string, unknown>;
    const kind = file["kind"];
    if ((kind !== "document" && kind !== "brain_source") || typeof file["id"] !== "string")
      return [];
    return [
      {
        kind,
        id: file["id"],
        name: typeof file["name"] === "string" ? file["name"] : "",
        bucket: typeof file["bucket"] === "string" ? file["bucket"] : "",
        path: typeof file["path"] === "string" ? file["path"] : "",
      },
    ];
  });
  return { name: typeof value.name === "string" ? value.name : "", files };
}

async function personTerms(service: SupabaseClient, fundId: string, target: Target) {
  const { data, error } = await service.rpc("gdpr_person_terms", {
    _fund_id: fundId,
    _person_id: target.personId ?? null,
    _entity_id: target.entityId ?? null,
  });
  if (error) throw personGoneOr(error, "gdpr_person_terms");
  return data as {
    person_id?: string | null;
    entity_ids?: string[];
    terms?: string[];
    primary_name?: string | null;
  } | null;
}

/**
 * The sources not read in yet whose file names the person. Their text is in no table, so
 * gdpr_person_files cannot see them: a waiting upload, or one in extract or classify, would
 * otherwise be read after the forgetting and store the name again, unmasked.
 */
async function unreadFilesNamingPerson(
  service: SupabaseClient,
  read: ReadSourceText,
  fundId: string,
  terms: string[],
  skip: ReadonlySet<string>,
): Promise<PersonFile[]> {
  const { data, error } = await service.rpc("gdpr_unread_sources", { _fund_id: fundId });
  if (error) throw new Error(`gdpr_unread_sources: ${error.code ?? ""} ${error.message}`);
  const sources = (Array.isArray(data) ? data : []).flatMap((raw): UnreadSource[] => {
    const row = raw as Record<string, unknown>;
    if (typeof row["id"] !== "string" || typeof row["path"] !== "string" || skip.has(row["id"]))
      return [];
    return [
      {
        id: row["id"],
        kind: String(row["kind"] ?? ""),
        name: typeof row["name"] === "string" ? row["name"] : "",
        fileName: typeof row["fileName"] === "string" ? row["fileName"] : null,
        path: row["path"],
        pageLimit: typeof row["pageLimit"] === "number" ? row["pageLimit"] : null,
      },
    ];
  });
  const namesPerson = async (source: UnreadSource): Promise<boolean> => {
    try {
      const text = await read(source);
      if (text === null) return false;
      const { data: matches, error: matchError } = await service.rpc("gdpr_texts_name_person", {
        _terms: terms,
        _texts: [text],
      });
      if (matchError) throw new Error(`gdpr_texts_name_person: ${matchError.message}`);
      return Array.isArray(matches) && matches[0] === true;
    } catch (cause) {
      // Not readable or not checkable now: it may name the person, so it is treated as if it does.
      console.error(
        `[brain-forget-person] fund=${fundId} source ${source.id} not checked`,
        cause instanceof Error ? cause.message : cause,
      );
      return true;
    }
  };
  // A few at a time: each is downloaded and read (up to 25 MB).
  const found: PersonFile[] = [];
  for (let start = 0; start < sources.length; start += UNREAD_PARALLEL) {
    const batch = sources.slice(start, start + UNREAD_PARALLEL);
    const named = await Promise.all(batch.map(namesPerson));
    batch.forEach((source, index) => {
      if (named[index]) found.push(toPersonFile(source));
    });
  }
  return found;
}

const UNREAD_PARALLEL = 3;

const toPersonFile = (source: UnreadSource): PersonFile => ({
  kind: "brain_source",
  id: source.id,
  name: source.name,
  bucket: BRAIN_SOURCES_BUCKET,
  path: source.path,
});

/** The name and the files that name the person, before "Glem" (no change, no AI call). */
export async function previewForgetPerson(
  service: SupabaseClient,
  fundId: string,
  target: Target,
  read: ReadSourceText,
): Promise<ForgetPersonPreview> {
  const { name, files } = await personFiles(service, fundId, target);
  const terms = ((await personTerms(service, fundId, target))?.terms ?? []).filter(Boolean);
  const unread = await unreadFilesNamingPerson(
    service,
    read,
    fundId,
    terms,
    new Set(files.map((file) => file.id)),
  );
  return {
    name,
    files: [...files, ...unread].map((file) => ({ kind: file.kind, name: file.name })),
  };
}

/** Deletes the files per bucket, one retry; returns the files that could not be deleted. */
async function removeFiles(deps: ForgetPersonDeps, fundId: string, files: PersonFile[]) {
  const byBucket = new Map<string, PersonFile[]>();
  const failed: PersonFile[] = [];
  for (const file of files) {
    // Only the fund's own objects in the two buckets: the path is checked, not trusted.
    // A file it may not touch counts as not deleted, so it is never reported or marked as gone.
    if (!FILE_BUCKETS.has(file.bucket) || !file.path.startsWith(`${fundId}/`)) {
      console.error(`[brain-forget-person] fund=${fundId} file ${file.kind}:${file.id} skipped`);
      failed.push(file);
      continue;
    }
    byBucket.set(file.bucket, [...(byBucket.get(file.bucket) ?? []), file]);
  }
  for (const [bucket, group] of byBucket) {
    let lastError: unknown = null;
    let done = false;
    for (let attempt = 0; attempt < 2 && !done; attempt += 1) {
      try {
        await deps.removeFiles(
          bucket,
          group.map((file) => file.path),
        );
        done = true;
      } catch (cause) {
        lastError = cause;
      }
    }
    if (!done) {
      console.error(
        `[brain-forget-person] fund=${fundId} ${group.length} files not deleted in ${bucket}`,
        lastError instanceof Error ? lastError.message : lastError,
      );
      failed.push(...group);
    }
  }
  return failed;
}

const fileIds = (files: PersonFile[]) => ({
  documentIds: files.filter((file) => file.kind === "document").map((file) => file.id),
  sourceIds: files.filter((file) => file.kind === "brain_source").map((file) => file.id),
});

/**
 * The audit trail holds a hash of the name, never the name. Keyed with the fund id, so the
 * same name gives a different hash in every fund and a hash cannot be matched across funds.
 */
export function nameHash(name: string, fundId: string): string {
  return createHmac("sha256", fundId)
    .update(name.normalize("NFKC").trim().toLowerCase())
    .digest("hex");
}

function sumValues(value: unknown): number {
  if (!value || typeof value !== "object") return 0;
  return Object.values(value as Record<string, unknown>).reduce<number>(
    (sum, entry) => sum + (typeof entry === "number" ? entry : 0),
    0,
  );
}

/**
 * "Glem denne person". The order is fixed:
 *   1. the person is looked up (unknown: refused) and an audit event with a hash of the name is
 *      written; no audit, no deletion
 *   2. with `removeFiles`, the files that name the person are deleted from Storage, also
 *      uploads not read in yet whose file names the person (kept ones must be approved again); a
 *      failure stops here, before anything is forgotten, so the admin can try again
 *   3. the AI log's payloads that name the person are removed (0073); first, so a retry still
 *      finds the person's names, and once more after step 5 for calls that were in flight
 *   4. gdpr_forget_person (0072, 0082, 0092, 0097) in one transaction: raw data and every Brain
 *      store; the files are marked removed and their text stays, masked
 *   5. the old fund memory entries and the lessons, whose text was masked, are embedded
 *      again; one retry each, and a failure is written to the audit trail with the ids, so nothing
 *      is lost silently; a file added between step 2 and 4 is deleted now
 */
export async function forgetPerson(
  deps: ForgetPersonDeps,
  fundId: string,
  target: Target,
  options: { removeFiles: boolean } = { removeFiles: false },
): Promise<ForgetPersonResult> {
  const who = await personTerms(deps.service, fundId, target);
  const terms = (who?.terms ?? []).filter(Boolean);
  const primaryName = who?.primary_name ?? terms[0] ?? "";

  await deps.audit({
    action: "person_forgotten",
    payload: {
      nameHash: nameHash(primaryName, fundId),
      hadRawPerson: Boolean(who?.person_id),
      entities: (who?.entity_ids ?? []).length,
      names: terms.length,
      removeFiles: options.removeFiles,
    },
  });

  // The files go before anything is forgotten: a failure leaves the person as before, so "Glem"
  // can be pressed again (the person still exists). Deleting a missing object is no error.
  const shown = options.removeFiles ? (await personFiles(deps.service, fundId, target)).files : [];
  // The sources not read in yet are read either way: kept ones must be approved again.
  const unread = await unreadFilesNamingPerson(
    deps.service,
    deps.readSource,
    fundId,
    terms,
    new Set(shown.map((file) => file.id)),
  );
  const removedFirst = options.removeFiles ? [...shown, ...unread] : [];
  const notRemoved = await removeFiles(deps, fundId, removedFirst);
  if (notRemoved.length > 0) {
    await deps.audit({
      action: "person_forget_files_failed",
      payload: { ...fileIds(notRemoved), personForgotten: false },
    });
    throw new BrainUserError(
      serverText("brainServer.forget.filesNotRemoved", { count: notRemoved.length }),
    );
  }

  const forgetInLog = async () => {
    const { data: removed, error: logError } = await deps.service.rpc("ai_call_log_forget", {
      _fund_id: fundId,
      _terms: terms,
    });
    if (logError) throw new Error(`ai_call_log_forget: ${logError.code ?? ""} ${logError.message}`);
    return Number(removed ?? 0);
  };
  let logRemoved = await forgetInLog();

  const { data, error } = await deps.service.rpc("gdpr_forget_person", {
    _fund_id: fundId,
    _person_id: target.personId ?? null,
    _entity_id: target.entityId ?? null,
    _remove_files: options.removeFiles,
    _unread_source_ids: unread.map((file) => file.id),
  });
  if (error) {
    const cause = personGoneOr(error, "gdpr_forget_person");
    // The files are already deleted: the admin must know that pressing "Glem" again finishes it.
    if (removedFirst.length > 0 && !(cause instanceof BrainUserError)) {
      console.error(`[brain-forget-person] fund=${fundId}`, cause.message);
      throw new BrainUserError(
        serverText("brainServer.forget.filesGoneRetry", { count: removedFirst.length }),
      );
    }
    throw cause;
  }
  const result = (data ?? {}) as {
    raw?: { peopleDeleted?: number; rawMasked?: unknown };
    brain?: Record<string, unknown> & {
      memoryEntries?: Array<{ id: string; text: string }>;
      lessonsToEmbed?: Array<{ id: string; text: string }>;
    };
    filesToRemove?: unknown;
    filesKept?: number;
    notCovered?: string[];
  };
  const memory = result.brain?.memoryEntries ?? [];
  const lessons = result.brain?.lessonsToEmbed ?? [];
  // The new vectors first, so a failure below cannot leave them missing without an audit trail.
  const missing: Array<{ text: string; cleared: boolean }> = [];
  const reembedded = await reembed(deps, fundId, REEMBED.memory, memory, missing);
  const lessonsReembedded = await reembed(deps, fundId, REEMBED.lessons, lessons, missing);
  // A file added between the first deletion and the forgetting is deleted now.
  const already = new Set(removedFirst.map((file) => `${file.bucket}:${file.path}`));
  const late = (Array.isArray(result.filesToRemove) ? result.filesToRemove : [])
    .map((raw) => raw as Record<string, unknown>)
    .filter((file) => !already.has(`${String(file["bucket"])}:${String(file["path"])}`))
    .flatMap((file): PersonFile[] =>
      (file["kind"] === "document" || file["kind"] === "brain_source") &&
      typeof file["id"] === "string" &&
      typeof file["bucket"] === "string" &&
      typeof file["path"] === "string"
        ? [
            {
              kind: file["kind"],
              id: file["id"],
              name: "",
              bucket: file["bucket"],
              path: file["path"],
            },
          ]
        : [],
    );
  const lateFailed = await removeFiles(deps, fundId, late);
  if (lateFailed.length > 0) {
    await deps.audit({
      action: "person_forget_files_failed",
      payload: { ...fileIds(lateFailed), personForgotten: true },
    });
  }
  // A job that was mid-call (L1, a deep analysis) may have logged the name after step 2.
  logRemoved += await forgetInLog();
  if (lateFailed.length > 0) {
    throw new BrainUserError(
      serverText("brainServer.forget.filesLeftAfter", { count: lateFailed.length }),
    );
  }
  if (missing.length > 0) {
    const what = missing.map((item) => item.text).join(serverText("brainServer.forget.and"));
    throw new BrainUserError(
      missing.every((item) => item.cleared)
        ? serverText("brainServer.forget.vectorMissing", { what })
        : serverText("brainServer.forget.vectorNotRemoved", { what }),
    );
  }

  return {
    peopleDeleted: Number(result.raw?.peopleDeleted ?? 0),
    factsDeleted: Number(result.brain?.["factsDeleted"] ?? 0),
    episodesMasked: Number(result.brain?.["episodesMasked"] ?? 0),
    episodesDeleted: Number(result.brain?.["episodesDeleted"] ?? 0),
    chunksMasked: Number(result.brain?.["chunksMasked"] ?? 0),
    rawRowsMasked: sumValues(result.raw?.rawMasked),
    logRowsMasked: Number(result.brain?.["logRowsMasked"] ?? 0),
    memoryEntriesReembedded: reembedded,
    pagesDeleted: Number(result.brain?.["pagesDeleted"] ?? 0),
    pagesMasked: Number(result.brain?.["pagesMasked"] ?? 0),
    lessonsMasked: Number(result.brain?.["lessonsMasked"] ?? 0),
    lessonsReembedded,
    aiLogPayloadsRemoved: logRemoved,
    filesRemoved: removedFirst.length + late.length,
    filesKept: Number(result.filesKept ?? 0),
    notCovered: result.notCovered ?? [],
  };
}

/** Where a masked text gets its new vector, and what a failure is called in the audit trail. */
const REEMBED = {
  // A memory entry is rebuilt from its case (decision-memory), and its vector is NOT NULL: on a
  // failed re-embed the entry goes, so no vector made from the name is left to search.
  memory: {
    table: "fund_memory_entries",
    idsKey: "memoryEntryIds",
    one: "brainServer.forget.memoryOne",
    many: "brainServer.forget.memoryMany",
    clear: "delete",
  },
  // A lesson's vector may be empty; the vector searches skip it.
  lessons: {
    table: "brain_playbook_bullets",
    idsKey: "lessonIds",
    one: "brainServer.forget.lessonOne",
    many: "brainServer.forget.lessonMany",
    clear: "null",
  },
} as const;

async function reembed(
  deps: ForgetPersonDeps,
  fundId: string,
  target: (typeof REEMBED)[keyof typeof REEMBED],
  entries: Array<{ id: string; text: string }>,
  missing: Array<{ text: string; cleared: boolean }>,
): Promise<number> {
  if (entries.length === 0) return 0;
  let lastError: unknown = null;
  // Rows that got their new vector are done; only the rest is tried again (and cleared).
  let pending = entries;
  for (let attempt = 0; attempt < 2 && pending.length > 0; attempt += 1) {
    try {
      const { embeddings } = await deps.embed(
        pending.map((entry) => entry.text),
        await deps.redactor(fundId),
      );
      if (embeddings.length !== pending.length) {
        throw new Error(`embedder returned ${embeddings.length} of ${pending.length} vectors`);
      }
      const failed: typeof pending = [];
      for (const [index, entry] of pending.entries()) {
        const { error } = await deps.service
          .from(target.table)
          .update({ embedding: JSON.stringify(embeddings[index]) })
          .eq("id", entry.id)
          .eq("fund_id", fundId);
        if (error) {
          lastError = new Error(`${target.table} embedding: ${error.message}`);
          failed.push(entry);
        }
      }
      pending = failed;
    } catch (cause) {
      lastError = cause;
    }
  }
  if (pending.length === 0) return entries.length;

  const ids = pending.map((entry) => entry.id);
  // The old vector was made from the text with the name: it never stays behind.
  const table = deps.service.from(target.table);
  const { error: clearError } = await (target.clear === "delete"
    ? table.delete().in("id", ids).eq("fund_id", fundId)
    : table.update({ embedding: null }).in("id", ids).eq("fund_id", fundId));
  if (clearError) {
    console.error(
      `[brain-forget-person] fund=${fundId} old vectors not cleared in ${target.table}`,
      clearError.message,
    );
  }
  await deps.audit({
    action: "person_forget_reembed_failed",
    payload: { [target.idsKey]: ids, oldVectorsCleared: !clearError },
  });
  console.error(
    `[brain-forget-person] fund=${fundId} re-embed failed for ${ids.length} rows in ${target.table}`,
    lastError instanceof Error ? lastError.message : lastError,
  );
  missing.push({
    text: serverText(ids.length === 1 ? target.one : target.many, { count: ids.length }),
    cleared: !clearError,
  });
  return entries.length - ids.length;
}
