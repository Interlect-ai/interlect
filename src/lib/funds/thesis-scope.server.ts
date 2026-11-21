/**
 * Which thesis a lookup uses (spec).
 *
 * A team can have more than one active thesis, so "the team's active setup" no longer exists:
 *   - everything about a case reads the active version of the case's own thesis;
 *   - the setup pages read the thesis the person chose (its id is sent along);
 *   - team-wide places without a choice (Brain, the AI level, the side rail) read the default thesis.
 * Every query here stays team-scoped (`fund_id`) on top of the thesis, and RLS still applies to the
 * caller's client.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { serverText } from "@/lib/i18n/server-text";
import {
  pickDefaultThesis,
  thesisAllowsNewAnalysis,
  thesisRowFrom,
  type ThesisRow,
} from "@/lib/funds/theses";

const THESIS_COLUMNS = "id, name, status, is_default, created_at, archived_at";

/** All the team's theses (archived included), oldest first. */
export async function loadTheses(supabase: SupabaseClient, fundId: string): Promise<ThesisRow[]> {
  const { data, error } = await supabase
    .from("fund_theses")
    .select(THESIS_COLUMNS)
    .eq("fund_id", fundId)
    .order("created_at", { ascending: true });
  if (error) {
    console.error("[theses] list", error.message);
    throw new Error(serverText("thesisServer.notLoaded"));
  }
  return (data ?? []).map((row) => thesisRowFrom(row as Record<string, unknown>));
}

/** The team's default thesis (see `pickDefaultThesis`), or null when it has none. */
export async function defaultThesis(
  supabase: SupabaseClient,
  fundId: string,
): Promise<ThesisRow | null> {
  return pickDefaultThesis(await loadTheses(supabase, fundId));
}

/**
 * The thesis a setup lookup uses: the named one, when it belongs to the team (any status, so an
 * archived thesis can still be read), else the default. Throws when a named thesis is not the
 * team's, so an id from another team never reads that team's setup.
 */
export async function chosenThesis(
  supabase: SupabaseClient,
  fundId: string,
  thesisId: string | null | undefined,
): Promise<ThesisRow | null> {
  if (!thesisId) return defaultThesis(supabase, fundId);
  const { data, error } = await supabase
    .from("fund_theses")
    .select(THESIS_COLUMNS)
    .eq("fund_id", fundId)
    .eq("id", thesisId)
    .maybeSingle();
  if (error) {
    console.error("[theses] chosen", error.message);
    throw new Error(serverText("thesisServer.notLoaded"));
  }
  if (!data) throw new Error(serverText("thesisServer.notFound"));
  return thesisRowFrom(data as Record<string, unknown>);
}

/** The case's thesis, or null when the case is not in the team (or not visible to the caller). */
export async function caseThesis(
  supabase: SupabaseClient,
  fundId: string,
  caseId: string,
): Promise<ThesisRow | null> {
  const { data: caseRow, error: caseError } = await supabase
    .from("cases")
    .select("thesis_id")
    .eq("fund_id", fundId)
    .eq("id", caseId)
    .maybeSingle();
  if (caseError) {
    console.error("[theses] case", caseError.message);
    throw new Error(serverText("thesisServer.notLoaded"));
  }
  const thesisId = caseRow?.["thesis_id"] as string | undefined;
  if (!thesisId) return null;
  return chosenThesis(supabase, fundId, thesisId);
}

/**
 * The case's thesis for work on the case. `forNewAnalysis`: a screening, deep analysis or
 * re-screening needs a thesis that is not archived (§3), else the person is told to reactivate it.
 */
export async function requireCaseThesis(
  supabase: SupabaseClient,
  fundId: string,
  caseId: string,
  options: { forNewAnalysis?: boolean } = {},
): Promise<ThesisRow> {
  const thesis = await caseThesis(supabase, fundId, caseId);
  if (!thesis) throw new Error(serverText("thesisServer.caseThesisMissing"));
  if (options.forNewAnalysis && !thesisAllowsNewAnalysis(thesis.status)) {
    throw new Error(serverText("thesisServer.archivedNoAnalysis", { name: thesis.name }));
  }
  return thesis;
}
