import type { Language } from "../i18n/language.ts";
import { translate, type MessageKey, type TranslateVars } from "../i18n/translate.ts";

export const FINANCE_FORMULA_VERSION = "interlect-finance-v3";

/**
 * Where a figure comes from: "register" is the annual report in the company register
 * (a figure there is stated, a derived one is an estimate from it), "reported" is the company's
 * own word (pitch deck, website) or a web search.
 */
export type FinancialInputOrigin = "register" | "reported";

export interface FinancialInput {
  id: string;
  metric: string;
  value: number;
  unit: string;
  /** The period the figure covers (ISO dates); left out when the specialist gave none. */
  periodStart?: string | null;
  periodEnd?: string | null;
  origin?: FinancialInputOrigin;
  /** A figure the code derived from the register's own figures, not one the report states. */
  estimated?: boolean;
}

export interface FinanceResult {
  metric: string;
  status: "ok" | "kan_ikke_beregnes";
  value: number | null;
  unit: string | null;
  inputIds: string[];
  missingInputs: string[];
  warnings: string[];
}

const MONETARY_METRICS = new Set([
  "mrr",
  "arr",
  "monthly_revenue",
  "annual_revenue",
  "cash",
  "monthly_operating_expenses",
  "cogs",
  "sales_marketing_spend",
]);

const ISO_CURRENCY_PATTERN = /\b(DKK|EUR|USD|SEK|NOK|GBP|CHF|ISK|PLN|JPY|CAD|AUD)\b/;

const SCALE_TOKENS: Record<string, string> = {
  MIA: "mia. ",
  MILLIARD: "mia. ",
  MILLIARDER: "mia. ",
  BN: "mia. ",
  BILLION: "mia. ",
  BILLIONS: "mia. ",
  MIO: "mio. ",
  MILL: "mio. ",
  MILLION: "mio. ",
  MILLIONS: "mio. ",
  MILLIONER: "mio. ",
  MN: "mio. ",
  M: "mio. ",
  TUSIND: "t. ",
  THOUSAND: "t. ",
  THOUSANDS: "t. ",
  TKR: "t. ",
  K: "t. ",
  T: "t. ",
  "000": "t. ",
  "'000": "t. ",
};

/**
 * The money basis of a unit: ISO currency plus scale, e.g. "DKK", "mio. EUR" or "t. DKK".
 * "kr." counts as DKK. Returns "ukendt valuta" when no currency is stated (in `language`; one
 * calculation uses one language, so bases still compare like with like).
 */
export function moneyBasisOfUnit(unit: string, language: Language = "da"): string {
  const normalized = unit.toUpperCase();
  const iso = normalized.match(ISO_CURRENCY_PATTERN)?.[0];
  const currency =
    iso ??
    (/\b(T?KR)\b/.test(normalized)
      ? "DKK"
      : translate(language, "analysisServer.finance.unknownCurrency"));
  const tokens = normalized.split(/[^A-ZÆØÅ0-9']+/).filter(Boolean);
  const scales = new Set(
    tokens.map((token) => SCALE_TOKENS[token]).filter((scale): scale is string => Boolean(scale)),
  );
  // A number we do not recognise (e.g. "100 DKK" or "10^6") means the scale is unknown,
  // and an unknown scale must never be treated as "no scale".
  const unknownNumber = tokens.some((token) => /\d/.test(token) && !SCALE_TOKENS[token]);
  if (scales.size > 1 || unknownNumber) {
    return translate(language, "analysisServer.finance.unknownScale", { currency });
  }
  return `${[...scales][0] ?? ""}${currency}`;
}

/**
 * The single money basis every monetary input shares. Mixed currencies or scales are never
 * converted or guessed: the monetary calculations then report "kan ikke beregnes" with a warning.
 */
function resolveCurrency(inputs: FinancialInput[], language: Language) {
  const bases = new Set(
    inputs
      .filter((input) => MONETARY_METRICS.has(input.metric))
      .map((input) => moneyBasisOfUnit(input.unit, language)),
  );
  if (bases.size > 1) {
    return { currency: null, mixed: [...bases].sort() };
  }
  return {
    currency: [...bases][0] ?? translate(language, "analysisServer.finance.unknownCurrency"),
    mixed: null,
  };
}

/**
 * The deterministic finance calculations. `language` is the language of the units and warnings
 * stored with the run; Danish when left out.
 */
export function calculateFinance(
  inputs: FinancialInput[],
  language: Language = "da",
): FinanceResult[] {
  const text = (key: string, vars?: TranslateVars) =>
    translate(language, `analysisServer.finance.${key}` as MessageKey, vars);
  const { currency, mixed } = resolveCurrency(inputs, language);
  if (mixed) {
    const warning = text("mixedCurrencies", { bases: mixed.join(", ") });
    const monetaryInputs = inputs.filter((input) => MONETARY_METRICS.has(input.metric));
    return calculateFinance(
      inputs.filter((input) => !MONETARY_METRICS.has(input.metric)),
      language,
    ).map((result) => ({
      ...result,
      inputIds: [...result.inputIds, ...monetaryInputs.map((input) => input.id)],
      // The amounts exist, just in different bases: the warning explains it, not "missing".
      missingInputs: result.missingInputs.filter((metric) => !MONETARY_METRICS.has(metric)),
      warnings: [...result.warnings, warning],
    }));
  }
  const money = (period: string) => `${currency}${period}`;
  // The newest period wins when a metric has several; inputs without a period keep their order.
  const byMetric = new Map(
    [...inputs]
      .sort((a, b) => (a.periodEnd ?? "").localeCompare(b.periodEnd ?? ""))
      .map((input) => [input.metric, input]),
  );
  const value = (metric: string) => byMetric.get(metric)?.value;
  const ids = (...metrics: string[]) =>
    metrics.map((metric) => byMetric.get(metric)?.id).filter((id): id is string => Boolean(id));
  /** Says whether a result rests on the register or on the company's own figures. */
  const originWarnings = (used: FinancialInput[]) => [
    ...(used.some((input) => input.origin === "register")
      ? [text(used.some((input) => input.estimated) ? "registryEstimate" : "registryStated")]
      : []),
    ...(used.some((input) => input.origin === "reported") ? [text("selfReported")] : []),
  ];
  const result = (
    metric: string,
    output: number | undefined,
    unit: string,
    required: string[],
    warnings: string[] = [],
  ): FinanceResult => ({
    metric,
    status: output == null || !Number.isFinite(output) ? "kan_ikke_beregnes" : "ok",
    value: output == null || !Number.isFinite(output) ? null : round(output),
    unit: output == null || !Number.isFinite(output) ? null : unit,
    inputIds: ids(...required),
    missingInputs: required.filter((item) => value(item) == null),
    warnings: [
      ...warnings,
      ...(output == null || !Number.isFinite(output)
        ? []
        : originWarnings(
            required.flatMap((item) => {
              const used = byMetric.get(item);
              return used ? [used] : [];
            }),
          )),
    ],
  });

  const mrr = value("mrr") ?? (value("arr") != null ? value("arr")! / 12 : undefined);
  const arr = value("arr") ?? (value("mrr") != null ? value("mrr")! * 12 : undefined);
  const annualRevenue = value("annual_revenue");
  const revenue =
    value("monthly_revenue") ?? mrr ?? (annualRevenue != null ? annualRevenue / 12 : undefined);
  // Every accepted revenue input is named when none is present, so "missing" is complete.
  const revenueInputs =
    value("monthly_revenue") != null
      ? ["monthly_revenue"]
      : value("mrr") != null
        ? ["mrr"]
        : value("arr") != null
          ? ["arr"]
          : annualRevenue != null
            ? ["annual_revenue"]
            : ["monthly_revenue", "mrr", "arr", "annual_revenue"];
  const opex = value("monthly_operating_expenses");
  const netBurn = opex != null && revenue != null ? opex - revenue : undefined;
  const runway =
    value("cash") != null && netBurn != null && netBurn > 0 ? value("cash")! / netBurn : undefined;
  const grossMargin =
    revenue != null && value("cogs") != null && revenue !== 0
      ? ((revenue - value("cogs")!) / revenue) * 100
      : undefined;
  const cac =
    value("sales_marketing_spend") != null &&
    value("new_customers") != null &&
    value("new_customers")! > 0
      ? value("sales_marketing_spend")! / value("new_customers")!
      : undefined;
  const arpa =
    revenue != null && value("customers") != null && value("customers")! > 0
      ? revenue / value("customers")!
      : undefined;
  const ltv =
    arpa != null &&
    grossMargin != null &&
    value("monthly_churn_rate") != null &&
    value("monthly_churn_rate")! > 0
      ? (arpa * (grossMargin / 100)) / value("monthly_churn_rate")!
      : undefined;

  return [
    result("mrr", mrr, money(text("perMonth")), value("mrr") != null ? ["mrr"] : ["arr"]),
    result("arr", arr, money(text("perYear")), value("arr") != null ? ["arr"] : ["mrr"]),
    result(
      "net_burn",
      netBurn,
      money(text("perMonth")),
      ["monthly_operating_expenses", ...revenueInputs],
      netBurn != null && netBurn <= 0 ? [text("noPositiveBurn")] : [],
    ),
    result(
      "runway",
      runway,
      text("months"),
      ["cash", "monthly_operating_expenses", ...revenueInputs],
      netBurn != null && netBurn <= 0 ? [text("runwayNotMeaningful")] : [],
    ),
    result("gross_margin", grossMargin, "%", [...revenueInputs, "cogs"]),
    result("cac", cac, money(text("perCustomer")), ["sales_marketing_spend", "new_customers"]),
    result("revenue_per_customer", arpa, money(text("perCustomerMonth")), [
      ...revenueInputs,
      "customers",
    ]),
    result("ltv", ltv, money(text("perCustomer")), [
      ...revenueInputs,
      "customers",
      "cogs",
      "monthly_churn_rate",
    ]),
    result("ltv_cac", ltv != null && cac != null && cac > 0 ? ltv / cac : undefined, "x", [
      "sales_marketing_spend",
      "new_customers",
      ...revenueInputs,
      "customers",
      "cogs",
      "monthly_churn_rate",
    ]),
    result(
      "cac_payback",
      cac != null && arpa != null && grossMargin != null && arpa * grossMargin > 0
        ? cac / ((arpa * grossMargin) / 100)
        : undefined,
      text("months"),
      ["sales_marketing_spend", "new_customers", ...revenueInputs, "customers", "cogs"],
    ),
    revenueGrowth(inputs, text, originWarnings),
  ];
}

const FULL_YEAR_DAYS = { min: 350, max: 380 };

function daysBetween(fromIso: string, toIso: string): number {
  return (Date.parse(toIso) - Date.parse(fromIso)) / 86_400_000;
}

/**
 * Year-over-year growth in annual revenue: the two newest full-year figures that are
 * about a year apart, and only when the earlier one is positive. Anything else is "kan ikke
 * beregnes" and names the revenue input as missing, never a guess.
 */
function revenueGrowth(
  inputs: FinancialInput[],
  text: (key: string, vars?: TranslateVars) => string,
  originWarnings: (used: FinancialInput[]) => string[],
): FinanceResult {
  const years = inputs
    .filter(
      (input) =>
        input.metric === "annual_revenue" &&
        input.periodStart &&
        input.periodEnd &&
        Number.isFinite(input.value) &&
        daysBetween(input.periodStart, input.periodEnd) >= FULL_YEAR_DAYS.min &&
        daysBetween(input.periodStart, input.periodEnd) <= FULL_YEAR_DAYS.max,
    )
    .sort((a, b) => b.periodEnd!.localeCompare(a.periodEnd!));
  const [latest, previous] = years;
  const apart = latest && previous ? daysBetween(previous.periodEnd!, latest.periodEnd!) : NaN;
  const usable = latest && previous && apart >= 340 && apart <= 390 && previous.value > 0;
  const value = usable ? round((latest.value / previous.value - 1) * 100) : null;
  return {
    metric: "revenue_growth",
    status: value === null ? "kan_ikke_beregnes" : "ok",
    value,
    unit: value === null ? null : "%",
    inputIds: usable ? [previous.id, latest.id] : [],
    missingInputs: usable ? [] : ["annual_revenue"],
    warnings: usable ? originWarnings([previous, latest]) : [text("growthNeedsTwoYears")],
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
