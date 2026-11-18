import type { SupabaseClient } from "@supabase/supabase-js";
import { isStandingMove, undoneMoveIds } from "./movement";

/**
 * decision_stats: fixed, parameterised questions about the fund's own decisions (funnel,
 * reasons, score vs. decision, time per phase). No free SQL, no model; numbers come from code.
 * The chat's "aggregate" questions and Brain · Beslutninger use it. Callers check access.
 */
export const DECISION_STATS_GROUPS = [
  "funnel",
  "reasons",
  "score_vs_decision",
  "time_in_phase",
] as const;
export type DecisionStatsGroup = (typeof DECISION_STATS_GROUPS)[number];

export type DecisionStatsFilters = {
  sector?: string | null;
  stage?: string | null;
  /** Decided (or, for the funnel, created) on or after this date, YYYY-MM-DD. */
  from?: string | null;
  /** … and before this date (exclusive). */
  to?: string | null;
};

const DECISION_KINDS = ["reject", "decline_ic", "invest"] as const;
const PAGE = 1000;

type CaseRow = { id: string; phase: string; status: string; created_at: string };
type EventRow = {
  id: string;
  case_id: string;
  movement_kind: string | null;
  reason_codes: string[] | null;
  occurred_at: string;
  screening_score: number | null;
  deep_score: number | null;
  to_phase: string | null;
  undo_of: string | null;
};

export async function decisionStats(
  service: SupabaseClient,
  fundId: string,
  groupBy: DecisionStatsGroup,
  filters: DecisionStatsFilters = {},
): Promise<{ groupBy: DecisionStatsGroup; filters: DecisionStatsFilters; rows: unknown[] }> {
  const cases = await fundCases(service, fundId, filters);
  if (groupBy === "funnel") {
    const counts = new Map<string, number>();
    for (const row of cases) {
      if (!inPeriod(row.created_at, filters)) continue;
      const key = `${row.phase}|${row.status}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const rows = [...counts]
      .map(([key, count]) => {
        const [phase, status] = key.split("|");
        return { phase, status, cases: count };
      })
      .sort((a, b) => b.cases - a.cases);
    return { groupBy, filters, rows };
  }

  const events = await caseEvents(service, fundId, new Set(cases.map((row) => row.id)));
  if (groupBy === "time_in_phase") return { groupBy, filters, rows: timeInPhase(cases, events) };

  const decisions = latestDecisions(cases, events).filter((event) =>
    inPeriod(event.occurred_at, filters),
  );
  if (groupBy === "score_vs_decision") {
    const rows = DECISION_KINDS.map((kind) => {
      const own = decisions.filter((event) => event.movement_kind === kind);
      return {
        decision: kind,
        cases: own.length,
        screeningScore: summary(own.map((event) => event.screening_score)),
        deepScore: summary(own.map((event) => event.deep_score)),
      };
    });
    return { groupBy, filters, rows };
  }

  const labels = await reasonLabels(service, fundId);
  const counts = new Map<string, number>();
  for (const event of decisions) {
    for (const code of event.reason_codes ?? []) {
      const key = `${event.movement_kind}|${code}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const totals = new Map<string, number>();
  for (const event of decisions) {
    const kind = event.movement_kind ?? "";
    totals.set(kind, (totals.get(kind) ?? 0) + 1);
  }
  const rows = [...counts]
    .map(([key, count]) => {
      const [decision, code] = key.split("|") as [string, string];
      return {
        decision,
        reason: code,
        label: labels.get(code) ?? code,
        cases: count,
        shareOfDecisions: Number((count / (totals.get(decision) ?? 1)).toFixed(3)),
      };
    })
    .sort((a, b) => b.cases - a.cases || a.reason.localeCompare(b.reason));
  return { groupBy, filters, rows };
}

async function fundCases(
  service: SupabaseClient,
  fundId: string,
  filters: DecisionStatsFilters,
): Promise<CaseRow[]> {
  const out: CaseRow[] = [];
  for (let from = 0; ; from += PAGE) {
    let query = service
      .from("cases")
      .select("id, phase, status, created_at, companies!inner(sector, stage)")
      .eq("fund_id", fundId)
      .order("id")
      .range(from, from + PAGE - 1);
    if (filters.sector) query = query.eq("companies.sector", filters.sector);
    if (filters.stage) query = query.eq("companies.stage", filters.stage);
    const { data, error } = await query;
    if (error) throw new Error(`decision_stats cases: ${error.message}`);
    for (const row of data ?? []) {
      out.push({
        id: row["id"] as string,
        phase: row["phase"] as string,
        status: row["status"] as string,
        created_at: row["created_at"] as string,
      });
    }
    if ((data ?? []).length < PAGE) return out;
  }
}

async function caseEvents(
  service: SupabaseClient,
  fundId: string,
  caseIds: Set<string>,
): Promise<EventRow[]> {
  const out: EventRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await service
      .from("case_transition_events")
      .select(
        "id, case_id, movement_kind, reason_codes, occurred_at, screening_score, deep_score, to_phase, undo_of",
      )
      .eq("fund_id", fundId)
      .order("occurred_at")
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`decision_stats events: ${error.message}`);
    for (const row of (data ?? []) as unknown as EventRow[]) {
      if (caseIds.has(row.case_id)) out.push(row);
    }
    if ((data ?? []).length < PAGE) return out;
  }
}

/** Per decided case its latest decision that was not undone (same rule as brain_case_decisions). */
function latestDecisions(cases: CaseRow[], events: EventRow[]): EventRow[] {
  const decided = new Set(cases.filter((row) => row.phase === "decided").map((row) => row.id));
  const undone = undoneMoveIds(events);
  const latest = new Map<string, EventRow>();
  for (const event of events) {
    if (!decided.has(event.case_id) || !isStandingMove(event, undone)) continue;
    if (!DECISION_KINDS.includes(event.movement_kind as (typeof DECISION_KINDS)[number])) continue;
    latest.set(event.case_id, event);
  }
  return [...latest.values()];
}

/** Average days a case spent in each phase it has left (a phase it is still in is not counted). */
function timeInPhase(cases: CaseRow[], events: EventRow[]) {
  const byCase = new Map<string, EventRow[]>();
  for (const event of events) {
    if (!event.to_phase) continue;
    const list = byCase.get(event.case_id) ?? [];
    list.push(event);
    byCase.set(event.case_id, list);
  }
  const days = new Map<string, number[]>();
  for (const row of cases) {
    let phase = "screening";
    let since = new Date(row.created_at).getTime();
    for (const event of byCase.get(row.id) ?? []) {
      if (event.to_phase === phase) continue;
      const at = new Date(event.occurred_at).getTime();
      const list = days.get(phase) ?? [];
      list.push(Math.max(0, (at - since) / 86_400_000));
      days.set(phase, list);
      phase = event.to_phase as string;
      since = at;
    }
  }
  return [...days].map(([phase, values]) => ({
    phase,
    stints: values.length,
    averageDays: Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1)),
  }));
}

function summary(values: Array<number | null>) {
  const numbers = values.filter((value): value is number => typeof value === "number");
  if (numbers.length === 0) return null;
  const sorted = [...numbers].sort((a, b) => a - b);
  return {
    n: numbers.length,
    average: Number((numbers.reduce((sum, value) => sum + value, 0) / numbers.length).toFixed(1)),
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
}

async function reasonLabels(service: SupabaseClient, fundId: string): Promise<Map<string, string>> {
  const { data, error } = await service
    .from("brain_reason_codes")
    .select("code, label")
    .eq("fund_id", fundId);
  if (error) throw new Error(`decision_stats reasons: ${error.message}`);
  return new Map((data ?? []).map((row) => [row["code"] as string, row["label"] as string]));
}

function inPeriod(iso: string, filters: DecisionStatsFilters): boolean {
  const day = iso.slice(0, 10);
  if (filters.from && day < filters.from) return false;
  if (filters.to && day >= filters.to) return false;
  return true;
}
