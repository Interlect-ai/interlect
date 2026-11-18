import type { Language } from "../i18n/language.ts";
import { translate, type MessageKey } from "../i18n/translate.ts";

/** The finance metrics and inputs that have a name in the dictionary (finance.labels). */
const FINANCE_LABEL_KEYS = new Set([
  "mrr",
  "arr",
  "net_burn",
  "runway",
  "gross_margin",
  "cac",
  "revenue_per_customer",
  "ltv",
  "ltv_cac",
  "cac_payback",
  "revenue_growth",
  "monthly_revenue",
  "annual_revenue",
  "cash",
  "monthly_operating_expenses",
  "cogs",
  "sales_marketing_spend",
  "new_customers",
  "customers",
  "monthly_churn_rate",
]);

/** Name of a deterministic finance metric or input in the fund's language. */
export function financeLabel(metric: string, language: Language = "da") {
  return FINANCE_LABEL_KEYS.has(metric)
    ? translate(language, `finance.labels.${metric}` as MessageKey)
    : metric.replaceAll("_", " ");
}
