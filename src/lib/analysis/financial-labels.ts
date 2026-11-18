import type { Language } from "../i18n/language.ts";
import { translate, type MessageKey } from "../i18n/translate.ts";

/** Danske navne på de regnskabsposter, vi læser fra XBRL-årsrapporter. Delt af
 * server (evidenstekster) og UI (regnskabspanel), så de aldrig går i utakt. */
export const FINANCIAL_METRIC_LABELS_DA: Record<string, string> = {
  revenue: "Nettoomsætning",
  gross_profit: "Bruttofortjeneste",
  cost_of_sales: "Vareforbrug",
  raw_materials: "Råvarer og hjælpematerialer",
  other_external_expenses: "Andre eksterne omkostninger",
  employee_expense: "Personaleomkostninger",
  depreciation: "Af- og nedskrivninger",
  operating_result: "Resultat af primær drift",
  finance_income: "Finansielle indtægter",
  finance_expenses: "Finansielle omkostninger",
  result_before_tax: "Resultat før skat",
  tax_expense: "Skat af årets resultat",
  net_result: "Årets resultat",
  assets: "Aktiver i alt",
  noncurrent_assets: "Anlægsaktiver",
  current_assets: "Omsætningsaktiver",
  inventories: "Varebeholdninger",
  trade_receivables: "Tilgodehavender fra salg",
  cash: "Likvide beholdninger",
  equity: "Egenkapital",
  contributed_capital: "Indskudt kapital",
  retained_earnings: "Overført resultat",
  proposed_dividend: "Foreslået udbytte",
  provisions: "Hensatte forpligtelser",
  liabilities: "Gæld i alt",
  longterm_liabilities: "Langfristet gæld",
  shortterm_liabilities: "Kortfristet gæld",
  trade_payables: "Leverandørgæld",
  liabilities_and_equity: "Passiver i alt",
  cash_flow_operating: "Pengestrøm fra drift",
  cash_flow_investing: "Pengestrøm fra investering",
  cash_flow_financing: "Pengestrøm fra finansiering",
  average_employees: "Gennemsnitligt antal ansatte",
};

/**
 * The name of a line item for the screen. Danish is the const above, unchanged for the
 * server's evidence texts; other languages read the dictionary (finance.metric).
 */
export function financialMetricLabel(metric: string, language: Language = "da"): string {
  const danish = FINANCIAL_METRIC_LABELS_DA[metric];
  if (danish === undefined) return metric.replaceAll("_", " ");
  return language === "da" ? danish : translate(language, `finance.metric.${metric}` as MessageKey);
}
