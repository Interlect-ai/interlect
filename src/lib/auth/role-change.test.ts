import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyRoleChange,
  planRoleChange,
  RoleChangeInconsistentError,
  type RoleRow,
  type RoleStore,
} from "./role-change.ts";
import type { AppRole } from "@/lib/supabase/types";

/** An in-memory role table with injectable failures per call number. */
function fakeStore(start: AppRole[], failOn: { add?: number[]; remove?: number[] } = {}) {
  const roles = new Map<AppRole, string | null>(start.map((role) => [role, "orig"]));
  const calls = { add: 0, remove: 0 };
  const history: string[] = [];
  const store: RoleStore = {
    async add(rows: RoleRow[]) {
      calls.add += 1;
      if (failOn.add?.includes(calls.add)) throw new Error("add failed");
      for (const row of rows) if (!roles.has(row.role)) roles.set(row.role, row.grantedBy);
      history.push(`add:${rows.map((row) => row.role).join(",")}`);
      assert.ok(roles.size >= 1);
    },
    async remove(list: AppRole[]) {
      calls.remove += 1;
      if (failOn.remove?.includes(calls.remove)) throw new Error("remove failed");
      for (const role of list) roles.delete(role);
      history.push(`remove:${list.join(",")}`);
    },
  };
  return { store, roles, history };
}

const rowsOf = (roles: AppRole[]): RoleRow[] => roles.map((role) => ({ role, grantedBy: "orig" }));

test("planRoleChange: add and remove, no duplicates, one result", () => {
  assert.deepEqual(planRoleChange(["member"], ["lead"]), {
    add: ["lead"],
    remove: ["member"],
    result: ["lead"],
  });
  assert.deepEqual(planRoleChange(["lead", "member"], ["lead", "lead"]), {
    add: [],
    remove: ["member"],
    result: ["lead"],
  });
  assert.deepEqual(planRoleChange(["reader"], ["reader"]), {
    add: [],
    remove: [],
    result: ["reader"],
  });
});

test("applyRoleChange: the new role exists before the old one goes", async () => {
  const { store, roles, history } = fakeStore(["member"]);
  await applyRoleChange({ current: rowsOf(["member"]), desired: ["lead"], grantedBy: "me", store });
  assert.deepEqual(history, ["add:lead", "remove:member"]);
  assert.deepEqual([...roles.keys()], ["lead"]);
  assert.equal(roles.get("lead"), "me");
});

test("applyRoleChange: no change touches nothing", async () => {
  const { store, history } = fakeStore(["lead"]);
  await applyRoleChange({ current: rowsOf(["lead"]), desired: ["lead"], grantedBy: "me", store });
  assert.deepEqual(history, []);
});

test("applyRoleChange: refuses an empty role list", async () => {
  const { store, roles } = fakeStore(["lead"]);
  await assert.rejects(
    applyRoleChange({ current: rowsOf(["lead"]), desired: [], grantedBy: "me", store }),
    /mindst én rolle/,
  );
  assert.deepEqual([...roles.keys()], ["lead"]);
});

test("applyRoleChange: the add fails, nothing changed", async () => {
  const { store, roles } = fakeStore(["member"], { add: [1] });
  await assert.rejects(
    applyRoleChange({ current: rowsOf(["member"]), desired: ["admin"], grantedBy: "me", store }),
    /add failed/,
  );
  assert.deepEqual([...roles.keys()], ["member"]);
});

test("applyRoleChange: the remove fails (e.g. last admin), the new role is taken back", async () => {
  const { store, roles } = fakeStore(["admin"], { remove: [1] });
  await assert.rejects(
    applyRoleChange({ current: rowsOf(["admin"]), desired: ["member"], grantedBy: "me", store }),
    /remove failed/,
  );
  assert.deepEqual([...roles.keys()], ["admin"]);
});

test("applyRoleChange: the audit fails after the change, everything is restored", async () => {
  const { store, roles } = fakeStore(["member"]);
  await assert.rejects(
    applyRoleChange({
      current: rowsOf(["member"]),
      desired: ["lead"],
      grantedBy: "me",
      store,
      afterChange: async () => {
        throw new Error("audit failed");
      },
    }),
    /audit failed/,
  );
  assert.deepEqual([...roles.keys()], ["member"]);
  assert.equal(roles.get("member"), "orig");
});

test("applyRoleChange: a failed rollback says so instead of hiding a half state", async () => {
  // remove call 1 (the change) fails, then remove call 2 (taking the added role back) fails too.
  const { store } = fakeStore(["member"], { remove: [1, 2] });
  await assert.rejects(
    applyRoleChange({ current: rowsOf(["member"]), desired: ["lead"], grantedBy: "me", store }),
    (error: unknown) => error instanceof RoleChangeInconsistentError,
  );
});

test("applyRoleChange: roles are never empty at any step, whatever fails", async () => {
  for (const failOn of [{}, { add: [1] }, { remove: [1] }, { remove: [1, 2] }, { add: [2] }]) {
    const { store, roles } = fakeStore(["member"], failOn);
    try {
      await applyRoleChange({
        current: rowsOf(["member"]),
        desired: ["lead"],
        grantedBy: "me",
        store,
        afterChange: async () => undefined,
      });
    } catch {
      // expected for the failing variants
    }
    assert.ok(roles.size >= 1, JSON.stringify(failOn));
  }
});
