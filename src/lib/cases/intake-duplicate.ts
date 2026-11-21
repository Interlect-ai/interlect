/**
 * Duplicate check for Opret case, in one fund (one thesis). The RPC `create_manual_case_for_fund` is
 * idempotent (it returns the existing case without a message) and only knows the website's
 * domain, else the name; the UI needs a friendly message, so the check is made first, with the
 * same two rules PLUS the CVR number when a human chose a registered company (a company
 * written under another trade name is still the same company). Read-only; RLS-scoped client.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Language } from "../i18n/language.ts";
import { translate } from "../i18n/translate.ts";

export interface DuplicateInput {
  fundId: string;
  companyName: string;
  /** Normalised domain (as the RPC), or null. */
  domain: string | null;
  /** The CVR a human chose, or null. */
  cvrNumber: string | null;
  /**
   * The thesis the new case would belong to: the same company under another thesis is a
   * separate case (beslutningslog 28. sep), so only a case under this thesis is a duplicate.
   */
  thesisId?: string;
}

export interface DuplicateHit {
  caseId: string;
  companyName: string;
}

/** The same normalisation as the RPC (create_manual_case_for_fund, 0007). */
export function domainOfWebsite(website: string): string | null {
  const domain = website
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(www\.)?|\/.*$/g, "");
  return domain || null;
}

export async function lookupExistingCase(
  client: SupabaseClient,
  input: DuplicateInput,
  language: Language = "da",
): Promise<DuplicateHit | null> {
  const rules: Array<{ column: "cvr_number" | "domain" | "name"; value: string; like?: boolean }> =
    [];
  if (input.cvrNumber) rules.push({ column: "cvr_number", value: input.cvrNumber });
  if (input.domain) rules.push({ column: "domain", value: input.domain });
  else rules.push({ column: "name", value: input.companyName, like: true });

  for (const rule of rules) {
    let query = client.from("companies").select("id, name").eq("fund_id", input.fundId);
    query = rule.like
      ? query.ilike(rule.column, rule.value.replace(/[%_\\]/g, "\\$&"))
      : query.eq(rule.column, rule.value);
    const { data: companies, error } = await query.limit(1);
    if (error) throw new Error(translate(language, "intake.duplicateCheck.failed"));
    const company = companies?.[0];
    if (!company) continue;
    let caseQuery = client
      .from("cases")
      .select("id")
      .eq("fund_id", input.fundId)
      .eq("company_id", company["id"] as string);
    if (input.thesisId) caseQuery = caseQuery.eq("thesis_id", input.thesisId);
    const { data: found, error: caseError } = await caseQuery.limit(1);
    if (caseError) throw new Error(translate(language, "intake.duplicateCheck.failed"));
    const existing = found?.[0];
    if (existing) {
      return { caseId: existing["id"] as string, companyName: company["name"] as string };
    }
  }
  return null;
}
