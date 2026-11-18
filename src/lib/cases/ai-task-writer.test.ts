import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadOpenTaskTitles, writeAiTasksWith, type AuditWriter } from "./ai-task-writer.ts";
import type { AiTaskSource } from "./tasks.ts";

interface Call {
  table: string;
  op: "select" | "update" | "upsert";
  payload: unknown;
  filters: Array<[string, string, unknown]>;
}

/** A recording stand-in for the Supabase query builder (enough for the task writer). */
function fakeService(rows: {
  tasks: Array<Record<string, unknown>>;
  runs: Array<Record<string, unknown>>;
  /** The case's owner columns. */
  caseRow?: Record<string, unknown> | null;
  /** Active members (user ids) of the fund. */
  members?: string[];
  /** The trigger rejects a responsible person (IL001), as when they left meanwhile. */
  rejectAssignee?: boolean;
}) {
  const log: Array<Call | { audit: string }> = [];
  const service = {
    from(table: string) {
      const call: Call = { table, op: "select", payload: null, filters: [] };
      const builder: Record<string, unknown> = {};
      const chain =
        (name: string) =>
        (...args: unknown[]) => {
          if (name === "update" || name === "upsert") {
            call.op = name;
            call.payload = args[0];
          } else if (["eq", "is", "not", "in"].includes(name)) {
            call.filters.push([name, String(args[0]), args.length > 2 ? args.slice(1) : args[1]]);
          }
          return builder;
        };
      for (const name of [
        "select",
        "update",
        "upsert",
        "eq",
        "is",
        "not",
        "in",
        "order",
        "limit",
      ]) {
        builder[name] = chain(name);
      }
      builder["maybeSingle"] = () => ({
        then: (resolve: (value: unknown) => void) => {
          log.push(call);
          resolve({ data: table === "cases" ? (rows.caseRow ?? null) : null, error: null });
        },
      });
      builder["then"] = (resolve: (value: unknown) => void) => {
        log.push(call);
        if (call.op === "select" && table === "fund_memberships") {
          resolve({ data: (rows.members ?? []).map((id) => ({ user_id: id })), error: null });
        } else if (call.op === "select") {
          resolve({ data: table === "case_tasks" ? rows.tasks : rows.runs, error: null });
        } else if (call.op === "update") {
          // A compare-and-set that matches: return the row id asked for.
          const id = call.filters.find((filter) => filter[1] === "id")?.[2];
          resolve({ data: [{ id }], error: null });
        } else {
          const payloads = (Array.isArray(call.payload) ? call.payload : [call.payload]) as Array<
            Record<string, unknown>
          >;
          if (rows.rejectAssignee && payloads.some((row) => row["assignee_id"])) {
            resolve({ data: null, error: { code: "IL001", message: "not a member" } });
            return;
          }
          resolve({ data: payloads.map(() => ({ id: "new" })), error: null });
        }
      };
      return builder;
    },
  } as unknown as SupabaseClient;
  const audit: AuditWriter = async (_service, input) => {
    log.push({ audit: input.action });
  };
  return { service, audit, log };
}

const T0 = "2026-09-30T10:00:00.000000+00:00";
const taskRow = (over: Record<string, unknown>) => ({
  id: "t1",
  dedupe_key: "none::gammelt hul",
  title: "Gammelt hul",
  origin: "ai",
  status: "open",
  assignee_id: null,
  due_on: null,
  answer_text: null,
  answer_value: null,
  answer_document_id: null,
  answer_evidence_id: null,
  resolved_at: null,
  created_at: T0,
  updated_at: T0,
  deleted_at: null,
  deleted_by: null,
  source_run_id: "run-old",
  linked_kind: null,
  linked_key: null,
  ...over,
});

const source: AiTaskSource = {
  gates: [],
  criteria: [],
  unresolvedGateKeys: [],
  missingCriterionKeys: [],
  assessments: [],
  openQuestions: ["Et helt nyt spørgsmål"],
};
const input = {
  fundId: "f",
  caseId: "c",
  runId: "run-new",
  runKind: "screening" as const,
  createdBy: "u",
  source,
};
const runs = [{ id: "run-old", kind: "screening" }];

test("retirement: the audit event is written before any update, and each update is a compare-and-set", async () => {
  const { service, audit, log } = fakeService({ tasks: [taskRow({})], runs });
  await writeAiTasksWith(service, audit, input);
  const order = log.map((entry) =>
    "audit" in entry ? `audit:${entry.audit}` : `${entry.table}:${entry.op}`,
  );
  assert.ok(order.indexOf("audit:ai_tasks_retired") >= 0);
  const firstRetireUpdate = log.findIndex(
    (entry) => "op" in entry && entry.op === "update" && entry.table === "case_tasks",
  );
  assert.ok(order.indexOf("audit:ai_tasks_retired") < firstRetireUpdate);
  const update = log[firstRetireUpdate] as Call;
  const filters = update.filters.map((filter) => `${filter[0]}:${filter[1]}`);
  for (const guard of [
    "is:deleted_at",
    "eq:status",
    "is:assignee_id",
    "is:answer_text",
    "is:answer_value",
    "eq:updated_at",
  ]) {
    assert.ok(filters.includes(guard), `missing guard ${guard}`);
  }
  assert.equal(update.filters.find((filter) => filter[1] === "updated_at")?.[2], T0);
  // The retirement leaves `updated_at` alone and sets no "deleted by".
  const payload = update.payload as Record<string, unknown>;
  assert.deepEqual(Object.keys(payload), ["deleted_at"]);
});

test("a failed audit event means nothing is retired", async () => {
  const { service, log } = fakeService({ tasks: [taskRow({})], runs });
  const failing: AuditWriter = async () => {
    throw new Error("audit down");
  };
  await writeAiTasksWith(service, failing, input);
  const updates = log.filter((entry) => "op" in entry && entry.op === "update");
  assert.equal(updates.length, 0);
});

test("a run of another kind retires nothing", async () => {
  const { service, audit, log } = fakeService({
    tasks: [taskRow({ source_run_id: "run-deep" })],
    runs: [{ id: "run-deep", kind: "deep" }],
  });
  await writeAiTasksWith(service, audit, input);
  assert.equal(log.filter((entry) => "audit" in entry).length, 0);
});

test("restore is a compare-and-set on a system-retired, untouched row and keeps updated_at", async () => {
  const retired = taskRow({
    dedupe_key: "none::et helt nyt spørgsmål",
    title: "Et helt nyt spørgsmål",
    deleted_at: "2026-09-30T11:00:00Z",
  });
  const { service, audit, log } = fakeService({ tasks: [retired], runs });
  await writeAiTasksWith(service, audit, input);
  const update = log.find((entry) => "op" in entry && entry.op === "update") as Call;
  const filters = update.filters.map((filter) => `${filter[0]}:${filter[1]}`);
  for (const guard of ["not:deleted_at", "is:deleted_by", "eq:updated_at"]) {
    assert.ok(filters.includes(guard), `missing guard ${guard}`);
  }
  const payload = update.payload as Record<string, unknown>;
  assert.equal(payload["deleted_at"], null);
  assert.equal("updated_at" in payload, false);
  assert.ok(log.some((entry) => "audit" in entry && entry.audit === "ai_tasks_restored"));
  // The gap came back: no new row was inserted.
  assert.equal(log.filter((entry) => "op" in entry && entry.op === "upsert").length, 0);
});

test("restore writes its audit event BEFORE the update and fails closed (#11)", async () => {
  const retired = taskRow({
    dedupe_key: "none::et helt nyt spørgsmål",
    title: "Et helt nyt spørgsmål",
    deleted_at: "2026-09-30T11:00:00Z",
  });
  const ok = fakeService({ tasks: [retired], runs });
  await writeAiTasksWith(ok.service, ok.audit, input);
  const auditAt = ok.log.findIndex(
    (entry) => "audit" in entry && entry.audit === "ai_tasks_restored",
  );
  const updateAt = ok.log.findIndex((entry) => "op" in entry && entry.op === "update");
  assert.ok(auditAt >= 0 && auditAt < updateAt);

  const bad = fakeService({ tasks: [retired], runs });
  const failing: AuditWriter = async () => {
    throw new Error("audit down");
  };
  await writeAiTasksWith(bad.service, failing, input);
  assert.equal(bad.log.filter((entry) => "op" in entry && entry.op === "update").length, 0);
});

test("retire and restore also guard case, due date, file and evidence (#11)", async () => {
  const retire = fakeService({ tasks: [taskRow({})], runs });
  await writeAiTasksWith(retire.service, retire.audit, input);
  const retireUpdate = retire.log.find((entry) => "op" in entry && entry.op === "update") as Call;
  const restore = fakeService({
    tasks: [
      taskRow({
        dedupe_key: "none::et helt nyt spørgsmål",
        title: "Et helt nyt spørgsmål",
        deleted_at: "2026-09-30T11:00:00Z",
      }),
    ],
    runs,
  });
  await writeAiTasksWith(restore.service, restore.audit, input);
  const restoreUpdate = restore.log.find((entry) => "op" in entry && entry.op === "update") as Call;
  for (const call of [retireUpdate, restoreUpdate]) {
    const filters = call.filters.map((filter) => `${filter[0]}:${filter[1]}`);
    for (const guard of [
      "eq:case_id",
      "is:due_on",
      "is:answer_document_id",
      "is:answer_evidence_id",
      "is:assignee_id",
      "eq:updated_at",
    ]) {
      assert.ok(filters.includes(guard), `missing guard ${guard}`);
    }
  }
});

test("the synthesis is shown only open tasks that this run would not retire (#2)", async () => {
  const { service } = fakeService({
    tasks: [
      taskRow({ id: "a", title: "Urørt dyb-opgave", source_run_id: "run-deep" }),
      taskRow({
        id: "b",
        title: "Rørt dyb-opgave",
        source_run_id: "run-deep",
        assignee_id: "u1",
        updated_at: "2026-09-30T12:00:00.000000+00:00",
      }),
      taskRow({ id: "c", title: "Screening-opgave", source_run_id: "run-old" }),
      taskRow({ id: "d", title: "Slettet", source_run_id: "run-old", deleted_at: "x" }),
    ],
    runs: [
      { id: "run-deep", kind: "deep" },
      { id: "run-old", kind: "screening" },
    ],
  });
  const titles = await loadOpenTaskTitles(service, "f", "c", 25, "deep");
  assert.deepEqual(titles.sort(), ["Rørt dyb-opgave", "Screening-opgave"]);
});

const upserted = (log: Array<Call | { audit: string }>) =>
  log
    .filter((entry): entry is Call => "op" in entry && entry.op === "upsert")
    .flatMap((call) => (Array.isArray(call.payload) ? call.payload : [call.payload])) as Array<
    Record<string, unknown>
  >;

test("T-753: a new task starts with the case's owner and a deadline from today", async () => {
  const { service, audit, log } = fakeService({
    tasks: [],
    runs,
    caseRow: { assigned_to: "owner", created_by: "creator" },
    members: ["owner", "creator", "u"],
  });
  await writeAiTasksWith(service, audit, {
    ...input,
    now: new Date("2026-10-15T22:30:00Z"), // 16 Oct in Copenhagen
  });
  const rows = upserted(log);
  assert.ok(rows.length > 0);
  for (const row of rows) {
    assert.equal(row["assignee_id"], "owner");
    // An open question is not urgent: two weeks from the Copenhagen date.
    assert.equal(row["due_on"], "2026-10-30");
  }
});

test("T-753: an urgent gap (an unknown binding gate) gets one week", async () => {
  const { service, audit, log } = fakeService({
    tasks: [],
    runs,
    caseRow: { assigned_to: null, created_by: "creator" },
    members: ["creator"],
  });
  await writeAiTasksWith(service, audit, {
    ...input,
    now: new Date("2026-12-28T10:00:00Z"),
    source: {
      ...source,
      gates: [{ key: "geo", label: "Nordisk selskab", treatment: "hard" }],
      unresolvedGateKeys: ["geo"],
    },
  });
  const gate = upserted(log).find((row) => row["linked_kind"] === "gate");
  assert.equal(gate?.["due_on"], "2027-01-04");
  assert.equal(gate?.["assignee_id"], "creator");
});

test("T-753: a former member is never given a task; the run's starter or no one is", async () => {
  const left = fakeService({
    tasks: [],
    runs,
    caseRow: { assigned_to: "gone", created_by: "gone-too" },
    members: ["u"],
  });
  await writeAiTasksWith(left.service, left.audit, input);
  assert.ok(upserted(left.log).every((row) => row["assignee_id"] === "u"));

  const nobody = fakeService({ tasks: [], runs, caseRow: null, members: [] });
  await writeAiTasksWith(nobody.service, nobody.audit, input);
  const rows = upserted(nobody.log);
  assert.ok(rows.length > 0);
  assert.ok(rows.every((row) => row["assignee_id"] === null && typeof row["due_on"] === "string"));
});

test("T-753: an untouched task with a responsible person and deadline is still retired, guarded on both", async () => {
  const { service, audit, log } = fakeService({
    tasks: [taskRow({ assignee_id: "owner", due_on: "2026-10-10" })],
    runs,
    caseRow: { assigned_to: "owner", created_by: "owner" },
    members: ["owner"],
  });
  await writeAiTasksWith(service, audit, input);
  const update = log.find(
    (entry) => "op" in entry && entry.op === "update" && entry.table === "case_tasks",
  ) as Call;
  assert.ok(update, "the untouched task was retired");
  assert.deepEqual(
    update.filters.find((filter) => filter[1] === "assignee_id"),
    ["eq", "assignee_id", "owner"],
  );
  assert.deepEqual(
    update.filters.find((filter) => filter[1] === "due_on"),
    ["eq", "due_on", "2026-10-10"],
  );
});

test("T-753: a responsible person who left meanwhile: the tasks are saved without one", async () => {
  const { service, audit, log } = fakeService({
    tasks: [],
    runs,
    caseRow: { assigned_to: "owner", created_by: "owner" },
    members: ["owner"],
    rejectAssignee: true,
  });
  const written = await writeAiTasksWith(service, audit, input);
  assert.equal(written, 1);
  const saved = upserted(log).filter((row) => row["assignee_id"] === null);
  assert.equal(saved.length, 1);
});

test("T-753: the synthesis sees an open task's short title with its question", async () => {
  const { service } = fakeService({
    tasks: [
      taskRow({
        id: "q",
        title: "Churn pr. kohorte",
        description: "Indhent månedlig churn pr. kundekohorte.",
        source_run_id: "run-old",
        updated_at: "2026-09-30T12:00:00.000000+00:00",
      }),
    ],
    runs,
  });
  const titles = await loadOpenTaskTitles(service, "f", "c", 25, "screening");
  assert.deepEqual(titles, ["Churn pr. kohorte: Indhent månedlig churn pr. kundekohorte."]);
});
