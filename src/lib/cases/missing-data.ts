/**
 * "Kan ikke beregnes": why a finance figure could not be calculated, and the mail draft that
 * asks the founder for what is missing (moved unchanged from the old Økonomi section).
 * No founder e-mail address is stored in the data model, so the link opens a draft without a
 * recipient that the user addresses themselves, instead of inventing an address.
 */
import { DEFAULT_LANGUAGE, type Language } from "../i18n/language.ts";
import { translate, type MessageKey } from "../i18n/translate.ts";

/** Metrics that read the same in every language ("MRR"), and the dictionary keys of the rest. */
const financialMetricLabels: Record<string, string> = {
  mrr: "MRR",
  arr: "ARR",
  net_burn: "Net burn",
  runway: "Runway",
  cac: "CAC",
  ltv: "LTV",
  ltv_cac: "LTV/CAC",
  cac_payback: "CAC payback",
};
const financialMetricKeys: Record<string, MessageKey> = {
  gross_margin: "screening.missing.metricGrossMargin",
  revenue_growth: "screening.missing.metricRevenueGrowth",
  revenue_per_customer: "screening.missing.metricRevenuePerCustomer",
};

export function financialMetricLabel(
  metric: string,
  language: Language = DEFAULT_LANGUAGE,
): string {
  const key = financialMetricKeys[metric];
  if (key) return translate(language, key);
  return financialMetricLabels[metric] ?? metric.replaceAll("_", " ");
}

const financialInputLabels: Record<string, string> = {
  mrr: "MRR",
  arr: "ARR",
};
const financialInputKeys: Record<string, MessageKey> = {
  monthly_revenue: "screening.missing.inputMonthlyRevenue",
  annual_revenue: "screening.missing.inputAnnualRevenue",
  cash: "screening.missing.inputCash",
  monthly_operating_expenses: "screening.missing.inputMonthlyOpex",
  cogs: "screening.missing.inputCogs",
  sales_marketing_spend: "screening.missing.inputSalesMarketing",
  new_customers: "screening.missing.inputNewCustomers",
  customers: "screening.missing.inputCustomers",
  monthly_churn_rate: "screening.missing.inputMonthlyChurn",
  monthly_growth_rate: "screening.missing.inputMonthlyGrowth",
};

export function financialInputLabel(input: string, language: Language = DEFAULT_LANGUAGE): string {
  const key = financialInputKeys[input];
  if (key) return translate(language, key);
  return financialInputLabels[input] ?? input.replaceAll("_", " ");
}

/** The reason a calculation has no value: the missing inputs, else the first warning. */
export function unresolvedReason(
  calc: { missingInputs: string[]; warnings: string[] },
  language: Language = DEFAULT_LANGUAGE,
): string {
  return calc.missingInputs.length > 0
    ? translate(language, "screening.missing.lacks", {
        inputs: calc.missingInputs.map((input) => financialInputLabel(input, language)).join(", "),
      })
    : (calc.warnings[0] ?? translate(language, "screening.missing.cannotCalculate"));
}

export function missingDataMailto(
  companyName: string,
  calculations: Array<{ metric: string; missingInputs: string[]; warnings: string[] }>,
  language: Language = DEFAULT_LANGUAGE,
): string {
  const subject = translate(language, "screening.missing.mailSubject", { company: companyName });
  const lines = calculations.map(
    (calc) =>
      `- ${financialMetricLabel(calc.metric, language)}: ${unresolvedReason(calc, language)}`,
  );
  const body = [
    translate(language, "screening.missing.mailHello"),
    "",
    translate(language, "screening.missing.mailBody"),
    "",
    ...lines,
  ].join("\n");
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
