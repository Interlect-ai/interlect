import type { SupabaseClient } from "@supabase/supabase-js";
import { BrainUserError } from "./errors.ts";

import { BRAIN_SOURCES_BUCKET } from "./ingest/bucket.ts";
import { serverText } from "../i18n/server-text.ts";

export { BRAIN_SOURCES_BUCKET };

export interface ForgetSourceResult {
  episodes: number;
  chunks: number;
  factsDeleted: number;
  factsUnlinked: number;
  entitiesMarked: number;
  /** People and companies that only came from the source and have no other facts. */
  entitiesDeleted: number;
  insightsEmptied: number;
  /** Lessons that rested on the source: text emptied, retired. */
  lessonsEmptied: number;
  /** Pages that lost a section citing the source, and old versions deleted. */
  pagesChanged: number;
  pageVersionsDeleted: number;
  /** Old chat answers whose citations lost the source's words, and searches that listed it. */
  chatMessagesChanged: number;
  retrievalEventsChanged: number;
  logRowsMasked: number;
}

export interface ForgetSourceDeps {
  service: SupabaseClient;
  /** Writes the audit event; must throw when it cannot (the action is then refused). */
  audit: (event: {
    action: string;
    sourceId: string;
    payload: Record<string, unknown>;
  }) => Promise<void>;
}

/** A Storage error that only means the file (or bucket) is not there, which is what we want. */
export function isMissingStorageObject(
  error: { message?: string; statusCode?: string | number | undefined } | null,
): boolean {
  if (!error) return false;
  const status = String(error.statusCode ?? "");
  return status === "404" || /not found|does not exist|no such/i.test(error.message ?? "");
}

/**
 * "Glem denne kilde": the order is fixed.
 *   1. audit event with kind, sha256 and who (never the title or the content: the log is immutable
 *   and Glem could never remove a name in a title); no audit, no deletion
 *   2. the Storage file is deleted; a missing file is fine, any other failure stops here, before
 *      the database is touched, so the whole action can be repeated
 *   3. brain_forget_source (0052, 0082): facts that stand on this source alone are deleted for
 *      good, the rest follows by cascade; entities are marked (and deleted when nothing else is left
 *      of them, 0103), insights emptied, lessons that rest
 *      on the source emptied, page sections that cite it removed, log rows masked
 * The same file can be uploaded again afterwards.
 */
export async function forgetSource(
  deps: ForgetSourceDeps,
  fundId: string,
  sourceId: string,
): Promise<ForgetSourceResult> {
  const { data: source, error: lookupError } = await deps.service
    .from("brain_sources")
    .select("id, kind, sha256, storage_path")
    .eq("id", sourceId)
    .eq("fund_id", fundId)
    .maybeSingle();
  if (lookupError) throw new Error(`brain_sources lookup: ${lookupError.message}`);
  if (!source) throw new BrainUserError(serverText("brainServer.common.sourceGone"));

  await deps.audit({
    action: "brain_source_forgotten",
    sourceId,
    payload: {
      kind: source["kind"],
      sha256: source["sha256"],
    },
  });

  const path = source["storage_path"] as string | null;
  if (path) {
    const { error } = await deps.service.storage.from(BRAIN_SOURCES_BUCKET).remove([path]);
    if (error && !isMissingStorageObject(error)) {
      throw new Error(`Storage remove failed: ${error.message}`);
    }
  }

  const { data, error } = await deps.service.rpc("brain_forget_source", {
    _fund_id: fundId,
    _source_id: sourceId,
  });
  if (error) {
    // A source that vanished between the lookup and the call (a second click) is already forgotten.
    if (error.code === "P0002")
      throw new BrainUserError(serverText("brainServer.common.sourceGone"));
    throw new Error(`brain_forget_source: ${error.code ?? ""} ${error.message}`);
  }
  const result = (data ?? {}) as Partial<ForgetSourceResult>;
  return {
    episodes: Number(result.episodes ?? 0),
    chunks: Number(result.chunks ?? 0),
    factsDeleted: Number(result.factsDeleted ?? 0),
    factsUnlinked: Number(result.factsUnlinked ?? 0),
    entitiesMarked: Number(result.entitiesMarked ?? 0),
    entitiesDeleted: Number(result.entitiesDeleted ?? 0),
    insightsEmptied: Number(result.insightsEmptied ?? 0),
    lessonsEmptied: Number(result.lessonsEmptied ?? 0),
    pagesChanged: Number(result.pagesChanged ?? 0),
    pageVersionsDeleted: Number(result.pageVersionsDeleted ?? 0),
    chatMessagesChanged: Number(result.chatMessagesChanged ?? 0),
    retrievalEventsChanged: Number(result.retrievalEventsChanged ?? 0),
    logRowsMasked: Number(result.logRowsMasked ?? 0),
  };
}
