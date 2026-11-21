import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/lib/supabase/auth-middleware";
import { requireFundCapability, writeAudit } from "@/lib/auth/access.server";
import { getServiceClient } from "@/lib/supabase/admin.server";
import {
  currentGateVerdict,
  recalculateScreeningScore,
  type Recalculation,
} from "@/lib/analysis/rescore.server";
import { hasCapability } from "@/lib/domain/workflow";
import { roleLabels } from "@/lib/auth/roles";
import type { AppRole } from "@/lib/supabase/types";
import {
  caseTaskAnswerKinds,
  caseTaskKinds,
  isBindingGateAnswer,
  resolveTaskSource,
  type TaskRunKind,
  type CaseTaskAnswerKind,
  type CaseTaskKind,
} from "./tasks";
import { serverText } from "@/lib/i18n/server-text";
import { caseThesis } from "@/lib/funds/thesis-scope.server";
import { withDemoView } from "@/lib/display/display-names.server";

/**
 * "Skal afklares" (0034). Samme liste i screening og dyb analyse. Alle kan læse; Admin, Lead og
 * Medlem opretter, redigerer, sletter og besvarer (manage_tasks). Alt skrives af serveren.
 */

const fundIdSchema = z.guid();
const TASK_COLUMNS =
  "id, case_id, kind, title, description, why, answer_kind, answer_options, answer_unit, assignee_id, due_on, linked_kind, linked_key, origin, source_run_id, status, answer_text, answer_value, answer_document_id, answer_evidence_id, resolved_by, resolved_at, created_at, updated_at";

export interface CaseTaskAnswerValue {
  number?: number;
  option?: string;
  gatePassed?: boolean;
  /** An Admin or Lead turned a failed requirement into met (written reason, audited). */
  override?: boolean;
  /** The setup version the gate answer was given against (it only counts under that version). */
  configVersionId?: string | null;
}

/** Shortest written reason for overriding a failed requirement (mandate_gate_override). */
const OVERRIDE_REASON_MIN = 10;

export interface CaseTask {
  id: string;
  kind: CaseTaskKind;
  title: string;
  description: string | null;
  why: string | null;
  answerKind: CaseTaskAnswerKind;
  answerOptions: string[];
  answerUnit: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  dueOn: string | null;
  linkedKind: "gate" | "criterion" | null;
  linkedKey: string | null;
  origin: "ai" | "user";
  /** The run that raised an AI task (null for tasks people made, or when the run is gone). */
  sourceRunId: string | null;
  /** 'screening' | 'deep': the UI's "Fra dyb analyse" label. null when there is no run. */
  sourceRunKind: TaskRunKind | null;
  status: "open" | "resolved";
  answerText: string | null;
  answerValue: CaseTaskAnswerValue | null;
  answerDocumentId: string | null;
  /** The attached file's name (Filer), when the answer has one. */
  answerFileName: string | null;
  resolvedAt: string | null;
  /** Who answered ("Oplyst af …" on Mandatfit). */
  resolvedByName: string | null;
  /** A criterion answered after the latest screening: offer a new screening (no score change). */
  newAnswer: boolean;
  createdAt: string;
}

export const listCaseTasks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ fundId: fundIdSchema, caseId: z.guid() }).parse(input))
  .handler(
    withDemoView(async ({ data, context }): Promise<CaseTask[]> => {
      await requireFundCapability(context.supabase, context.userId, data.fundId, "view_case");
      const [{ data: rows, error }, { data: latestScreening, error: screeningError }] =
        await Promise.all([
          context.supabase
            .from("case_tasks")
            .select(TASK_COLUMNS)
            .eq("fund_id", data.fundId)
            .eq("case_id", data.caseId)
            .is("deleted_at", null)
            .order("created_at", { ascending: true }),
          context.supabase
            .from("analysis_runs")
            .select("completed_at")
            .eq("fund_id", data.fundId)
            .eq("case_id", data.caseId)
            .eq("kind", "screening")
            .in("status", ["complete", "awaiting_approval"])
            .not("completed_at", "is", null)
            .order("completed_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
        ]);
      if (error || screeningError) {
        console.error("[listCaseTasks]", error?.message ?? screeningError?.message);
        throw new Error(serverText("caseServer.tasks.notLoaded"));
      }
      // Which kind of run raised each AI task ("Fra dyb analyse"); same fund only.
      const runIds = [
        ...new Set(
          (rows ?? []).map((row) => row["source_run_id"] as string | null).filter(Boolean),
        ),
      ] as string[];
      const runKinds = new Map<string, TaskRunKind>();
      if (runIds.length) {
        const { data: runs, error: runsError } = await context.supabase
          .from("analysis_runs")
          .select("id, kind")
          .eq("fund_id", data.fundId)
          .in("id", runIds);
        // The label is cosmetic: the list still loads, but the failure is logged.
        if (runsError) console.error("[listCaseTasks] runs", runsError.message);
        for (const run of runs ?? []) {
          if (run["kind"] === "screening" || run["kind"] === "deep") {
            runKinds.set(run["id"] as string, run["kind"]);
          }
        }
      }
      const assigneeIds = [
        ...new Set(
          (rows ?? [])
            .flatMap((row) => [row["assignee_id"], row["resolved_by"]] as Array<string | null>)
            .filter(Boolean),
        ),
      ] as string[];
      const names = new Map<string, string | null>();
      const documentIds = [
        ...new Set(
          (rows ?? []).map((row) => row["answer_document_id"] as string | null).filter(Boolean),
        ),
      ] as string[];
      const fileNames = new Map<string, string>();
      if (documentIds.length) {
        const { data: documents, error: documentsError } = await context.supabase
          .from("documents")
          .select("id, file_name")
          .eq("fund_id", data.fundId)
          .in("id", documentIds);
        // File names are cosmetic: the list still loads, but the failure is logged.
        if (documentsError) console.error("[listCaseTasks] documents", documentsError.message);
        for (const document of documents ?? []) {
          fileNames.set(document["id"] as string, document["file_name"] as string);
        }
      }
      if (assigneeIds.length) {
        const { data: profiles, error: profilesError } = await context.supabase
          .from("profiles")
          .select("id, full_name, email_normalized")
          .in("id", assigneeIds);
        // Names are cosmetic: the list still loads, but the failure is logged.
        if (profilesError) console.error("[listCaseTasks] profiles", profilesError.message);
        for (const profile of profiles ?? []) {
          names.set(
            profile["id"] as string,
            (profile["full_name"] as string | null) ??
              (profile["email_normalized"] as string | null),
          );
        }
      }
      const screenedAt = (latestScreening?.["completed_at"] as string | null) ?? null;
      return (rows ?? []).map((row) => mapTask(row, names, fileNames, screenedAt, runKinds));
    }),
  );

export interface TaskAssignee {
  userId: string;
  name: string;
  /** The highest role, as shown under the name ("Lead", "Medlem"). */
  roleLabel: string;
  isMe: boolean;
}

const ROLE_ORDER: AppRole[] = ["admin", "lead", "member", "reader"];

/**
 * Who can be responsible for a task: the fund's active members who can work on tasks (Admin,
 * Lead, Medlem). A Læser cannot answer a task, so is not offered. Everyone who can see the case
 * may read the list (the assignee picker is shown to all who manage tasks).
 */
export const listTaskAssignees = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ fundId: fundIdSchema }).parse(input))
  .handler(async ({ data, context }): Promise<TaskAssignee[]> => {
    await requireFundCapability(context.supabase, context.userId, data.fundId, "view_case");
    const { data: memberships, error } = await context.supabase
      .from("fund_memberships")
      .select("user_id, status, fund_membership_roles(role)")
      .eq("fund_id", data.fundId)
      .eq("status", "active");
    if (error) {
      console.error("[listTaskAssignees]", error.message);
      throw new Error(serverText("caseServer.common.teamNotLoaded"));
    }
    const rows = (
      (memberships ?? []) as unknown as Array<{
        user_id: string;
        fund_membership_roles: { role: AppRole }[] | null;
      }>
    ).flatMap((row) => {
      const roles = (row.fund_membership_roles ?? []).map((entry) => entry.role);
      const top = ROLE_ORDER.find((role) => roles.includes(role));
      return top && top !== "reader" ? [{ userId: row.user_id, role: top }] : [];
    });
    const names = new Map<string, string>();
    if (rows.length) {
      const { data: profiles, error: profilesError } = await context.supabase
        .from("profiles")
        .select("id, full_name, email_normalized")
        .in(
          "id",
          rows.map((row) => row.userId),
        );
      if (profilesError) {
        console.error("[listTaskAssignees] profiles", profilesError.message);
        throw new Error(serverText("caseServer.common.teamNotLoaded"));
      }
      for (const profile of profiles ?? []) {
        const name =
          (profile["full_name"] as string | null)?.trim() ||
          (profile["email_normalized"] as string | null) ||
          "Unavngivet bruger";
        names.set(profile["id"] as string, name);
      }
    }
    return rows
      .map((row) => ({
        userId: row.userId,
        name: names.get(row.userId) ?? "Unavngivet bruger",
        roleLabel: roleLabels[row.role],
        isMe: row.userId === context.userId,
      }))
      .sort((a, b) => Number(b.isMe) - Number(a.isMe) || a.name.localeCompare(b.name, "da"));
  });

function mapTask(
  row: Record<string, unknown>,
  names: Map<string, string | null>,
  fileNames: Map<string, string>,
  screenedAt: string | null,
  runKinds: ReadonlyMap<string, TaskRunKind>,
): CaseTask {
  const resolvedAt = (row["resolved_at"] as string | null) ?? null;
  const assigneeId = (row["assignee_id"] as string | null) ?? null;
  const resolvedBy = (row["resolved_by"] as string | null) ?? null;
  const answerDocumentId = (row["answer_document_id"] as string | null) ?? null;
  return {
    id: row["id"] as string,
    kind: row["kind"] as CaseTaskKind,
    title: row["title"] as string,
    description: (row["description"] as string | null) ?? null,
    why: (row["why"] as string | null) ?? null,
    answerKind: row["answer_kind"] as CaseTaskAnswerKind,
    answerOptions: (row["answer_options"] as string[] | null) ?? [],
    answerUnit: (row["answer_unit"] as string | null) ?? null,
    assigneeId,
    assigneeName: assigneeId ? (names.get(assigneeId) ?? null) : null,
    dueOn: (row["due_on"] as string | null) ?? null,
    linkedKind: (row["linked_kind"] as "gate" | "criterion" | null) ?? null,
    linkedKey: (row["linked_key"] as string | null) ?? null,
    origin: row["origin"] as "ai" | "user",
    ...resolveTaskSource(row["source_run_id"] as string | null, runKinds),
    status: row["status"] as "open" | "resolved",
    answerText: (row["answer_text"] as string | null) ?? null,
    answerValue: (row["answer_value"] as CaseTaskAnswerValue | null) ?? null,
    answerDocumentId,
    answerFileName: answerDocumentId ? (fileNames.get(answerDocumentId) ?? null) : null,
    resolvedAt,
    resolvedByName: resolvedBy ? (names.get(resolvedBy) ?? null) : null,
    newAnswer:
      row["linked_kind"] === "criterion" &&
      resolvedAt !== null &&
      (screenedAt === null || resolvedAt > screenedAt),
    createdAt: row["created_at"] as string,
  };
}

const editableFields = {
  kind: z.enum(caseTaskKinds),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000).nullable(),
  why: z.string().trim().max(2000).nullable(),
  answerKind: z.enum(caseTaskAnswerKinds),
  answerOptions: z.array(z.string().trim().min(1).max(80)).max(10),
  answerUnit: z.string().trim().max(40).nullable(),
  assigneeId: z.guid().nullable(),
  dueOn: z.string().date().nullable(),
};

/**
 * The gate and criterion keys a task may be linked to: those of the active version of the case's
 * own thesis.
 */
async function assertLinkExists(
  service: ReturnType<typeof getServiceClient>,
  fundId: string,
  caseId: string,
  linkedKind: "gate" | "criterion",
  linkedKey: string,
) {
  const thesis = await caseThesis(service, fundId, caseId);
  if (!thesis) throw new Error(serverText("caseServer.tasks.linkNotInSetup"));
  const { data: config, error } = await service
    .from("fund_config_versions")
    .select("mandate_gates(gate_key), assessment_criteria(criterion_key)")
    .eq("fund_id", fundId)
    .eq("thesis_id", thesis.id)
    .eq("status", "active")
    .maybeSingle();
  if (error) {
    console.error("[case_tasks] link check", error.message);
    throw new Error(serverText("caseServer.tasks.setupNotChecked"));
  }
  const keys =
    linkedKind === "gate"
      ? ((config?.["mandate_gates"] as { gate_key: string }[] | null) ?? []).map((g) => g.gate_key)
      : ((config?.["assessment_criteria"] as { criterion_key: string }[] | null) ?? []).map(
          (c) => c.criterion_key,
        );
  if (!keys.includes(linkedKey)) {
    throw new Error(serverText("caseServer.tasks.linkNotInSetup"));
  }
}

/** IL001 = the assignee is not a member of the fund (case_tasks_check_assignee, 0039). */
function assigneeError(code: string | undefined): never {
  if (code === "IL001") {
    throw new Error(serverText("caseServer.common.ownerNotMember"));
  }
  throw new Error(serverText("caseServer.tasks.notSaved"));
}

export const createCaseTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        fundId: fundIdSchema,
        caseId: z.guid(),
        kind: editableFields.kind.default("task"),
        title: editableFields.title,
        description: editableFields.description.default(null),
        why: editableFields.why.default(null),
        answerKind: editableFields.answerKind.default("text"),
        answerOptions: editableFields.answerOptions.default([]),
        answerUnit: editableFields.answerUnit.default(null),
        assigneeId: editableFields.assigneeId.default(null),
        dueOn: editableFields.dueOn.default(null),
        linkedKind: z.enum(["gate", "criterion"]).nullable().default(null),
        linkedKey: z.string().trim().min(1).max(120).nullable().default(null),
      })
      .refine((value) => (value.linkedKind === null) === (value.linkedKey === null))
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    await requireFundCapability(context.supabase, context.userId, data.fundId, "manage_tasks");
    const service = getServiceClient();
    if (data.linkedKind && data.linkedKey) {
      await assertLinkExists(service, data.fundId, data.caseId, data.linkedKind, data.linkedKey);
    }
    const { data: row, error } = await service
      .from("case_tasks")
      .insert({
        fund_id: data.fundId,
        case_id: data.caseId,
        kind: data.kind,
        title: data.title,
        description: data.description,
        why: data.why,
        answer_kind: data.answerKind,
        answer_options: data.answerOptions,
        answer_unit: data.answerUnit,
        assignee_id: data.assigneeId,
        due_on: data.dueOn,
        linked_kind: data.linkedKind,
        linked_key: data.linkedKey,
        origin: "user",
        created_by: context.userId,
      })
      .select("id")
      .single();
    if (error || !row) {
      // 23503: the case is not in this fund (composite foreign key).
      if (error?.code === "23503")
        throw new Error(serverText("caseServer.common.caseNotFoundInFund"));
      console.error("[createCaseTask]", error?.message);
      assigneeError(error?.code);
    }
    return { id: row["id"] as string };
  });

export const updateCaseTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        fundId: fundIdSchema,
        taskId: z.guid(),
        kind: editableFields.kind.optional(),
        title: editableFields.title.optional(),
        description: editableFields.description.optional(),
        why: editableFields.why.optional(),
        answerKind: editableFields.answerKind.optional(),
        answerOptions: editableFields.answerOptions.optional(),
        answerUnit: editableFields.answerUnit.optional(),
        assigneeId: editableFields.assigneeId.optional(),
        dueOn: editableFields.dueOn.optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await requireFundCapability(context.supabase, context.userId, data.fundId, "manage_tasks");
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (data.kind !== undefined) patch["kind"] = data.kind;
    if (data.title !== undefined) patch["title"] = data.title;
    if (data.description !== undefined) patch["description"] = data.description;
    if (data.why !== undefined) patch["why"] = data.why;
    if (data.answerKind !== undefined) patch["answer_kind"] = data.answerKind;
    if (data.answerOptions !== undefined) patch["answer_options"] = data.answerOptions;
    if (data.answerUnit !== undefined) patch["answer_unit"] = data.answerUnit;
    if (data.assigneeId !== undefined) patch["assignee_id"] = data.assigneeId;
    if (data.dueOn !== undefined) patch["due_on"] = data.dueOn;
    const { data: rows, error } = await getServiceClient()
      .from("case_tasks")
      .update(patch)
      .eq("id", data.taskId)
      .eq("fund_id", data.fundId)
      .is("deleted_at", null)
      .select("id");
    if (error) {
      console.error("[updateCaseTask]", error.message);
      assigneeError(error.code);
    }
    if (!rows?.length) throw new Error(serverText("caseServer.tasks.notFound"));
    return { ok: true };
  });

/**
 * A resolved gate answer that is deleted or restored changes which answers count, so the code
 * score is calculated again (no AI call). The task change itself is already saved; a failed
 * recalculation is logged and reported, not thrown.
 */
async function rescoreAfterTaskChange(
  service: ReturnType<typeof getServiceClient>,
  row: Record<string, unknown>,
  input: { fundId: string; taskId: string; actorId: string },
): Promise<boolean> {
  if (row["linked_kind"] !== "gate" || row["status"] !== "resolved") return true;
  try {
    await recalculateScreeningScore(service, {
      fundId: input.fundId,
      caseId: row["case_id"] as string,
      taskId: input.taskId,
      actorId: input.actorId,
    });
    return true;
  } catch (cause) {
    console.error("[case_tasks] rescore after delete/restore", cause);
    return false;
  }
}

/**
 * The audit event was written before a change that then failed: record that it was never saved,
 * so the log does not show something that did not happen. Never throws (the original error is
 * what the user must see).
 */
async function auditNotSaved(
  service: ReturnType<typeof getServiceClient>,
  input: {
    fundId: string;
    actorId: string;
    action: string;
    taskId: string;
    payload: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await writeAudit(service, {
      fundId: input.fundId,
      actorType: "user",
      actorId: input.actorId,
      action: input.action,
      entity: "case_tasks",
      entityId: input.taskId,
      payload: input.payload,
    });
  } catch (cause) {
    console.error(`[case_tasks] ${input.action} audit`, cause);
  }
}

/** Blød sletning; restoreCaseTask er Fortryd. */
export const deleteCaseTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ fundId: fundIdSchema, taskId: z.guid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true; recalculationFailed: boolean }> => {
    const access = await requireFundCapability(
      context.supabase,
      context.userId,
      data.fundId,
      "manage_tasks",
    );
    const service = getServiceClient();
    const { data: task, error: taskError } = await service
      .from("case_tasks")
      .select("id, case_id, linked_kind, linked_key, status, answer_value, updated_at")
      .eq("id", data.taskId)
      .eq("fund_id", data.fundId)
      .is("deleted_at", null)
      .maybeSingle();
    if (taskError) {
      console.error("[deleteCaseTask] task", taskError.message);
      throw new Error(serverText("caseServer.tasks.notDeleted"));
    }
    if (!task) throw new Error(serverText("caseServer.tasks.notFound"));
    // Et besvaret krav, der er "Ikke opfyldt" eller tilsidesat, bærer en beslutning om et
    // bindende krav. At slette det ændrer, om casen er stoppet, så det kræver samme ret som en
    // tilsidesættelse (Admin/Lead) og skrives i revisionsloggen (harden F1).
    const answer = task["answer_value"] as CaseTaskAnswerValue | null;
    const bindingAnswer = isBindingGateAnswer({
      linkedKind: task["linked_kind"] as string | null,
      status: task["status"] as string,
      answerValue: answer,
    });
    if (bindingAnswer) {
      if (!hasCapability(access.roles, "override_mandate_gate", access.settings)) {
        throw new Error(serverText("caseServer.tasks.bindingDelete"));
      }
      await writeAudit(service, {
        fundId: data.fundId,
        actorType: "user",
        actorId: context.userId,
        action: "gate_answer_deleted",
        entity: "case_tasks",
        entityId: data.taskId,
        payload: {
          caseId: task["case_id"],
          gateKey: task["linked_key"],
          gatePassed: answer?.gatePassed ?? null,
          override: answer?.override === true,
        },
      });
    }
    const now = new Date().toISOString();
    const { data: rows, error } = await service
      .from("case_tasks")
      .update({ deleted_at: now, deleted_by: context.userId, updated_at: now })
      .eq("id", data.taskId)
      .eq("fund_id", data.fundId)
      .is("deleted_at", null)
      // Kun den version af opgaven, rettighedstjekket så (harden G9): er den besvaret i
      // mellemtiden, slettes intet, og brugeren beder om at genindlæse.
      .eq("updated_at", task["updated_at"] as string)
      .select("id, case_id, linked_kind, status");
    if (error || !rows?.length) {
      if (bindingAnswer) {
        await auditNotSaved(service, {
          fundId: data.fundId,
          actorId: context.userId,
          action: "gate_answer_deleted_not_saved",
          taskId: data.taskId,
          payload: { caseId: task["case_id"], gateKey: task["linked_key"] },
        });
      }
      if (error) {
        console.error("[deleteCaseTask]", error.message);
        throw new Error(serverText("caseServer.tasks.notDeleted"));
      }
      throw new Error(serverText("caseServer.tasks.changedMeanwhile"));
    }
    const rescored = await rescoreAfterTaskChange(service, rows[0]!, {
      fundId: data.fundId,
      taskId: data.taskId,
      actorId: context.userId,
    });
    return { ok: true, recalculationFailed: !rescored };
  });

export const restoreCaseTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ fundId: fundIdSchema, taskId: z.guid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true; recalculationFailed: boolean }> => {
    const access = await requireFundCapability(
      context.supabase,
      context.userId,
      data.fundId,
      "manage_tasks",
    );
    const service = getServiceClient();
    const { data: task, error: taskError } = await service
      .from("case_tasks")
      .select("id, case_id, linked_kind, linked_key, status, answer_value")
      .eq("id", data.taskId)
      .eq("fund_id", data.fundId)
      .not("deleted_at", "is", null)
      .maybeSingle();
    if (taskError) {
      console.error("[restoreCaseTask] task", taskError.message);
      throw new Error(serverText("caseServer.tasks.notRestored"));
    }
    if (!task) throw new Error(serverText("caseServer.tasks.notFound"));
    // Et slettet svar, der tilsidesatte et krav, gendannes kun med samme ret som selve
    // tilsidesættelsen, og det skrives i revisionsloggen.
    // Et slettet svar, der afgør et bindende krav ("Ikke opfyldt" eller en tilsidesættelse),
    // gendannes kun med samme ret som tilsidesættelsen, og det skrives i revisionsloggen
    // (harden F1 og G8).
    const restoredAnswer = task["answer_value"] as CaseTaskAnswerValue | null;
    const bindingRestore = isBindingGateAnswer({
      linkedKind: task["linked_kind"] as string | null,
      status: task["status"] as string,
      answerValue: restoredAnswer,
    });
    if (bindingRestore) {
      if (!hasCapability(access.roles, "override_mandate_gate", access.settings)) {
        throw new Error(serverText("caseServer.tasks.bindingRestore"));
      }
      await writeAudit(service, {
        fundId: data.fundId,
        actorType: "user",
        actorId: context.userId,
        action:
          restoredAnswer?.override === true
            ? "mandate_gate_override_restored"
            : "gate_answer_restored",
        entity: "case_tasks",
        entityId: data.taskId,
        payload: {
          caseId: task["case_id"],
          gateKey: task["linked_key"],
          gatePassed: restoredAnswer?.gatePassed ?? null,
        },
      });
    }
    const { data: rows, error } = await service
      .from("case_tasks")
      .update({ deleted_at: null, deleted_by: null, updated_at: new Date().toISOString() })
      .eq("id", data.taskId)
      .eq("fund_id", data.fundId)
      .not("deleted_at", "is", null)
      .select("id, case_id, linked_kind, status");
    if (error || !rows?.length) {
      if (bindingRestore) {
        await auditNotSaved(service, {
          fundId: data.fundId,
          actorId: context.userId,
          action: "gate_answer_restored_not_saved",
          taskId: data.taskId,
          payload: { caseId: task["case_id"], gateKey: task["linked_key"] },
        });
      }
      if (error) {
        console.error("[restoreCaseTask]", error.message);
        throw new Error(serverText("caseServer.tasks.notRestored"));
      }
      throw new Error(serverText("caseServer.tasks.notFound"));
    }
    const rescored = await rescoreAfterTaskChange(service, rows[0]!, {
      fundId: data.fundId,
      taskId: data.taskId,
      actorId: context.userId,
    });
    return { ok: true, recalculationFailed: !rescored };
  });

/**
 * The team's earlier answer, replaced by a revision: its evidence row goes when no analysis run
 * was based on it (a replaced answer must not count twice in a new screening); a row a run
 * used stays as that run's history. Never throws: the new answer is already saved.
 */
async function dropReplacedAnswerEvidence(
  service: ReturnType<typeof getServiceClient>,
  input: { fundId: string; caseId: string; evidenceId: string | null },
): Promise<void> {
  if (!input.evidenceId) return;
  const { data: runs, error: runError } = await service
    .from("analysis_runs")
    .select("id")
    .eq("fund_id", input.fundId)
    .eq("case_id", input.caseId)
    .contains("input_evidence_ids", [input.evidenceId])
    .limit(1);
  if (runError) {
    console.error("[answerCaseTask] replaced evidence lookup", runError.message);
    return;
  }
  if (runs?.length) return;
  const { error } = await service
    .from("evidence_items")
    .delete()
    .eq("id", input.evidenceId)
    .eq("fund_id", input.fundId)
    .eq("stated_by", "Teamets svar");
  if (error) console.error("[answerCaseTask] replaced evidence", error.message);
}

/**
 * Svar på en task: svaret gemmes som evidens ("Teamets svar",
 * verificeret) og knyttes via tasken til gaten eller kriteriet. Et gate-svar (Opfyldt / Ikke
 * opfyldt) regner scoren igen i kode; et kriterie-svar markeres "nyt svar" og tilbyder
 * genscreening. Ingen "+N point": UI'et viser blot den nye score.
 */
export const answerCaseTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        fundId: fundIdSchema,
        taskId: z.guid(),
        text: z.string().trim().max(4000).default(""),
        number: z.number().finite().nullable().default(null),
        option: z.string().trim().max(80).nullable().default(null),
        documentId: z.guid().nullable().default(null),
        /** Only for tasks linked to a gate: the team's own answer to the requirement. */
        gatePassed: z.boolean().nullable().default(null),
        /**
         * The user chose to override a requirement that is assessed as not met (Admin/Lead, with
         * a written reason). Without it, "Opfyldt" on such a requirement is refused, so an
         * answer from a page that showed an older assessment never becomes an override silently.
         */
        override: z.boolean().default(false),
        /**
         * "Redigér" on a resolved task ("Alt kan redigeres efter gem"): the new answer
         * replaces the old one. A binding gate answer needs the same right as deleting it.
         */
        revise: z.boolean().default(false),
      })
      .parse(input),
  )
  .handler(
    async ({
      data,
      context,
    }): Promise<{
      taskId: string;
      recalculation: Recalculation | null;
      /** The answer is saved, but the new score could not be calculated (logged). */
      recalculationFailed: boolean;
      offerRescreen: boolean;
    }> => {
      const access = await requireFundCapability(
        context.supabase,
        context.userId,
        data.fundId,
        "manage_tasks",
      );
      const service = getServiceClient();
      const { data: task, error: taskError } = await service
        .from("case_tasks")
        .select(
          "id, case_id, title, status, linked_kind, linked_key, answer_options, answer_value, answer_evidence_id, updated_at",
        )
        .eq("id", data.taskId)
        .eq("fund_id", data.fundId)
        .is("deleted_at", null)
        .maybeSingle();
      if (taskError) {
        console.error("[answerCaseTask] task", taskError.message);
        throw new Error(serverText("caseServer.tasks.notFetched"));
      }
      if (!task) throw new Error(serverText("caseServer.tasks.notFound"));
      if (!data.revise && task["status"] === "resolved") {
        throw new Error(serverText("caseServer.tasks.alreadyAnswered"));
      }
      if (data.revise && task["status"] !== "resolved") {
        throw new Error(serverText("caseServer.tasks.notAnsweredYet"));
      }
      // Rewriting a "Ikke opfyldt" or an override changes whether the case is stopped: the same
      // right as deleting it (Admin/Lead), and it is audited (harden F1).
      const previousAnswer = task["answer_value"] as CaseTaskAnswerValue | null;
      const revisesBindingAnswer =
        data.revise &&
        isBindingGateAnswer({
          linkedKind: task["linked_kind"] as string | null,
          status: task["status"] as string,
          answerValue: previousAnswer,
        });
      if (
        revisesBindingAnswer &&
        !hasCapability(access.roles, "override_mandate_gate", access.settings)
      ) {
        throw new Error(serverText("caseServer.tasks.bindingEdit"));
      }
      const caseId = task["case_id"] as string;
      const options = (task["answer_options"] as string[] | null) ?? [];
      if (data.option !== null && options.length && !options.includes(data.option)) {
        throw new Error(serverText("caseServer.tasks.notAnOption"));
      }
      if (data.gatePassed !== null && task["linked_kind"] !== "gate") {
        throw new Error(serverText("caseServer.tasks.gateOnly"));
      }
      // Et svar må afklare et ukendt krav, men at gøre et ikke-opfyldt krav opfyldt er at
      // tilsidesætte det; det må kun Admin og Lead (override_mandate_gate), med en skriftlig
      // begrundelse, og det skrives i revisionsloggen.
      let override = false;
      // Vurderingen og den version, svaret bindes til, kommer fra samme opslag (harden G27).
      const gate =
        task["linked_kind"] === "gate" && data.gatePassed !== null
          ? await currentGateVerdict(service, {
              fundId: data.fundId,
              caseId,
              gateKey: task["linked_key"] as string,
            })
          : null;
      // Rewording an override is still an override: without this, the current verdict (the
      // override itself) would say "met", and the revision would silently drop the override.
      const keepsOverride = data.revise && previousAnswer?.override === true;
      if (data.gatePassed === true && gate) {
        if (gate.verdict === false || keepsOverride) {
          if (!hasCapability(access.roles, "override_mandate_gate", access.settings)) {
            throw new Error(serverText("caseServer.tasks.notMetLeadOnly"));
          }
          if (!data.override) {
            throw new Error(serverText("caseServer.tasks.nowNotMet"));
          }
          if (Array.from(data.text).length < OVERRIDE_REASON_MIN) {
            throw new Error(serverText("caseServer.tasks.overrideReason"));
          }
          override = true;
        }
      }
      const gateConfigVersion = gate?.configVersionId ?? null;
      const valueText =
        [
          data.option,
          data.number !== null ? String(data.number) : null,
          data.gatePassed === null
            ? null
            : data.gatePassed
              ? serverText("caseServer.tasks.met")
              : serverText("caseServer.tasks.notMet"),
          data.text || null,
        ]
          .filter(Boolean)
          .join(", ") || null;
      if (!valueText && !data.documentId)
        throw new Error(serverText("caseServer.tasks.answerOrFile"));

      if (data.documentId) {
        const { data: document, error: documentError } = await service
          .from("documents")
          .select("id")
          .eq("id", data.documentId)
          .eq("fund_id", data.fundId)
          .eq("case_id", caseId)
          .maybeSingle();
        if (documentError) {
          console.error("[answerCaseTask] document", documentError.message);
          throw new Error(serverText("caseServer.tasks.fileNotChecked"));
        }
        if (!document) throw new Error(serverText("caseServer.tasks.fileNotOnCase"));
      }

      if (override) {
        // Revisionen skrives før svaret: fejler den, er intet tilsidesat.
        await writeAudit(service, {
          fundId: data.fundId,
          actorType: "user",
          actorId: context.userId,
          action: "mandate_gate_override",
          entity: "case_tasks",
          entityId: data.taskId,
          payload: { caseId, gateKey: task["linked_key"], reason: data.text },
        });
      }
      if (revisesBindingAnswer) {
        await writeAudit(service, {
          fundId: data.fundId,
          actorType: "user",
          actorId: context.userId,
          action: "gate_answer_revised",
          entity: "case_tasks",
          entityId: data.taskId,
          payload: {
            caseId,
            gateKey: task["linked_key"],
            from: {
              gatePassed: previousAnswer?.gatePassed ?? null,
              override: previousAnswer?.override === true,
            },
            to: { gatePassed: data.gatePassed, override },
          },
        });
      }

      const now = new Date().toISOString();
      const { data: evidence, error: evidenceError } = await service
        .from("evidence_items")
        .insert({
          fund_id: data.fundId,
          case_id: caseId,
          document_id: data.documentId,
          claim: task["title"] as string,
          value_text: valueText,
          stated_by: "Teamets svar",
          status: "verified",
          confidence: 1,
          observation_date: now.slice(0, 10),
          created_by: context.userId,
        })
        .select("id")
        .single();
      if (evidenceError || !evidence) {
        console.error("[answerCaseTask] evidence", evidenceError?.message);
        if (override) {
          await auditNotSaved(service, {
            fundId: data.fundId,
            actorId: context.userId,
            action: "mandate_gate_override_not_saved",
            taskId: data.taskId,
            payload: { caseId, gateKey: task["linked_key"] },
          });
        }
        if (revisesBindingAnswer) {
          await auditNotSaved(service, {
            fundId: data.fundId,
            actorId: context.userId,
            action: "gate_answer_revised_not_saved",
            taskId: data.taskId,
            payload: { caseId, gateKey: task["linked_key"] },
          });
        }
        throw new Error(serverText("caseServer.tasks.answerNotEvidence"));
      }

      const taskUpdate = service
        .from("case_tasks")
        .update({
          status: "resolved",
          answer_text: data.text || null,
          answer_value: {
            ...(data.number !== null ? { number: data.number } : {}),
            ...(data.option !== null ? { option: data.option } : {}),
            ...(data.gatePassed !== null ? { gatePassed: data.gatePassed } : {}),
            ...(override ? { override: true } : {}),
            ...(gateConfigVersion ? { configVersionId: gateConfigVersion } : {}),
          },
          answer_document_id: data.documentId,
          answer_evidence_id: evidence["id"],
          resolved_by: context.userId,
          resolved_at: now,
          updated_at: now,
        })
        .eq("id", data.taskId)
        .eq("fund_id", data.fundId)
        // A task Interlect retired in the meantime (a newer run no longer raises it) takes no
        // answer: the answer must never land on a task that is off the list.
        .is("deleted_at", null);
      // A revision replaces only the answer that was read above (not one saved in between).
      const { data: updated, error: updateError } = await (
        data.revise
          ? taskUpdate.eq("status", "resolved").eq("updated_at", task["updated_at"] as string)
          : taskUpdate.eq("status", "open")
      ).select("id");
      if (updateError || !updated?.length) {
        // The evidence row belongs to an answer that was never saved: remove it again, so it
        // does not count in the trust figures.
        const { error: cleanupError } = await service
          .from("evidence_items")
          .delete()
          .eq("id", evidence["id"] as string)
          .eq("fund_id", data.fundId);
        if (cleanupError) {
          console.error("[answerCaseTask] orphan evidence", cleanupError.message);
        }
        if (override) {
          // The audit log already holds the override; record that it was never saved.
          await auditNotSaved(service, {
            fundId: data.fundId,
            actorId: context.userId,
            action: "mandate_gate_override_not_saved",
            taskId: data.taskId,
            payload: { caseId, gateKey: task["linked_key"] },
          });
        }
        if (revisesBindingAnswer) {
          await auditNotSaved(service, {
            fundId: data.fundId,
            actorId: context.userId,
            action: "gate_answer_revised_not_saved",
            taskId: data.taskId,
            payload: { caseId, gateKey: task["linked_key"] },
          });
        }
        if (updateError) {
          console.error("[answerCaseTask] task", updateError.message);
          throw new Error(serverText("caseServer.tasks.answerNotSaved"));
        }
        // Say what happened: a task taken off the list in the meantime is not "answered by
        // someone else". The evidence row above is already removed.
        const { data: current } = await service
          .from("case_tasks")
          .select("deleted_at")
          .eq("id", data.taskId)
          .eq("fund_id", data.fundId)
          .maybeSingle();
        if (current?.["deleted_at"]) {
          throw new Error(serverText("caseServer.tasks.taskRetired"));
        }
        throw new Error(
          data.revise
            ? serverText("caseServer.tasks.answerChanged")
            : serverText("caseServer.tasks.answeredByOther"),
        );
      }
      if (data.revise) {
        await dropReplacedAnswerEvidence(service, {
          fundId: data.fundId,
          caseId,
          evidenceId: (task["answer_evidence_id"] as string | null) ?? null,
        });
      }

      // Filen vises under "Fra task" i Filer, og svaret står som systemlinje i Beskeder (0035).
      // Begge dele er følger af svaret; fejler de, er svaret stadig gemt.
      if (data.documentId) {
        const { error: linkError } = await service
          .from("documents")
          .update({ task_id: data.taskId })
          .eq("id", data.documentId)
          .eq("fund_id", data.fundId);
        if (linkError) console.error("[answerCaseTask] document link", linkError.message);
      }
      const { error: messageError } = await service.from("case_messages").insert({
        fund_id: data.fundId,
        case_id: caseId,
        author_id: context.userId,
        kind: "system",
        body: serverText(
          data.revise ? "caseServer.tasks.answerRevisedMessage" : "caseServer.tasks.answerMessage",
          {
            title: task["title"] as string,
            value: valueText ?? serverText("caseServer.tasks.fileAttached"),
          },
        ).slice(0, 5000),
      });
      if (messageError) console.error("[answerCaseTask] message", messageError.message);

      // Svaret er gemt; fejler genberegningen, siges det til brugeren i stedet for at kaste,
      // for tasken kan ikke besvares igen.
      let recalculation: Recalculation | null = null;
      let recalculationFailed = false;
      const gateAnswerChanged =
        data.gatePassed !== null || typeof previousAnswer?.gatePassed === "boolean";
      if (task["linked_kind"] === "gate" && gateAnswerChanged) {
        try {
          recalculation = await recalculateScreeningScore(service, {
            fundId: data.fundId,
            caseId,
            taskId: data.taskId,
            actorId: context.userId,
          });
        } catch (cause) {
          console.error("[answerCaseTask] rescore", cause);
          recalculationFailed = true;
        }
      }
      return {
        taskId: data.taskId,
        recalculation,
        recalculationFailed,
        offerRescreen: task["linked_kind"] === "criterion",
      };
    },
  );
