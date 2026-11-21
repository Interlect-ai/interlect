import { getEncoding } from "js-tiktoken";
import { translate } from "../i18n/translate.ts";
import type { Language } from "../i18n/language.ts";

/**
 * Interlects AI-budgetter er fastsat i DKK, men udbyderne afregner i USD.
 * USD-lofterne er afrundet ned fra ECB-krydskursen 2. september 2026, så
 * valutabevaegelser ikke utilsigtet sender en koersel over det viste DKK-loft.
 */
export const AI_BUDGETS = {
  exchangeRateDkkPerUsd: 6.46,
  // Screeningen er vigtig og må koste op til 5 kr., så den kan
  // være grundigere (identifikation, flere kilder). Stadig et loft, ikke et mål.
  screening: {
    dkk: 5,
    usd: 0.77,
    researchUsd: 0.46,
    analysisUsd: 0.31,
  },
  deep: {
    dkk: 35,
    usd: 5.4,
    researchUsd: 1.9,
    analysisUsd: 3.5,
    specialistsUsd: 2.75,
    synthesisUsd: 0.75,
  },
} as const;

export type PricedModel =
  | "openai/gpt-5.4-mini"
  | "openai/gpt-5.4"
  | "openai/gpt-5.5"
  | "perplexity/sonar"
  | "perplexity/sonar-pro"
  | "openai/text-embedding-3-small"
  // Brain's exam judge only: another model family than the chat.
  | "anthropic/claude-sonnet-5.5"
  | "anthropic/claude-opus-5.5";

const MODEL_PRICING_USD_PER_MILLION: Record<
  PricedModel,
  { input: number; output: number; request: number }
> = {
  "openai/gpt-5.4-mini": { input: 0.75, output: 4.5, request: 0 },
  "openai/gpt-5.4": { input: 2.5, output: 15, request: 0 },
  "openai/gpt-5.5": { input: 5, output: 30, request: 0 },
  "perplexity/sonar": { input: 1, output: 1, request: 0.01 },
  // Reserve Perplexity's low-context Pro Search price, not the cheaper fast-search price.
  "perplexity/sonar-pro": { input: 3, output: 15, request: 0.014 },
  // Embedding-only model, no output tokens.
  "openai/text-embedding-3-small": { input: 0.02, output: 0, request: 0 },
  "anthropic/claude-sonnet-5.5": { input: 2, output: 10, request: 0 },
  "anthropic/claude-opus-5.5": { input: 4, output: 20, request: 0 },
};

export interface RequestBudgetEstimate {
  maxCostUsd: number;
  maxInputTokens: number;
  maxOutputTokens: number;
}

const gatewayEncoding = getEncoding("o200k_base");

/**
 * Tokenisér det faktiske gateway-payload før kaldet. En modelafhængig margin
 * dækker message-overhead og mindre forskelle mellem udbydernes tokenisering.
 * Det undgår både falske budgetstop og løse tegn-/byte-gæt.
 */
export function estimateRequestMaximumUsd(input: {
  model: PricedModel;
  requestBody: unknown;
  maxOutputTokens: number;
}): RequestBudgetEstimate {
  const measuredInputTokens = gatewayEncoding.encode(JSON.stringify(input.requestBody)).length;
  return {
    maxCostUsd: requestMaximumUsd(input.model, measuredInputTokens, input.maxOutputTokens),
    maxInputTokens: maxInputTokensFor(input.model, measuredInputTokens),
    maxOutputTokens: input.maxOutputTokens,
  };
}

function maxInputTokensFor(model: PricedModel, measuredInputTokens: number): number {
  const safetyFactor = model.startsWith("perplexity/") ? 1.25 : 1.1;
  return Math.ceil(measuredInputTokens * safetyFactor + 128);
}

/** The most one call can cost at this many measured or assumed input tokens. */
export function requestMaximumUsd(
  model: PricedModel,
  measuredInputTokens: number,
  maxOutputTokens: number,
): number {
  const pricing = MODEL_PRICING_USD_PER_MILLION[model];
  return roundUsd(
    (maxInputTokensFor(model, measuredInputTokens) * pricing.input +
      maxOutputTokens * pricing.output) /
      1_000_000 +
      pricing.request,
  );
}

/** A run stopped at its price limit: what is finished is kept and reused for free. */
export class BudgetLimitError extends Error {}

/** A call stopped before it was sent, because its worst case passes its cap. */
export class BudgetExceededError extends BudgetLimitError {}

/** The reason a failed run is marked with (0124), also through an error that wraps the stop. */
export function stopReasonOf(cause: unknown): "price_limit" | null {
  let current = cause;
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    if (current instanceof BudgetLimitError) return "price_limit";
    current = current.cause;
  }
  return null;
}

/**
 * Stops a call whose worst case passes what is left. The step's error (shown in the case's model
 * log) is a short sentence in the run's language without an amount (P13); the call's
 * internal name and the amounts are only logged.
 */
export function assertWithinBudget(
  estimate: RequestBudgetEstimate,
  availableUsd: number,
  label: string,
  language: Language,
): void {
  if (estimate.maxCostUsd > availableUsd) {
    console.warn(
      `[budget] ${label}: worst case $${estimate.maxCostUsd.toFixed(2)} > $${availableUsd.toFixed(2)} left`,
    );
    throw new BudgetExceededError(translate(language, "analysisServer.budget.stepStopped"));
  }
}

/**
 * The list price of tokens already used, for a step whose response did not carry the
 * Gateway's own price (the Brain chat books each step as it finishes).
 */
export function tokenCostUsd(model: PricedModel, inputTokens: number, outputTokens: number) {
  const pricing = MODEL_PRICING_USD_PER_MILLION[model];
  return roundUsd(
    (Math.max(0, inputTokens) * pricing.input + Math.max(0, outputTokens) * pricing.output) /
      1_000_000,
  );
}

/** Unknown provider cost is accounted at the reserved worst-case amount. */
export function budgetCharge(actualCostUsd: number | null, estimate: RequestBudgetEstimate) {
  return actualCostUsd ?? estimate.maxCostUsd;
}

/** As `assertWithinBudget`, after the fact: the booked spend passed the step's cap. */
export function assertActualSpendWithinBudget(
  chargedUsd: number,
  budgetUsd: number,
  label: string,
  language: Language,
): void {
  if (chargedUsd > budgetUsd + 0.000001) {
    console.warn(
      `[budget] ${label}: booked $${chargedUsd.toFixed(2)} > cap $${budgetUsd.toFixed(2)}`,
    );
    throw new BudgetLimitError(translate(language, "analysisServer.budget.stepStopped"));
  }
}

export function formatBudgetDkk(value: number) {
  return new Intl.NumberFormat("da-DK", {
    style: "currency",
    currency: "DKK",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

/**
 * Formaterer et faktisk registreret USD-forbrug som DKK, med samme kurs som
 * budgetlofterne ovenfor. Bruges til at vise den reelle pris på en afsluttet
 * kørsel -- til forskel fra formatBudgetDkk, som viser det faste loft.
 */
export function costDkk(usd: number) {
  return new Intl.NumberFormat("da-DK", {
    style: "currency",
    currency: "DKK",
    minimumFractionDigits: 2,
  }).format(usd * AI_BUDGETS.exchangeRateDkkPerUsd);
}

function roundUsd(value: number) {
  return Math.ceil(value * 1_000_000) / 1_000_000;
}
