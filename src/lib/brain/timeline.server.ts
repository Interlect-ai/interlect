import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * timeline: the facts about one entity in time order, expired and superseded ones
 * included ("hvordan har Nordlys udviklet sig?"). Proposed and rejected facts are left out.
 * Callers check access.
 */
export type TimelineEntry = {
  factId: string;
  predicate: string;
  statement: string;
  valueNum: number | null;
  valueText: string | null;
  unit: string | null;
  validFrom: string | null;
  validTo: string | null;
  recordedAt: string;
  trustTier: string;
  /** "current", "ended" (valid_to passed), or "replaced" (expired or superseded). */
  state: "current" | "ended" | "replaced";
};

const TIMELINE_LIMIT = 500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function entityTimeline(
  service: SupabaseClient,
  fundId: string,
  entityId: string,
  period: { from?: string | null; to?: string | null } = {},
  now = new Date(),
): Promise<TimelineEntry[]> {
  // The id goes into a PostgREST filter string, so only a uuid is accepted.
  if (!UUID.test(entityId)) throw new Error("timeline: entity id must be a uuid");
  const { data, error } = await service
    .from("brain_facts")
    .select(
      "id, predicate, statement, value_num, value_text, unit, valid_from, valid_to, recorded_at, trust_tier, expired_at, superseded_by",
    )
    .eq("fund_id", fundId)
    .eq("status", "active")
    .or(`subject_id.eq.${entityId},object_id.eq.${entityId}`)
    .order("valid_from", { ascending: true, nullsFirst: false })
    .order("recorded_at", { ascending: true })
    .limit(TIMELINE_LIMIT);
  if (error) throw new Error(`timeline: ${error.message}`);
  const today = now.toISOString().slice(0, 10);
  // A fact overlaps [from, to) when it starts before `to` and ends after `from` (open = no end).
  const inPeriod = (row: Record<string, unknown>) => {
    const validFrom = row["valid_from"] as string | null;
    const validTo = row["valid_to"] as string | null;
    if (period.to && validFrom && validFrom >= period.to) return false;
    if (period.from && validTo && validTo <= period.from) return false;
    return true;
  };
  return (data ?? []).filter(inPeriod).map((row) => {
    const validTo = row["valid_to"] as string | null;
    const replaced = row["expired_at"] !== null || row["superseded_by"] !== null;
    return {
      factId: row["id"] as string,
      predicate: row["predicate"] as string,
      statement: row["statement"] as string,
      valueNum: row["value_num"] === null ? null : Number(row["value_num"]),
      valueText: row["value_text"] as string | null,
      unit: row["unit"] as string | null,
      validFrom: row["valid_from"] as string | null,
      validTo,
      recordedAt: row["recorded_at"] as string,
      trustTier: row["trust_tier"] as string,
      state: replaced ? "replaced" : validTo && validTo <= today ? "ended" : "current",
    };
  });
}
