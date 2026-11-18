/**
 * B5: kør founder-kontrollen (founder-check.ts) for casen og gem resultatet som evidens
 * under en intern kilde ("Interlects founder-kontrol"), så FMF-kriteriet kan citere den.
 * Evidens slettes aldrig (tidligere analyser citerer den); hver ændring gemmes som et nyt
 * sæt rækker, og kun det nyeste sæt når prompten (evidence-selection.ts). Kaster aldrig;
 * fejl logges og giver en note, som vises på kørslens CVR-trin.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { checkFounders, founderClaim, FOUNDER_CLAIM_PREFIX } from "./founder-check";
import type { FounderCheckResult } from "./founder-check";

import { serverText } from "../i18n/server-text.ts";
import type { MessageKey, TranslateVars } from "../i18n/translate.ts";

/** Messages to the person, in the page's language or the fund's in a worker. */
function msg(key: string, vars?: TranslateVars) {
  return serverText(`analysisServer.founders.${key}` as MessageKey, vars);
}

export const FOUNDER_CHECK_SOURCE_TYPE = "founder_check";
const MAX_ROWS = 400;
// i18n-keep: evidence text, recognised by its prefix like the other founder claims.
const NO_FOUNDERS_CLAIM = `${FOUNDER_CLAIM_PREFIX}ingen founders er oplyst i casens materiale, så ingen er kontrolleret.`;

const EVIDENCE_STATUS: Record<FounderCheckResult["status"], string> = {
  corroborated: "corroborated",
  company_stated: "company_stated",
  claimed: "unknown",
};

const CONFIDENCE: Record<FounderCheckResult["status"], number> = {
  corroborated: 0.8,
  company_stated: 0.5,
  claimed: 0.2,
};

function hostOf(value: string): string | null {
  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`);
    return url.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Samme site som selskabet selv (fx blog.selskab.dk mod selskab.dk)? */
function isCompanyHost(host: string, companyHosts: string[]): boolean {
  return companyHosts.some(
    (own) => host === own || host.endsWith(`.${own}`) || own.endsWith(`.${host}`),
  );
}

function sourceOf(row: Record<string, unknown>) {
  const raw = row["sources"] as unknown;
  return (Array.isArray(raw) ? raw[0] : raw) as {
    source_type: string | null;
    url: string | null;
  } | null;
}

export async function storeFounderChecks(
  service: SupabaseClient,
  input: {
    fundId: string;
    caseId: string;
    founders: Array<{ name: string; role: string }>;
    /** Sand, når casens materiale er læst (udtræk ok eller genbrugt); en tom liste betyder da "ingen oplyst". */
    materialRead: boolean;
    /** Ekstra navne og domæner fra udtrækket og researchen. */
    extraNames: string[];
    extraDomains: string[];
    actorId: string | null;
  },
): Promise<{ results: FounderCheckResult[]; note: string | null }> {
  // Uden founders og uden læst materiale ved vi intet nyt; det seneste resultat står.
  if (!input.founders.length && !input.materialRead) return { results: [], note: null };
  try {
    const { data: caseRow, error: caseError } = await service
      .from("cases")
      .select("companies(name, legal_name, website, domains)")
      .eq("id", input.caseId)
      .eq("fund_id", input.fundId)
      .single();
    if (caseError || !caseRow) throw new Error(caseError?.message ?? msg("caseNotRead"));
    const rawCompany = caseRow["companies"] as unknown;
    const company = (Array.isArray(rawCompany) ? rawCompany[0] : rawCompany) as {
      name: string;
      legal_name: string | null;
      website: string | null;
      domains: string[] | null;
    } | null;
    const companyNames = [company?.name, company?.legal_name, ...input.extraNames].filter(
      (name): name is string => Boolean(name?.trim()),
    );
    const companyHosts = [company?.website, ...(company?.domains ?? []), ...input.extraDomains]
      .map((value) => (value ? hostOf(value) : null))
      .filter((host): host is string => Boolean(host));

    let results: FounderCheckResult[] = [];
    if (input.founders.length) {
      const [website, publicRows] = await Promise.all([
        service
          .from("evidence_items")
          .select("claim, excerpt, sources!inner(source_type)")
          .eq("fund_id", input.fundId)
          .eq("case_id", input.caseId)
          .eq("sources.source_type", "company_website")
          .order("collected_at", { ascending: false })
          .limit(MAX_ROWS),
        // Kun uafhængige kilder om det bekræftede selskab, og kun kildens egen tekst,
        // så AI'ens egne sætninger aldrig bekræfter sig selv.
        service
          .from("evidence_items")
          .select("excerpt, sources!inner(source_type, url, entity_match_status)")
          .eq("fund_id", input.fundId)
          .eq("case_id", input.caseId)
          .like("sources.source_type", "public_research:%")
          .neq("sources.source_type", "public_research:company")
          .eq("sources.entity_match_status", "confirmed")
          .not("excerpt", "is", null)
          .order("collected_at", { ascending: false })
          .limit(MAX_ROWS),
      ]);
      if (website.error || publicRows.error) {
        throw new Error(website.error?.message ?? publicRows.error?.message ?? "ukendt fejl");
      }
      const websiteText = (website.data ?? [])
        .map((row) => `${row["claim"] ?? ""}. ${row["excerpt"] ?? ""}`)
        .join("\n");
      const publicSources = (publicRows.data ?? []).flatMap((row) => {
        const url = sourceOf(row)?.url;
        const host = url ? hostOf(url) : null;
        if (!url || !host || isCompanyHost(host, companyHosts)) return [];
        return [{ url, text: String(row["excerpt"] ?? "") }];
      });
      results = checkFounders({
        founders: input.founders,
        websiteText,
        publicSources,
        companyNames,
      });
    }

    const rows = results.length
      ? results.map((result) => ({
          claim: founderClaim(result),
          status: EVIDENCE_STATUS[result.status],
          confidence: CONFIDENCE[result.status],
        }))
      : [{ claim: NO_FOUNDERS_CLAIM, status: "unknown", confidence: null }];

    // Uændret siden sidst: intet nyt sæt. Nyeste sæt = rækker med samme collected_at.
    const { data: previous, error: previousError } = await service
      .from("evidence_items")
      .select("claim, collected_at, sources!inner(source_type)")
      .eq("fund_id", input.fundId)
      .eq("case_id", input.caseId)
      .eq("sources.source_type", FOUNDER_CHECK_SOURCE_TYPE)
      .order("collected_at", { ascending: false })
      .limit(50);
    if (previousError) throw new Error(previousError.message);
    const latestAt = previous?.[0]?.["collected_at"];
    const latestClaims = new Set(
      (previous ?? [])
        .filter((row) => row["collected_at"] === latestAt)
        .map((row) => String(row["claim"])),
    );
    const unchanged =
      latestClaims.size === rows.length && rows.every((row) => latestClaims.has(row.claim));
    if (unchanged) return { results, note: null };

    // Én intern kilde pr. case; den ældste bruges, hvis to kørsler har oprettet hver sin.
    const { data: existing, error: existingError } = await service
      .from("sources")
      .select("id")
      .eq("fund_id", input.fundId)
      .eq("case_id", input.caseId)
      .eq("source_type", FOUNDER_CHECK_SOURCE_TYPE)
      .order("created_at", { ascending: true })
      .limit(1);
    if (existingError) throw new Error(existingError.message);
    let sourceId = existing?.[0]?.["id"] as string | undefined;
    if (!sourceId) {
      const { data: source, error: sourceError } = await service
        .from("sources")
        .insert({
          fund_id: input.fundId,
          case_id: input.caseId,
          url: null,
          title: "Interlects founder-kontrol",
          source_type: FOUNDER_CHECK_SOURCE_TYPE,
          fetched_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (sourceError || !source) throw new Error(sourceError?.message ?? msg("sourceNotCreated"));
      sourceId = source["id"] as string;
    }
    const today = new Date().toISOString().slice(0, 10);
    // Ét insert, så hele sættet får samme collected_at (transaktionens now()).
    const { error: insertError } = await service.from("evidence_items").insert(
      rows.map((row) => ({
        fund_id: input.fundId,
        case_id: input.caseId,
        source_id: sourceId,
        claim: row.claim,
        observation_date: today,
        // i18n-keep: the evidence's source, stored like the other "stated by" values.
        stated_by: "Interlect (kontrol mod selskabets website og uafhængige offentlige kilder)",
        confidence: row.confidence,
        status: row.status,
        created_by: input.actorId,
      })),
    );
    if (insertError) throw new Error(insertError.message);
    return { results, note: null };
  } catch (cause) {
    console.error(
      `[founder-verification] not stored (fund ${input.fundId}, case ${input.caseId})`,
      cause instanceof Error ? cause.message : cause,
    );
    return { results: [], note: msg("checkFailed") };
  }
}
