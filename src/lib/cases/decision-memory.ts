/**
 * What the fund's memory ("lignende tidligere beslutninger") should hold for a case, decided
 * from the case's state alone (harden N1): a decided case has exactly one entry with its
 * current outcome; any other case has none. Events (Fortryd, Genåbn, flips) never decide it,
 * so an undo or a reopen cannot leave a stale entry or delete a valid one.
 *
 * The reconcile runs over an injected client, so tests drive it with logged event sequences
 * (harden F4); decision-memory.server.ts wires in the service client and the memory writer.
 * Only type imports here, so `node --test` can load the file.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CasePhase, CaseStatus } from "./lifecycle";

export type MemoryDecision = "invested" | "closed_without_investment";

export type MemoryAction = { kind: "write"; decision: MemoryDecision } | { kind: "delete" };

export function memoryActionFor(state: { phase: CasePhase; status: CaseStatus }): MemoryAction {
  if (state.phase === "decided" && state.status === "invested") {
    return { kind: "write", decision: "invested" };
  }
  if (state.phase === "decided" && state.status === "closed") {
    return { kind: "write", decision: "closed_without_investment" };
  }
  return { kind: "delete" };
}

/** Fortryd window on the server (5 s in the UI + 2 s) and a margin. */
export const MEMORY_RECONCILE_DELAY_MS = 8_000;

/** One case's entry as the reconcile wants it (the writer embeds the summary). */
export interface MemoryEntryDraft {
  caseId: string;
  companyName: string;
  sector: string | null;
  geography: string | null;
  stage: string | null;
  decision: MemoryDecision;
  /** The day of the decision in the log ("YYYY-MM-DD"); null for a case decided before it. */
  decidedAt: string | null;
  reason: string;
}

export interface MemoryReconcileDeps {
  service: SupabaseClient;
  memoryEnabled: boolean;
  /** The entry's text (memory.ts), compared with the stored one so an unchanged entry stays. */
  summaryOf(entry: MemoryEntryDraft): string;
  write(fundId: string, entry: MemoryEntryDraft): Promise<void>;
}

interface CaseRow {
  id: string;
  phase: CasePhase;
  status: CaseStatus;
  company: { name: string; sector: string | null; geography: string | null; stage: string | null };
}

interface StoredEntry {
  decision: MemoryDecision;
  decidedAt: string | null;
  summary: string;
}

// i18n-keep: part of the memory text the model reads (Brain's prompt data).
const NO_REASON = "Ingen begrundelse angivet.";

async function readCases(
  service: SupabaseClient,
  fundId: string,
  caseIds: string[],
): Promise<CaseRow[] | null> {
  const { data, error } = await service
    .from("cases")
    .select("id, phase, status, companies(name, sector, geography, stage)")
    .eq("fund_id", fundId)
    .in("id", caseIds);
  if (error) {
    console.error(`[decision-memory] cases (fund ${fundId})`, error.message);
    return null;
  }
  return (data ?? []).flatMap((row) => {
    const raw = row["companies"] as unknown;
    const company = (Array.isArray(raw) ? raw[0] : raw) as CaseRow["company"] | null;
    if (!company) return [];
    return [
      {
        id: row["id"] as string,
        phase: row["phase"] as CasePhase,
        status: row["status"] as CaseStatus,
        company,
      },
    ];
  });
}

async function readEntry(
  service: SupabaseClient,
  fundId: string,
  caseId: string,
): Promise<StoredEntry | null | undefined> {
  const { data, error } = await service
    .from("fund_memory_entries")
    .select("decision, decided_at, summary_text")
    .eq("fund_id", fundId)
    .eq("case_id", caseId)
    .limit(1);
  if (error) {
    console.error(`[decision-memory] entry (fund ${fundId}, case ${caseId})`, error.message);
    return undefined;
  }
  const row = (data ?? [])[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    decision: row["decision"] as MemoryDecision,
    decidedAt: (row["decided_at"] as string | null) ?? null,
    summary: row["summary_text"] as string,
  };
}

async function removeEntries(service: SupabaseClient, fundId: string, caseIds: string[]) {
  if (caseIds.length === 0) return;
  const { error } = await service
    .from("fund_memory_entries")
    .delete()
    .eq("fund_id", fundId)
    .in("case_id", caseIds);
  if (error) {
    console.error(
      `[decision-memory] not removed (fund ${fundId}, cases ${caseIds.join(",")})`,
      error.message,
    );
  }
}

/**
 * The decision that put the case in its current status: the newest move to it that is not an
 * undo (after Investeret → Luk → Fortryd that is still the Investeret). Its reasons and note
 * become the entry's reason, its day the entry's date. `logged: false` for a case decided
 * before the log. undefined when the log or the reasons' names can't be read: a guess (raw
 * codes) must never replace a good entry (harden SF2).
 */
async function decisionEvent(
  service: SupabaseClient,
  fundId: string,
  caseId: string,
  status: CaseStatus,
): Promise<{ reason: string; decidedAt: string | null; logged: boolean } | undefined> {
  const { data, error } = await service
    .from("case_transition_events")
    .select("reason_codes, note, occurred_at")
    .eq("fund_id", fundId)
    .eq("case_id", caseId)
    .eq("to_status", status)
    .is("undo_of", null)
    .order("occurred_at", { ascending: false })
    .limit(1);
  if (error) {
    console.error(`[decision-memory] decision (fund ${fundId}, case ${caseId})`, error.message);
    return undefined;
  }
  const event = (data ?? [])[0] as
    { reason_codes: string[] | null; note: string | null; occurred_at: string } | undefined;
  if (!event) return { reason: NO_REASON, decidedAt: null, logged: false };
  const codes = event.reason_codes ?? [];
  const labels = codes.length
    ? await service
        .from("brain_reason_codes")
        .select("code, label")
        .eq("fund_id", fundId)
        .in("code", codes)
    : { data: [], error: null };
  if (labels.error) {
    console.warn(`[decision-memory] reason labels (fund ${fundId})`, labels.error.message);
    return undefined;
  }
  const labelOf = new Map(
    ((labels.data ?? []) as { code: string; label: string }[]).map((row) => [row.code, row.label]),
  );
  return {
    reason:
      [...codes.map((code) => labelOf.get(code) ?? code), event.note?.trim()]
        .filter(Boolean)
        .join(", ") || NO_REASON,
    decidedAt: event.occurred_at.slice(0, 10),
    logged: true,
  };
}

/**
 * Brings the given cases' entries in line with their state now. Removes the entries of cases
 * that are not decided; for decided cases writes the entry only when it would differ from the
 * stored one (an undo round trip keeps the entry, its id and so other cases' matches, harden
 * F2). With the memory switched off nothing is written, but an entry with the wrong outcome
 * is removed (harden F5). Never throws: memory must never block or undo a decision.
 */
export async function reconcileMemoryWith(
  deps: MemoryReconcileDeps,
  fundId: string,
  caseIds: string[],
  depth = 0,
): Promise<void> {
  try {
    const { service } = deps;
    const rows = await readCases(service, fundId, caseIds);
    if (!rows) return;
    // Not decided (any more): no entry. One query for all of them.
    await removeEntries(
      service,
      fundId,
      rows.filter((row) => memoryActionFor(row).kind === "delete").map((row) => row.id),
    );
    for (const row of rows) {
      if (memoryActionFor(row).kind === "delete") continue;
      // Read again right before the write: a bulk write embeds one case at a time.
      const fresh = (await readCases(service, fundId, [row.id]))?.[0];
      if (!fresh) continue;
      const action = memoryActionFor(fresh);
      if (action.kind === "delete") {
        await removeEntries(service, fundId, [fresh.id]);
        continue;
      }
      const stored = await readEntry(service, fundId, fresh.id);
      if (stored === undefined) continue;
      const wrongOutcome = stored !== null && stored.decision !== action.decision;
      if (!deps.memoryEnabled) {
        if (wrongOutcome) await removeEntries(service, fundId, [fresh.id]);
        continue;
      }
      const event = await decisionEvent(service, fundId, fresh.id, fresh.status);
      if (!event) {
        // Better no entry than one with the wrong outcome; the next move tries again.
        if (wrongOutcome) await removeEntries(service, fundId, [fresh.id]);
        continue;
      }
      // Decided before the log: the stored entry knows its reason and day better (harden SF3).
      if (!event.logged && stored !== null && !wrongOutcome) continue;
      const entry: MemoryEntryDraft = {
        caseId: fresh.id,
        companyName: fresh.company.name,
        sector: fresh.company.sector,
        geography: fresh.company.geography,
        stage: fresh.company.stage,
        decision: action.decision,
        decidedAt: event.decidedAt,
        reason: event.reason,
      };
      const unchanged =
        stored !== null &&
        !wrongOutcome &&
        stored.decidedAt === entry.decidedAt &&
        stored.summary === deps.summaryOf(entry);
      if (unchanged) continue;
      // The writer keeps the old entry when the embedding fails; a flipped outcome goes first.
      if (wrongOutcome) await removeEntries(service, fundId, [fresh.id]);
      await deps.write(fundId, entry);
      // Moved while the entry was being written: follow the case again.
      const after = (await readCases(service, fundId, [fresh.id]))?.[0];
      if (after && (after.phase !== fresh.phase || after.status !== fresh.status) && depth < 2) {
        await reconcileMemoryWith(deps, fundId, [fresh.id], depth + 1);
      }
    }
  } catch (cause) {
    console.error(
      `[decision-memory] not reconciled (fund ${fundId})`,
      cause instanceof Error ? cause.message : String(cause),
    );
  }
}
