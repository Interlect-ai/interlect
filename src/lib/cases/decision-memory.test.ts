import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  MEMORY_RECONCILE_DELAY_MS,
  memoryActionFor,
  reconcileMemoryWith,
  type MemoryEntryDraft,
} from "./decision-memory.ts";

test("the memory follows the case's state, not the event (harden N1)", () => {
  // Invested (also after Genåbn + Fortryd, or after a Luk that was undone): one invested entry.
  assert.deepEqual(memoryActionFor({ phase: "decided", status: "invested" }), {
    kind: "write",
    decision: "invested",
  });
  assert.deepEqual(memoryActionFor({ phase: "decided", status: "closed" }), {
    kind: "write",
    decision: "closed_without_investment",
  });
  // Not decided (an undone decision, a reopened case): no entry.
  for (const phase of ["screening", "deep_analysis", "committee"] as const) {
    for (const status of ["active", "on_hold"] as const) {
      assert.deepEqual(memoryActionFor({ phase, status }), { kind: "delete" });
    }
  }
});

test("the reconcile waits out the server's Fortryd window (5 s + 2 s)", () => {
  assert.ok(MEMORY_RECONCILE_DELAY_MS > 7_000);
});

// ---- The reconcile over logged event sequences (harden F4) ----------------------------------

type Row = Record<string, unknown>;

/** Enough of supabase-js for the reconcile: select/delete with eq, in, is, order and limit. */
function fakeDb(tables: Record<string, Row[]>, failing: string[] = []) {
  const client = {
    from(table: string) {
      const filters: ((row: Row) => boolean)[] = [];
      let mode: "select" | "delete" = "select";
      let order: { column: string; ascending: boolean } | null = null;
      let limit = Infinity;
      const run = () => {
        if (failing.includes(table)) return { data: null, error: { message: `${table} failed` } };
        const all = tables[table] ?? [];
        const hit = all.filter((row) => filters.every((keep) => keep(row)));
        if (mode === "delete") {
          tables[table] = all.filter((row) => !hit.includes(row));
          return { data: null, error: null };
        }
        if (order) {
          const { column, ascending } = order;
          hit.sort(
            (a, b) => String(a[column]).localeCompare(String(b[column])) * (ascending ? 1 : -1),
          );
        }
        return { data: hit.slice(0, limit).map((row) => ({ ...row })), error: null };
      };
      const builder = {
        select: () => builder,
        delete: () => ((mode = "delete"), builder),
        eq: (column: string, value: unknown) => (
          filters.push((row) => row[column] === value),
          builder
        ),
        in: (column: string, values: unknown[]) => (
          filters.push((row) => values.includes(row[column])),
          builder
        ),
        is: (column: string, value: unknown) => (
          filters.push((row) => (row[column] ?? null) === value),
          builder
        ),
        order: (column: string, options: { ascending: boolean }) => (
          (order = { column, ascending: options.ascending }),
          builder
        ),
        limit: (count: number) => ((limit = count), builder),
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
          Promise.resolve().then(run).then(resolve, reject),
      };
      return builder;
    },
  };
  return client as unknown as SupabaseClient;
}

const FUND = "fund-a";
const OTHER_FUND = "fund-b";
const CASE = "case-1";
const company = { name: "Nordlys", sector: "Energi", geography: "DK", stage: "seed" };
const summaryOf = (entry: MemoryEntryDraft) =>
  `${entry.companyName} -- ${entry.decision}. Begrundelse: ${entry.reason}`;

let nextId = 0;
function world(state: { phase: string; status: string }, events: Row[], entries: Row[] = []) {
  const tables: Record<string, Row[]> = {
    cases: [{ id: CASE, fund_id: FUND, ...state, companies: company }],
    case_transition_events: events.map((event) => ({ fund_id: FUND, case_id: CASE, ...event })),
    brain_reason_codes: [
      { fund_id: FUND, code: "strong_team", label: "Stærkt team" },
      { fund_id: FUND, code: "too_early", label: "For tidligt" },
      { fund_id: OTHER_FUND, code: "too_early", label: "Andet fonds label" },
    ],
    fund_memory_entries: entries,
  };
  const writes: MemoryEntryDraft[] = [];
  const deps = (
    options: { memoryEnabled?: boolean; failing?: string[]; onWrite?: () => void } = {},
  ) => ({
    service: fakeDb(tables, options.failing),
    memoryEnabled: options.memoryEnabled ?? true,
    summaryOf,
    async write(fundId: string, entry: MemoryEntryDraft) {
      writes.push(entry);
      // As memory.ts: delete + insert, so the entry gets a new id.
      tables["fund_memory_entries"] = (tables["fund_memory_entries"] ?? []).filter(
        (row) => row["case_id"] !== entry.caseId,
      );
      tables["fund_memory_entries"].push({
        id: `entry-${++nextId}`,
        fund_id: fundId,
        case_id: entry.caseId,
        decision: entry.decision,
        decided_at: entry.decidedAt,
        summary_text: summaryOf(entry),
      });
      options.onWrite?.();
    },
  });
  return { tables, writes, deps, entries: () => tables["fund_memory_entries"] ?? [] };
}

const invest = {
  id: "e1",
  to_status: "invested",
  reason_codes: ["strong_team"],
  note: "Stærk traction",
  occurred_at: "2026-09-20T09:00:00Z",
  undo_of: null,
};
const storedInvest = (id = "entry-kept") => ({
  id,
  fund_id: FUND,
  case_id: CASE,
  decision: "invested",
  decided_at: "2026-09-20",
  summary_text: "Nordlys -- invested. Begrundelse: Stærkt team, Stærk traction",
});

test("Investeret writes one entry with the decision's reasons and day", async () => {
  const w = world({ phase: "decided", status: "invested" }, [invest]);
  await reconcileMemoryWith(w.deps(), FUND, [CASE]);
  assert.equal(w.entries().length, 1);
  assert.deepEqual(
    { decision: w.entries()[0]?.["decision"], day: w.entries()[0]?.["decided_at"] },
    { decision: "invested", day: "2026-09-20" },
  );
  assert.equal(w.writes[0]?.reason, "Stærkt team, Stærk traction");
});

test("Genåbn + Fortryd keeps the entry and its id, so other cases keep their matches (F2)", async () => {
  const w = world(
    { phase: "decided", status: "invested" },
    [
      invest,
      { id: "e2", to_status: "active", occurred_at: "2026-09-30T10:00:00Z", undo_of: null },
      { id: "e3", to_status: "invested", occurred_at: "2026-09-30T10:00:03Z", undo_of: "e2" },
    ],
    [storedInvest()],
  );
  await reconcileMemoryWith(w.deps(), FUND, [CASE]);
  assert.equal(w.writes.length, 0);
  assert.equal(w.entries()[0]?.["id"], "entry-kept");
  assert.equal(w.entries()[0]?.["decided_at"], "2026-09-20");
});

test("Luk + Fortryd on an invested case keeps the invested entry (F2)", async () => {
  const w = world(
    { phase: "decided", status: "invested" },
    [
      invest,
      {
        id: "e2",
        to_status: "closed",
        reason_codes: ["too_early"],
        occurred_at: "2026-09-30T10:00:00Z",
        undo_of: null,
      },
      { id: "e3", to_status: "invested", occurred_at: "2026-09-30T10:00:03Z", undo_of: "e2" },
    ],
    [storedInvest()],
  );
  await reconcileMemoryWith(w.deps(), FUND, [CASE]);
  assert.equal(w.writes.length, 0);
  assert.equal(w.entries()[0]?.["id"], "entry-kept");
});

test("a real flip rewrites the entry with the new outcome, reasons and day", async () => {
  const w = world(
    { phase: "decided", status: "closed" },
    [
      invest,
      {
        id: "e2",
        to_status: "closed",
        reason_codes: ["too_early"],
        note: null,
        occurred_at: "2026-09-30T10:00:00Z",
        undo_of: null,
      },
    ],
    [storedInvest()],
  );
  await reconcileMemoryWith(w.deps(), FUND, [CASE]);
  assert.equal(w.entries().length, 1);
  assert.equal(w.entries()[0]?.["decision"], "closed_without_investment");
  assert.equal(w.entries()[0]?.["decided_at"], "2026-09-30");
  // The fund's own label, not another fund's.
  assert.equal(w.writes[0]?.reason, "For tidligt");
});

test("closed again with new reasons inside the window rewrites the reason", async () => {
  const w = world(
    { phase: "decided", status: "closed" },
    [
      {
        id: "e1",
        to_status: "closed",
        reason_codes: ["too_early"],
        occurred_at: "2026-09-30T09:00:00Z",
        undo_of: null,
      },
      { id: "e2", to_status: "active", occurred_at: "2026-09-30T09:00:02Z", undo_of: null },
      {
        id: "e3",
        to_status: "closed",
        reason_codes: [],
        note: "Ny grund",
        occurred_at: "2026-09-30T09:00:04Z",
        undo_of: null,
      },
    ],
    [
      {
        id: "entry-old",
        fund_id: FUND,
        case_id: CASE,
        decision: "closed_without_investment",
        decided_at: "2026-09-30",
        summary_text: "Nordlys -- closed_without_investment. Begrundelse: For tidligt",
      },
    ],
  );
  await reconcileMemoryWith(w.deps(), FUND, [CASE]);
  assert.equal(w.writes[0]?.reason, "Ny grund");
});

test("a reopened case loses its entry", async () => {
  const w = world({ phase: "committee", status: "active" }, [invest], [storedInvest()]);
  await reconcileMemoryWith(w.deps(), FUND, [CASE]);
  assert.equal(w.entries().length, 0);
  assert.equal(w.writes.length, 0);
});

test("memory off: nothing is written, but a flipped outcome is removed (F5)", async () => {
  const flipped = world({ phase: "decided", status: "closed" }, [invest], [storedInvest()]);
  await reconcileMemoryWith(flipped.deps({ memoryEnabled: false }), FUND, [CASE]);
  assert.equal(flipped.entries().length, 0);
  assert.equal(flipped.writes.length, 0);

  const same = world({ phase: "decided", status: "invested" }, [invest], [storedInvest()]);
  await reconcileMemoryWith(same.deps({ memoryEnabled: false }), FUND, [CASE]);
  assert.equal(same.entries()[0]?.["id"], "entry-kept");

  const fresh = world({ phase: "decided", status: "invested" }, [invest]);
  await reconcileMemoryWith(fresh.deps({ memoryEnabled: false }), FUND, [CASE]);
  assert.equal(fresh.entries().length, 0);
});

test("another fund's call touches neither the case nor its entry", async () => {
  const w = world({ phase: "committee", status: "active" }, [invest], [storedInvest()]);
  await reconcileMemoryWith(w.deps(), OTHER_FUND, [CASE]);
  assert.equal(w.entries()[0]?.["id"], "entry-kept");
});

test("an unreadable log never writes a guess and removes a wrong outcome", async () => {
  const w = world({ phase: "decided", status: "closed" }, [invest], [storedInvest()]);
  const original = console.error;
  console.error = () => {};
  try {
    await reconcileMemoryWith(w.deps({ failing: ["case_transition_events"] }), FUND, [CASE]);
  } finally {
    console.error = original;
  }
  assert.equal(w.writes.length, 0);
  assert.equal(w.entries().length, 0);
});

test("a failed label lookup is logged and never replaces an entry with raw codes (F6, SF2)", async () => {
  const run = async (entries: Row[]) => {
    const w = world({ phase: "decided", status: "invested" }, [invest], entries);
    const warnings: unknown[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => void warnings.push(args);
    try {
      await reconcileMemoryWith(w.deps({ failing: ["brain_reason_codes"] }), FUND, [CASE]);
    } finally {
      console.warn = original;
    }
    return { w, warnings };
  };
  // A good entry keeps its id and text.
  const kept = await run([
    { ...storedInvest(), summary_text: "Nordlys -- invested. Begrundelse: Gammel tekst" },
  ]);
  assert.equal(kept.warnings.length, 1);
  assert.equal(kept.w.writes.length, 0);
  assert.equal(kept.w.entries()[0]?.["id"], "entry-kept");
  // No entry yet: none is written from a guess; the next move tries again.
  const none = await run([]);
  assert.equal(none.w.writes.length, 0);
});

test("a case decided before the log keeps its stored reason and day (SF3)", async () => {
  const w = world({ phase: "decided", status: "invested" }, [], [storedInvest()]);
  await reconcileMemoryWith(w.deps(), FUND, [CASE]);
  assert.equal(w.writes.length, 0);
  assert.equal(w.entries()[0]?.["decided_at"], "2026-09-20");
});

test("a case decided before the log gets an entry without a day", async () => {
  const w = world({ phase: "decided", status: "invested" }, []);
  await reconcileMemoryWith(w.deps(), FUND, [CASE]);
  assert.equal(w.writes[0]?.decidedAt, null);
  assert.equal(w.writes[0]?.reason, "Ingen begrundelse angivet.");
});

test("a case reopened while its entry was written is followed again", async () => {
  const w = world({ phase: "decided", status: "invested" }, [invest]);
  const deps = w.deps({
    onWrite: () => {
      const row = w.tables["cases"]?.[0];
      if (row) Object.assign(row, { phase: "committee", status: "active" });
    },
  });
  await reconcileMemoryWith(deps, FUND, [CASE]);
  assert.equal(w.writes.length, 1);
  assert.equal(w.entries().length, 0);
});
