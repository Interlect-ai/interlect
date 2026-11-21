/**
 * The planner (spor B3, spec B.1): what a run may do inside its limit. It works out the
 * most a run can cost before it starts and keeps what fits, in a fixed order: the analysis itself
 * first, then the mandatory research tracks, the deck's own pages, the other tracks, and last the
 * steps that only sharpen the research. Under the bottom for the level the answer is "too_low":
 * the run never starts. Pure, no model calls: a run started at the same limit gets the same plan,
 * also when a later phase works it out again from what is stored on the run.
 *
 * A worst case here is an assumption about the text's length; the real check is still made on the
 * real text before every call (`assertWithinBudget`).
 */
import { requestMaximumUsd, type PricedModel } from "./budgets.ts";
import { SPECIALIST_MAX_OUTPUT_TOKENS, SYNTHESIS_MAX_OUTPUT_TOKENS } from "./deep-text-rules.ts";

type RunKind = "screening" | "deep";

export const SCREENING_MAX_OUTPUT_TOKENS = 9_000;
export const TRACK_MAX_OUTPUT_TOKENS: Record<RunKind, number> = { screening: 3_500, deep: 5_000 };
export const TRACK_MODELS: Record<RunKind, PricedModel> = {
  screening: "perplexity/sonar",
  deep: "perplexity/sonar-pro",
};

/**
 * Assumed input tokens. One track's real prompt and schema measure about 1,650 tokens;
 * 3,000 leaves room for a fund's own questions. 60k is the input the standard caps are tested
 * against (deep-limits.test.ts), and the screening reads at most 100 evidence rows.
 */
const ASSUMED_INPUT_TOKENS = { track: 3_000, screening: 40_000, deepCall: 60_000 };

/** The most each step outside the tracks may spend. A test holds these to the steps' own limits. */
export const STEP_LIMITS_USD: Record<
  RunKind,
  Record<"identity" | "researchPlan" | "evidenceSheet" | "searchQuestions" | "deckOcr", number>
> = {
  // searchQuestions: the neutral topics (0.02) and the check of the fund's questions (0.03).
  screening: {
    identity: 0.03,
    researchPlan: 0.08,
    evidenceSheet: 0.08,
    searchQuestions: 0.05,
    deckOcr: 0.1,
  },
  // The deep analysis reuses the screening's identity and its read of the deck.
  deep: {
    identity: 0.03,
    researchPlan: 0.12,
    evidenceSheet: 0.3,
    searchQuestions: 0.05,
    deckOcr: 0,
  },
};

/**
 * The research tracks, most important first. The first ones are mandatory: who the company is, its
 * money, its people and what it sells, so every part of the analysis has something to read.
 */
export const TRACK_PRIORITY: Record<RunKind, readonly string[]> = {
  screening: [
    "screening_identity_filings",
    "screening_founders_funding",
    "screening_traction_commercial",
    "screening_market_mandate",
    "screening_product_technology",
  ],
  deep: [
    "identity_registry",
    "filings_financials",
    "founders_team",
    "product_technology",
    "traction_customers_gtm",
    "market_competition",
    "funding_ownership",
    "legal_regulatory_reputation",
  ],
};
export const MANDATORY_TRACK_COUNT: Record<RunKind, number> = { screening: 3, deep: 5 };

type OptionalStep = "researchPlan" | "evidenceSheet" | "searchQuestions" | "deckOcr";

export interface RunScope {
  status: "full" | "reduced" | "too_low";
  /** The research tracks the run searches, most important first. */
  tracks: readonly string[];
  /**
   * Three quarters of the chosen tracks must succeed, as 4 of 5 and 6 of 8 always were, but one
   * track may always fail: a screening cut to its 3 mandatory tracks needs 2 of 3.
   */
  minSuccessfulTracks: number;
  researchPlan: boolean;
  evidenceSheet: boolean;
  searchQuestions: boolean;
  deckOcr: boolean;
  /** The most the chosen set can cost, in USD. */
  maxUsd: number;
}

export interface PlannedParts {
  researchUsd: number;
  analysisUsd: number;
  specialistsUsd: number;
  synthesisUsd: number;
}

function ceil4(value: number): number {
  return Math.ceil(value * 10_000 - 1e-9) / 10_000;
}

function floor4(value: number): number {
  return Math.floor(value * 10_000 + 1e-9) / 10_000;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function trackMaximumUsd(kind: RunKind): number {
  return requestMaximumUsd(
    TRACK_MODELS[kind],
    ASSUMED_INPUT_TOKENS.track,
    TRACK_MAX_OUTPUT_TOKENS[kind],
  );
}

/** The most the analysis itself can cost: it is never cut, and comes first. */
function analysisNeed(
  kind: RunKind,
  model: PricedModel,
  specialistCount: number,
): Omit<PlannedParts, "researchUsd"> {
  if (kind === "screening") {
    const analysisUsd = ceil4(
      requestMaximumUsd(model, ASSUMED_INPUT_TOKENS.screening, SCREENING_MAX_OUTPUT_TOKENS),
    );
    return { analysisUsd, specialistsUsd: 0, synthesisUsd: 0 };
  }
  const specialistsUsd = ceil4(
    Math.max(1, specialistCount) *
      requestMaximumUsd(model, ASSUMED_INPUT_TOKENS.deepCall, SPECIALIST_MAX_OUTPUT_TOKENS),
  );
  const synthesisUsd = ceil4(
    requestMaximumUsd(model, ASSUMED_INPUT_TOKENS.deepCall, SYNTHESIS_MAX_OUTPUT_TOKENS),
  );
  return { analysisUsd: ceil4(specialistsUsd + synthesisUsd), specialistsUsd, synthesisUsd };
}

/**
 * What goes first when a full run does not fit, one at a time. The steps that only sharpen the
 * research go before any track, and the deck's own pages go last: they are the case's own material.
 */
function shedOrder(kind: RunKind): ReadonlyArray<OptionalStep | string> {
  const droppable = TRACK_PRIORITY[kind].slice(MANDATORY_TRACK_COUNT[kind]).reverse();
  return ["researchPlan", "evidenceSheet", "searchQuestions", ...droppable, "deckOcr"];
}

/** Three quarters, rounded up, yet never so many that one failed track fails the run. */
export function minSuccessfulTracks(trackCount: number): number {
  return Math.max(1, Math.min(Math.ceil(trackCount * 0.75), trackCount - 1));
}

function scopeAfterShedding(kind: RunKind, shed: ReadonlySet<string>, status: RunScope["status"]) {
  const tracks = TRACK_PRIORITY[kind].filter((track) => !shed.has(track));
  const steps = STEP_LIMITS_USD[kind];
  const keeps = (step: OptionalStep) => !shed.has(step);
  const researchUsd = ceil4(
    steps.identity +
      tracks.length * trackMaximumUsd(kind) +
      (keeps("researchPlan") ? steps.researchPlan : 0) +
      (keeps("evidenceSheet") ? steps.evidenceSheet : 0) +
      (keeps("searchQuestions") ? steps.searchQuestions : 0) +
      (keeps("deckOcr") ? steps.deckOcr : 0),
  );
  const scope: Omit<RunScope, "maxUsd"> = {
    status,
    tracks,
    minSuccessfulTracks: minSuccessfulTracks(tracks.length),
    researchPlan: keeps("researchPlan"),
    evidenceSheet: keeps("evidenceSheet"),
    searchQuestions: keeps("searchQuestions"),
    deckOcr: keeps("deckOcr"),
  };
  return { scope, researchUsd };
}

/** The run's parts: the fixed shares when they cover the needs, else each need and a share of the rest. */
function allocate(
  capUsd: number,
  need: PlannedParts,
  shares: PlannedParts,
  status: RunScope["status"],
): PlannedParts {
  const sharesCover =
    shares.researchUsd >= need.researchUsd &&
    shares.analysisUsd >= need.analysisUsd &&
    shares.specialistsUsd >= need.specialistsUsd &&
    shares.synthesisUsd >= need.synthesisUsd;
  if (status === "too_low" || (status === "full" && sharesCover)) return shares;
  const totalShare = shares.researchUsd + shares.analysisUsd;
  const left = Math.max(0, capUsd - need.researchUsd - need.analysisUsd);
  const extra = (share: number) => (totalShare > 0 ? floor4((left * share) / totalShare) : 0);
  const researchUsd = round4(need.researchUsd + extra(shares.researchUsd));
  if (need.specialistsUsd === 0) {
    return {
      researchUsd,
      analysisUsd: round4(need.analysisUsd + extra(shares.analysisUsd)),
      specialistsUsd: 0,
      synthesisUsd: 0,
    };
  }
  const specialistsUsd = round4(need.specialistsUsd + extra(shares.specialistsUsd));
  const synthesisUsd = round4(need.synthesisUsd + extra(shares.synthesisUsd));
  return {
    researchUsd,
    analysisUsd: round4(specialistsUsd + synthesisUsd),
    specialistsUsd,
    synthesisUsd,
  };
}

/** The most a run can cost with everything left in or with only the mandatory parts. */
function maxUsdAt(
  kind: RunKind,
  model: PricedModel,
  specialistCount: number,
  shed: ReadonlySet<string>,
): number {
  const { researchUsd } = scopeAfterShedding(kind, shed, "full");
  return ceil4(researchUsd + analysisNeed(kind, model, specialistCount).analysisUsd);
}

/** What a run can do inside `capUsd`, and how the money is shared between its parts. */
export function planRunScope(input: {
  kind: RunKind;
  model: PricedModel;
  capUsd: number;
  specialistCount: number;
  /** The tier's fixed shares at this cap; used whenever they cover what the run needs. */
  shares: PlannedParts;
}): { scope: RunScope; parts: PlannedParts } {
  const { kind, model, capUsd, specialistCount, shares } = input;
  const shed = new Set<string>();
  const order = shedOrder(kind);
  let next = 0;
  while (maxUsdAt(kind, model, specialistCount, shed) > capUsd && next < order.length) {
    shed.add(order[next]!);
    next += 1;
  }
  const maxUsd = maxUsdAt(kind, model, specialistCount, shed);
  const status: RunScope["status"] = maxUsd > capUsd ? "too_low" : next > 0 ? "reduced" : "full";
  const { scope, researchUsd } = scopeAfterShedding(kind, shed, status);
  const need = { researchUsd, ...analysisNeed(kind, model, specialistCount) };
  return { scope: { ...scope, maxUsd }, parts: allocate(capUsd, need, shares, status) };
}

/** The bottom for the level in whole kroner: below it no run starts (spec B.1 punkt 5). */
export function floorDkk(
  kind: RunKind,
  model: PricedModel,
  specialistCount: number,
  usdToDkk: number,
): number {
  const usd = maxUsdAt(kind, model, specialistCount, new Set(shedOrder(kind)));
  // One extra hundredth of a krone: the cap in dollars is rounded down when it is worked out.
  return Math.ceil(usd * usdToDkk + 0.01);
}
