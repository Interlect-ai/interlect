import assert from "node:assert/strict";
import { test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { failAbandonedJobs, removeAbandonedUploads, removeUnapprovedUploads } from "./retention.ts";

function fake(options: {
  rows: Array<{ id: string; storage_path: string | null }>;
  storageErrors?: Record<string, string>;
  deleteFails?: boolean;
  /** Ids whose row is no longer an unfinished upload when the delete runs (an upload that finished). */
  finishedMeanwhile?: string[];
}) {
  const calls: string[] = [];
  const service = {
    from: () => {
      const builder: Record<string, unknown> = {};
      let deleting = false;
      let id = "";
      builder["select"] = () => builder;
      builder["delete"] = () => {
        deleting = true;
        return builder;
      };
      builder["eq"] = (column: string, value: string) => {
        if (column === "id") id = value;
        return builder;
      };
      for (const name of ["is", "lt", "limit", "neq", "in"]) builder[name] = () => builder;
      builder["then"] = (resolve: (value: unknown) => void) =>
        resolve(
          deleting
            ? options.deleteFails
              ? { data: null, error: { message: "x" } }
              : { data: options.finishedMeanwhile?.includes(id) ? [] : [{ id }], error: null }
            : { data: options.rows, error: null },
        );
      return builder;
    },
    storage: {
      from: () => ({
        remove: async (paths: string[]) => {
          calls.push(`remove:${paths[0]}`);
          const message = options.storageErrors?.[paths[0]!];
          return { error: message ? { message } : null };
        },
      }),
    },
  } as unknown as SupabaseClient;
  return { service, calls };
}

test("an abandoned upload loses its row and its file", async () => {
  const { service, calls } = fake({
    rows: [
      { id: "a", storage_path: "f/a/x.pdf" },
      { id: "b", storage_path: null },
    ],
  });
  const result = await removeAbandonedUploads(service, "fund", new Date());
  assert.deepEqual(result, { removed: 2, failed: 0 });
  assert.deepEqual(calls, ["remove:f/a/x.pdf"]);
});

test("a file that was never uploaded is fine, but another Storage failure is counted (the row is already gone, so the file is an orphan)", async () => {
  const { service } = fake({
    rows: [
      { id: "a", storage_path: "f/a/x.pdf" },
      { id: "b", storage_path: "f/b/y.pdf" },
    ],
    storageErrors: { "f/a/x.pdf": "Object not found", "f/b/y.pdf": "timeout" },
  });
  const result = await removeAbandonedUploads(service, "fund", new Date());
  assert.deepEqual(result, { removed: 2, failed: 1 });
});

test("a database failure on one row is counted, not thrown", async () => {
  const { service } = fake({ rows: [{ id: "a", storage_path: null }], deleteFails: true });
  assert.deepEqual(await removeAbandonedUploads(service, "fund", new Date()), {
    removed: 0,
    failed: 1,
  });
});

test("an upload that finished while the night job ran keeps its row and its file", async () => {
  const { service, calls } = fake({
    rows: [
      { id: "a", storage_path: "f/a/x.pdf" },
      { id: "b", storage_path: "f/b/y.pdf" },
    ],
    finishedMeanwhile: ["a"],
  });
  const result = await removeAbandonedUploads(service, "fund", new Date());
  assert.deepEqual(result, { removed: 1, failed: 0 });
  assert.deepEqual(calls, ["remove:f/b/y.pdf"], "the finished upload's file is never touched");
});

test("an upload nobody approved loses its row and its file, and the guard is on approved_at (T-743)", async () => {
  const guards: string[] = [];
  const { service, calls } = fake({ rows: [{ id: "a", storage_path: "f/a/x.pdf" }] });
  const from = service.from.bind(service);
  (service as unknown as { from: unknown }).from = (table: string) => {
    const builder = from(table) as unknown as Record<string, (...args: unknown[]) => unknown>;
    const is = builder["is"]!;
    builder["is"] = (column: unknown, value: unknown) => {
      guards.push(String(column));
      return is(column, value);
    };
    return builder;
  };
  const result = await removeUnapprovedUploads(service, "fund", new Date());
  assert.deepEqual(result, { removed: 1, failed: 0 });
  assert.deepEqual(calls, ["remove:f/a/x.pdf"]);
  assert.deepEqual(guards, ["approved_at", "approved_at"], "select and delete are both guarded");
});

test("only uploads that never started are removed, never a read-in source without timestamps (T-788)", async () => {
  for (const remove of [removeAbandonedUploads, removeUnapprovedUploads]) {
    const guards: string[] = [];
    const { service } = fake({ rows: [{ id: "a", storage_path: "f/a/x.pdf" }] });
    const from = service.from.bind(service);
    (service as unknown as { from: unknown }).from = (table: string) => {
      const builder = from(table) as unknown as Record<string, (...args: unknown[]) => unknown>;
      const inList = builder["in"]!;
      builder["in"] = (column: unknown, values: unknown) => {
        guards.push(`${String(column)}:${String(values)}`);
        return inList(column, values);
      };
      return builder;
    };
    await remove(service, "fund", new Date());
    assert.deepEqual(
      guards,
      ["status:queued,failed", "status:queued,failed"],
      "select and delete both leave a ready source (the demo fund's reports) alone",
    );
  }
});

/** brain_jobs and brain_sources for failAbandonedJobs: records every filter and update. */
function fakeJobs(jobs: Array<{ loop: string; key: string }>, sourceStatus = "embedding") {
  const calls: string[] = [];
  const service = {
    from: (table: string) => {
      const builder: Record<string, unknown> = {};
      let updating = false;
      builder["update"] = (values: Record<string, unknown>) => {
        updating = true;
        calls.push(`${table}.update:${String(values["status"])}`);
        return builder;
      };
      builder["select"] = () => builder;
      for (const name of ["eq", "lt"]) {
        builder[name] = (column: string, value: string) => {
          calls.push(`${table}.${name}:${column}=${value}`);
          return builder;
        };
      }
      const result = () =>
        table === "brain_jobs"
          ? { data: jobs, error: null }
          : updating
            ? { data: null, error: null }
            : { data: { status: sourceStatus, approved_at: null }, error: null };
      builder["maybeSingle"] = async () => result();
      builder["then"] = (resolve: (value: unknown) => void) => resolve(result());
      return builder;
    },
  } as unknown as SupabaseClient;
  return { service, calls };
}

test("a running job whose lease ran out before the cut-off becomes failed, guarded by status and lease (T-517)", async () => {
  const { service, calls } = fakeJobs([{ loop: "L1_extract", key: "case:2026-10-04" }]);
  const before = new Date("2026-10-06T01:00:00Z");
  assert.equal(await failAbandonedJobs(service, "fund", before, new Date()), 1);
  assert.deepEqual(calls, [
    "brain_jobs.update:failed",
    "brain_jobs.eq:fund_id=fund",
    "brain_jobs.eq:status=running",
    `brain_jobs.lt:lease_until=${before.toISOString()}`,
  ]);
});

test("an abandoned INGEST job fails its source too, so the user can retry it (T-517)", async () => {
  const sourceId = "11111111-2222-4333-8444-555555555555";
  const { service, calls } = fakeJobs([{ loop: "INGEST", key: sourceId }]);
  assert.equal(await failAbandonedJobs(service, "fund", new Date(), new Date()), 1);
  assert.ok(calls.includes("brain_sources.update:failed"), calls.join("\n"));
  assert.ok(calls.includes("brain_sources.eq:status=embedding"), "only a source still being read");
});
