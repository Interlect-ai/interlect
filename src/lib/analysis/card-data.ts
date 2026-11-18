/**
 * The data the deep analysis's cards draw (prototype Case Dyb analyse v5). Each of
 * the four standard specialists delivers one small, sourced data set for its own card next to its
 * analysis, so no extra AI call is paid for:
 *
 * - people_team → `team`: the people with a score per axis (radar over the people).
 * - product_market_gtm → `market`: the market size over time (growth as a line).
 * - technology_risk → `techBenchmarks`: technical key figures next to the industry's (bars).
 * - fund_finance_deal → `ownership`: ownership shares (donut) and the financing rounds (cap table).
 *
 * When a standard specialist's own data cannot be found, it gives `highlights` instead: 3–6
 * figures it did find (revenue growth, customers, capacity, milestones with year), each with its
 * source, so its card can still draw something. A team's own specialist always delivers
 * `highlights` (it has no fixed chart).
 *
 * Every point needs at least one allowed evidence id; a point without a source is removed in code
 * (`sanitizeCardData`), never guessed. What the sources do not have stays "not found" with the
 * specialist's reason. The data lives on the specialist's packet (analysis_run_steps.output_json
 * and analysis_runs.raw_response.specialists), so no migration; `readDeepCardData` gives the UI
 * one typed object per run. A run stored before this ticket has no card
 * data: every card is then "not found".
 */
import { z } from "zod";

export {
  CARD_DATA_KINDS,
  HIGHLIGHTS_KIND,
  TEAM_AXES,
  cardDataKindFor,
  type AnyCardDataKind,
  type CardDataKind,
  type CardDataModuleId,
  type TeamAxis,
} from "./card-data-kinds.ts";
import {
  HIGHLIGHTS_KIND,
  TEAM_AXES,
  cardDataKindFor,
  type CardDataKind,
  type TeamAxis,
} from "./card-data-kinds.ts";

export const CARD_LIMITS = {
  people: 6,
  marketPoints: 8,
  benchmarks: 5,
  holders: 8,
  rounds: 8,
  /** The figures a card falls back to; asked for 3–6, at least one is drawn. */
  highlightsMin: 3,
  highlights: 6,
  evidencePerItem: 4,
  /** Ownership shares that add up to more than this are contradictory sources: none is shown. */
  ownershipSumMax: 100.5,
  label: 120,
  reason: 300,
} as const;

/**
 * The parse is twice as lenient as the JSON schema's maxLength (the call is paid for), so a
 * provider that lets a string run a little long never drops a whole card.
 */
const LABEL_MAX = CARD_LIMITS.label * 2;
const evidenceIds = z.array(z.string().min(1)).max(CARD_LIMITS.evidencePerItem * 2);
const notFound = z
  .string()
  .max(CARD_LIMITS.reason * 2)
  .nullable();

const teamSchema = z.object({
  kind: z.literal("team"),
  people: z.array(
    z.object({
      name: z.string().min(1).max(LABEL_MAX),
      role: z.string().max(LABEL_MAX),
      scores: z.object(
        Object.fromEntries(
          TEAM_AXES.map((axis) => [axis, z.number().min(0).max(10).nullable()]),
        ) as Record<TeamAxis, z.ZodNullable<z.ZodNumber>>,
      ),
      evidenceIds,
    }),
  ),
  notFound,
});

const marketSchema = z.object({
  kind: z.literal("market"),
  /** What is measured, e.g. "Spend management, Europa (SAM)". */
  label: z.string().max(LABEL_MAX),
  scope: z.enum(["tam", "sam", "som", "market"]),
  geography: z.string().max(LABEL_MAX),
  currency: z.string().max(16),
  /** "million" or "billion": the points' values are in this unit of the currency. */
  unit: z.enum(["million", "billion"]),
  points: z.array(
    z.object({
      year: z.number().int().min(1990).max(2060),
      value: z.number().nonnegative(),
      basis: z.enum(["actual", "forecast"]),
      evidenceIds,
    }),
  ),
  notFound,
});

const techBenchmarksSchema = z.object({
  kind: z.literal("techBenchmarks"),
  items: z.array(
    z.object({
      metric: z.string().min(1).max(LABEL_MAX),
      unit: z.string().max(48),
      company: z.number().nullable(),
      industry: z.number().nullable(),
      higherIsBetter: z.boolean(),
      evidenceIds,
    }),
  ),
  notFound,
});

const ownershipSchema = z.object({
  kind: z.literal("ownership"),
  holders: z.array(
    z.object({
      holder: z.string().min(1).max(LABEL_MAX),
      holderType: z.enum(["founder", "investor", "employee_pool", "other"]),
      percent: z.number().min(0).max(100),
      asOf: z.string().max(20).nullable(),
      evidenceIds,
    }),
  ),
  rounds: z.array(
    z.object({
      name: z.string().min(1).max(LABEL_MAX),
      date: z.string().max(20).nullable(),
      amount: z.number().nonnegative().nullable(),
      currency: z.string().max(16).nullable(),
      investors: z.array(z.string().max(LABEL_MAX)).max(8),
      evidenceIds,
    }),
  ),
  notFound,
});

const highlightsSchema = z.object({
  kind: z.literal(HIGHLIGHTS_KIND),
  items: z.array(
    z.object({
      /** What the figure is, e.g. "Clubs using the product". */
      label: z.string().min(1).max(LABEL_MAX),
      value: z.number(),
      /** The unit as the source states it ("clubs", "%", "EUR million"); may be empty. */
      unit: z.string().max(48),
      /** The year or date the figure is for (ÅÅÅÅ or ÅÅÅÅ-MM), when the source has it. */
      period: z.string().max(20).nullable(),
      evidenceIds,
    }),
  ),
  notFound,
});

export const cardDataSchema = z.discriminatedUnion("kind", [
  teamSchema,
  marketSchema,
  techBenchmarksSchema,
  ownershipSchema,
  highlightsSchema,
]);

export type CardData = z.infer<typeof cardDataSchema>;
export type TeamCardData = z.infer<typeof teamSchema>;
export type MarketCardData = z.infer<typeof marketSchema>;
export type TechBenchmarksCardData = z.infer<typeof techBenchmarksSchema>;
export type OwnershipCardData = z.infer<typeof ownershipSchema>;
export type HighlightsCardData = z.infer<typeof highlightsSchema>;

/**
 * The specialist's stored `cardData`: lenient, so a stored packet always parses (the model's
 * output is paid for). Anything that does not match the contract is read as no card data.
 */
export const storedCardDataSchema = z.preprocess((value) => {
  if (value === null || value === undefined) return null;
  const parsed = cardDataSchema.safeParse(value);
  if (parsed.success) return value;
  console.warn(
    `[card-data] card data dropped: ${parsed.error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join(".")} ${issue.message}`)
      .join("; ")}`,
  );
  return null;
}, cardDataSchema.nullable());

function evidenceIdsJsonSchema(allowedEvidenceIds: readonly string[]) {
  return {
    type: "array",
    maxItems: CARD_LIMITS.evidencePerItem,
    items: allowedEvidenceIds.length
      ? { type: "string", enum: [...allowedEvidenceIds] }
      : { type: "string" },
  };
}

const notFoundJsonSchema = { type: ["string", "null"], maxLength: CARD_LIMITS.reason };

function object(properties: Record<string, unknown>) {
  return {
    type: "object",
    additionalProperties: false,
    properties,
    required: Object.keys(properties),
  };
}

function highlightsJsonSchema(allowedEvidenceIds: readonly string[]) {
  return object({
    kind: { type: "string", const: HIGHLIGHTS_KIND },
    items: {
      type: "array",
      maxItems: CARD_LIMITS.highlights,
      items: object({
        label: { type: "string", minLength: 1, maxLength: CARD_LIMITS.label },
        value: { type: "number" },
        unit: { type: "string", maxLength: 24 },
        period: { type: ["string", "null"], maxLength: 10 },
        evidenceIds: evidenceIdsJsonSchema(allowedEvidenceIds),
      }),
    },
    notFound: notFoundJsonSchema,
  });
}

/**
 * The strict JSON schema of one specialist's `cardData`: a standard specialist's own chart or, when
 * its data is missing, `highlights`; a team's own specialist (`custom`) only `highlights`.
 * Every property is required, as the strict structured output demands.
 */
export function cardDataJsonSchema(
  moduleId: string,
  allowedEvidenceIds: readonly string[],
  custom = false,
): Record<string, unknown> | null {
  if (custom) return highlightsJsonSchema(allowedEvidenceIds);
  const own = ownCardDataJsonSchema(moduleId, allowedEvidenceIds);
  return own ? { anyOf: [own, highlightsJsonSchema(allowedEvidenceIds)] } : null;
}

function ownCardDataJsonSchema(
  moduleId: string,
  allowedEvidenceIds: readonly string[],
): Record<string, unknown> | null {
  const kind = cardDataKindFor(moduleId);
  const sources = evidenceIdsJsonSchema(allowedEvidenceIds);
  const label = { type: "string", maxLength: CARD_LIMITS.label };
  const name = { type: "string", minLength: 1, maxLength: CARD_LIMITS.label };
  switch (kind) {
    case "team":
      return object({
        kind: { type: "string", const: "team" },
        people: {
          type: "array",
          maxItems: CARD_LIMITS.people,
          items: object({
            name,
            role: label,
            scores: object(
              Object.fromEntries(
                TEAM_AXES.map((axis) => [
                  axis,
                  { type: ["number", "null"], minimum: 0, maximum: 10 },
                ]),
              ),
            ),
            evidenceIds: sources,
          }),
        },
        notFound: notFoundJsonSchema,
      });
    case "market":
      return object({
        kind: { type: "string", const: "market" },
        label,
        scope: { type: "string", enum: ["tam", "sam", "som", "market"] },
        geography: label,
        currency: { type: "string", maxLength: 8 },
        unit: { type: "string", enum: ["million", "billion"] },
        points: {
          type: "array",
          maxItems: CARD_LIMITS.marketPoints,
          items: object({
            year: { type: "integer", minimum: 1990, maximum: 2060 },
            value: { type: "number", minimum: 0 },
            basis: { type: "string", enum: ["actual", "forecast"] },
            evidenceIds: sources,
          }),
        },
        notFound: notFoundJsonSchema,
      });
    case "techBenchmarks":
      return object({
        kind: { type: "string", const: "techBenchmarks" },
        items: {
          type: "array",
          maxItems: CARD_LIMITS.benchmarks,
          items: object({
            metric: name,
            unit: { type: "string", maxLength: 24 },
            company: { type: ["number", "null"] },
            industry: { type: ["number", "null"] },
            higherIsBetter: { type: "boolean" },
            evidenceIds: sources,
          }),
        },
        notFound: notFoundJsonSchema,
      });
    case "ownership":
      return object({
        kind: { type: "string", const: "ownership" },
        holders: {
          type: "array",
          maxItems: CARD_LIMITS.holders,
          items: object({
            holder: name,
            holderType: { type: "string", enum: ["founder", "investor", "employee_pool", "other"] },
            percent: { type: "number", minimum: 0, maximum: 100 },
            asOf: { type: ["string", "null"], maxLength: 10 },
            evidenceIds: sources,
          }),
        },
        rounds: {
          type: "array",
          maxItems: CARD_LIMITS.rounds,
          items: object({
            name,
            date: { type: ["string", "null"], maxLength: 10 },
            amount: { type: ["number", "null"], minimum: 0 },
            currency: { type: ["string", "null"], maxLength: 8 },
            investors: { type: "array", maxItems: 8, items: label },
            evidenceIds: sources,
          }),
        },
        notFound: notFoundJsonSchema,
      });
    default:
      return null;
  }
}

// i18n-keep: a rule in the Danish specialist prompt, never shown to the person.
const COMMON_RULE_DA = `Hvert punkt skal have mindst ét evidenceId fra den tilladte evidens, der dokumenterer netop det tal eller den oplysning. Et tal uden kilde må ikke stå i cardData: lad det være ude. Opfind, interpolér, ekstrapolér eller afrund aldrig til et tal, kilden ikke har. Har kilderne slet ikke dataene, så returnér tomme lister og skriv i notFound én kort sætning om, hvad der ikke kunne findes og hvorfor (fx "Ingen offentlig kilde angiver markedets størrelse for mere end ét år."). Ellers er notFound null.`;

// i18n-keep: rules in the Danish specialist prompt, never shown to the person.
const KIND_RULES_DA: Record<CardDataKind, string> = {
  team: `cardData (kind "team") er dataene til teamkortets radar: op til ${CARD_LIMITS.people} personer i founderteam og ledelse, som evidensen navngiver, med navn og rolle. Giv hver person en score fra 0 til 10 på de fem akser domain (brancheindsigt og problemnærhed), execution (dokumenterede resultater), commercial (salg og kunder), technical (teknisk dybde) og leadership (ledelse og rekruttering). Scoren er din vurdering af den dokumenterede baggrund relativt til selskabets stadie; null, når evidensen intet siger om aksen. evidenceIds er kilderne til personens baggrund.`,
  market: `cardData (kind "market") er dataene til markedskortets vækstlinje: markedets størrelse i mindst to forskellige år (historiske og prognoser), alle for samme marked, geografi og valuta. label siger kort, hvad der måles; scope er tam, sam, som eller market; unit er million eller billion af currency. basis er actual for et opgjort år og forecast for en prognose. Brug kun tal fra navngivne kilder med år; virksomhedens egne TAM-tal må bruges, men kun med deres egen kilde. Ét enkelt år er ikke en linje: returnér da tomme points og en notFound.`,
  techBenchmarks: `cardData (kind "techBenchmarks") er dataene til teknologikortets søjler: op til ${CARD_LIMITS.benchmarks} tekniske nøgletal, som evidensen dokumenterer for selskabet (fx oppetid, svartid, modelpræcision, andel af medarbejdere i udvikling, antal patenter). company er selskabets værdi, industry branchens typiske niveau, begge i samme unit. industry sættes kun, når en navngiven kilde i den tilladte evidens angiver branchens niveau for netop dette nøgletal; ellers er industry null, og nøgletallet står stadig med selskabets værdi (kortet viser det uden søjle mod branchen). Skøn, gæt eller afled aldrig branchens niveau. company er null, hvor selskabets værdi ikke er dokumenteret. higherIsBetter siger, om et højere tal er bedre.`,
  ownership: `cardData (kind "ownership") er dataene til deal-kortets donut og kapitaltabel. holders er ejerne med ejerandel i procent (fx reelle og legale ejere i det officielle register, kapitaltabel i materialet), holderType founder, investor, employee_pool eller other, og asOf som dato (ÅÅÅÅ-MM-DD eller ÅÅÅÅ), når kilden har den. Ejerandele, der tilsammen er over 100 %, er modstridende kilder: tag kun den nyeste opgørelse med. rounds er finansieringsrunderne med navn, dato, beløb i hele valutaenheder (fx 2000000, ikke 2) og valuta (null, hvor kilden ikke har dem) og de investorer, kilden nævner.`,
};

// i18n-keep: rules in the Danish specialist prompt, never shown to the person.
const HIGHLIGHTS_RULE_DA = `cardData (kind "highlights") er ${CARD_LIMITS.highlightsMin}-${CARD_LIMITS.highlights} tal, du faktisk har fundet i evidensen for dit område, så kortet kan tegne dem: fx omsætning og vækst, antal kunder, brugere, klubber eller lande, kapacitet, solgte enheder, medarbejdere, markedsstørrelse for ét år eller milepæle med år. label siger kort, hvad tallet er; value er tallet som et rent tal (12000, ikke "12.000+"); unit er enheden, som kilden angiver den (fx "klubber", "%", "mio. EUR"); period er året eller måneden (ÅÅÅÅ eller ÅÅÅÅ-MM), når kilden har den, ellers null. Vælg de tal, der siger mest om dit område, og tag kun hvert tal med én gang.`;

// i18n-keep: part of the Danish specialist prompt.
const READING_ORDER_DA = `Sådan finder du dataene: læs først casens eget materiale (pitch deck, casens filer, hjemmesidens sider og de officielle registre), derefter evidensarket og den offentlige research. Meld først "ikke fundet", når ingen af dem har tallene.`;

/**
 * The prompt section about a specialist's `cardData`: a standard specialist's own chart with
 * `highlights` as the fallback, and `highlights` only for a team's own specialist.
 */
export function cardDataPromptSection(moduleId: string, custom = false): string {
  if (custom) {
    // i18n-keep: part of the Danish specialist prompt.
    return `

Data til kortet (cardData):
- ${READING_ORDER_DA}
- ${HIGHLIGHTS_RULE_DA}
- ${COMMON_RULE_DA}`;
  }
  const kind = cardDataKindFor(moduleId);
  if (!kind) return "";
  // i18n-keep: part of the Danish specialist prompt.
  return `

Data til kortet (cardData):
- ${READING_ORDER_DA}
- ${KIND_RULES_DA[kind]}
- Findes dine faste tal ikke (fx ingen markedsstørrelse i to forskellige år, ingen tekniske nøgletal overhovedet), så giv i stedet cardData med kind "highlights": ${HIGHLIGHTS_RULE_DA} Brug kun "highlights", når dine faste tal ikke kan findes; har du heller ingen tal med kilde, så returnér dit eget kind med tomme lister og notFound.
- ${COMMON_RULE_DA}`;
}

/** The research questions that look for the cards' data, per deep research module. */
export const CARD_DATA_RESEARCH_QUESTIONS = {
  founders_team:
    "For each founder and leader: current role, years of domain experience, earlier companies and roles with dates, documented commercial, technical and leadership results, so each person's background can be compared on the same axes",
  market_competition:
    "Market size figures for the company's market in at least two different years (historic and forecast), each with year, geography, currency, unit and the publishing source, so growth over time can be drawn; prefer one consistent source series",
  product_technology:
    "Technical key figures that can be compared with the industry's typical level (for example uptime, latency, model accuracy, share of staff in R&D, number of granted patents), each with the company's value and source, and the industry benchmark with its source only where a named source publishes one",
  funding_ownership:
    "Ownership shares per holder (founders, investors, employee option pool) with percentage and date from official registries of owners or a published cap table, and each financing round with date, amount, currency and investors",
} as const;

export type CardDataStatus = "found" | "not_found";

export interface CardSlot<T> {
  status: CardDataStatus;
  data: T | null;
  /** The specialist's reason when nothing was found; null when the run predates. */
  reason: string | null;
}

export interface DeepCardData {
  team: CardSlot<TeamCardData>;
  market: CardSlot<MarketCardData>;
  techBenchmarks: CardSlot<TechBenchmarksCardData>;
  ownership: CardSlot<OwnershipCardData>;
  /**
   * Per specialist (module id, also a team's own `custom_…`), the figures it found when
   * its own chart's data was missing (or, for a team's own specialist, always). Only specialists
   * with at least one sourced figure are here.
   */
  highlights: Record<string, HighlightsCardData>;
}

function withSources<T extends { evidenceIds: string[] }>(
  items: readonly T[],
  allowed: ReadonlySet<string> | null,
): T[] {
  return items
    .map((item) => ({
      ...item,
      evidenceIds: [...new Set(item.evidenceIds)].filter((id) => !allowed || allowed.has(id)),
    }))
    .filter((item) => item.evidenceIds.length > 0);
}

function finish<T extends CardData>(data: T, hasData: boolean): T {
  return { ...data, notFound: hasData ? null : (data.notFound ?? null) };
}

/**
 * Code's check of what the specialist delivered (runs before the packet is stored and again when
 * it is read): every point keeps only allowed sources and a point without one is dropped, a
 * market line needs two different years, a benchmark needs at least one side, and ownership that
 * adds up to more than 100 % is dropped as contradictory. Never throws: the call is paid for.
 * `allowed` is null when reading a stored run (the sources were checked when it was stored).
 */
export function sanitizeCardData(
  data: CardData | null | undefined,
  allowed: ReadonlySet<string> | null,
): CardData | null {
  if (!data) return null;
  switch (data.kind) {
    case "team": {
      const people = withSources(data.people, allowed)
        .filter((person) => TEAM_AXES.some((axis) => person.scores[axis] !== null))
        .slice(0, CARD_LIMITS.people);
      return finish({ ...data, people }, people.length > 0);
    }
    case "market": {
      const byYear = new Map<number, MarketCardData["points"][number]>();
      for (const point of withSources(data.points, allowed)) {
        if (!byYear.has(point.year)) byYear.set(point.year, point);
      }
      // The newest years are kept: the line ends in the forecast.
      const points = [...byYear.values()]
        .sort((a, b) => a.year - b.year)
        .slice(-CARD_LIMITS.marketPoints);
      const line = points.length >= 2 ? points : [];
      return finish({ ...data, points: line }, line.length > 0);
    }
    case "techBenchmarks": {
      const items = withSources(data.items, allowed)
        .filter((item) => item.company !== null || item.industry !== null)
        .filter((item) =>
          [item.company, item.industry].every((v) => v === null || Number.isFinite(v)),
        )
        .slice(0, CARD_LIMITS.benchmarks);
      return finish({ ...data, items }, items.length > 0);
    }
    case "ownership": {
      let holders = withSources(data.holders, allowed).slice(0, CARD_LIMITS.holders);
      const sum = holders.reduce((total, holder) => total + holder.percent, 0);
      if (sum > CARD_LIMITS.ownershipSumMax) holders = [];
      const rounds = withSources(data.rounds, allowed).slice(0, CARD_LIMITS.rounds);
      return finish({ ...data, holders, rounds }, holders.length > 0 || rounds.length > 0);
    }
    case HIGHLIGHTS_KIND: {
      const seen = new Set<string>();
      const items = withSources(data.items, allowed)
        .filter((item) => Number.isFinite(item.value))
        .filter((item) => {
          // The same figure twice (same label and period) is one figure.
          const key = `${item.label.trim().toLocaleLowerCase()}|${item.period ?? ""}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .slice(0, CARD_LIMITS.highlights);
      return finish({ ...data, items }, items.length > 0);
    }
  }
}

/** The packet with its card data checked against the run's evidence (worker and inline path). */
export function withSanitizedCardData<T extends { cardData?: CardData | null | undefined }>(
  packet: T,
  allowedEvidenceIds: readonly string[],
): T {
  if (packet.cardData === undefined) return packet;
  return { ...packet, cardData: sanitizeCardData(packet.cardData, new Set(allowedEvidenceIds)) };
}

/** The research module's card question, also kept when the fund rewrote the module's. */
export function cardDataResearchQuestion(researchModuleId: string): string | null {
  return (
    (CARD_DATA_RESEARCH_QUESTIONS as Record<string, string | undefined>)[researchModuleId] ?? null
  );
}

function slot<T extends CardData>(data: T | undefined, hasData: (data: T) => boolean): CardSlot<T> {
  if (!data) return { status: "not_found", data: null, reason: null };
  return hasData(data)
    ? { status: "found", data, reason: null }
    : { status: "not_found", data: null, reason: data.notFound };
}

/**
 * The cards' data of one deep run, read from `analysis_runs.raw_response`.
 * A card is "found" only when its data has at least one sourced point; otherwise "not_found" with
 * the specialist's reason (null for a run stored or a switched-off specialist).
 */
export function readDeepCardData(rawResponse: unknown): DeepCardData {
  const specialists =
    rawResponse && typeof rawResponse === "object"
      ? (rawResponse as { specialists?: unknown }).specialists
      : null;
  const byKind = new Map<CardDataKind, CardData>();
  const highlights: Record<string, HighlightsCardData> = {};
  if (Array.isArray(specialists)) {
    for (const packet of specialists) {
      if (!packet || typeof packet !== "object") continue;
      const { moduleId, cardData } = packet as { moduleId?: unknown; cardData?: unknown };
      if (typeof moduleId !== "string") continue;
      const parsed = cardDataSchema.safeParse(cardData);
      if (!parsed.success) continue;
      if (parsed.data.kind === HIGHLIGHTS_KIND) {
        const clean = sanitizeCardData(parsed.data, null);
        if (clean?.kind === HIGHLIGHTS_KIND && clean.items.length > 0) highlights[moduleId] = clean;
        continue;
      }
      const kind = cardDataKindFor(moduleId);
      if (!kind || parsed.data.kind !== kind) continue;
      const clean = sanitizeCardData(parsed.data, null);
      if (clean) byKind.set(kind, clean);
    }
  }
  return {
    team: slot(byKind.get("team") as TeamCardData | undefined, (d) => d.people.length > 0),
    market: slot(byKind.get("market") as MarketCardData | undefined, (d) => d.points.length > 0),
    techBenchmarks: slot(
      byKind.get("techBenchmarks") as TechBenchmarksCardData | undefined,
      (d) => d.items.length > 0,
    ),
    ownership: slot(
      byKind.get("ownership") as OwnershipCardData | undefined,
      (d) => d.holders.length > 0 || d.rounds.length > 0,
    ),
    highlights,
  };
}
