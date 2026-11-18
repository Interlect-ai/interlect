/** brain_log rows and rollback plans. Kør: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { brainLogRow, planRevert } from "./log.ts";

const FUND = "a0000000-0000-4000-8000-00000000000a";
const OBJ = "a0000000-0000-4000-8000-0000000000e1";

test("a log row keeps the actor rule of the database", () => {
  const row = brainLogRow({
    fundId: FUND,
    actor: "RETENTION",
    action: "delete",
    objectKind: "retrieval_events",
    objectId: OBJ,
    reason: "x".repeat(3000),
  });
  assert.equal(row["actor"], "RETENTION");
  assert.equal((row["reason"] as string).length, 2000);
  assert.throws(() =>
    brainLogRow({
      fundId: FUND,
      actor: "user:nope" as never,
      action: "insert",
      objectKind: "fact",
      objectId: OBJ,
    }),
  );
});

test("a rollback undoes the run in reverse order", () => {
  const steps = planRevert([
    { action: "insert", objectKind: "fact", objectId: "f1", before: null },
    { action: "update", objectKind: "entity", objectId: "e1", before: { name: "Old" } },
    { action: "invalidate", objectKind: "fact", objectId: "f0", before: { expired_at: null } },
    { action: "update", objectKind: "entity", objectId: "e2", before: null },
  ]);
  assert.deepEqual(
    steps.map((step) => `${step.kind}:${step.objectId}`),
    ["reactivate:f0", "restore:e1", "remove:f1"],
  );
  assert.deepEqual(steps[1]!.state, { name: "Old" });
});
