/**
 * Visning af nøgletal fra nøgletalsmotoren i fondens sprog (dansk er standard). Delt af
 * screeningens økonomikort og den dybe analyses økonomisektion, så et tal altid ser ens ud.
 */
import type { FinancialMetric, MetricUnit } from "./financial-metrics";
import { DEFAULT_LANGUAGE, LANGUAGE_TAGS, type Language } from "../i18n/language.ts";
import { translate } from "../i18n/translate.ts";

type Digits = "decimal" | "whole" | "twoDecimals";
const FORMATS: Record<Digits, Intl.NumberFormatOptions> = {
  decimal: { maximumFractionDigits: 1 },
  whole: { maximumFractionDigits: 0 },
  twoDecimals: { maximumFractionDigits: 2 },
};
const formatters = new Map<string, Intl.NumberFormat>();

function numbers(language: Language, digits: Digits): Intl.NumberFormat {
  const id = `${language}:${digits}`;
  let format = formatters.get(id);
  if (!format) {
    format = new Intl.NumberFormat(LANGUAGE_TAGS[language], FORMATS[digits]);
    formatters.set(id, format);
  }
  return format;
}

/** Kompakte beløb: 839.709.000 → "840 mio.", 3.400.000 → "3,4 mio.". */
export function formatDkkCompact(value: number, language: Language = DEFAULT_LANGUAGE): string {
  const sign = value < 0 ? "−" : "";
  const abs = Math.abs(value);
  const decimal = numbers(language, "decimal");
  const whole = numbers(language, "whole");
  if (abs >= 1e9) {
    return (
      sign + translate(language, "finance.format.billion", { value: decimal.format(abs / 1e9) })
    );
  }
  if (abs >= 1e7) {
    return sign + translate(language, "finance.format.million", { value: whole.format(abs / 1e6) });
  }
  if (abs >= 1e6) {
    return (
      sign + translate(language, "finance.format.million", { value: decimal.format(abs / 1e6) })
    );
  }
  if (abs >= 1e3) {
    return (
      sign + translate(language, "finance.format.thousand", { value: whole.format(abs / 1e3) })
    );
  }
  return `${sign}${whole.format(abs)}`;
}

export function formatRunway(months: number, language: Language = DEFAULT_LANGUAGE): string {
  if (months >= 120) return translate(language, "finance.format.overTenYears");
  if (months >= 36) {
    return translate(language, "finance.format.years", {
      value: numbers(language, "decimal").format(months / 12),
    });
  }
  return translate(language, "finance.format.months", {
    value: numbers(language, "whole").format(months),
  });
}

export function formatByUnit(
  unit: MetricUnit,
  value: number,
  language: Language = DEFAULT_LANGUAGE,
): string {
  switch (unit) {
    case "dkk":
      return formatDkkCompact(value, language);
    case "percent":
      return translate(language, "finance.format.percent", {
        value: `${value < 0 ? "−" : ""}${numbers(language, "decimal").format(Math.abs(value))}`,
      });
    case "months":
      return formatRunway(value, language);
    case "days":
      return translate(language, "finance.format.days", {
        value: numbers(language, "whole").format(value),
      });
    case "count":
    case "persons":
      return numbers(language, "whole").format(value);
    default:
      // Forholdstal (likviditetsgrad, gældsgrad) med to decimaler: 0,77, ikke 0,8.
      return `${value < 0 ? "−" : ""}${numbers(language, "twoDecimals").format(Math.abs(value))}`;
  }
}

/** Et nøgletal med sin enhed; beløb i en anden valuta end DKK får valutakoden på ("136 mio. NOK"). */
export function formatMetricValue(
  metric: FinancialMetric,
  value: number,
  language: Language = DEFAULT_LANGUAGE,
): string {
  const text = formatByUnit(metric.unit, value, language);
  return metric.currency ? `${text} ${metric.currency}` : text;
}

/**
 * "kr." for DKK; ellers valutakoden (NOK, USD). Tal fra et udenlandsk register vises i
 * selskabets egen valuta og omregnes aldrig. Udeladt = DKK.
 */
export function currencySuffix(
  currency: string | null | undefined,
  language: Language = DEFAULT_LANGUAGE,
): string {
  return !currency || currency === "DKK" ? translate(language, "finance.format.dkk") : currency;
}

/** Et input (regnskabspost) vist med sin enhed. */
export function formatInputValue(
  metric: string,
  value: number,
  currency?: string,
  language: Language = DEFAULT_LANGUAGE,
): string {
  return metric === "average_employees"
    ? translate(language, "finance.format.people", {
        value: numbers(language, "whole").format(value),
      })
    : `${formatDkkCompact(value, language)} ${currencySuffix(currency, language)}`;
}

/**
 * Hvert nøgletal har sin faste farve fra den validerede palet (dataviz-validatoren,
 * lys og mørk), så farven følger nøgletallet på tværs af siderne.
 */
export const METRIC_COLOR: Record<string, string> = {
  revenue: "var(--series-1)",
  gross_profit: "var(--series-1)",
  ebitda: "var(--series-2)",
  ebit: "var(--series-2)",
  ebitda_margin: "var(--series-2)",
  net_result: "var(--series-3)",
  equity: "var(--series-7)",
  equity_ratio: "var(--series-7)",
  cash: "var(--series-6)",
  current_ratio: "var(--series-6)",
  runway_today: "var(--series-6)",
  employees: "var(--series-5)",
};

export function metricColor(key: string): string {
  return METRIC_COLOR[key] ?? "var(--series-4)";
}
