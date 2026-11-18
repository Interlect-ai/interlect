import assert from "node:assert/strict";
import { test } from "node:test";
import { ingestContinuationKey, ingestKey, parseIngestKey } from "./keys.ts";

const ID = "a1000000-0000-4000-8000-0000000000f1";

test("the first run, a retry and a continuation each have their own key and read back", () => {
  assert.deepEqual(parseIngestKey(ingestKey(ID)), { sourceId: ID, run: 0, part: 0 });
  assert.deepEqual(parseIngestKey(ingestKey(ID, 2)), { sourceId: ID, run: 2, part: 0 });
  assert.deepEqual(parseIngestKey(ingestContinuationKey(ID, 3)), { sourceId: ID, run: 0, part: 3 });
  assert.notEqual(ingestKey(ID, 1), ingestContinuationKey(ID, 1));
});

test("bad keys and numbers are refused", () => {
  assert.equal(parseIngestKey(`${ID}+x1`), null);
  assert.equal(parseIngestKey("nope"), null);
  assert.throws(() => ingestContinuationKey(ID, 0));
  assert.throws(() => ingestContinuationKey("nope", 1));
});
