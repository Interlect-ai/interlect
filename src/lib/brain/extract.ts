/**
 * L1 · Forstå (06 L1), pure helpers: the quote check, batches, entity keys, trust rank and the
 * entity-resolution rules. No I/O here (tested in extract.test.ts); the SQL side is migration
 * 0045 (brain_apply_extraction) and the loop is loops/extract.ts.
 */
import { AI_BUDGETS } from "../analysis/budgets.ts";
import type { EntityType } from "./contracts/extract.ts";
import { normalizeEntityName } from "./keys.ts";

/** 06 L1: at most 0,20 kr. per batch, all model calls of the batch together. */
export const L1_BATCH_CAP_USD = Number((0.2 / AI_BUDGETS.exchangeRateDkkPerUsd).toFixed(4));
/** "Bidder på op til 6 lange eller 12 korte" episodes: a long one counts twice. */
export const LONG_EPISODE_CHARS = 1200;
export const BATCH_UNITS = 12;
/**
 * Text per batch, so one extractor call stays inside the cap: ~12,000 characters of Danish is
 * ~4,500 input tokens ($0.004) plus 4,500 output tokens ($0.020) on gpt-5.4-mini.
 */
export const MAX_BATCH_CHARS = 12_000;
/** Batches per queue message; the rest follow in a continuation message ("+<n>"). */
export const MAX_BATCHES_PER_RUN = 6;
/** No new batch after this long, so a message stays well inside the 300 s function limit. */
export const RUN_BUDGET_MS = 150_000;
/** The per-case L1 lease; renewed before each batch. */
export const CASE_LEASE_SECONDS = 300;

/**
 * 06 L1 step 3: lower case, one space for any whitespace, one kind of quote mark and dash. NFKC
 * first, so "ﬁ" and full-width forms compare equal to what the model copies.
 */
export function normalizeForQuote(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’‚‛′`´]/g, "'")
    .replace(/[“”„‟″«»]/g, '"')
    .replace(/[‐‑‒–—―−]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** The normalised quote must be a substring of the normalised episode (06 L1 step 3). */
export function quoteInEpisode(quote: string, episode: string): boolean {
  const needle = normalizeForQuote(quote);
  // Too short to prove anything ("ja", "2021"): a fact needs a quote that carries it.
  if (needle.length < 4) return false;
  return normalizeForQuote(episode).includes(needle);
}

/**
 * Splits pending episodes into batches of at most 12 units (a long episode is 2 units) and
 * MAX_BATCH_CHARS characters. An episode is never split (its content is at most 8,000).
 */
export function batchEpisodes<T extends { content: string }>(episodes: readonly T[]): T[][] {
  const batches: T[][] = [];
  let current: T[] = [];
  let units = 0;
  let chars = 0;
  for (const episode of episodes) {
    const size = episode.content.length > LONG_EPISODE_CHARS ? 2 : 1;
    const full = units + size > BATCH_UNITS || chars + episode.content.length > MAX_BATCH_CHARS;
    if (full && current.length > 0) {
      batches.push(current);
      current = [];
      units = 0;
      chars = 0;
    }
    current.push(episode);
    units += size;
    chars += episode.content.length;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

/** Official 7 > partner 6 > customer_doc 5 > third_party 4 > analysis 3 > … > public_web 0. */
export const TRUST_RANK: Record<string, number> = {
  official: 7,
  partner: 6,
  customer_doc: 5,
  third_party: 4,
  analysis: 3,
  user_note: 2,
  company_claim: 1,
  public_web: 0,
};

export function trustRank(tier: string): number {
  return TRUST_RANK[tier] ?? -1;
}

/** "https://www.Nordlys.dk/om" -> "nordlys.dk". Null when nothing host-like is left. */
export function normalizeDomain(raw: string): string | null {
  const host = raw
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/^www\./, "")
    .split(/[/?#:\s]/)[0];
  return host && /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : null;
}

/**
 * The entity's normalized_key, the same keys the projection (0042) writes, so rule 1 (same CVR
 * or domain) and an unchanged name find the existing entity:
 *   company / investor / fund_vehicle: cvr:<8 digits> | domain:<host> | name:<normalised>
 *   person: name:<normalised>@<the case company's key> (same company context, 06 L1 rule 2)
 *   sector / geography: <type>:name:<normalised> · stage: stage:<normalised_with_underscores>
 *   metric: metric:<normalised> · market / product / theme: name:<normalised>
 * Null when the name normalises to nothing.
 */
export function entityKey(
  entity: { type: EntityType; name: string; identifiers?: { cvr?: string; domain?: string } },
  companyKey: string,
): string | null {
  const name = normalizeEntityName(entity.name);
  switch (entity.type) {
    case "company":
    case "investor":
    case "fund_vehicle": {
      const cvr = entity.identifiers?.cvr;
      if (cvr && /^\d{8}$/.test(cvr)) return `cvr:${cvr}`;
      const domain = entity.identifiers?.domain ? normalizeDomain(entity.identifiers.domain) : null;
      if (domain) return `domain:${domain}`;
      return name ? `name:${name}` : null;
    }
    case "person":
      return name ? `name:${name}@${companyKey}` : null;
    case "sector":
    case "geography":
      return name ? `${entity.type}:name:${name}` : null;
    case "stage":
      return name ? `stage:${name.replace(/[\s-]+/g, "_")}` : null;
    case "metric":
      return name ? `metric:${name}` : null;
    default:
      return name ? `name:${name}` : null;
  }
}

export type EntityCandidate = {
  id: string;
  name: string;
  normalizedKey: string;
  /** Trigram similarity of the names (0..1); null when the candidate came from the vector list. */
  trigram: number | null;
  /** Cosine similarity of name + context (0..1); null when it came from the name list. */
  cosine: number | null;
};

export type EntityDecision =
  | { kind: "match"; id: string; rule: 1 | 2 | 3 }
  | { kind: "ambiguous"; candidates: EntityCandidate[] }
  | { kind: "new" };

/**
 * 06 L1 step 4, stop at the first match:
 *   1 same key (CVR, domain or the same normalised name in the same context) -> same entity
 *   2 trigram >= 0.85 (persons: only within the case company, i.e. the same "@<key>")
 *   3 cosine >= 0.92
 *   4 trigram 0.60-0.85 or cosine 0.80-0.92 -> the resolver chooses among the top 5
 *   5 otherwise a new entity
 */
export function decideEntity(input: {
  type: EntityType;
  exactId: string | null;
  candidates: readonly EntityCandidate[];
  companyKey: string;
}): EntityDecision {
  if (input.exactId) return { kind: "match", id: input.exactId, rule: 1 };
  const inContext = input.candidates.filter(
    (candidate) =>
      input.type !== "person" || candidate.normalizedKey.endsWith(`@${input.companyKey}`),
  );
  const byTrigram = [...inContext]
    .filter((candidate) => candidate.trigram !== null)
    .sort((a, b) => (b.trigram ?? 0) - (a.trigram ?? 0));
  const byCosine = [...inContext]
    .filter((candidate) => candidate.cosine !== null)
    .sort((a, b) => (b.cosine ?? 0) - (a.cosine ?? 0));
  const bestName = byTrigram[0];
  if (bestName && (bestName.trigram ?? 0) >= 0.85)
    return { kind: "match", id: bestName.id, rule: 2 };
  const bestVector = byCosine[0];
  if (bestVector && (bestVector.cosine ?? 0) >= 0.92) {
    return { kind: "match", id: bestVector.id, rule: 3 };
  }
  const unclear = inContext.filter(
    (candidate) =>
      ((candidate.trigram ?? 0) >= 0.6 && (candidate.trigram ?? 0) < 0.85) ||
      ((candidate.cosine ?? 0) >= 0.8 && (candidate.cosine ?? 0) < 0.92),
  );
  if (unclear.length > 0) {
    const seen = new Set<string>();
    const top = [...unclear]
      .sort(
        (a, b) => Math.max(b.trigram ?? 0, b.cosine ?? 0) - Math.max(a.trigram ?? 0, a.cosine ?? 0),
      )
      .filter((candidate) => (seen.has(candidate.id) ? false : (seen.add(candidate.id), true)))
      .slice(0, 5);
    return { kind: "ambiguous", candidates: top };
  }
  return { kind: "new" };
}

/** Below this the resolver's match is not trusted: a new entity plus a merge_candidate insight. */
export const RESOLVER_MIN_CONFIDENCE = 0.8;
/** A new free-text fact this close to an active one is checked by the resolver (06 L1 step 6). */
export const FREE_TEXT_SIMILARITY = 0.85;

/** L1 continuation key: "<L0 key>+<part>" (the queue key allows "+"). */
export function extractPartKey(baseKey: string, part: number): string {
  return `${baseKey}+${part}`;
}

export function parseExtractPartKey(key: string): { baseKey: string; part: number } {
  const match = /^(.*)\+(\d{1,4})$/.exec(key);
  if (!match) return { baseKey: key, part: 0 };
  return { baseKey: match[1] as string, part: Number(match[2]) };
}

/**
 * Labels the model may still leave in a statement ("K1 oplyser, at …") are replaced by the
 * entity's name, so a fact reads on its own in search and chat. Unknown labels stay as they are.
 */
export function nameLabels(statement: string, names: ReadonlyMap<string, string>): string {
  return statement.replace(/\b(K\d{1,3}|new:\d{1,3})\b/g, (label) => names.get(label) ?? label);
}
