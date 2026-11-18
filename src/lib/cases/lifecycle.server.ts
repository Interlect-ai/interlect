import type { SupabaseClient } from "@supabase/supabase-js";
import type { Access } from "@/lib/auth/access.server";
import { hasCapability } from "@/lib/domain/workflow";
import { enqueueBrainCapture } from "@/lib/brain/queue.server";
import { getServiceClient } from "@/lib/supabase/admin.server";
import {
  actionMovementKind,
  appRefusal,
  reasonRequired,
  requiredCapability,
  transitionTarget,
  type CasePhase,
  type CaseStatus,
  type CaseTransitionAction,
} from "./lifecycle";
import { serverText } from "@/lib/i18n/server-text";

/**
 * The only way the server changes a case's phase or status: public.transition_case (0033).
 * It locks the case, re-checks the actor's role in the database, writes the log row and keeps
 * the old workspace_status/process_stage columns in step. Service role only.
 */
export interface TransitionRequest {
  fundId: string;
  caseId: string;
  /** null for automatic moves (actorType "system"). */
  actorId: string | null;
  toPhase: CasePhase | null;
  toStatus: CaseStatus | null;
  reasonCodes?: string[];
  note?: string | null;
  batchId?: string | null;
  actorType?: "user" | "system" | "pap";
  /** Only move when the case is still in this phase (automatic reverts, stale pages). */
  expectedPhase?: CasePhase | null;
  /** Only move when the case still has this status (stale pages). */
  expectedStatus?: CaseStatus | null;
  analysisRunId?: string | null;
  /** Force "system" (undo, automatic moves); anything else is derived in the database. */
  systemMovement?: boolean;
}

export interface TransitionOutcome {
  eventId: string | null;
  changed: boolean;
  fromPhase: CasePhase;
  fromStatus: CaseStatus;
  toPhase: CasePhase;
  toStatus: CaseStatus;
  movementKind: string | null;
}

export class TransitionRefused extends Error {}

export async function transitionCase(
  service: SupabaseClient,
  request: TransitionRequest,
): Promise<TransitionOutcome> {
  const { data, error } = await service.rpc("transition_case", {
    _fund_id: request.fundId,
    _case_id: request.caseId,
    _actor_id: request.actorId,
    _to_phase: request.toPhase,
    _to_status: request.toStatus,
    _reason_codes: request.reasonCodes ?? [],
    _note: request.note ?? null,
    _batch_id: request.batchId ?? null,
    _actor_type: request.actorType ?? "user",
    _expected_phase: request.expectedPhase ?? null,
    _analysis_run_id: request.analysisRunId ?? null,
    _movement_kind: request.systemMovement ? "system" : null,
    _undo_of: null,
    _expected_status: request.expectedStatus ?? null,
  });
  if (error) {
    // P0001 = a deliberate `raise exception` with a Danish message meant for the user.
    if (error.code === "P0001") throw new TransitionRefused(error.message);
    console.error("[transition_case]", error.message);
    throw new Error(serverText("caseServer.lifecycle.notMoved"));
  }
  const row = (Array.isArray(data) ? data[0] : data) as {
    event_id: string | null;
    changed: boolean;
    from_phase: CasePhase;
    from_status: CaseStatus;
    to_phase: CasePhase;
    to_status: CaseStatus;
    movement_kind: string | null;
  } | null;
  if (!row) {
    console.error(`[transition_case] case ${request.caseId}: no result row`);
    throw new Error(serverText("caseServer.lifecycle.notMoved"));
  }
  return {
    eventId: row.event_id,
    changed: row.changed,
    fromPhase: row.from_phase,
    fromStatus: row.from_status,
    toPhase: row.to_phase,
    toStatus: row.to_status,
    movementKind: row.movement_kind,
  };
}

export interface CaseTransitionResult {
  caseId: string;
  ok: boolean;
  changed: boolean;
  phase: CasePhase | null;
  status: CaseStatus | null;
  /** Danish message when the case was not moved. */
  error: string | null;
}

export interface CaseTransitionsInput {
  /** The user's own client (RLS decides which cases they can see). */
  supabase: SupabaseClient;
  userId: string;
  /** From requireFundCapability for this fund; decisions are re-checked per case. */
  access: Access;
  fundId: string;
  caseIds: string[];
  action: CaseTransitionAction;
  reasonCodes: string[];
  note: string;
  analysisRunId?: string | null;
  /** Per-case analysis run (a committee move records the deep analysis it was based on). */
  analysisRunIds?: Record<string, string>;
  /**
   * The phase and status the user saw, per case. A case that has moved since then is not moved
   * again (a stale page cannot overwrite a newer decision). Without it, the state read here is
   * used, which still closes the gap between reading and writing.
   */
  expected?: Record<string, { phase: CasePhase; status: CaseStatus }>;
}

/** "Someone else changed the case", in the requesting page's language. */
export const staleCaseMessage = () => serverText("caseServer.lifecycle.changedElsewhere");

/**
 * Moves one or more cases in one fund. Every case gets its own result; the ones that moved
 * share one undo token (the batch id).
 */
export async function runCaseTransitions(
  input: CaseTransitionsInput,
): Promise<{ results: CaseTransitionResult[]; undoToken: string | null }> {
  const caseIds = [...new Set(input.caseIds)];

  // Kun cases i den valgte fond; brugerens egen klient, så RLS også afgør det.
  const { data: rows, error } = await input.supabase
    .from("cases")
    .select("id, phase, status")
    .eq("fund_id", input.fundId)
    .in("id", caseIds);
  if (error) {
    console.error("[transitionCases] cases", error.message);
    throw new Error(serverText("caseServer.lifecycle.casesNotLoaded"));
  }
  const current = new Map(
    (rows ?? []).map((row) => [
      row["id"] as string,
      { phase: row["phase"] as CasePhase, status: row["status"] as CaseStatus },
    ]),
  );

  const service = getServiceClient();
  const { data: codeRows, error: codeError } = await service
    .from("brain_reason_codes")
    .select("code, applies_to")
    .eq("fund_id", input.fundId)
    .eq("is_active", true);
  if (codeError) {
    console.error("[transitionCases] reason codes", codeError.message);
    throw new Error(serverText("caseServer.lifecycle.reasonsNotLoaded"));
  }
  const appliesTo = new Map(
    (codeRows ?? []).map((row) => [row["code"] as string, row["applies_to"] as string[]]),
  );

  const target = transitionTarget(input.action);
  const batchId = crypto.randomUUID();
  const results: CaseTransitionResult[] = [];
  let anyChanged = false;

  for (const caseId of caseIds) {
    const state = current.get(caseId);
    if (!state) {
      results.push(refused(caseId, serverText("caseServer.common.caseNotFoundInThesis")));
      continue;
    }
    const seen = input.expected?.[caseId];
    if (seen && (seen.phase !== state.phase || seen.status !== state.status)) {
      results.push(refused(caseId, staleCaseMessage()));
      continue;
    }
    // A decided case is reopened, never "held": hold would silently undo the decision.
    const refusal = appRefusal(input.action, state.phase);
    if (refusal) {
      results.push(refused(caseId, refusal));
      continue;
    }
    const capability = requiredCapability(input.action, state.phase);
    if (!hasCapability(input.access.roles, capability, input.access.settings)) {
      results.push(
        refused(
          caseId,
          capability === "decide_case"
            ? serverText("caseServer.lifecycle.roleCannotDecide")
            : serverText("caseServer.lifecycle.roleCannotMove"),
        ),
      );
      continue;
    }
    const kind = actionMovementKind(input.action, state.phase, state.status);
    if (kind && reasonRequired(kind) && input.reasonCodes.length === 0) {
      results.push(refused(caseId, serverText("caseServer.lifecycle.chooseReason")));
      continue;
    }
    const unsuitable = input.reasonCodes.find(
      (code) => !kind || !(appliesTo.get(code) ?? []).includes(kind),
    );
    if (kind && unsuitable) {
      results.push(refused(caseId, serverText("caseServer.lifecycle.reasonMismatch")));
      continue;
    }
    try {
      const outcome = await transitionCase(service, {
        fundId: input.fundId,
        caseId,
        actorId: input.userId,
        toPhase: target.phase,
        toStatus: target.status,
        reasonCodes: input.reasonCodes,
        note: input.note || null,
        batchId,
        analysisRunId: input.analysisRunIds?.[caseId] ?? input.analysisRunId ?? null,
        expectedPhase: state.phase,
        expectedStatus: state.status,
      });
      if (!outcome.changed && outcome.eventId === null && movedSince(outcome, state)) {
        results.push(refused(caseId, staleCaseMessage()));
        continue;
      }
      anyChanged ||= outcome.changed;
      results.push({
        caseId,
        ok: true,
        changed: outcome.changed,
        phase: outcome.toPhase,
        status: outcome.toStatus,
        error: null,
      });
    } catch (cause) {
      // Continue with the other cases, so the ones already moved keep their undo token. An
      // unexpected failure is logged; a refusal is the user's answer (harden SF11).
      if (!(cause instanceof TransitionRefused)) {
        console.error(
          `[transition] case ${caseId} (fund ${input.fundId}) not moved`,
          cause instanceof Error ? cause.message : String(cause),
        );
      }
      results.push(
        refused(
          caseId,
          cause instanceof TransitionRefused
            ? cause.message
            : serverText("caseServer.lifecycle.notMoved"),
        ),
      );
    }
  }
  // Brain: a registered movement is new case knowledge. Never blocks the move.
  await Promise.all(
    results
      .filter((result) => result.changed)
      .map((result) => enqueueBrainCapture(input.fundId, result.caseId)),
  );
  return { results, undoToken: anyChanged ? batchId : null };
}

/** transition_case returned without moving because the case is no longer where it was read. */
function movedSince(
  outcome: TransitionOutcome,
  state: { phase: CasePhase; status: CaseStatus },
): boolean {
  return outcome.fromPhase !== state.phase || outcome.fromStatus !== state.status;
}

function refused(caseId: string, error: string): CaseTransitionResult {
  return { caseId, ok: false, changed: false, phase: null, status: null, error };
}

/**
 * A failed deep analysis is not a completed one: the case returns to Screening, where it can be
 * started again, but only when this run moved it out of Screening (a case that was already in Dyb
 * analyse or Komité stays where it was, harden) and only while it is still in Dyb
 * analyse (nobody moved it in the meantime). Never throws: the run's own failure is what the
 * user must see.
 */
export async function returnFailedDeepCaseToScreening(
  service: SupabaseClient,
  fundId: string,
  caseId: string,
  runId: string,
): Promise<void> {
  try {
    const { data: moved, error: movedError } = await service
      .from("case_transition_events")
      .select("id")
      .eq("fund_id", fundId)
      .eq("case_id", caseId)
      .eq("analysis_run_id", runId)
      .eq("from_phase", "screening")
      .eq("to_phase", "deep_analysis")
      .limit(1)
      .maybeSingle();
    if (movedError) {
      console.error(`[deep-failure] case ${caseId}: move lookup`, movedError.message);
      return;
    }
    if (!moved) return;
    await transitionCase(service, {
      fundId,
      caseId,
      actorId: null,
      actorType: "system",
      toPhase: "screening",
      toStatus: null,
      expectedPhase: "deep_analysis",
      systemMovement: true,
      note: serverText("caseServer.lifecycle.deepFailed"),
      analysisRunId: runId,
    });
  } catch (cause) {
    console.error(
      `[deep-failure] case ${caseId} was not returned to Screening`,
      cause instanceof Error ? cause.message : cause,
    );
  }
}
