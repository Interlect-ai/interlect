import assert from "node:assert/strict";
import { test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BrainUserError } from "./errors.ts";
import { forgetSource, isMissingStorageObject } from "./forget.server.ts";

const FUND = "11111111-1111-4111-8111-111111111111";
const SOURCE = "22222222-2222-4222-8222-222222222222";

function fake(options: {
  source?: Record<string, unknown> | null;
  storageError?: { message: string; statusCode?: string } | null;
  rpc?: { data?: unknown; error?: { code?: string; message: string } | null };
  log: string[];
}) {
  const source =
    options.source === undefined
      ? {
          id: SOURCE,
          title: "LP-brev Q2",
          kind: "pdf",
          sha256: "a".repeat(64),
          storage_path: `${FUND}/lp.pdf`,
        }
      : options.source;
  const service = {
    from: () => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: async () => ({ data: source, error: null }),
      };
      return builder;
    },
    storage: {
      from: (bucket: string) => ({
        remove: async (paths: string[]) => {
          options.log.push(`storage:${bucket}:${paths.join(",")}`);
          return { error: options.storageError ?? null };
        },
      }),
    },
    rpc: async (name: string) => {
      options.log.push(`rpc:${name}`);
      return (
        options.rpc ?? {
          data: {
            episodes: 3,
            chunks: 9,
            factsDeleted: 4,
            factsUnlinked: 1,
            entitiesMarked: 2,
            insightsEmptied: 1,
            lessonsEmptied: 2,
            pagesChanged: 3,
            pageVersionsDeleted: 6,
            chatMessagesChanged: 7,
            retrievalEventsChanged: 8,
            logRowsMasked: 5,
          },
          error: null,
        }
      );
    },
  } as unknown as SupabaseClient;
  return service;
}

test("the order is audit, then the file, then the database, and the audit never holds content", async () => {
  const log: string[] = [];
  const result = await forgetSource(
    {
      service: fake({ log }),
      audit: async (event) => {
        log.push(`audit:${event.action}:${JSON.stringify(Object.keys(event.payload).sort())}`);
      },
    },
    FUND,
    SOURCE,
  );
  assert.deepEqual(log, [
    'audit:brain_source_forgotten:["kind","sha256"]',
    `storage:brain-sources:${FUND}/lp.pdf`,
    "rpc:brain_forget_source",
  ]);
  assert.equal(result.factsDeleted, 4);
  assert.equal(result.logRowsMasked, 5);
  assert.deepEqual(
    [result.lessonsEmptied, result.pagesChanged, result.pageVersionsDeleted],
    [2, 3, 6],
  );
  assert.deepEqual([result.chatMessagesChanged, result.retrievalEventsChanged], [7, 8]);
});

test("without an audit event nothing is deleted", async () => {
  const log: string[] = [];
  await assert.rejects(
    () =>
      forgetSource(
        {
          service: fake({ log }),
          audit: async () => {
            throw new Error("audit refused");
          },
        },
        FUND,
        SOURCE,
      ),
    /audit refused/,
  );
  assert.deepEqual(log, []);
});

test("a Storage failure stops before the database is touched, so the action can be repeated", async () => {
  const log: string[] = [];
  await assert.rejects(
    () =>
      forgetSource(
        {
          service: fake({ log, storageError: { message: "boom", statusCode: "500" } }),
          audit: async () => {},
        },
        FUND,
        SOURCE,
      ),
    /Storage remove failed/,
  );
  assert.ok(!log.includes("rpc:brain_forget_source"));
});

test("a file or bucket that is already gone is fine", async () => {
  const log: string[] = [];
  await forgetSource(
    {
      service: fake({ log, storageError: { message: "Object not found", statusCode: "404" } }),
      audit: async () => {},
    },
    FUND,
    SOURCE,
  );
  assert.ok(log.includes("rpc:brain_forget_source"));
  assert.equal(isMissingStorageObject({ message: "Bucket not found" }), true);
  assert.equal(isMissingStorageObject({ message: "denied", statusCode: "403" }), false);
  assert.equal(isMissingStorageObject(null), false);
});

test("a source without a stored file (a pasted text) skips Storage", async () => {
  const log: string[] = [];
  await forgetSource(
    {
      service: fake({
        log,
        source: { id: SOURCE, title: "Note", kind: "text", sha256: null, storage_path: null },
      }),
      audit: async () => {},
    },
    FUND,
    SOURCE,
  );
  assert.deepEqual(log, ["rpc:brain_forget_source"]);
});

test("an unknown source, or one a second click already forgot, is a plain refusal", async () => {
  await assert.rejects(
    () =>
      forgetSource(
        { service: fake({ log: [], source: null }), audit: async () => {} },
        FUND,
        SOURCE,
      ),
    BrainUserError,
  );
  await assert.rejects(
    () =>
      forgetSource(
        {
          service: fake({ log: [], rpc: { error: { code: "P0002", message: "unknown source" } } }),
          audit: async () => {},
        },
        FUND,
        SOURCE,
      ),
    BrainUserError,
  );
});

test("any other database failure is an error, not a silent success", async () => {
  await assert.rejects(
    () =>
      forgetSource(
        {
          service: fake({ log: [], rpc: { error: { code: "XX000", message: "internal" } } }),
          audit: async () => {},
        },
        FUND,
        SOURCE,
      ),
    /brain_forget_source/,
  );
});
