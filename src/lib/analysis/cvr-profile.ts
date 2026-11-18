/**
 * B2b: CVR-stamdata som officiel evidens (branche, virksomhedsform, startdato, status og
 * beliggenhed uden vej og husnummer, der kan være en privat bolig). Gemmes én gang pr.
 * case og CVR-nummer som kilden "CVR (Erhvervsstyrelsen)", så analyserne kan citere dem,
 * og udfylder stiftelsesår og hjemland, når de mangler. Allerede gemte stamdata genbekræftes,
 * hvis de var trukket tilbage, og hentes først igen efter 90 dage (Datafordeleren er langsom);
 * et ændret sæt gemmes som et nyt sæt ved siden af det gamle.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchCvrRegistryProfile, type CvrRegistryProfile } from "./cvr-lookup";

import { serverText } from "../i18n/server-text.ts";
import type { MessageKey, TranslateVars } from "../i18n/translate.ts";

/** Messages to the person, in the page's language or the fund's in a worker. */
function msg(key: string, vars?: TranslateVars) {
  return serverText(`analysisServer.cvrProfile.${key}` as MessageKey, vars);
}

/** The registry parts that could not be fetched ("branche og adresse"), in the same language. */
function partsText(parts: readonly string[]) {
  return parts.map((part) => msg(`parts.${part}`)).join(msg("and"));
}

export const CVR_PROFILE_SOURCE_TYPE = "cvr_stamdata";

function registryUrl(cvrNumber: string) {
  return `https://datacvr.virk.dk/enhed/virksomhed/${cvrNumber}`;
}

// i18n-keep: register data stored as evidence, and compared word for word to see if it changed.
function claimsFor(profile: CvrRegistryProfile): string[] {
  const claims: string[] = [];
  if (profile.industryText) {
    claims.push(
      `Branche i CVR: ${profile.industryCode ? `${profile.industryCode} ` : ""}${profile.industryText}.`,
    );
  }
  if (profile.legalFormText) claims.push(`Virksomhedsform i CVR: ${profile.legalFormText}.`);
  if (profile.startDate) claims.push(`Startdato i CVR: ${profile.startDate}.`);
  claims.push(
    profile.endDate
      ? `Status i CVR: ${profile.status}, ophørt ${profile.endDate}.`
      : `Status i CVR: ${profile.status}.`,
  );
  const location = profile.location;
  if (location && (location.city || location.municipality)) {
    const place = [location.postcode, location.city].filter(Boolean).join(" ");
    claims.push(
      `Beliggenhed i CVR: ${place || location.municipality}${location.municipality && place ? ` (${location.municipality} Kommune)` : ""}.`,
    );
  }
  return claims;
}

/**
 * Gem stamdata for casens CVR. Returnerer en kort dansk note, når noget ikke kunne
 * gemmes (til kørslens trin), ellers null. Kaster aldrig.
 */
export async function storeCvrRegistryProfile(
  service: SupabaseClient,
  input: {
    fundId: string;
    caseId: string;
    companyId: string;
    cvrNumber: string;
    actorId: string | null;
  },
): Promise<string | null> {
  const where = `case ${input.caseId}, CVR ${input.cvrNumber}`;
  try {
    const url = registryUrl(input.cvrNumber);
    const { data: existingRows, error: existingError } = await service
      .from("sources")
      .select("id, entity_match_status, fetched_at, evidence_items(count)")
      .eq("fund_id", input.fundId)
      .eq("case_id", input.caseId)
      .eq("url", url)
      .limit(1);
    if (existingError) throw new Error(msg("sourceNotLookedUp", { reason: existingError.message }));
    const existing = existingRows?.[0];
    const evidenceCount = Number(
      (existing?.["evidence_items"] as Array<{ count: number }> | undefined)?.[0]?.count ?? 0,
    );
    if (existing && evidenceCount > 0) {
      // Allerede gemt: genbekræft kun, hvis et tidligere CVR-skift trak dem tilbage.
      if (existing["entity_match_status"] !== "confirmed") {
        const { error: confirmError } = await service
          .from("sources")
          .update({ entity_match_status: "confirmed", entity_match_confidence: null })
          .eq("id", existing["id"] as string)
          .eq("fund_id", input.fundId);
        if (confirmError)
          throw new Error(msg("sourceNotReconfirmed", { reason: confirmError.message }));
      }
      // Stamdata (fx status ved konkurs) kan ændre sig: hent igen efter 90 dage.
      const fetchedAt = Date.parse((existing["fetched_at"] as string | null) ?? "");
      if (Number.isFinite(fetchedAt) && Date.now() - fetchedAt < REFRESH_AFTER_MS) return null;
      try {
        return await refreshRegistryProfile(service, input, existing["id"] as string);
      } catch (refreshError) {
        console.warn("[cvr-profile] refresh failed", refreshError);
        return msg("refreshFailed");
      }
    }
    const profile = await fetchCvrRegistryProfile(input.cvrNumber);
    if (!profile) return null;
    let sourceId = existing?.["id"] as string | undefined;
    if (!sourceId) {
      const { data: source, error: sourceError } = await service
        .from("sources")
        .insert({
          fund_id: input.fundId,
          case_id: input.caseId,
          url,
          title: `CVR ${input.cvrNumber} (Erhvervsstyrelsen)`,
          source_type: CVR_PROFILE_SOURCE_TYPE,
          entity_match_status: "confirmed",
          fetched_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (sourceError || !source) {
        throw new Error(msg("sourceNotSaved", { reason: sourceError?.message ?? msg("unknown") }));
      }
      sourceId = source["id"] as string;
    }
    const today = new Date().toISOString().slice(0, 10);
    const { error: evidenceError } = await service.from("evidence_items").insert(
      claimsFor(profile).map((claim) => ({
        fund_id: input.fundId,
        case_id: input.caseId,
        source_id: sourceId,
        claim,
        source_date: today,
        observation_date: today,
        stated_by: "Erhvervsstyrelsen (CVR)",
        confidence: 1,
        status: "verified",
        created_by: input.actorId,
      })),
    );
    if (evidenceError) {
      // Ingen forældreløs kilde: næste kørsel skal kunne prøve igen.
      await service.from("sources").delete().eq("id", sourceId).eq("fund_id", input.fundId);
      throw new Error(msg("evidenceNotSaved", { reason: evidenceError.message }));
    }
    await fillCompanyFromRegistry(service, input, profile);
    return profile.missingParts.length
      ? msg("fetchedWithout", { parts: partsText(profile.missingParts) })
      : null;
  } catch (cause) {
    console.error(
      `[cvr-profile] registry data not stored (${where})`,
      cause instanceof Error ? cause.message : cause,
    );
    return msg("notFetched");
  }
}

const REFRESH_AFTER_MS = 90 * 86_400_000;

/**
 * Hent stamdata igen for en eksisterende kilde. Et ændret sæt gemmes som nye rækker (samme
 * collected_at); de gamle bevares, fordi tidligere analyser kan have citeret dem, og kun
 * det nyeste sæt når prompten (evidence-selection.ts).
 */
async function refreshRegistryProfile(
  service: SupabaseClient,
  input: { fundId: string; caseId: string; cvrNumber: string; actorId: string | null },
  sourceId: string,
): Promise<string | null> {
  const profile = await fetchCvrRegistryProfile(input.cvrNumber);
  if (!profile) return null;
  // Et ufuldstændigt svar må ikke erstatte et komplet sæt; de gemte stamdata gælder, og
  // fetched_at røres ikke, så næste kørsel prøver igen.
  if (profile.missingParts.length) {
    return msg("notUpdated", { parts: partsText(profile.missingParts) });
  }
  const claims = claimsFor(profile);
  const { data: rows, error } = await service
    .from("evidence_items")
    .select("claim, collected_at")
    .eq("fund_id", input.fundId)
    .eq("source_id", sourceId)
    .order("collected_at", { ascending: false })
    .limit(40);
  if (error) throw new Error(msg("existingNotRead", { reason: error.message }));
  const latestAt = rows?.[0]?.["collected_at"];
  const latest = new Set(
    (rows ?? [])
      .filter((row) => row["collected_at"] === latestAt)
      .map((row) => String(row["claim"])),
  );
  const changed = latest.size !== claims.length || claims.some((claim) => !latest.has(claim));
  if (changed) {
    const today = new Date().toISOString().slice(0, 10);
    const { error: insertError } = await service.from("evidence_items").insert(
      claims.map((claim) => ({
        fund_id: input.fundId,
        case_id: input.caseId,
        source_id: sourceId,
        claim,
        source_date: today,
        observation_date: today,
        stated_by: "Erhvervsstyrelsen (CVR)",
        confidence: 1,
        status: "verified",
        created_by: input.actorId,
      })),
    );
    if (insertError) throw new Error(msg("newNotSaved", { reason: insertError.message }));
  }
  const { error: touchError } = await service
    .from("sources")
    .update({ fetched_at: new Date().toISOString() })
    .eq("id", sourceId)
    .eq("fund_id", input.fundId);
  if (touchError) console.warn("[cvr-profile] fetched_at not updated", touchError.message);
  return changed ? msg("updated") : null;
}

/** Udfyld kun tomme felter; en menneskelig rettelse eller et tidligere fund vinder. */
async function fillCompanyFromRegistry(
  service: SupabaseClient,
  input: { fundId: string; companyId: string },
  profile: CvrRegistryProfile,
) {
  const { data: company, error } = await service
    .from("companies")
    .select("founded_year, hq_country, profile_source")
    .eq("id", input.companyId)
    .eq("fund_id", input.fundId)
    .maybeSingle();
  if (error || !company) {
    console.warn("[cvr-profile] company not readable for registry fill", error?.message);
    return;
  }
  const update: Record<string, unknown> = {};
  const startYear = profile.startDate ? Number(profile.startDate.slice(0, 4)) : null;
  if (!company["founded_year"] && startYear) update["founded_year"] = startYear;
  if (!company["hq_country"] && profile.location?.countryCode === "DK") {
    update["hq_country"] = "DK";
    update["profile_source"] = {
      ...((company["profile_source"] as Record<string, string> | null) ?? {}),
      hq_country: "cvr",
    };
  }
  if (!Object.keys(update).length) return;
  update["updated_at"] = new Date().toISOString();
  const { error: updateError } = await service
    .from("companies")
    .update(update)
    .eq("id", input.companyId)
    .eq("fund_id", input.fundId);
  if (updateError) console.warn("[cvr-profile] company update failed", updateError.message);
}
