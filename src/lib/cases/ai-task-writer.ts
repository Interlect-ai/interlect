import type { SupabaseClient } from "@supabase/supabase-js";
import { copenhagenDate } from "../overview/dates.ts";
import {
  buildAiTaskDrafts,
  isUntouchedAiTask,
  planAiTaskWrites,
  MAX_AI_TASKS_PER_RUN,
  type AiTaskDraft,
  type AiTaskSource,
  type ExistingTaskRow,
} from "./tasks.ts";

/**
 * The audit writer is passed in (the real one fails closed), so this file has no imports beyond
 * types and the pure task and date rules and can be tested with a fake client.
 */
export type AuditWriter = (
  service: SupabaseClient,
  input: {
    fundId: string | null;
    actorType: "pap" | "user" | "system";
    actorId: string | null;
    action: string;
    entity: string;
    entityId: string | null;
    payload?: Record<string, unknown>;
  },
) => Promise<void>;

const EXISTING_COLUMNS =
  "id, dedupe_key, title, description, origin, status, assignee_id, due_on, answer_text, answer_value, answer_document_id, answer_evidence_id, resolved_at, created_at, updated_at, deleted_at, deleted_by, source_run_id, linked_kind, linked_key";

/**
 * Writes the questions and gaps of a finished screening or deep analysis as AI tasks
 * (origin 'ai'), and tidies the case's earlier AI tasks:
 * - The same gap is never written twice for a case, also not after the team resolved or deleted
 *   it (unique case_id + dedupe_key, and a near-duplicate check on the wording).
 * - AI tasks from an earlier run that nobody touched (open, no answer, never edited) and that
 *   the new run no longer raises are retired: soft-deleted without a "deleted by", audited, and
 *   brought back if a later run raises the gap again. Tasks a person made, changed, answered or
 *   deleted are never touched.
 * a new task is given its responsible person (the case's owner, see `defaultAssignee`)
 *   and its deadline (TASK_DUE_DAYS from today) when it is written.
 * Never throws: a run must not fail because its tasks could not be saved; the failure is logged.
 * Returns the number of tasks written.
 */
export async function writeAiTasksWith(
  service: SupabaseClient,
  writeAudit: AuditWriter,
  input: {
    fundId: string;
    caseId: string;
    runId: string;
    runKind: "screening" | "deep";
    /** The person who started the run; AI tasks are recorded as created on their behalf. */
    createdBy: string;
    source: AiTaskSource;
    /** The moment the deadlines count from (tests); now by default. */
    now?: Date;
  },
): Promise<number> {
  try {
    const raised = buildAiTaskDrafts(input.source);
    const [existing, assigneeId] = await Promise.all([
      loadExisting(service, input.fundId, input.caseId),
      defaultAssignee(service, input),
    ]);
    const start = { assigneeId, today: copenhagenDate(input.now ?? new Date()) };
    const plan = planAiTaskWrites({
      runId: input.runId,
      runKind: input.runKind,
      raised,
      cap: input.source.maxTasks ?? MAX_AI_TASKS_PER_RUN,
      existing,
    });

    const inserted = await insertTasks(service, input, start, plan.insert);
    const restored = await restoreTasks(service, writeAudit, input, start, plan.restore, existing);
    // Retire last, and only when the new tasks were saved: a run that failed to write must not
    // also remove the tasks the team had.
    if (inserted.failed === 0 && plan.retire.length) {
      await retireTasks(service, writeAudit, input, plan.retire, existing);
    }
    return inserted.written + restored;
  } catch (cause) {
    console.error(
      `[ai-tasks] run ${input.runId}: tasks were not saved`,
      cause instanceof Error ? cause.message : cause,
    );
    return 0;
  }
}

async function loadExisting(
  service: SupabaseClient,
  fundId: string,
  caseId: string,
): Promise<ExistingTaskRow[]> {
  const { data, error } = await service
    .from("case_tasks")
    .select(EXISTING_COLUMNS)
    .eq("fund_id", fundId)
    .eq("case_id", caseId);
  if (error) throw new Error(`existing tasks could not be read: ${error.message}`);
  const rows = data ?? [];
  const runIds = [
    ...new Set(rows.map((row) => row["source_run_id"] as string | null).filter(Boolean)),
  ] as string[];
  const kinds = new Map<string, "screening" | "deep">();
  if (runIds.length) {
    const { data: runs, error: runError } = await service
      .from("analysis_runs")
      .select("id, kind")
      .eq("fund_id", fundId)
      .in("id", runIds);
    if (runError) throw new Error(`task runs could not be read: ${runError.message}`);
    for (const run of runs ?? []) {
      const kind = run["kind"];
      if (kind === "screening" || kind === "deep") kinds.set(run["id"] as string, kind);
    }
  }
  return rows.map((row) => ({
    id: row["id"] as string,
    dedupeKey: (row["dedupe_key"] as string | null) ?? null,
    title: row["title"] as string,
    description: (row["description"] as string | null) ?? null,
    origin: row["origin"] as string,
    status: row["status"] as string,
    assigneeId: (row["assignee_id"] as string | null) ?? null,
    dueOn: (row["due_on"] as string | null) ?? null,
    answerText: (row["answer_text"] as string | null) ?? null,
    answerValue: row["answer_value"] ?? null,
    answerDocumentId: (row["answer_document_id"] as string | null) ?? null,
    answerEvidenceId: (row["answer_evidence_id"] as string | null) ?? null,
    resolvedAt: (row["resolved_at"] as string | null) ?? null,
    createdAt: row["created_at"] as string,
    updatedAt: row["updated_at"] as string,
    deletedAt: (row["deleted_at"] as string | null) ?? null,
    deletedBy: (row["deleted_by"] as string | null) ?? null,
    sourceRunId: (row["source_run_id"] as string | null) ?? null,
    sourceRunKind: kinds.get(row["source_run_id"] as string) ?? null,
    linkedKind: (row["linked_kind"] as string | null) ?? null,
    linkedKey: (row["linked_key"] as string | null) ?? null,
  }));
}

/** `case_tasks_check_assignee`'s error code for a responsible person who is not a member (0039). */
const NOT_A_MEMBER = "IL001";

/** Who and when a new AI task starts with. */
interface TaskStart {
  assigneeId: string | null;
  /** The run's Copenhagen date, "YYYY-MM-DD". */
  today: string;
}

/** "YYYY-MM-DD" plus whole days (calendar arithmetic, no time zone involved). */
export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year!, (month ?? 1) - 1, (day ?? 1) + days)).toISOString().slice(0, 10);
}

/**
 * The person an AI task is given from the start: the case's owner (the
 * person it is assigned to, else the one who created it), else the person who started the run.
 * Only an active member of the fund can hold a task (the `case_tasks_check_assignee` trigger), so
 * a former member is skipped. A failed read gives no one: the tasks are still written, and the
 * failure is logged.
 */
async function defaultAssignee(
  service: SupabaseClient,
  input: { fundId: string; caseId: string; runId: string; createdBy: string },
): Promise<string | null> {
  try {
    const { data: caseRow, error } = await service
      .from("cases")
      .select("assigned_to, created_by")
      .eq("id", input.caseId)
      .eq("fund_id", input.fundId)
      .maybeSingle();
    if (error) throw new Error(`the case could not be read: ${error.message}`);
    const candidates = [
      ...new Set(
        [
          (caseRow?.["assigned_to"] as string | null | undefined) ?? null,
          (caseRow?.["created_by"] as string | null | undefined) ?? null,
          input.createdBy,
        ].filter((id): id is string => Boolean(id)),
      ),
    ];
    if (candidates.length === 0) return null;
    const { data: members, error: memberError } = await service
      .from("fund_memberships")
      .select("user_id")
      .eq("fund_id", input.fundId)
      .eq("status", "active")
      .in("user_id", candidates);
    if (memberError) throw new Error(`the members could not be read: ${memberError.message}`);
    const active = new Set((members ?? []).map((row) => row["user_id"] as string));
    const chosen = candidates.find((id) => active.has(id)) ?? null;
    if (chosen === null) {
      // Not a failure, but the tasks then show on nobody's Overblik: say so.
      console.warn(
        `[ai-tasks] run ${input.runId}: case ${input.caseId} has no active member to hold its tasks`,
      );
    }
    return chosen;
  } catch (cause) {
    console.error(
      `[ai-tasks] run ${input.runId}: no responsible person set`,
      cause instanceof Error ? cause.message : cause,
    );
    return null;
  }
}

function taskRow(
  input: { fundId: string; caseId: string; runId: string; createdBy: string },
  start: TaskStart,
  draft: AiTaskDraft,
) {
  return {
    fund_id: input.fundId,
    case_id: input.caseId,
    kind: draft.kind,
    title: draft.title,
    why: draft.why,
    description: draft.description ?? null,
    linked_kind: draft.linkedKind,
    linked_key: draft.linkedKey,
    origin: "ai",
    dedupe_key: draft.dedupeKey,
    source_run_id: input.runId,
    created_by: input.createdBy,
    assignee_id: start.assigneeId,
    due_on: addDays(start.today, draft.dueInDays),
  };
}

async function insertTasks(
  service: SupabaseClient,
  input: { fundId: string; caseId: string; runId: string; createdBy: string },
  start: TaskStart,
  drafts: AiTaskDraft[],
): Promise<{ written: number; failed: number }> {
  if (drafts.length === 0) return { written: 0, failed: 0 };
  const rows = drafts.map((draft) => taskRow(input, start, draft));
  const { data, error } = await service
    .from("case_tasks")
    .upsert(rows, { onConflict: "case_id,dedupe_key", ignoreDuplicates: true })
    .select("id");
  if (!error) return { written: data?.length ?? 0, failed: 0 };

  // One bad row rejects the whole batch; save the others one by one (harden).
  console.error(`[ai-tasks] run ${input.runId}: batch rejected, retrying per task`, error.message);
  let written = 0;
  let failed = 0;
  for (const row of rows) {
    let { data: one, error: oneError } = await service
      .from("case_tasks")
      .upsert(row, { onConflict: "case_id,dedupe_key", ignoreDuplicates: true })
      .select("id");
    // The responsible person can have left the team since it was read: the task is still saved,
    // without one (the trigger rejects a non-member with this code).
    if (oneError?.code === NOT_A_MEMBER && row.assignee_id) {
      console.error(
        `[ai-tasks] run ${input.runId}: task "${row.dedupe_key.slice(0, 80)}" retried without a responsible person`,
        oneError.code,
        oneError.message,
      );
      ({ data: one, error: oneError } = await service
        .from("case_tasks")
        .upsert(
          { ...row, assignee_id: null },
          { onConflict: "case_id,dedupe_key", ignoreDuplicates: true },
        )
        .select("id"));
    }
    if (oneError) {
      failed += 1;
      console.error(
        `[ai-tasks] run ${input.runId}: task "${row.dedupe_key.slice(0, 80)}" not saved`,
        oneError.code,
        oneError.message,
      );
    } else written += one?.length ?? 0;
  }
  if (failed) {
    console.error(`[ai-tasks] run ${input.runId}: ${failed} of ${rows.length} tasks not saved`);
  }
  return { written, failed };
}

/** A gap the system retired earlier and this run raises again: back on the list, new wording. */
async function restoreTasks(
  service: SupabaseClient,
  writeAudit: AuditWriter,
  input: { fundId: string; caseId: string; runId: string; createdBy: string },
  start: TaskStart,
  restore: Array<{ id: string; draft: AiTaskDraft }>,
  existing: readonly ExistingTaskRow[],
): Promise<number> {
  if (restore.length === 0) return 0;
  const byId = new Map(existing.map((row) => [row.id, row]));
  const planned = restore.filter(({ id }) => byId.has(id));
  if (planned.length === 0) return 0;
  // The audit event comes first and fails closed, like the retirement: no record, no change.
  try {
    await writeAudit(service, {
      fundId: input.fundId,
      actorType: "pap",
      actorId: input.runId,
      action: "ai_tasks_restored",
      entity: "cases",
      entityId: input.caseId,
      payload: { runId: input.runId, taskIds: planned.map(({ id }) => id) },
    });
  } catch {
    return 0; // already logged by writeAudit
  }
  let restored = 0;
  const done: string[] = [];
  for (const { id, draft } of planned) {
    const previous = byId.get(id)!;
    // `updated_at` is left alone on purpose: the task is still untouched by any person. It starts
    // again like a new task: the case's owner and a fresh deadline.
    const restoreAs = (assigneeId: string | null) => {
      let update = service
        .from("case_tasks")
        .update({
          deleted_at: null,
          deleted_by: null,
          content_purged_at: null,
          kind: draft.kind,
          title: draft.title,
          why: draft.why,
          description: draft.description ?? null,
          dedupe_key: draft.dedupeKey,
          source_run_id: input.runId,
          assignee_id: assigneeId,
          due_on: addDays(start.today, draft.dueInDays),
        })
        .eq("id", id)
        .eq("fund_id", input.fundId)
        .eq("case_id", input.caseId)
        .not("deleted_at", "is", null)
        .is("deleted_by", null)
        .eq("status", "open");
      // The responsible person and deadline as they were read (see `retireTasks`).
      update =
        previous.assigneeId === null
          ? update.is("assignee_id", null)
          : update.eq("assignee_id", previous.assigneeId);
      update =
        previous.dueOn === null ? update.is("due_on", null) : update.eq("due_on", previous.dueOn);
      return update
        .is("answer_text", null)
        .is("answer_value", null)
        .is("answer_document_id", null)
        .is("answer_evidence_id", null)
        .eq("updated_at", previous.updatedAt)
        .select("id");
    };
    let { data, error } = await restoreAs(start.assigneeId);
    // The case's owner can have left the team since it was read: restore without one.
    if (error?.code === NOT_A_MEMBER && start.assigneeId) ({ data, error } = await restoreAs(null));
    if (error) {
      console.error(`[ai-tasks] run ${input.runId}: task ${id} not restored`, error.message);
    } else if (data?.length) {
      restored += 1;
      done.push(id);
    }
  }
  if (done.length !== planned.length) {
    await auditTaskBatch(service, writeAudit, input, "ai_tasks_restored_result", done);
  }
  return restored;
}

/** The run no longer raises these, and nobody touched them: off the list, with an audit event. */
async function retireTasks(
  service: SupabaseClient,
  writeAudit: AuditWriter,
  input: { fundId: string; caseId: string; runId: string },
  ids: string[],
  existing: readonly ExistingTaskRow[],
): Promise<void> {
  const byId = new Map(existing.map((row) => [row.id, row]));
  // The audit event comes first and fails closed: no record, no retirement.
  try {
    await writeAudit(service, {
      fundId: input.fundId,
      actorType: "pap",
      actorId: input.runId,
      action: "ai_tasks_retired",
      entity: "cases",
      entityId: input.caseId,
      payload: { runId: input.runId, taskIds: ids, reason: "not raised by the newer run" },
    });
  } catch {
    return; // already logged by writeAudit
  }
  const retired: string[] = [];
  for (const id of ids) {
    const row = byId.get(id);
    if (!row) continue;
    // Only the version of the task that was read: a person who touched it meanwhile wins.
    // `updated_at` is left alone so the retirement can be told from a person's delete. Since
    // an untouched AI task can have a responsible person and a deadline (set when it was written),
    // so they are compared with the read row instead of required empty; a person who changes
    // either also moves `updated_at`, which is checked too.
    let update = service
      .from("case_tasks")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id)
      .eq("fund_id", input.fundId)
      .eq("case_id", input.caseId)
      .is("deleted_at", null)
      .eq("status", "open");
    update =
      row.assigneeId === null
        ? update.is("assignee_id", null)
        : update.eq("assignee_id", row.assigneeId);
    update = row.dueOn === null ? update.is("due_on", null) : update.eq("due_on", row.dueOn);
    const { data, error } = await update
      .is("answer_text", null)
      .is("answer_value", null)
      .is("answer_document_id", null)
      .is("answer_evidence_id", null)
      .eq("updated_at", row.updatedAt)
      .select("id");
    if (error) {
      console.error(`[ai-tasks] run ${input.runId}: task ${id} not retired`, error.message);
    } else if (data?.length) retired.push(id);
  }
  if (retired.length !== ids.length) {
    await auditTaskBatch(service, writeAudit, input, "ai_tasks_retired_result", retired);
  }
}

async function auditTaskBatch(
  service: SupabaseClient,
  writeAudit: AuditWriter,
  input: { fundId: string; caseId: string; runId: string },
  action: string,
  taskIds: string[],
): Promise<void> {
  try {
    await writeAudit(service, {
      fundId: input.fundId,
      actorType: "pap",
      actorId: input.runId,
      action,
      entity: "cases",
      entityId: input.caseId,
      payload: { runId: input.runId, taskIds },
    });
  } catch {
    // Logged by writeAudit; the task change itself is already saved.
  }
}

/**
 * Titles of the tasks the case has open right now (any origin), newest first and capped, for the
 * synthesis's curated next steps: it must not write a step the case already has. Tasks the new
 * run would retire (untouched AI tasks of the run's own kind) are left out: the model does not
 * restate what it is told is already there, so showing them would let the run retire still-valid
 * tasks nobody replaces. A read that fails returns nothing (the planner's near-duplicate check
 * still protects the list).
 */
export async function loadOpenTaskTitles(
  service: SupabaseClient,
  fundId: string,
  caseId: string,
  limit: number,
  runKind: "screening" | "deep",
): Promise<string[]> {
  try {
    const existing = await loadExisting(service, fundId, caseId);
    return (
      existing
        .filter(
          (row) =>
            row.deletedAt === null &&
            row.status === "open" &&
            !(isUntouchedAiTask(row) && row.sourceRunKind === runKind),
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, limit)
        // Since the title is a short name and the question is the description: the model
        // needs both to recognise a task it must not write again.
        .map((row) =>
          row.description ? `${row.title}: ${row.description}`.slice(0, 200) : row.title,
        )
        .filter(Boolean)
    );
  } catch (cause) {
    console.error("[ai-tasks] open task titles", cause instanceof Error ? cause.message : cause);
    return [];
  }
}
