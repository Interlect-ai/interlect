/**
 * L1 contracts (06 L1 step 2). The model never sees uuids: episodes are "E1".."En", known
 * entities "K1".."Kn" and new entities "new:1".."new:n". parseExtraction maps the labels back,
 * validates every field and runs the quote check in code, so only facts that are backed by the
 * exact words of their own episode reach the database. Pure (tested in extract.test.ts).
 */
import { z } from "zod";
import { placeholderPattern, type Redactor } from "../../ai/redact.ts";
import { quoteInEpisode } from "../extract.ts";

/** = brain_entities.type. */
export const ENTITY_TYPES = [
  "company",
  "person",
  "case",
  "sector",
  "geography",
  "stage",
  "investor",
  "fund_vehicle",
  "market",
  "product",
  "theme",
  "metric",
  "reason",
] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];
/** Cases come from the projection and reasons from the reason catalogue; L1 never creates them. */
export const EXTRACTABLE_ENTITY_TYPES = ENTITY_TYPES.filter(
  (type) => type !== "case" && type !== "reason",
);

/** = brain_facts.predicate. The list only grows through a migration. */
export const PREDICATES = [
  "has_case",
  "founded_by",
  "works_at",
  "board_member_of",
  "in_sector",
  "in_geography",
  "at_stage",
  "decided",
  "because_of",
  "competes_with",
  "operates_in_market",
  "sells_product",
  "partner_of",
  "customer_of",
  "raised_round",
  "invested_in",
  "co_invested_with",
  "valued_at",
  "metric",
  "has_role",
  "previously_at",
  "educated_at",
  "has_risk",
  "has_strength",
  "has_weakness",
  "claims",
  "similar_to",
  "outcome",
  "part_of_theme",
] as const;
export type Predicate = (typeof PREDICATES)[number];
/** Derived by the projection (has_case) or by later loops (similar_to L4, outcome L3, themes L5). */
export const EXTRACTABLE_PREDICATES = PREDICATES.filter(
  (predicate) => !["has_case", "similar_to", "outcome", "part_of_theme"].includes(predicate),
);

/** Facts without a structured value; a new one is compared to similar ones by the resolver. */
export const FREE_TEXT_PREDICATES: readonly Predicate[] = [
  "claims",
  "has_risk",
  "has_strength",
  "has_weakness",
];

/** Per batch; the prompt asks for the most important first, so a cut never loses the core. */
export const MAX_ENTITIES = 30;
export const MAX_FACTS = 25;

const nullableString = { anyOf: [{ type: "string" }, { type: "null" }] } as const;

/** JSON schema for the model (strict structured output: every field required, null = none). */
export const extractorJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    entities: {
      type: "array",
      maxItems: MAX_ENTITIES,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          ref: { type: "string" },
          type: { type: "string", enum: EXTRACTABLE_ENTITY_TYPES },
          name: { type: "string" },
          cvr: nullableString,
          domain: nullableString,
          linkedin: nullableString,
        },
        required: ["ref", "type", "name", "cvr", "domain", "linkedin"],
      },
    },
    facts: {
      type: "array",
      maxItems: MAX_FACTS,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          episode: { type: "string" },
          subject: { type: "string" },
          predicate: { type: "string", enum: EXTRACTABLE_PREDICATES },
          object: nullableString,
          valueText: nullableString,
          valueNum: { anyOf: [{ type: "number" }, { type: "null" }] },
          unit: nullableString,
          validFrom: nullableString,
          validTo: nullableString,
          statement: { type: "string" },
          quote: { type: "string" },
          confidence: { type: "number" },
        },
        required: [
          "episode",
          "subject",
          "predicate",
          "object",
          "valueText",
          "valueNum",
          "unit",
          "validFrom",
          "validTo",
          "statement",
          "quote",
          "confidence",
        ],
      },
    },
    aiInstructions: {
      type: "array",
      maxItems: 30,
      items: { type: "string" },
    },
  },
  required: ["entities", "facts", "aiInstructions"],
} as const;

/**
 * The episodes the extractor says contain text aimed at an AI: known labels only, each
 * once. A missing or malformed list is no flag, never a broken answer.
 */
export function parseInstructionEpisodes(raw: unknown, labels: ReadonlySet<string>): string[] {
  const list = (raw as { aiInstructions?: unknown } | null)?.aiInstructions;
  if (!Array.isArray(list)) return [];
  return [
    ...new Set(
      list.filter((label): label is string => typeof label === "string" && labels.has(label)),
    ),
  ];
}

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  });

const rawEntity = z.object({
  ref: z.string().min(1).max(40),
  type: z.enum(EXTRACTABLE_ENTITY_TYPES as [EntityType, ...EntityType[]]),
  name: z.string().trim().min(1).max(200),
  cvr: z.string().nullable(),
  domain: z.string().nullable(),
  linkedin: z.string().nullable(),
});

const rawFact = z.object({
  episode: z.string().min(1).max(10),
  subject: z.string().min(1).max(40),
  predicate: z.enum(EXTRACTABLE_PREDICATES as [Predicate, ...Predicate[]]),
  object: z.string().min(1).max(40).nullable(),
  valueText: z.string().trim().max(200).nullable(),
  valueNum: z.number().finite().nullable(),
  unit: z.string().trim().max(20).nullable(),
  validFrom: isoDate.nullable(),
  validTo: isoDate.nullable(),
  statement: z.string().trim().min(1).max(300),
  quote: z.string().trim().min(1).max(400),
  confidence: z.number().min(0).max(1),
});

export type ExtractedEntity = {
  ref: string;
  type: EntityType;
  name: string;
  identifiers: { cvr?: string; domain?: string; linkedin?: string };
};

export type ExtractedFact = {
  episodeId: string;
  subject: string;
  predicate: Predicate;
  object: string | null;
  valueText: string | null;
  valueNum: number | null;
  unit: string | null;
  validFrom: string | null;
  validTo: string | null;
  statement: string;
  quote: string;
  confidence: number;
};

export type ExtractRejection =
  | "invalid_shape"
  | "entity_invalid"
  | "fact_invalid"
  | "unknown_episode"
  | "unknown_ref"
  | "quote_not_in_episode"
  | "quote_too_long"
  | "period_reversed";

/** A structural rejection of a fact: a sign of a broken answer, not of an empty episode. */
export const STRUCTURAL_FACT_REJECTIONS: readonly ExtractRejection[] = [
  "fact_invalid",
  "quote_too_long",
  "unknown_episode",
  "unknown_ref",
];

export type ParsedExtraction = {
  /** False when the answer was not {entities, facts} at all. */
  shapeOk: boolean;
  /** Known entities (K1, K2 …) the model listed again; harmless, not a rejection. */
  knownRepeated: number;
  /** Facts kept after a small repair (percent confidence, year/month date, long text). */
  repaired: number;
  entities: ExtractedEntity[];
  facts: ExtractedFact[];
  rejected: Partial<Record<ExtractRejection, number>>;
};

/**
 * Maps labels back to ids and keeps only valid facts: a known episode, refs that exist, a
 * period that runs forward and a quote that is a substring of its own episode (06 L1 step 3).
 */
export function parseExtraction(
  raw: unknown,
  context: {
    /** "E1" -> { id, content } */
    episodes: ReadonlyMap<string, { id: string; content: string }>;
    /** "K1" -> entity id */
    known: ReadonlyMap<string, string>;
  },
): ParsedExtraction {
  const rejected: ParsedExtraction["rejected"] = {};
  const reject = (reason: ExtractRejection) => {
    rejected[reason] = (rejected[reason] ?? 0) + 1;
  };
  const root = z
    .object({ entities: z.array(z.unknown()), facts: z.array(z.unknown()) })
    .safeParse(raw);
  if (!root.success) {
    return {
      shapeOk: false,
      knownRepeated: 0,
      repaired: 0,
      entities: [],
      facts: [],
      rejected: { invalid_shape: 1 },
    };
  }

  const entities: ExtractedEntity[] = [];
  const newRefs = new Set<string>();
  let knownRepeated = 0;
  for (const item of root.data.entities.slice(0, MAX_ENTITIES)) {
    const parsed = rawEntity.safeParse(item);
    // A known entity listed again under its K label: nothing to declare (it is already known).
    if (parsed.success && context.known.has(parsed.data.ref)) {
      knownRepeated += 1;
      continue;
    }
    // Only "new:<n>" declares an entity; a known one is referenced by its K label.
    if (!parsed.success || !/^new:\d{1,3}$/.test(parsed.data.ref) || newRefs.has(parsed.data.ref)) {
      reject("entity_invalid");
      continue;
    }
    const { ref, type, name, cvr, domain, linkedin } = parsed.data;
    newRefs.add(ref);
    entities.push({
      ref,
      type,
      name,
      identifiers: {
        ...(cvr && /^\d{8}$/.test(cvr.replace(/\s/g, "")) ? { cvr: cvr.replace(/\s/g, "") } : {}),
        ...(domain && domain.trim() ? { domain: domain.trim() } : {}),
        ...(linkedin && linkedin.trim() ? { linkedin: linkedin.trim() } : {}),
      },
    });
  }

  const refExists = (ref: string) => newRefs.has(ref) || context.known.has(ref);
  const facts: ExtractedFact[] = [];
  let repaired = 0;
  for (const item of root.data.facts.slice(0, MAX_FACTS)) {
    // The quote is the proof and is never shortened: only the whole quote can prove a fact.
    const rawQuote =
      item && typeof item === "object" ? (item as Record<string, unknown>)["quote"] : null;
    if (typeof rawQuote === "string" && rawQuote.trim().length > 400) {
      reject("quote_too_long");
      continue;
    }
    const lenient = lenientFact(item);
    const parsed = rawFact.safeParse(lenient.fact);
    if (!parsed.success) {
      reject("fact_invalid");
      continue;
    }
    const fact = parsed.data;
    const episode = context.episodes.get(fact.episode);
    if (!episode) {
      reject("unknown_episode");
      continue;
    }
    if (!refExists(fact.subject) || (fact.object !== null && !refExists(fact.object))) {
      reject("unknown_ref");
      continue;
    }
    if (fact.validFrom && fact.validTo && fact.validTo < fact.validFrom) {
      reject("period_reversed");
      continue;
    }
    if (!quoteInEpisode(fact.quote, episode.content)) {
      reject("quote_not_in_episode");
      continue;
    }
    if (lenient.repaired) repaired += 1;
    facts.push({
      episodeId: episode.id,
      subject: fact.subject,
      predicate: fact.predicate,
      object: fact.object,
      valueText: fact.valueText || null,
      valueNum: fact.valueNum,
      unit: fact.unit || null,
      validFrom: fact.validFrom,
      validTo: fact.validTo,
      statement: fact.statement,
      quote: fact.quote,
      confidence: fact.confidence,
    });
  }
  return { shapeOk: true, knownRepeated, repaired, entities, facts, rejected };
}

/**
 * The words each placeholder stands for in one episode, found by laying the masked episode over
 * the original (the text between placeholders is the same in both). One placeholder can stand
 * for several surfaces ("Peter Holm", "Holm, Peter"). Null when the two cannot be laid over each
 * other, e.g. two placeholders side by side.
 */
function surfacesIn(original: string, masked: string): Map<string, Set<string>> | null {
  const found = new Map<string, Set<string>>();
  const marks = [...masked.matchAll(placeholderPattern())];
  let pos = 0;
  let from = 0;
  for (const [index, mark] of marks.entries()) {
    const literal = masked.slice(from, mark.index);
    if (!original.startsWith(literal, pos)) return null;
    pos += literal.length;
    from = mark.index + mark[0].length;
    const nextMark = marks[index + 1];
    const next = masked.slice(from, nextMark ? nextMark.index : masked.length);
    let end: number;
    if (!nextMark) end = original.length - next.length;
    else if (next) end = original.indexOf(next, pos + 1);
    else return null;
    if (end <= pos) return null;
    const key = mark[0].toLowerCase();
    found.set(key, (found.get(key) ?? new Set()).add(original.slice(pos, end)));
    pos = end;
  }
  return original.slice(pos) === masked.slice(from) ? found : null;
}

/**
 * A masked quote in the episode's own words: each placeholder becomes what it stands for in that
 * episode, and the result must pass the quote check against the original. Null when no reading
 * does, so a quote is never stored in other words than its episode's.
 */
function quoteInOwnWords(
  maskedQuote: string,
  episode: { original: string; masked: string },
  redactor: Pick<Redactor, "restore">,
): string | null {
  const keys = [
    ...new Set((maskedQuote.match(placeholderPattern()) ?? []).map((p) => p.toLowerCase())),
  ];
  const surfaces = keys.length > 0 ? surfacesIn(episode.original, episode.masked) : null;
  let readings: string[][] = [[]];
  for (const key of keys) {
    const options = new Set([...(surfaces?.get(key) ?? []), redactor.restore(key)]);
    options.delete(key);
    readings = readings.flatMap((reading) => [...options].map((o) => [...reading, o])).slice(0, 32);
  }
  for (const reading of readings) {
    const quote = maskedQuote.replace(
      placeholderPattern(),
      (p) => reading[keys.indexOf(p.toLowerCase())] ?? p,
    );
    if (quoteInEpisode(quote, episode.original)) return quote;
  }
  return null;
}

/**
 * The quote check on masked text (point 3): the model read the episodes masked
 * ("[Person 1]") and quotes them masked, so each quote is checked against its masked episode
 * first. Then the facts and entities get their real names back, and each quote the exact words
 * of its own episode. A quote is never accepted because the masking changed the text, and an
 * entity whose name is still a placeholder (one the model made up) is dropped with its facts.
 */
export function parseMaskedExtraction(
  raw: unknown,
  context: Parameters<typeof parseExtraction>[1],
  redactor: Pick<Redactor, "redactAll" | "restoreJson" | "restore">,
): ParsedExtraction {
  const labels = [...context.episodes.keys()];
  const originals = labels.map((label) => context.episodes.get(label)!);
  const masked = redactor.redactAll(originals.map((episode) => episode.content));
  const byId = new Map(
    originals.map((episode, index) => [
      episode.id,
      { original: episode.content, masked: masked[index] ?? "" },
    ]),
  );
  const parsed = parseExtraction(raw, {
    episodes: new Map(
      labels.map((label, index) => [
        label,
        { id: originals[index]!.id, content: masked[index] ?? "" },
      ]),
    ),
    known: context.known,
  });
  const restored = redactor.restoreJson(parsed);
  const rejected = { ...parsed.rejected };
  const reject = (reason: ExtractRejection) => {
    rejected[reason] = (rejected[reason] ?? 0) + 1;
  };
  const invented = new Set(
    restored.entities
      .filter((entity) => placeholderPattern().test(entity.name))
      .map((entity) => entity.ref),
  );
  for (let i = 0; i < invented.size; i += 1) reject("entity_invalid");
  const facts: ExtractedFact[] = [];
  for (const [index, fact] of restored.facts.entries()) {
    if (invented.has(fact.subject) || (fact.object !== null && invented.has(fact.object))) {
      reject("unknown_ref");
      continue;
    }
    const episode = byId.get(fact.episodeId);
    const quote = episode && quoteInOwnWords(parsed.facts[index]!.quote, episode, redactor);
    if (!quote) {
      reject("quote_not_in_episode");
      continue;
    }
    if (quote.trim().length > 400) {
      reject("quote_too_long");
      continue;
    }
    facts.push({ ...fact, quote });
  }
  return {
    ...restored,
    entities: restored.entities.filter((entity) => !invented.has(entity.ref)),
    facts,
    rejected,
  };
}

/**
 * Small, safe repairs before validation, so a usable fact is not lost on form: a confidence
 * given in percent, a year or month instead of a date, and a statement, value or unit over the
 * limit. Never the quote (see parseExtraction).
 */
function lenientFact(item: unknown): { fact: unknown; repaired: boolean } {
  if (!item || typeof item !== "object") return { fact: item, repaired: false };
  const original = item as Record<string, unknown>;
  const fact = { ...original };
  if (
    typeof fact["confidence"] === "number" &&
    fact["confidence"] > 1 &&
    fact["confidence"] <= 100
  ) {
    fact["confidence"] = fact["confidence"] / 100;
  }
  const date = (value: unknown, end: boolean) => {
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    if (/^\d{4}$/.test(trimmed)) return end ? `${trimmed}-12-31` : `${trimmed}-01-01`;
    if (/^\d{4}-\d{2}$/.test(trimmed)) {
      if (!end) return `${trimmed}-01`;
      const [year, month] = trimmed.split("-").map(Number) as [number, number];
      const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
      return `${trimmed}-${String(last).padStart(2, "0")}`;
    }
    return trimmed.slice(0, 10);
  };
  fact["validFrom"] = date(fact["validFrom"], false);
  fact["validTo"] = date(fact["validTo"], true);
  const clip = (key: string, max: number) => {
    const value = fact[key];
    if (typeof value !== "string") return;
    const trimmed = value.trim();
    fact[key] = trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
  };
  clip("statement", 300);
  clip("valueText", 200);
  clip("unit", 20);
  const repaired = ["confidence", "validFrom", "validTo", "statement", "valueText", "unit"].some(
    (key) =>
      fact[key] !== original[key] &&
      !(typeof original[key] === "string" && (original[key] as string).trim() === fact[key]),
  );
  return { fact, repaired };
}

/** The resolver's answer for entities (06 L1 step 4, row 4). */
export const entityResolverJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    decisions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          item: { type: "string" },
          match: { type: "string" },
          confidence: { type: "number" },
        },
        required: ["item", "match", "confidence"],
      },
    },
  },
  required: ["decisions"],
} as const;

/** The resolver's answer for free-text facts (06 L1 step 6, third bullet). */
export const factResolverJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    decisions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          item: { type: "string" },
          relation: { type: "string", enum: ["compatible", "supersedes", "contradicts"] },
        },
        required: ["item", "relation"],
      },
    },
  },
  required: ["decisions"],
} as const;

const entityDecision = z.object({
  item: z.string(),
  match: z.string(),
  confidence: z.number().min(0).max(1),
});
const factDecision = z.object({
  item: z.string(),
  relation: z.enum(["compatible", "supersedes", "contradicts"]),
});

/** item label -> { match: candidate label | "new", confidence }. Invalid rows are dropped. */
export function parseEntityDecisions(
  raw: unknown,
): Map<string, { match: string; confidence: number }> {
  const out = new Map<string, { match: string; confidence: number }>();
  const rows = z.object({ decisions: z.array(z.unknown()) }).safeParse(raw);
  if (!rows.success) return out;
  for (const row of rows.data.decisions) {
    const parsed = entityDecision.safeParse(row);
    if (parsed.success && !out.has(parsed.data.item)) {
      out.set(parsed.data.item, { match: parsed.data.match, confidence: parsed.data.confidence });
    }
  }
  return out;
}

/** item label -> relation. Invalid rows are dropped (= compatible). */
export function parseFactDecisions(
  raw: unknown,
): Map<string, "compatible" | "supersedes" | "contradicts"> {
  const out = new Map<string, "compatible" | "supersedes" | "contradicts">();
  const rows = z.object({ decisions: z.array(z.unknown()) }).safeParse(raw);
  if (!rows.success) return out;
  for (const row of rows.data.decisions) {
    const parsed = factDecision.safeParse(row);
    if (parsed.success && !out.has(parsed.data.item))
      out.set(parsed.data.item, parsed.data.relation);
  }
  return out;
}
