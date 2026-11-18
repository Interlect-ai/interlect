/**
 * Brain's search, pure parts: the question type, the merge score and recall@k. No I/O
 * here (tested in retrieval.test.ts); the searches run in retrieval.server.ts.
 */

export const QUESTION_TYPES = [
  "lookup",
  "aggregate",
  "similar",
  "global",
  "temporal",
  "case_advice",
] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

const PATTERNS: Array<[QuestionType, RegExp]> = [
  [
    "aggregate",
    /\b(hvor mange|hvor stor en andel|andel(en)?|fordeling(en)?|hvor ofte|i alt|how many|share of|distribution)\b/i,
  ],
  [
    "temporal",
    /\b(udvikl(et|ing)|siden|over tid|før og nu|tidslinje|hvordan har .* (ændret|udviklet)|over time|since)\b/i,
  ],
  ["similar", /\b(ligner|lignende|minder om|som .* tidligere|similar|resembl)/i],
  [
    "case_advice",
    /\b(bør vi|skal vi spørge|hvad skal vi|hvad mangler|næste skridt|should we ask)\b/i,
  ],
  ["global", /\b(hvad har vi lært|generelt|på tværs|mønstre?|what have we learned|in general)\b/i],
];

/**
 * Step 1 by heuristic: the first pattern that matches, else "lookup". The planned mini
 * call for unclear questions comes with the chat; retrieval treats every type alike
 * except "aggregate", which the chat answers with decision_stats.
 */
export function questionType(question: string): QuestionType {
  for (const [type, pattern] of PATTERNS) if (pattern.test(question)) return type;
  return "lookup";
}

/** Official 1 · partner 0,9 · customer_doc 0,8 · third_party 0,6 · analysis 0,5 · … */
export const TRUST_WEIGHT: Record<string, number> = {
  official: 1,
  partner: 0.9,
  customer_doc: 0.8,
  third_party: 0.6,
  analysis: 0.5,
  user_note: 0.4,
  company_claim: 0.3,
  public_web: 0.2,
};

export type RankingWeights = {
  rrf: number;
  usefulness: number;
  trust: number;
  recency: number;
  distance: number;
};

/** = brain_fund_settings.ranking_weights default (0040). */
export const DEFAULT_RANKING_WEIGHTS: RankingWeights = {
  rrf: 1,
  usefulness: 0.3,
  trust: 0.2,
  recency: 0.1,
  distance: 0.3,
};

/** The fund's weights; a missing or invalid field keeps its default. */
export function parseRankingWeights(raw: unknown): RankingWeights {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out = { ...DEFAULT_RANKING_WEIGHTS };
  for (const key of Object.keys(out) as Array<keyof RankingWeights>) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 10) {
      out[key] = value;
    }
  }
  return out;
}

export const RRF_K = 60;

export type RankedCandidate = {
  key: string;
  /** list name -> 1-based rank in that list */
  ranks: Record<string, number>;
  trustTier: string | null;
  date: Date | null;
  /** Hops from the case or an @-entity: 0 = about it, 1 = one fact away. Null = unrelated. */
  hops: number | null;
  /** Beta(alpha, beta) from brain_usefulness (L4); null = never judged. */
  usefulness: { alpha: number; beta: number } | null;
};

/**
 * Step 4. RRF is scaled by (k + 1), so first place in one list counts 1: with the default
 * weights relevance leads and trust, recency, distance and usefulness break ties (the formula's
 * raw 1/(60 + rank) is ~0.016 and would let trust alone decide the order).
 */
export function mergeScore(candidate: RankedCandidate, weights: RankingWeights, now: Date): number {
  const rrf = Object.values(candidate.ranks).reduce(
    (sum, rank) => sum + (RRF_K + 1) / (RRF_K + rank),
    0,
  );
  const usefulness = candidate.usefulness
    ? logit(candidate.usefulness.alpha / (candidate.usefulness.alpha + candidate.usefulness.beta))
    : 0;
  const trust = candidate.trustTier ? (TRUST_WEIGHT[candidate.trustTier] ?? 0) : 0;
  const ageDays = candidate.date
    ? Math.max(0, (now.getTime() - candidate.date.getTime()) / 86_400_000)
    : null;
  const recency = ageDays === null ? 0 : Math.exp(-ageDays / 365);
  const distance = candidate.hops === null ? 0 : 1 / (1 + candidate.hops);
  return (
    weights.rrf * rrf +
    weights.usefulness * usefulness +
    weights.trust * trust +
    weights.recency * recency +
    weights.distance * distance
  );
}

function logit(p: number): number {
  const clamped = Math.min(0.99, Math.max(0.01, p));
  return Math.log(clamped / (1 - clamped));
}

/** Highest score first; ties by key, so the order is stable. */
export function rankCandidates<T extends RankedCandidate>(
  candidates: readonly T[],
  weights: RankingWeights,
  now: Date,
): Array<T & { score: number }> {
  return candidates
    .map((candidate) => ({ ...candidate, score: mergeScore(candidate, weights, now) }))
    .sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
}

/**
 * Recall@k ("genfinding"): the share of expected refs among the first k results. Null
 * when the item expects nothing (e.g. should_refuse), so it does not count in the average.
 */
export function recallAtK(
  expected: readonly string[],
  retrieved: readonly string[],
  k = 20,
): number | null {
  const wanted = new Set(expected);
  if (wanted.size === 0) return null;
  const top = new Set(retrieved.slice(0, k));
  let found = 0;
  for (const ref of wanted) if (top.has(ref)) found += 1;
  return found / wanted.size;
}

/**
 * The text lists match on any of the question's words (websearch "or"), ranked by how many and
 * how close: websearch_to_tsquery alone requires every word, so a natural question ("Hvad siger
 * fondsrapporten om B2B SaaS?") would find nothing that does not repeat all of it.
 */
export function ftsQuery(question: string): string {
  const words = question
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 3 && !FTS_STOPWORDS.has(word));
  const unique = [...new Set(words)].slice(0, 20);
  return unique.length > 0 ? unique.join(" or ") : question;
}

// i18n-keep: Danish words left out of the search query, not text for people.
const FTS_STOPWORDS = new Set([
  "hvad",
  "hvem",
  "hvor",
  "hvilke",
  "hvilken",
  "hvilket",
  "hvordan",
  "hvorfor",
  "hvornår",
  "der",
  "det",
  "den",
  "de",
  "og",
  "eller",
  "som",
  "med",
  "til",
  "fra",
  "for",
  "har",
  "havde",
  "var",
  "blev",
  "bliver",
  "står",
  "siger",
  "sagt",
  "vores",
  "vi",
  "vil",
  "skal",
  "kan",
  "bør",
  "om",
  "på",
  "af",
  "at",
  "en",
  "et",
  "er",
  "ikke",
  "sig",
  "sin",
  "sit",
  "sine",
  "deres",
  "the",
  "and",
  "what",
  "who",
  "how",
  "why",
  "which",
  "does",
  "did",
  "was",
  "were",
  "are",
  "about",
  "with",
  "from",
  "for",
  "our",
  "that",
  "this",
  "have",
  "has",
]);
