/**
 * Reads the rows Overblik is built from, every page (paginate.ts: PostgREST cuts a query at
 * 1,000 rows and a number built from a cut list is silently too low). Always the signed-in
 * user's own client, so row-level security keeps every read inside the fund. The row mapping
 * is in mappers.ts (tested without a database).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { isStepDone } from "@/lib/cases/run-steps";
import { DEFAULT_LANGUAGE, type Language } from "@/lib/i18n/language";
import type { TransitionEvent } from "./funnel";
import {
  mapCaseRow,
  mapEventRow,
  mapOpenTaskRow,
  mapRecalcRow,
  mapRunRow,
  type Row,
} from "./mappers";
import { fetchAllRows } from "./paginate";
import type { CaseRow, OpenTaskRow, RecalcRow, RunRow } from "./snapshot";

/** The team's cases, limited to `thesisIds` when given (the theses the page shows). */
export async function loadCaseRows(
  supabase: SupabaseClient,
  fundId: string,
  language: Language = DEFAULT_LANGUAGE,
  thesisIds?: readonly string[],
): Promise<CaseRow[]> {
  const rows = await fetchAllRows<Row>((from, to) => {
    let query = supabase
      .from("cases")
      .select(
        "id, thesis_id, phase, status, created_at, last_action_at, companies(name, stage, hq_country, sector_key, sector_taxonomy(label_da))",
        { count: "exact" },
      )
      .eq("fund_id", fundId);
    if (thesisIds) query = query.in("thesis_id", [...thesisIds]);
    return query.order("id").range(from, to);
  });
  return rows.map((row) => mapCaseRow(row, language));
}

/**
 * ONE read of the fund's runs for everything on the page: the full history of the active setup
 * version (scores, funnel, Venter) and, from any version, the runs since `sinceIso` (activity,
 * "I gang nu", Forbrug).
 */
export async function loadRuns(
  supabase: SupabaseClient,
  fundId: string,
  configVersionId: string | readonly string[],
  sinceIso: string,
): Promise<{ configRuns: RunRow[]; recent: Row[] }> {
  // One active version per shown thesis; ids are uuids from the database.
  const configIds = typeof configVersionId === "string" ? [configVersionId] : [...configVersionId];
  const active = new Set(configIds);
  const rows = await fetchAllRows<Row>((from, to) =>
    supabase
      .from("analysis_runs")
      .select(
        "id, case_id, kind, status, previous_run_id, config_version_id, created_at, completed_at, recommendations(overall_score, evidence_confidence)",
        { count: "exact" },
      )
      .eq("fund_id", fundId)
      .in("kind", ["screening", "deep"])
      .or(`config_version_id.in.(${configIds.join(",")}),created_at.gte.${sinceIso}`)
      .order("id")
      .range(from, to),
  );
  return {
    configRuns: rows.filter((row) => active.has(row["config_version_id"] as string)).map(mapRunRow),
    recent: rows.filter((row) => (row["created_at"] as string) >= sinceIso),
  };
}

/** Cases with a finished screening under an OLDER setup version (they look unscreened now). */
export async function loadOlderVersionScreenedCaseIds(
  supabase: SupabaseClient,
  fundId: string,
  configVersionId: string | readonly string[],
): Promise<Set<string>> {
  const configIds = typeof configVersionId === "string" ? [configVersionId] : [...configVersionId];
  const rows = await fetchAllRows<Row>((from, to) =>
    supabase
      .from("analysis_runs")
      .select("id, case_id", { count: "exact" })
      .eq("fund_id", fundId)
      .eq("kind", "screening")
      .in("status", ["complete", "awaiting_approval"])
      .not("config_version_id", "in", `(${configIds.join(",")})`)
      .order("id")
      .range(from, to),
  );
  return new Set(rows.map((row) => row["case_id"] as string));
}

export async function loadRecalcs(supabase: SupabaseClient, fundId: string): Promise<RecalcRow[]> {
  const rows = await fetchAllRows<Row>((from, to) =>
    supabase
      .from("case_score_recalculations")
      .select("id, run_id, overall_score, created_at", { count: "exact" })
      .eq("fund_id", fundId)
      .order("id")
      .range(from, to),
  );
  return rows.map(mapRecalcRow);
}

export async function loadTransitionEvents(
  supabase: SupabaseClient,
  fundId: string,
): Promise<TransitionEvent[]> {
  const rows = await fetchAllRows<Row>((from, to) =>
    supabase
      .from("case_transition_events")
      .select("id, case_id, field, to_phase, to_status, occurred_at, undo_of", {
        count: "exact",
      })
      .eq("fund_id", fundId)
      .in("field", ["phase", "status"])
      .order("id")
      .range(from, to),
  );
  return rows.map(mapEventRow);
}

export async function loadOpenTaskRows(
  supabase: SupabaseClient,
  fundId: string,
): Promise<OpenTaskRow[]> {
  const rows = await fetchAllRows<Row>((from, to) =>
    supabase
      .from("case_tasks")
      .select("id, case_id, assignee_id, due_on", { count: "exact" })
      .eq("fund_id", fundId)
      .eq("status", "open")
      .is("deleted_at", null)
      .order("id")
      .range(from, to),
  );
  return rows.map(mapOpenTaskRow);
}

export interface RunningRun {
  caseId: string;
  kind: "screening" | "deep";
  stepKey: string | null;
  completed: number;
  total: number;
}

/** Runs queued or running now, with their active step: small, so it can be polled. */
export async function loadRunningRuns(
  supabase: SupabaseClient,
  fundId: string,
): Promise<RunningRun[]> {
  const runs = await fetchAllRows<Row>((from, to) =>
    supabase
      .from("analysis_runs")
      .select("id, case_id, kind, status", { count: "exact" })
      .eq("fund_id", fundId)
      .in("status", ["queued", "running"])
      .order("id")
      .range(from, to),
  );
  if (runs.length === 0) return [];
  const { data: steps, error } = await supabase
    .from("analysis_run_steps")
    .select("run_id, step_key, status, step_order")
    .eq("fund_id", fundId)
    .in(
      "run_id",
      runs.map((run) => run["id"] as string),
    );
  // The step line is a convenience; the run itself still shows.
  if (error) console.warn("[overview] running steps unavailable", error.message);
  return runs.map((run) => {
    const own = (steps ?? [])
      .filter((step) => step["run_id"] === run["id"])
      .sort((a, b) => Number(a["step_order"]) - Number(b["step_order"]));
    const active =
      own.find((step) => step["status"] === "running") ??
      own.find((step) => step["status"] === "queued");
    return {
      caseId: run["case_id"] as string,
      kind: run["kind"] as "screening" | "deep",
      stepKey: (active?.["step_key"] as string | undefined) ?? null,
      completed: own.filter((step) =>
        isStepDone({ key: step["step_key"] as string, status: step["status"] as string }),
      ).length,
      total: own.length,
    };
  });
}
