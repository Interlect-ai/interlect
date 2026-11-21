type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" ? (value as UnknownRecord) : null;
}

function finiteCost(value: unknown): number | null {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/** AI Gateway and individual providers expose billed USD in slightly different envelopes. */
export function extractGatewayCostUsd(body: unknown): number | null {
  const root = record(body);
  if (!root) return null;
  const providerMetadata = record(root["provider_metadata"] ?? root["providerMetadata"]);
  const gateway = record(providerMetadata?.["gateway"]);
  const usage = record(root["usage"]);
  const usageCost = record(usage?.["cost"]);
  return (
    finiteCost(gateway?.["cost"]) ??
    finiteCost(usageCost?.["total_cost"] ?? usageCost?.["totalCost"]) ??
    finiteCost(usage?.["cost"])
  );
}

export function sumCompleteCosts(costs: Array<number | null>): number | null {
  if (!costs.length || costs.some((cost) => cost === null)) return null;
  return (costs as number[]).reduce((sum, cost) => sum + cost, 0);
}

/**
 * A call the gateway refused with an error status and no usage at all was not
 * billed. Any other call without a usable answer was, so it is charged (its price, or its maximum).
 */
export function refusedWithoutUsage(input: {
  ok: boolean;
  actualCostUsd: number | null;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined;
}): boolean {
  return (
    !input.ok &&
    input.actualCostUsd === null &&
    input.usage?.prompt_tokens == null &&
    input.usage?.completion_tokens == null &&
    input.usage?.total_tokens == null
  );
}

/**
 * The prices a failed screening stores. `callCostUsd` is what the fund-fit call is known
 * to have cost (its charge when the answer was cut off or over budget, `ScreeningGatewayError`),
 * null when the call never answered. The fund-fit step gets only its own call's price, and the
 * run gets the research plus that call, so the settlement (0071) books what was paid instead of
 * nothing.
 *
 * `chargedUsd` is what the run charged against its budget (the known prices plus the
 * maximum for each call without one). The settlement (0114) books it when the run's price is
 * unknown, so a paid failure is not booked as 0 kr. Null only when nothing is known. An unknown
 * research price makes the run's price unknown, also when the call's price is known: the call is
 * then booked through `chargedUsd` together with the research, instead of alone.
 */
export function failedScreeningCosts(input: {
  failedStep: "screening_research" | "fund_screening";
  incurredUsd: number | null;
  /** What the run had charged before the failed step; null when not known. */
  incurredChargeUsd: number | null;
  callCostUsd: number | null;
}): { runUsd: number | null; stepUsd: number | null; chargedUsd: number | null } {
  const chargedBeforeUsd = input.incurredChargeUsd ?? input.incurredUsd;
  const callUsd = input.failedStep === "fund_screening" ? input.callCostUsd : null;
  const chargedUsd =
    chargedBeforeUsd === null && callUsd === null ? null : (chargedBeforeUsd ?? 0) + (callUsd ?? 0);
  if (input.failedStep !== "fund_screening") {
    return { runUsd: input.incurredUsd, stepUsd: input.incurredUsd, chargedUsd };
  }
  if (input.callCostUsd === null) return { runUsd: input.incurredUsd, stepUsd: null, chargedUsd };
  return {
    runUsd: input.incurredUsd === null ? null : input.incurredUsd + input.callCostUsd,
    stepUsd: input.callCostUsd,
    chargedUsd,
  };
}

/**
 * The research failed after it had charged its budget (paid calls); carries the charge, so
 * the failed run is booked to it. The message is the original failure's.
 */
export class ResearchFailedError extends Error {
  readonly chargeUsd: number;
  constructor(cause: unknown, chargeUsd: number) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = "ResearchFailedError";
    this.chargeUsd = chargeUsd;
  }
}

/**
 * Runs work that charges the budget as it goes (`spent.usd`); a failure after it charged
 * anything is thrown as a `ResearchFailedError` with that charge, otherwise as it was.
 */
export async function chargedOnFailure<T>(run: (spent: { usd: number }) => Promise<T>): Promise<T> {
  const spent = { usd: 0 };
  try {
    return await run(spent);
  } catch (cause) {
    if (cause instanceof ResearchFailedError) throw cause;
    if (spent.usd > 0) throw new ResearchFailedError(cause, spent.usd);
    throw cause;
  }
}

/**
 * What a failed model call charged against its budget. `errorChargeUsd` is what the error
 * decided (the maximum for a call without an answer, 0 for a call refused without usage); else
 * the answered call's price, or its maximum when the price is unknown (as `budgetCharge`). Null
 * when nothing is known to have been sent.
 */
export function failedCallChargeUsd(
  completion: { actualCostUsd: number | null; estimatedMaximumUsd: { maxCostUsd: number } } | null,
  errorChargeUsd: number | null,
): number | null {
  if (errorChargeUsd !== null) return errorChargeUsd;
  if (completion) return completion.actualCostUsd ?? completion.estimatedMaximumUsd.maxCostUsd;
  return null;
}

/**
 * The price and the charge of a run that failed or was released as stalled, from
 * its steps. `charged_cost` is what a step charged against its budget (its price, or the maximum
 * of each call without one; 0116). A step that charged without a known price makes the run's
 * price unknown, so the settlement (0114) books `chargedUsd` instead of only the known prices.
 * A step with neither (never ran, or saved before 0116) counts as nothing, as before, and
 * `everyStepKnown` says so (a finished run's charge is only a bound when it is true). Both are
 * null when no step reported anything, which the settlement books as nothing.
 */
export function stepRunCosts(
  rows: ReadonlyArray<{ actual_cost: unknown; charged_cost: unknown }>,
): {
  actualUsd: number | null;
  chargedUsd: number | null;
  everyStepKnown: boolean;
} {
  let known: number | null = null;
  let charged: number | null = null;
  let unknownPrice = false;
  let everyStepKnown = true;
  for (const row of rows) {
    const price = finiteCost(row.actual_cost);
    const charge = finiteCost(row.charged_cost) ?? price;
    if (price !== null) known = (known ?? 0) + price;
    if (charge !== null) charged = (charged ?? 0) + charge;
    else everyStepKnown = false;
    // A step that charged nothing (skipped, reused) has nothing unknown.
    if (price === null && charge !== null && charge > 0) unknownPrice = true;
  }
  return { actualUsd: unknownPrice ? null : known, chargedUsd: charged, everyStepKnown };
}

/**
 * A finished run's price, charge and tokens are its steps' sums, so the run and its steps
 * always agree (the reconciliation, `scripts/analysis-reconcile.ts`, compares them). Before, the
 * direct runner added up its own calls and left the evidence sheet out. The price is unknown when a
 * step's is (`sumCompleteCosts`); the charge is only a bound when every step left one.
 * `knownUsd` (the known prices alone) is what the run's budget check uses.
 */
export function runTotalsFromSteps(
  rows: ReadonlyArray<{
    actual_cost: unknown;
    charged_cost: unknown;
    input_tokens: unknown;
    output_tokens: unknown;
    total_tokens: unknown;
  }>,
): {
  actualUsd: number | null;
  chargedUsd: number | null;
  knownUsd: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
} {
  const prices = rows.map((row) => finiteCost(row.actual_cost));
  const costs = stepRunCosts(rows);
  const tokens = (value: unknown) => Number(value ?? 0) || 0;
  return {
    actualUsd: sumCompleteCosts(prices),
    chargedUsd: costs.everyStepKnown ? costs.chargedUsd : null,
    knownUsd: prices.reduce<number>((sum, price) => sum + (price ?? 0), 0),
    inputTokens: rows.reduce((sum, row) => sum + tokens(row.input_tokens), 0),
    outputTokens: rows.reduce((sum, row) => sum + tokens(row.output_tokens), 0),
    totalTokens: rows.reduce(
      (sum, row) =>
        sum +
        (row.total_tokens === null || row.total_tokens === undefined
          ? tokens(row.input_tokens) + tokens(row.output_tokens)
          : tokens(row.total_tokens)),
      0,
    ),
  };
}
