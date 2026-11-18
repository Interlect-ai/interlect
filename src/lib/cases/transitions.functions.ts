import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/lib/supabase/auth-middleware";
import { forbidden, requireFundCapability } from "@/lib/auth/access.server";
import { getServiceClient } from "@/lib/supabase/admin.server";
import { caseTransitionActions, type CasePhase, type CaseStatus } from "./lifecycle";
import { runCaseTransitions, type CaseTransitionResult } from "./lifecycle.server";
import { enqueueBrainCapture } from "@/lib/brain/queue.server";
import { scheduleMemoryReconcile } from "./decision-memory.server";
import { MAX_REASONS } from "./reason-options";
import { reasonLabel } from "./reason-label";
import { requestLanguage, serverText } from "@/lib/i18n/server-text";
import { withDemoView } from "@/lib/display/display-names.server";

export type { CaseTransitionResult };

/**
 * Én server-funktion til alle fase- og statusskift fra split-knappen, bulk-bjælken og
 * bekræftelsesdialogerne (01-datamodel §0033). Rollen tjekkes her pr. case og igen i databasen;
 * hver case får sit eget resultat, og hele kaldet får én fortryd-nøgle (5 s).
 */

const fundIdSchema = z.guid();
const reasonCodeSchema = z.string().regex(/^[a-z][a-z0-9_]{1,59}$/);

export const transitionCases = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        fundId: fundIdSchema,
        caseIds: z.array(z.guid()).min(1).max(100),
        action: z.enum(caseTransitionActions),
        reasonCodes: z.array(reasonCodeSchema).max(MAX_REASONS).default([]),
        note: z.string().trim().max(2000).default(""),
        /** The phase and status the page showed; a case that moved since is not moved again. */
        expected: z
          .array(
            z.object({
              caseId: z.guid(),
              phase: z.enum(["screening", "deep_analysis", "committee", "decided"]),
              status: z.enum(["active", "on_hold", "closed", "invested"]),
            }),
          )
          .max(100)
          .optional(),
      })
      .parse(input),
  )
  .handler(
    async ({
      data,
      context,
    }): Promise<{ results: CaseTransitionResult[]; undoToken: string | null }> => {
      // Alle, der må flytte en case, har mindst move_process_stage; beslutninger tjekkes pr. case.
      const access = await requireFundCapability(
        context.supabase,
        context.userId,
        data.fundId,
        "move_process_stage",
      );
      // A committee move records the deep analysis it was based on (audit, as).
      const analysisRunIds =
        data.action === "send_to_committee"
          ? await latestDeepRuns(context.supabase, data.fundId, data.caseIds)
          : undefined;
      const outcome = await runCaseTransitions({
        supabase: context.supabase,
        userId: context.userId,
        access,
        fundId: data.fundId,
        caseIds: data.caseIds,
        action: data.action,
        reasonCodes: data.reasonCodes,
        note: data.note,
        ...(analysisRunIds ? { analysisRunIds } : {}),
        ...(data.expected
          ? {
              expected: Object.fromEntries(
                data.expected.map(({ caseId, phase, status }) => [caseId, { phase, status }]),
              ),
            }
          : {}),
      });
      // The fund's memory follows the cases' decisions (written or removed after the Fortryd
      // window, from each case's state then).
      await scheduleMemoryReconcile(
        data.fundId,
        outcome.results.filter((result) => result.ok && result.changed).map((r) => r.caseId),
      );
      return outcome;
    },
  );

/** The newest finished deep analysis per case (null-safe: a missing one is simply left out). */
async function latestDeepRuns(
  supabase: SupabaseClient,
  fundId: string,
  caseIds: string[],
): Promise<Record<string, string> | undefined> {
  const { data: rows, error } = await supabase
    .from("analysis_runs")
    .select("id, case_id")
    .eq("fund_id", fundId)
    .eq("kind", "deep")
    .eq("status", "complete")
    .not("completed_at", "is", null)
    .in("case_id", caseIds)
    .order("completed_at", { ascending: false });
  if (error) {
    console.error(`[transitionCases] deep runs (fund ${fundId})`, error.message);
    return undefined;
  }
  const byCase: Record<string, string> = {};
  for (const row of rows ?? []) {
    const caseId = row["case_id"] as string;
    byCase[caseId] ??= row["id"] as string;
  }
  return byCase;
}

/**
 * Fortryd: skriver den omvendte overgang (append-only, "system", note "Fortrudt") for de cases i
 * batchen, der stadig står, hvor overgangen efterlod dem. Kun samme bruger, inden for 5 s + 2 s.
 */
export const undoCaseTransitions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ fundId: fundIdSchema, undoToken: z.guid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<{ undone: string[]; notUndone: string[] }> => {
    await requireFundCapability(
      context.supabase,
      context.userId,
      data.fundId,
      "move_process_stage",
    );
    const { data: rows, error } = await getServiceClient().rpc("undo_case_transitions", {
      _fund_id: data.fundId,
      _actor_id: context.userId,
      _batch_id: data.undoToken,
    });
    if (error) {
      if (error.code === "P0001") throw new Error(error.message);
      console.error("[undo_case_transitions]", error.message);
      throw new Error(serverText("caseServer.transitions.undoFailed"));
    }
    const outcome = (rows ?? []) as { case_id: string; undone: boolean }[];
    if (outcome.length === 0) forbidden(serverText("caseServer.transitions.tooLate"));
    const undone = outcome.filter((row) => row.undone).map((row) => row.case_id);
    // The undone cases' memory follows their state after the undo (harden B/N1).
    await scheduleMemoryReconcile(data.fundId, undone);
    await Promise.all(undone.map((caseId) => enqueueBrainCapture(data.fundId, caseId)));
    return {
      undone,
      notUndone: outcome.filter((row) => !row.undone).map((row) => row.case_id),
    };
  });

export interface ReasonCode {
  code: string;
  label: string;
  group: string;
  appliesTo: string[];
  revisit: boolean;
}

/** Årsagerne til dialogerne (Luk, Sæt på hold, Marker som investeret, Afvis i komité). */
export const listReasonCodes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ fundId: fundIdSchema }).parse(input))
  .handler(async ({ data, context }): Promise<ReasonCode[]> => {
    await requireFundCapability(context.supabase, context.userId, data.fundId, "view_case");
    const { data: rows, error } = await context.supabase
      .from("brain_reason_codes")
      .select("code, label, group_key, applies_to, revisit")
      .eq("fund_id", data.fundId)
      .eq("is_active", true)
      .order("sort_order");
    if (error) {
      console.error("[listReasonCodes]", error.message);
      throw new Error(serverText("caseServer.common.reasonsNotLoaded"));
    }
    const language = requestLanguage();
    return (rows ?? []).map((row) => ({
      code: row["code"] as string,
      label: reasonLabel(row["code"] as string, row["label"] as string, language),
      group: row["group_key"] as string,
      appliesTo: row["applies_to"] as string[],
      revisit: row["revisit"] as boolean,
    }));
  });

export interface CaseStatusLine {
  /** The latest move of the case's phase or status; null for a case that never moved. */
  last: {
    /** "status" when the move changed the status, else "phase" (one log row per move). */
    field: "phase" | "status";
    fromStatus: CaseStatus | null;
    fromPhase: CasePhase | null;
    toPhase: CasePhase | null;
    toStatus: CaseStatus | null;
    occurredAt: string;
    actorName: string | null;
    actorType: string;
    reasons: string[];
    note: string | null;
    /** The move was an undo ("Fortryd") of the one before. */
    undone: boolean;
  } | null;
  createdAt: string;
  createdByName: string | null;
}

/**
 * The history line in the case's status menu (CaseStatus "Oprettet 18. sep af Maja Holm", "Sat på
 * hold i dag af Maja Holm: Venter på data"). Read with the user's own client (RLS).
 */
export const getCaseStatusLine = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ fundId: fundIdSchema, caseId: z.guid() }).parse(input))
  .handler(
    withDemoView(async ({ data, context }): Promise<CaseStatusLine> => {
      await requireFundCapability(context.supabase, context.userId, data.fundId, "view_case");
      const [caseResult, eventResult, codeResult] = await Promise.all([
        context.supabase
          .from("cases")
          .select("created_at, created_by")
          .eq("fund_id", data.fundId)
          .eq("id", data.caseId)
          .maybeSingle(),
        context.supabase
          .from("case_transition_events")
          .select(
            "field, from_phase, from_status, to_phase, to_status, occurred_at, actor_id, actor_type, reason_codes, note, undo_of",
          )
          .eq("fund_id", data.fundId)
          .eq("case_id", data.caseId)
          .in("field", ["phase", "status"])
          .order("occurred_at", { ascending: false })
          .limit(1),
        context.supabase
          .from("brain_reason_codes")
          .select("code, label")
          .eq("fund_id", data.fundId),
      ]);
      if (caseResult.error || !caseResult.data) {
        if (caseResult.error) console.error("[getCaseStatusLine] case", caseResult.error.message);
        throw new Error(serverText("caseServer.common.historyNotLoaded"));
      }
      if (eventResult.error) {
        console.error("[getCaseStatusLine] events", eventResult.error.message);
        throw new Error(serverText("caseServer.common.historyNotLoaded"));
      }
      if (codeResult.error)
        console.warn("[getCaseStatusLine] reason codes", codeResult.error.message);
      const language = requestLanguage();
      const labels = new Map(
        (codeResult.data ?? []).map((row) => [
          row["code"] as string,
          reasonLabel(row["code"] as string, row["label"] as string, language),
        ]),
      );
      const event = (eventResult.data ?? [])[0] as Record<string, unknown> | undefined;
      const createdBy = caseResult.data["created_by"] as string | null;
      const actorId = (event?.["actor_id"] as string | null | undefined) ?? null;
      const people = [...new Set([createdBy, actorId].filter((id): id is string => Boolean(id)))];
      const { data: profiles, error: profileError } = people.length
        ? await context.supabase.from("profiles").select("id, full_name").in("id", people)
        : { data: [], error: null };
      if (profileError) console.warn("[getCaseStatusLine] names", profileError.message);
      const nameOf = (id: string | null) =>
        id
          ? ((((profiles ?? []) as Record<string, unknown>[]).find((row) => row["id"] === id)?.[
              "full_name"
            ] as string | null | undefined) ?? null)
          : null;
      return {
        last: event
          ? {
              field: event["field"] === "status" ? "status" : "phase",
              fromStatus: (event["from_status"] as CaseStatus | null) ?? null,
              fromPhase: (event["from_phase"] as CasePhase | null) ?? null,
              toPhase: (event["to_phase"] as CasePhase | null) ?? null,
              toStatus: (event["to_status"] as CaseStatus | null) ?? null,
              occurredAt: event["occurred_at"] as string,
              actorName: nameOf(actorId),
              actorType: event["actor_type"] as string,
              reasons: ((event["reason_codes"] as string[] | null) ?? []).map(
                (code) => labels.get(code) ?? code,
              ),
              note: (event["note"] as string | null) ?? null,
              undone: Boolean(event["undo_of"]),
            }
          : null,
        createdAt: caseResult.data["created_at"] as string,
        createdByName: nameOf(createdBy),
      };
    }),
  );
