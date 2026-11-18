import assert from "node:assert/strict";
import { test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { failIngestSourceOfDeadJob } from "./dead-job.ts";
import { ingestKey } from "./keys.ts";

const FUND = "11111111-1111-4111-8111-111111111111";
const SOURCE = "22222222-2222-4222-8222-222222222222";

function fake(
  status: string | null,
  approved = false,
  holder: { jobId: string; leaseUntil: string } | null = null,
) {
  const updates: Array<Record<string, unknown>> = [];
  const wheres: Array<[string, unknown]> = [];
  const service = {
    from: () => {
      let updating: Record<string, unknown> | null = null;
      const builder: Record<string, unknown> = {};
      builder["select"] = () => builder;
      builder["update"] = (columns: Record<string, unknown>) => {
        updating = columns;
        updates.push(columns);
        return builder;
      };
      builder["eq"] = (column: string, value: unknown) => {
        if (updating) wheres.push([column, value]);
        return builder;
      };
      builder["maybeSingle"] = async () => ({
        data: status
          ? {
              status,
              approved_at: approved ? "2026-10-01T10:00:00Z" : null,
              ingest_job_id: holder?.jobId ?? null,
              ingest_lease_until: holder?.leaseUntil ?? null,
            }
          : null,
        error: null,
      });
      builder["then"] = (resolve: (value: unknown) => void) => resolve({ error: null });
      return builder;
    },
  } as unknown as SupabaseClient;
  return { service, updates, wheres };
}

test("a source left 'embedding' by a job that died becomes failed from that step", async () => {
  const f = fake("embedding");
  await failIngestSourceOfDeadJob(f.service, FUND, ingestKey(SOURCE, 0));
  assert.equal(f.updates.length, 1);
  assert.equal(f.updates[0]?.["status"], "failed");
  assert.equal(f.updates[0]?.["failed_step"], "embed");
  assert.deepEqual(
    f.wheres.find(([column]) => column === "status"),
    ["status", "embedding"],
    "only if it is still in that status",
  );
});

test("a source that is ready, failed, queued, in review or gone is left alone", async () => {
  for (const status of ["ready", "failed", "review", null]) {
    const f = fake(status);
    await failIngestSourceOfDeadJob(f.service, FUND, ingestKey(SOURCE, 2));
    assert.equal(f.updates.length, 0, String(status));
  }
});

test("a key that is not an INGEST key changes nothing", async () => {
  const f = fake("embedding");
  await failIngestSourceOfDeadJob(f.service, FUND, "not-a-key");
  assert.equal(f.updates.length, 0);
});

test("an approved source whose job never started is failed from the first step; an unapproved queued one is left alone", async () => {
  const stuck = fake("queued", true);
  await failIngestSourceOfDeadJob(stuck.service, FUND, ingestKey(SOURCE, 0));
  assert.equal(stuck.updates[0]?.["status"], "failed");
  assert.equal(stuck.updates[0]?.["failed_step"], "extract");
  const waiting = fake("queued", false);
  await failIngestSourceOfDeadJob(waiting.service, FUND, ingestKey(SOURCE, 0));
  assert.equal(waiting.updates.length, 0);
});

test("a source another run holds is left alone; an expired hold or its own job is not (T-517)", async () => {
  const now = new Date("2026-10-06T12:00:00Z");
  const held = fake("embedding", false, { jobId: "newer", leaseUntil: "2026-10-06T12:10:00Z" });
  await failIngestSourceOfDeadJob(held.service, FUND, ingestKey(SOURCE, 0), "dead", now);
  assert.equal(held.updates.length, 0, "a newer run is reading it");
  const expired = fake("embedding", false, { jobId: "newer", leaseUntil: "2026-10-06T11:00:00Z" });
  await failIngestSourceOfDeadJob(expired.service, FUND, ingestKey(SOURCE, 0), "dead", now);
  assert.equal(expired.updates.length, 1);
  const own = fake("embedding", false, { jobId: "dead", leaseUntil: "2026-10-06T12:10:00Z" });
  await failIngestSourceOfDeadJob(own.service, FUND, ingestKey(SOURCE, 0), "dead", now);
  assert.equal(own.updates.length, 1);
});
