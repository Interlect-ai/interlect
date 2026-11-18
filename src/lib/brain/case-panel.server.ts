import type { SupabaseClient } from "@supabase/supabase-js";
import { reasonLabel } from "@/lib/cases/reason-label";
import { requestLanguage } from "@/lib/i18n/server-text";
import {
  PANEL_CONTRADICTION_LIMIT,
  PANEL_PRIOR_LIMIT,
  PANEL_SIMILAR_LIMIT,
  contradictionKey,
  panelDecision,
  rankSimilarCases,
  type BrainCasePanel,
  type PanelContradiction,
  type PanelDecision,
  type PanelPriorCase,
} from "./case-panel";

/**
 * Builds the panel "Brain om denne case" from the fund's own rows, with the service
 * client: every query is scoped by `fundId`, and the caller has already checked that the user may
 * see the case. Reads only, no model call and no cost: the similar cases use the case's stored
 * profile vector. A section that fails is an error (the panel shows "kunne ikke hentes"), never
 * an empty list that would read as "nothing to find".
 */
export async function buildCasePanel(
  service: SupabaseClient,
  fundId: string,
  caseId: string,
): Promise<BrainCasePanel> {
  const { data: caseRow, error: caseError } = await service
    .from("cases")
    .select("id, company_id, companies(name)")
    .eq("fund_id", fundId)
    .eq("id", caseId)
    .maybeSingle();
  if (caseError) throw new Error(`panel case: ${caseError.message}`);
  if (!caseRow) throw new Error("panel case: not in this fund");
  const companyId = caseRow["company_id"] as string | null;
  const companies = caseRow["companies"] as { name: string } | { name: string }[] | null;
  const company = (Array.isArray(companies) ? companies[0]?.name : companies?.name) ?? null;

  const [labels, prior, similar, contradictions] = await Promise.all([
    reasonLabels(service, fundId),
    companyId ? priorCases(service, fundId, caseId, companyId) : Promise.resolve([]),
    similarCases(service, fundId, caseId),
    caseContradictions(service, fundId, caseId),
  ]);

  const decisions = await decisionsOf(
    service,
    fundId,
    [...prior.map((row) => row.caseId), ...similar.cases.map((row) => row.caseId)],
    labels,
  );
  return {
    caseId,
    company,
    previouslySeen: prior.map((row) => ({ ...row, decision: decisions.get(row.caseId) ?? null })),
    similar: {
      state: similar.state,
      cases: similar.cases.map((row) => ({ ...row, decision: decisions.get(row.caseId) ?? null })),
    },
    contradictions,
  };
}

async function reasonLabels(service: SupabaseClient, fundId: string) {
  const { data, error } = await service
    .from("brain_reason_codes")
    .select("code, label")
    .eq("fund_id", fundId);
  if (error) throw new Error(`panel reasons: ${error.message}`);
  // A seeded reason in the team's language, a team's own text as stored.
  const language = requestLanguage();
  return new Map(
    (data ?? []).map((row) => [
      row["code"] as string,
      reasonLabel(row["code"] as string, row["label"] as string, language),
    ]),
  );
}

async function priorCases(
  service: SupabaseClient,
  fundId: string,
  caseId: string,
  companyId: string,
): Promise<Array<Omit<PanelPriorCase, "decision">>> {
  const { data, error } = await service
    .from("cases")
    .select("id, phase, status, created_at")
    .eq("fund_id", fundId)
    .eq("company_id", companyId)
    .neq("id", caseId)
    .order("created_at", { ascending: false })
    .limit(PANEL_PRIOR_LIMIT);
  if (error) throw new Error(`panel prior cases: ${error.message}`);
  return (data ?? []).map((row) => ({
    caseId: row["id"] as string,
    createdOn: String(row["created_at"]).slice(0, 10),
    phase: row["phase"] as string,
    status: row["status"] as string,
  }));
}

async function similarCases(service: SupabaseClient, fundId: string, caseId: string) {
  const { data: profile, error } = await service
    .from("brain_entities")
    .select("embedding")
    .eq("fund_id", fundId)
    .eq("ref_table", "cases")
    .eq("ref_id", caseId)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw new Error(`panel profile: ${error.message}`);
  const embedding = (profile?.["embedding"] as string | null) ?? null;
  if (!embedding) return { state: "no_profile" as const, cases: [] };

  const { data: hits, error: searchError } = await service.rpc("brain_search_entities", {
    _fund_id: fundId,
    _query: null,
    _query_embedding: embedding,
    _types: ["case"],
    _limit: PANEL_SIMILAR_LIMIT + 6,
  });
  if (searchError) throw new Error(`panel similar: ${searchError.message}`);
  const ids = ((hits ?? []) as Array<{ entity_id: string }>).map((hit) => hit.entity_id);
  if (ids.length === 0) return { state: "too_few" as const, cases: [] };
  const { data: entities, error: entityError } = await service
    .from("brain_entities")
    .select("id, name, ref_id")
    .eq("fund_id", fundId)
    .eq("status", "active")
    .eq("ref_table", "cases")
    .in("id", ids);
  if (entityError) throw new Error(`panel similar entities: ${entityError.message}`);
  const byEntity = new Map(
    (entities ?? []).map((row) => [
      row["id"] as string,
      { caseId: row["ref_id"] as string, company: row["name"] as string },
    ]),
  );
  const ranked = rankSimilarCases(ids, byEntity, caseId);
  if (ranked.length === 0) return { state: "too_few" as const, cases: [] };
  // The profile entity is named "<company> (case)"; the panel shows the company's own name.
  const { data: named, error: nameError } = await service
    .from("cases")
    .select("id, companies(name)")
    .eq("fund_id", fundId)
    .in(
      "id",
      ranked.map((row) => row.caseId),
    );
  if (nameError) throw new Error(`panel similar names: ${nameError.message}`);
  const names = new Map(
    (named ?? []).map((row) => {
      const company = row["companies"] as { name: string } | { name: string }[] | null;
      return [
        row["id"] as string,
        (Array.isArray(company) ? company[0]?.name : company?.name) ?? null,
      ];
    }),
  );
  const cases = ranked.map((row) => ({ ...row, company: names.get(row.caseId) ?? row.company }));
  return { state: "ok" as const, cases };
}

/** The standing decision per case (brain_case_decisions leaves out undone moves). */
async function decisionsOf(
  service: SupabaseClient,
  fundId: string,
  caseIds: readonly string[],
  labels: ReadonlyMap<string, string>,
): Promise<Map<string, PanelDecision>> {
  const decisions = new Map<string, PanelDecision>();
  if (caseIds.length === 0) return decisions;
  const { data, error } = await service
    .from("brain_case_decisions")
    .select("case_id, decision_kind, decided_at, reason_codes")
    .eq("fund_id", fundId)
    .in("case_id", [...new Set(caseIds)]);
  if (error) throw new Error(`panel decisions: ${error.message}`);
  for (const row of data ?? []) {
    const decision = panelDecision(row, labels);
    if (decision && typeof row["case_id"] === "string") decisions.set(row["case_id"], decision);
  }
  return decisions;
}

/** Evidence the analysis marked contradictory has one open insight (L1); dismissed ones are gone. */
async function caseContradictions(
  service: SupabaseClient,
  fundId: string,
  caseId: string,
): Promise<PanelContradiction[]> {
  const { data: evidence, error } = await service
    .from("evidence_items")
    .select("id")
    .eq("fund_id", fundId)
    .eq("case_id", caseId)
    .eq("status", "contradictory");
  if (error) throw new Error(`panel evidence: ${error.message}`);
  const keys = (evidence ?? []).map((row) => contradictionKey(row["id"] as string));
  if (keys.length === 0) return [];
  const { data: insights, error: insightError } = await service
    .from("brain_insights")
    .select("id, title, status, created_at")
    .eq("fund_id", fundId)
    .eq("kind", "contradiction")
    .in("status", ["new", "seen"])
    .in("dedupe_key", keys)
    .order("created_at", { ascending: false })
    .limit(PANEL_CONTRADICTION_LIMIT);
  if (insightError) throw new Error(`panel contradictions: ${insightError.message}`);
  return (insights ?? []).map((row) => ({
    id: row["id"] as string,
    title: row["title"] as string,
    status: row["status"] as "new" | "seen",
    createdOn: String(row["created_at"]).slice(0, 10),
  }));
}
