import type { SupabaseClient } from "@supabase/supabase-js";
import { brainLogRow, type BrainLogEntry } from "./log";
import { serverText } from "../i18n/server-text.ts";

/** Appends entries to brain_log (append-only). Throws, so a loop never changes data unlogged. */
export async function writeBrainLog(
  service: SupabaseClient,
  entries: BrainLogEntry[],
): Promise<void> {
  if (entries.length === 0) return;
  const { error } = await service.from("brain_log").insert(entries.map(brainLogRow));
  if (error) {
    console.error("[brain-log]", error.code, error.message);
    throw new Error(serverText("brainServer.common.logNotWritten"));
  }
}
