import type { SupabaseClient } from "@supabase/supabase-js";
import { parseIngestKey } from "./keys.ts";
import { failedStepForStatus } from "./phase.ts";
import { serverText } from "../../i18n/server-text.ts";

/**
 * An INGEST job that ended without the pipeline's own catch running (the function died or its
 * lease ran out on the last attempt) must not leave the source "extracting" for ever: the source
 * becomes failed, from the step it was in, so the user can retry. Only a source that is still
 * being read is touched. With the dead job's id, a source another run holds (its own job and an
 * unexpired lease, 0054) is left alone: that run is reading it now.
 */
export async function failIngestSourceOfDeadJob(
  service: SupabaseClient,
  fundId: string,
  key: string,
  jobId?: string,
  now = new Date(),
): Promise<void> {
  const parsed = parseIngestKey(key);
  if (!parsed) return;
  const { data, error } = await service
    .from("brain_sources")
    .select("status, approved_at, ingest_job_id, ingest_lease_until")
    .eq("id", parsed.sourceId)
    .eq("fund_id", fundId)
    .maybeSingle();
  if (error || !data) return;
  const holder = (data["ingest_job_id"] as string | null | undefined) ?? null;
  const leaseUntil = (data["ingest_lease_until"] as string | null | undefined) ?? null;
  if (jobId && holder && holder !== jobId && leaseUntil && Date.parse(leaseUntil) > now.getTime()) {
    return;
  }
  const status = data["status"] as string;
  // An approved source still "queued" when its job is dead never got to start (the file or the
  // database failed on every attempt before the first step): it is failed from the first step.
  const step =
    failedStepForStatus(status) ?? (status === "queued" && data["approved_at"] ? "extract" : null);
  if (!step) return;
  const { error: updateError } = await service
    .from("brain_sources")
    .update({
      status: "failed",
      step: null,
      failed_step: step,
      error_message: serverText("brainServer.sources.interrupted"),
    })
    .eq("id", parsed.sourceId)
    .eq("fund_id", fundId)
    .eq("status", status);
  if (updateError) console.error("[brain] INGEST source not marked failed", updateError.message);
}
