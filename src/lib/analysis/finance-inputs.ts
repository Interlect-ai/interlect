import { moneyBasisOfUnit, type FinancialInput, type FinancialInputOrigin } from "./finance.ts";

const MONETARY = new Set([
  "mrr",
  "arr",
  "monthly_revenue",
  "annual_revenue",
  "cash",
  "monthly_operating_expenses",
  "cogs",
  "sales_marketing_spend",
]);

/**
 * Which figures `calculateFinance` gets. The specialist's own figures come first; a
 * metric the specialist did not give is filled from the register's annual report (stated
 * figures, plus the operating costs the code derives from them), so burn, runway and growth
 * are calculated whenever the register has the numbers. Every figure is marked with where it
 * comes from, so a result can say whether it rests on the register or on the company's word.
 */

/** Source types that are a company register's annual report (not the company's own words). */
const REGISTRY_SOURCE_TYPES = new Set(["cvr_regnskab", "registry_regnskab"]);

/** A saved data point with the source type of the evidence it points at (embedded select). */
export interface FinancePointRow {
  id: string;
  metric: string;
  value: number | string;
  unit: string;
  period_start: string | null;
  period_end: string | null;
  evidence_items?: unknown;
}

/** Select string that gives `FinancePointRow`s. */
export const FINANCE_POINT_SELECT =
  "id, metric, value, unit, period_start, period_end, evidence_items(sources(source_type))";

function first<T>(value: T | T[] | null | undefined): T | undefined {
  return Array.isArray(value) ? value[0] : (value ?? undefined);
}

function sourceTypeOf(row: FinancePointRow): string | undefined {
  const evidence = first(row.evidence_items as { sources?: unknown } | null | undefined);
  const source = first(evidence?.sources as { source_type?: string } | null | undefined);
  return source?.source_type;
}

/** The register's metrics that were not stated but derived by the code (registry-data-points.ts). */
const DERIVED_REGISTRY_METRICS = new Set(["monthly_operating_expenses"]);

export function toFinancialInput(row: FinancePointRow): FinancialInput {
  const sourceType = sourceTypeOf(row);
  const origin: FinancialInputOrigin | undefined = sourceType
    ? REGISTRY_SOURCE_TYPES.has(sourceType)
      ? "register"
      : "reported"
    : undefined;
  return {
    id: row.id,
    metric: row.metric,
    value: Number(row.value),
    unit: row.unit,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    ...(origin ? { origin } : {}),
    ...(origin === "register" && DERIVED_REGISTRY_METRICS.has(row.metric)
      ? { estimated: true }
      : {}),
  };
}

const REVENUE_METRICS = ["mrr", "arr", "monthly_revenue", "annual_revenue"];

/**
 * `caseRows` are all data points saved on the case; `specialistIds` are the ones this run's
 * specialist gave. The specialist's figures stay as they are and are never mixed into a
 * register burn. The register fills in groups that belong to one period:
 * - burn: the operating costs of the newest year that has them, with annual revenue (every
 *   year, so growth can compare two) , only when the specialist gave no revenue and no costs;
 * - cash: the cash of that same year (else the newest), when the specialist gave none.
 * Nothing is filled when its currency or scale differs from the specialist's own figures.
 */
export function financeInputsFor(
  caseRows: FinancePointRow[],
  specialistIds: ReadonlySet<string>,
): FinancialInput[] {
  const specialist = caseRows.filter((row) => specialistIds.has(row.id)).map(toFinancialInput);
  const has = (metric: string) => specialist.some((input) => input.metric === metric);
  const register = caseRows
    .filter((row) => !specialistIds.has(row.id))
    .map(toFinancialInput)
    .filter((input) => input.origin === "register");
  const newest = (metric: string, periodEnd?: string | null) =>
    register
      .filter((input) => input.metric === metric && (!periodEnd || input.periodEnd === periodEnd))
      .sort((a, b) => (b.periodEnd ?? "").localeCompare(a.periodEnd ?? ""))[0];

  const fill: FinancialInput[] = [];
  const costs = newest("monthly_operating_expenses");
  const burnWanted = costs && !has("monthly_operating_expenses") && !REVENUE_METRICS.some(has);
  if (burnWanted) {
    const basis = moneyBasisOfUnit(costs.unit);
    fill.push(
      costs,
      ...register.filter(
        (input) => input.metric === "annual_revenue" && moneyBasisOfUnit(input.unit) === basis,
      ),
    );
  }
  if (!has("cash")) {
    const cash = (burnWanted ? newest("cash", costs.periodEnd) : undefined) ?? newest("cash");
    if (cash) fill.push(cash);
  }
  const bases = new Set(
    [...specialist, ...fill]
      .filter((input) => MONETARY.has(input.metric))
      .map((input) => moneyBasisOfUnit(input.unit)),
  );
  // A register figure in another currency or scale would void the specialist's own results.
  return bases.size > 1 && specialist.length ? specialist : [...specialist, ...fill];
}
