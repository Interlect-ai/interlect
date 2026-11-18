import type { SupabaseClient } from "@supabase/supabase-js";
import type { EvidenceStatus } from "@/lib/domain/types";
import type { ScreeningCaseInput } from "./prompt";

/** Columns every analysis step needs to select and render evidence for a prompt. */
export const PROMPT_EVIDENCE_SELECT =
  "id, claim, status, observation_date, period_start, period_end, excerpt, document_id, collected_at, sources(title, url, source_type, entity_match_status), documents(file_name, kind)";

/** Rows fetched before selection; research can insert well over 100 items per run. */
export const PROMPT_EVIDENCE_FETCH_LIMIT = 400;

export const SCREENING_EVIDENCE_MAX = 100;
export const DEEP_EVIDENCE_MAX = 160;

const PRIMARY_EXCERPT_MAX_CHARS = 2500;
const SECONDARY_EXCERPT_MAX_CHARS = 1500;

type EvidenceTier = "deck" | "file" | "website" | "official" | "other";

// Deck, website and official registers are the case's own and most reliable material,
// so they must never be pushed out by a large batch of newer public research. The case's other
// files (an annual report of 100 pages) have their own slots, so they never push the deck
// out either.
const RESERVED_PER_TIER: Record<Exclude<EvidenceTier, "other">, number> = {
  deck: 40,
  file: 20,
  website: 20,
  official: 25,
};

/** Regnskaber fra et officielt register: dansk CVR og udenlandske registre. */
const REGISTRY_STATEMENT_TYPES = new Set(["cvr_regnskab", "registry_regnskab"]);

const OFFICIAL_SOURCE_TYPES = new Set([
  ...REGISTRY_STATEMENT_TYPES,
  "cvr_stamdata",
  "public_research:official_registry",
  "public_research:official_filing",
  "public_research:regulator",
]);

type EvidenceRow = Record<string, unknown>;

function firstRelation<T>(value: unknown): T | null {
  return ((Array.isArray(value) ? value[0] : value) as T | null | undefined) ?? null;
}

export function evidenceTier(row: EvidenceRow): EvidenceTier {
  if (row["document_id"]) {
    // A row read without its document's kind counts as the deck, as.
    const kind = firstRelation<{ kind?: string | null }>(row["documents"])?.kind;
    return kind && kind !== "pitch_deck" ? "file" : "deck";
  }
  const sourceType = firstRelation<{ source_type: string | null }>(row["sources"])?.source_type;
  if (sourceType === "company_website") return "website";
  if (sourceType && OFFICIAL_SOURCE_TYPES.has(sourceType)) return "official";
  return "other";
}

/**
 * The case's own material, which the prompts keep next to the evidence sheet: the deck,
 * the website, official registers and the founder check. The rest of the public research reaches
 * the prompts through the sheet.
 */
export function isCaseOwnEvidence(row: EvidenceRow): boolean {
  if (evidenceTier(row) !== "other") return true;
  return (
    firstRelation<{ source_type: string | null }>(row["sources"])?.source_type === "founder_check"
  );
}

/** Regnskabsevidens fra et selskab, et menneske har afvist, må ikke nå nye analyser. */
function isRetiredRegistryEvidence(row: EvidenceRow): boolean {
  const source = firstRelation<{ source_type: string | null; entity_match_status: string | null }>(
    row["sources"],
  );
  return (
    (REGISTRY_STATEMENT_TYPES.has(source?.source_type ?? "") ||
      source?.source_type === "cvr_stamdata") &&
    source?.entity_match_status === "unconfirmed"
  );
}

/**
 * Samme regnskabspost for samme periode fra to regnskabsfiler (fx årets eget tal og
 * næste års sammenligningstal) er én oplysning. Rækkerne kommer nyeste først, så den
 * nyeste vinder, og den gamle når ikke prompten som en dublet.
 */
function registryFactKey(row: EvidenceRow): string | null {
  const source = firstRelation<{ source_type: string | null }>(row["sources"]);
  if (!REGISTRY_STATEMENT_TYPES.has(source?.source_type ?? "")) return null;
  const match = /^(.*?):.*for perioden (\S+) til (\S+?)\.?$/.exec(String(row["claim"] ?? ""));
  return match ? `${match[1]}|${match[3]}` : null;
}

/** CVR-stamdata og founder-kontrol: få, faste fakta, som altid skal nå prompten. */
function isRegistryProfile(row: EvidenceRow): boolean {
  const type = firstRelation<{ source_type: string | null }>(row["sources"])?.source_type;
  return type === "cvr_stamdata" || type === "founder_check";
}

/** Kilder, der gemmer et nyt sæt, når noget ændrer sig; kun det nyeste sæt gælder. */
const BATCHED_SOURCE_TYPES = new Set(["founder_check", "cvr_stamdata"]);

function batchedType(row: EvidenceRow): string | null {
  const type = firstRelation<{ source_type: string | null }>(row["sources"])?.source_type ?? null;
  return type && BATCHED_SOURCE_TYPES.has(type) ? type : null;
}

/**
 * Picks the evidence a prompt sees. Rows must arrive newest first. Each primary tier keeps
 * its reserved slots, the remainder is filled newest first from everything else, and
 * unused reserved slots fall through to the next newest rows.
 */
export function selectPromptEvidence(allRows: EvidenceRow[], maxItems: number): EvidenceRow[] {
  const seenRegistryFacts = new Set<string>();
  // Founder-kontrol og CVR-stamdata gemmer et nyt sæt, når noget ændrer sig; kun det
  // nyeste sæt pr. kildetype gælder. Udgåede stamdata (et fravalgt CVR) tæller ikke med, så
  // et genbekræftet CVR's ældre sæt stadig når prompten.
  const latestBatch = new Map<string, string>();
  for (const row of allRows) {
    const type = batchedType(row);
    if (!type || isRetiredRegistryEvidence(row)) continue;
    const at = String(row["collected_at"] ?? "");
    if (at > (latestBatch.get(type) ?? "")) latestBatch.set(type, at);
  }
  // CVR-stamdata (få, faste fakta) først, så mange regnskabslinjer ikke skubber dem ud.
  const ordered = [
    ...allRows.filter(isRegistryProfile),
    ...allRows.filter((row) => !isRegistryProfile(row)),
  ];
  const rows = ordered.filter((row) => {
    if (isRetiredRegistryEvidence(row)) return false;
    const batch = batchedType(row);
    if (batch && String(row["collected_at"] ?? "") !== latestBatch.get(batch)) return false;
    const key = registryFactKey(row);
    if (!key) return true;
    if (seenRegistryFacts.has(key)) return false;
    seenRegistryFacts.add(key);
    return true;
  });
  const reservedUsed: Record<string, number> = { deck: 0, file: 0, website: 0, official: 0 };
  const selected = new Set<EvidenceRow>();
  for (const row of rows) {
    if (selected.size >= maxItems) break;
    const tier = evidenceTier(row);
    if (tier === "other") continue;
    if (reservedUsed[tier]! < RESERVED_PER_TIER[tier]) {
      reservedUsed[tier]! += 1;
      selected.add(row);
    }
  }
  for (const row of rows) {
    if (selected.size >= maxItems) break;
    selected.add(row);
  }
  // Keep the newest-first order the callers and prompts already rely on.
  return rows.filter((row) => selected.has(row));
}

/**
 * The public research's figures the specialists' cards need (market size, customers,
 * growth, technical key figures), kept next to the evidence sheet even when the sheet did not cite
 * them. The sheet is written per criterion of the fund, so a market-size figure the research found
 * (Veo, 15 Oct: USD 820 million in 2025 to 2.37 billion in 2034) never reached the specialist
 * whose card draws it. At most this many, newest first.
 */
export const CARD_FIGURE_EVIDENCE_MAX = 20;

// i18n-keep: patterns matched against evidence text, never shown.
const CARD_TOPIC =
  /market|marked|\bTAM\b|\bSAM\b|CAGR|revenue|omsætning|growth|vækst|customers?|kunder|clubs?|klubber|users?|brugere|subscribers?|countries|lande|employees|medarbejdere|units?|installed|capacity|kapacitet|uptime|latency|accuracy|resolution|patents?|funding|raised|valuation|\bARR\b|\bMRR\b|matches|teams/i;
// Years and dates are not figures: "in 2021" alone does not make a claim a figure.
const YEAR_OR_DATE = /\b(19|20)\d{2}(-\d{2}){0,2}\b/g;

/** Public research evidence that states a figure on one of the cards' topics. */
export function isCardFigureEvidence(row: EvidenceRow): boolean {
  if (evidenceTier(row) !== "other") return false;
  const sourceType = firstRelation<{ source_type: string | null }>(row["sources"])?.source_type;
  if (!sourceType?.startsWith("public_research")) return false;
  const claim = String(row["claim"] ?? "");
  return CARD_TOPIC.test(claim) && /\d/.test(claim.replace(YEAR_OR_DATE, ""));
}

/**
 * The evidence the deep analysis's specialists get: what `besideSheet` kept (the sheet's citations
 * and the case's own material) plus the research's card figures it left out.
 */
export function withCardFigureEvidence<Row extends EvidenceRow>(
  besideSheet: readonly Row[],
  candidates: readonly Row[],
): Row[] {
  const kept = new Set(besideSheet.map((row) => row["id"]));
  const figures = candidates
    .filter((row) => !kept.has(row["id"]) && isCardFigureEvidence(row))
    .slice(0, CARD_FIGURE_EVIDENCE_MAX);
  return [...besideSheet, ...figures];
}

export function toPromptEvidence(row: EvidenceRow): ScreeningCaseInput["evidence"][number] {
  const source = firstRelation<{ title: string; url: string | null }>(row["sources"]);
  const document = firstRelation<{ file_name: string }>(row["documents"]);
  const tier = evidenceTier(row);
  const excerptMax =
    tier === "deck" || tier === "file" || tier === "website"
      ? PRIMARY_EXCERPT_MAX_CHARS
      : SECONDARY_EXCERPT_MAX_CHARS;
  return {
    id: row["id"] as string,
    claim: row["claim"] as string,
    status: row["status"] as EvidenceStatus,
    sourceLabel: source?.title ?? document?.file_name ?? "Manuel intake",
    sourceUrl: source?.url ?? null,
    observationDate: row["observation_date"] as string | null,
    periodStart: row["period_start"] as string | null,
    periodEnd: row["period_end"] as string | null,
    excerpt: (row["excerpt"] as string | null)?.slice(0, excerptMax) ?? null,
  };
}

const RESERVED_SOURCE_TYPES = ["company_website", ...OFFICIAL_SOURCE_TYPES];

function collectedAt(row: EvidenceRow) {
  return String(row["collected_at"] ?? "");
}

/**
 * Loads the candidate rows for selectPromptEvidence. The newest rows alone are not enough:
 * deck and website evidence is the oldest on a case, so on a case with many research runs it
 * would fall outside the newest window. The reserved tiers are therefore fetched on their own
 * and merged in, newest first.
 */
export async function loadPromptEvidenceRows(
  client: SupabaseClient,
  fundId: string,
  caseId: string,
): Promise<{ data: EvidenceRow[] | null; error: unknown }> {
  const base = () =>
    client
      .from("evidence_items")
      .select(PROMPT_EVIDENCE_SELECT)
      .eq("case_id", caseId)
      .eq("fund_id", fundId);
  // CVR-stamdata og founder-kontrol er få faste fakta; de hentes altid med (B2b), hver for
  // sig, så mange founder-sæt ikke skubber stamdata ud.
  const registryRows = (sourceType: string) =>
    client
      .from("evidence_items")
      .select(PROMPT_EVIDENCE_SELECT.replace("sources(", "sources!inner("))
      .eq("case_id", caseId)
      .eq("fund_id", fundId)
      .eq("sources.source_type", sourceType)
      .order("collected_at", { ascending: false })
      .limit(20);
  // The deck and the case's other files each fetch their own slots.
  const caseFiles = () =>
    client
      .from("evidence_items")
      .select(PROMPT_EVIDENCE_SELECT.replace("documents(", "documents!inner("))
      .eq("case_id", caseId)
      .eq("fund_id", fundId);
  const [newest, deck, files, reservedSources, registryProfile, founderCheck] = await Promise.all([
    base().order("collected_at", { ascending: false }).limit(PROMPT_EVIDENCE_FETCH_LIMIT),
    caseFiles()
      .eq("documents.kind", "pitch_deck")
      .order("collected_at", { ascending: false })
      .limit(RESERVED_PER_TIER.deck),
    caseFiles()
      .neq("documents.kind", "pitch_deck")
      .order("collected_at", { ascending: false })
      .limit(RESERVED_PER_TIER.file),
    client
      .from("evidence_items")
      .select(PROMPT_EVIDENCE_SELECT.replace("sources(", "sources!inner("))
      .eq("case_id", caseId)
      .eq("fund_id", fundId)
      .in("sources.source_type", RESERVED_SOURCE_TYPES)
      .order("collected_at", { ascending: false })
      .limit(RESERVED_PER_TIER.website + RESERVED_PER_TIER.official),
    registryRows("cvr_stamdata"),
    registryRows("founder_check"),
  ]);
  const error =
    newest.error ??
    deck.error ??
    files.error ??
    reservedSources.error ??
    registryProfile.error ??
    founderCheck.error;
  if (error) return { data: null, error };
  const byId = new Map<string, EvidenceRow>();
  for (const row of [
    ...((newest.data ?? []) as EvidenceRow[]),
    ...((deck.data ?? []) as unknown as EvidenceRow[]),
    ...((files.data ?? []) as unknown as EvidenceRow[]),
    ...((reservedSources.data ?? []) as unknown as EvidenceRow[]),
    ...((registryProfile.data ?? []) as unknown as EvidenceRow[]),
    ...((founderCheck.data ?? []) as unknown as EvidenceRow[]),
  ]) {
    byId.set(row["id"] as string, row);
  }
  const rows = [...byId.values()].sort((a, b) => collectedAt(b).localeCompare(collectedAt(a)));
  return { data: rows, error: null };
}

/**
 * Loads exactly the evidence an earlier step saved as the run's input. Later phases use this so
 * the prompt, the citable IDs and the stored input_evidence_ids can never drift apart.
 */
export async function loadEvidenceRowsByIds(
  client: SupabaseClient,
  fundId: string,
  caseId: string,
  ids: string[],
): Promise<{ data: EvidenceRow[] | null; error: unknown }> {
  const { data, error } = await client
    .from("evidence_items")
    .select(PROMPT_EVIDENCE_SELECT)
    .eq("case_id", caseId)
    .eq("fund_id", fundId)
    .in("id", ids);
  if (error) return { data: null, error };
  const rows = (data ?? []) as EvidenceRow[];
  if (rows.length !== ids.length) {
    console.warn(
      `Case ${caseId}: ${ids.length - rows.length} af analysens gemte evidenspunkter findes ikke længere.`,
    );
  }
  return {
    data: rows.sort((a, b) => collectedAt(b).localeCompare(collectedAt(a))),
    error: null,
  };
}
