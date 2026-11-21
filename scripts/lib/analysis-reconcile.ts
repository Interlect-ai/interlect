/**
 * Afstemning af analysekørslernes pris (spec B.4 test 7): for hver færdig kørsel skal
 * trinene (analysis_run_steps), kørslen (analysis_runs.actual_cost) og kreditbogen (kørslens
 * afregnede række, 0131) give det samme inden for få øre, alle omregnet med kørslens egen kurs.
 * Vercels regning for perioden står ved siden af kreditbogens samlede forbrug.
 *
 * Pure, so it is tested; scripts/analysis-reconcile.ts reads the rows and prints the report.
 */

/** "Within a few øre" (spec B.4 test 7). */
export const RECONCILE_TOLERANCE_DKK = 0.05;

export interface ReconcileRunRow {
  id: string;
  fund_id: string;
  kind: string;
  status: string;
  actual_cost: number | string | null;
  usd_to_dkk: number | string | null;
  validation_result: unknown;
}

export interface ReconcileStepRow {
  run_id: string;
  actual_cost: number | string | null;
  charged_cost: number | string | null;
}

export interface ReconcileLedgerRow {
  ref_id: string | null;
  kind: string;
  scope: string;
  status: string;
  loop: string | null;
  amount_dkk: number | string | null;
  note: string | null;
}

/**
 * ok: the three agree. capped: booked lower than the run's price because of its limit or the month
 * (0131 writes it in the row's note). pending: the run's row is still reserved (the next settlement
 * books it). unknown_price: a finished run with neither a price nor a charged bound, booked at its
 * reservation on purpose (0114). Not errors. unsettled: the run has no row in the ledger at all.
 * steps_differ: the steps and the run disagree. booking_differs: the ledger and the run disagree.
 */
export type ReconcileVerdict =
  "ok" | "capped" | "pending" | "unknown_price" | "unsettled" | "steps_differ" | "booking_differs";

/** Verdicts that are not errors. */
const EXPECTED: ReadonlySet<ReconcileVerdict> = new Set([
  "ok",
  "capped",
  "pending",
  "unknown_price",
]);

export interface ReconciledRun {
  runId: string;
  fundId: string;
  kind: string;
  status: string;
  /** The rate the run was settled with: its own, else the installation's (before 0123). */
  rate: number;
  stepsDkk: number;
  /** Null when the run has neither a known price nor a charged bound. */
  runDkk: number | null;
  /** Null when the run has no settled row in the ledger. */
  bookedDkk: number | null;
  verdict: ReconcileVerdict;
}

export interface Reconciliation {
  runs: ReconciledRun[];
  totals: { stepsDkk: number; runDkk: number; bookedDkk: number };
  /** Every run whose verdict is an error (not ok, capped, pending or unknown_price). */
  problems: ReconciledRun[];
}

function amount(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** validation_result.budget.chargedUsd as the database reads it (ai_run_charged_usd, 0114). */
export function chargedUsd(validation: unknown): number | null {
  if (!validation || typeof validation !== "object" || Array.isArray(validation)) return null;
  const budget = (validation as Record<string, unknown>)["budget"];
  if (!budget || typeof budget !== "object" || Array.isArray(budget)) return null;
  const value = (budget as Record<string, unknown>)["chargedUsd"];
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

/** Is this ledger row an analysis run's own row (0125: no loop, a run id)? */
export function isRunRow(row: ReconcileLedgerRow): boolean {
  return row.kind === "usage" && row.scope === "analysis" && row.ref_id !== null && !row.loop;
}

export function reconcile(input: {
  runs: readonly ReconcileRunRow[];
  steps: readonly ReconcileStepRow[];
  ledger: readonly ReconcileLedgerRow[];
  /** ai_settings.usd_to_dkk: the rate of a run from before 0123. */
  defaultRate: number;
  toleranceDkk?: number;
}): Reconciliation {
  const tolerance = input.toleranceDkk ?? RECONCILE_TOLERANCE_DKK;
  const stepsUsd = new Map<string, number>();
  for (const step of input.steps) {
    // An unknown price counts with what the step charged against the budget.
    const usd = amount(step.actual_cost) ?? amount(step.charged_cost) ?? 0;
    stepsUsd.set(step.run_id, (stepsUsd.get(step.run_id) ?? 0) + usd);
  }
  const booked = new Map<string, { dkk: number; notes: string }>();
  const reserved = new Set<string>();
  for (const row of input.ledger) {
    if (!isRunRow(row) || row.ref_id === null) continue;
    if (row.status === "reserved") reserved.add(row.ref_id);
    if (row.status !== "final") continue;
    const before = booked.get(row.ref_id) ?? { dkk: 0, notes: "" };
    booked.set(row.ref_id, {
      dkk: before.dkk + (amount(row.amount_dkk) ?? 0),
      notes: `${before.notes} ${row.note ?? ""}`,
    });
  }

  const runs = input.runs.map((run): ReconciledRun => {
    const rate = amount(run.usd_to_dkk) ?? input.defaultRate;
    const stepsDkk = (stepsUsd.get(run.id) ?? 0) * rate;
    const runUsd = amount(run.actual_cost) ?? chargedUsd(run.validation_result);
    const runDkk = runUsd === null ? null : runUsd * rate;
    const row = booked.get(run.id);
    const base = {
      runId: run.id,
      fundId: run.fund_id,
      kind: run.kind,
      status: run.status,
      rate,
      stepsDkk,
      runDkk,
      bookedDkk: row?.dkk ?? null,
    };
    if (!row) return { ...base, verdict: reserved.has(run.id) ? "pending" : "unsettled" };
    if (runDkk !== null && Math.abs(stepsDkk - runDkk) > tolerance) {
      return { ...base, verdict: "steps_differ" };
    }
    const price = runDkk ?? stepsDkk;
    if (Math.abs(price - row.dkk) <= tolerance) return { ...base, verdict: "ok" };
    if (runDkk === null && (run.status === "complete" || run.status === "awaiting_approval")) {
      return { ...base, verdict: "unknown_price" };
    }
    if (row.dkk < price && row.notes.includes("afregnet til"))
      return { ...base, verdict: "capped" };
    return { ...base, verdict: "booking_differs" };
  });

  return {
    runs,
    totals: {
      stepsDkk: runs.reduce((sum, run) => sum + run.stepsDkk, 0),
      runDkk: runs.reduce((sum, run) => sum + (run.runDkk ?? 0), 0),
      bookedDkk: runs.reduce((sum, run) => sum + (run.bookedDkk ?? 0), 0),
    },
    problems: runs.filter((run) => !EXPECTED.has(run.verdict)),
  };
}

const VERDICT_TEXT: Record<ReconcileVerdict, string> = {
  ok: "passer",
  capped: "afregnet til grænsen",
  pending: "afregnes ved næste afregning",
  unknown_price: "ukendt pris, bogført til reservationen",
  unsettled: "ikke i kreditbogen",
  steps_differ: "trin ≠ kørsel",
  booking_differs: "bogføring ≠ kørsel",
};

function kr(value: number | null): string {
  return value === null ? "–" : `${value.toFixed(2)} kr.`;
}

/** The report as Markdown lines (also for GitHub's run summary). */
export function reconcileReport(input: {
  title: string;
  result: Reconciliation;
  /** What the rest of the ledger booked in the period (helpers, Brain, Spørg, eval), in kroner. */
  otherBookedDkk: number;
  /** Vercel's bill for the period in USD, typed by the operator; null when not given. */
  vercelUsd: number | null;
  /** The installation's rate, to put the bill in kroner. */
  rate: number;
}): string[] {
  const { result } = input;
  const count = (verdict: ReconcileVerdict) =>
    result.runs.filter((run) => run.verdict === verdict).length;
  const lines = [
    `## ${input.title}`,
    "",
    "| | Trin | Kørsel | Bogført |",
    "|---|---|---|---|",
    `| Analysekørsler | ${kr(result.totals.stepsDkk)} | ${kr(result.totals.runDkk)} | ${kr(result.totals.bookedDkk)} |`,
    "",
    `Kørsler: ${result.runs.length} · passer ${count("ok")} · afregnet til grænsen ${count("capped")} · venter på afregning ${count("pending")} · ukendt pris ${count("unknown_price")} · afvigelser ${result.problems.length}`,
    `Øvrigt bogført i perioden (hjælpere, Brain, Spørg, eval): ${kr(input.otherBookedDkk)}`,
  ];
  const ledgerTotal = result.totals.bookedDkk + input.otherBookedDkk;
  if (input.vercelUsd === null) {
    lines.push(
      `Kreditbogen i alt: ${kr(ledgerTotal)} · Vercels regning: ikke angivet (--vercel-usd <beløb>)`,
    );
  } else {
    const vercelDkk = input.vercelUsd * input.rate;
    lines.push(
      `Kreditbogen i alt: ${kr(ledgerTotal)} · Vercels regning: ${input.vercelUsd.toFixed(2)} USD ≈ ${kr(vercelDkk)} · forskel ${kr(vercelDkk - ledgerTotal)}`,
    );
  }
  if (result.problems.length > 0) {
    lines.push(
      "",
      "| Kørsel | Type | Status | Trin | Kørsel | Bogført | Hvorfor |",
      "|---|---|---|---|---|---|---|",
      ...result.problems.map(
        (run) =>
          `| ${run.runId} | ${run.kind} | ${run.status} | ${kr(run.stepsDkk)} | ${kr(run.runDkk)} | ${kr(run.bookedDkk)} | ${VERDICT_TEXT[run.verdict]} |`,
      ),
    );
  }
  return lines;
}
