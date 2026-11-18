import type { SupabaseClient } from "@supabase/supabase-js";
import { BrainUserError } from "./errors.ts";
import { isMissingStorageObject } from "./forget.server.ts";
import { BRAIN_SOURCES_BUCKET } from "./ingest/bucket.ts";
import { extractDocument } from "./ingest/extract.ts";
import { detectFileKind, ingestFileName } from "./ingest/file-kind.ts";
import type { ReadSourceText } from "./forget-person.server.ts";

/**
 * Reads a source not read in yet from Storage, as the ingest's extract step does (no AI call), so
 * "Glem person" can see whether it names the person. A file the ingest would refuse is
 * never read in (a wrong type, a locked or broken file), and a missing one has nothing to read:
 * both give null, so an unrelated file is never deleted for it.
 */
export function storageSourceReader(service: SupabaseClient): ReadSourceText {
  return async (source) => {
    const { data, error } = await service.storage.from(BRAIN_SOURCES_BUCKET).download(source.path);
    if (error || !data) {
      if (isMissingStorageObject(error as { message?: string; statusCode?: string } | null))
        return null;
      throw new Error(`storage download: ${error?.message ?? "no data"}`);
    }
    const bytes = new Uint8Array(await data.arrayBuffer());
    const kind = detectFileKind(bytes, ingestFileName(source.fileName, source.kind));
    if (!kind.ok || kind.kind !== source.kind) return null;
    try {
      const doc = await extractDocument(bytes, kind.kind, {
        ...(source.pageLimit ? { maxPages: source.pageLimit } : {}),
      });
      return doc.blocks.map((block) => block.text).join("\n");
    } catch (cause) {
      if (cause instanceof BrainUserError) return null;
      throw cause;
    }
  };
}
