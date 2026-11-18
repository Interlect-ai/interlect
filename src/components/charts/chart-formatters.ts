import { DEFAULT_LANGUAGE, LANGUAGE_TAGS, type Language } from "@/lib/i18n/language";

/**
 * Intl formatters for the chart primitives. Danish keeps the en-US output it has
 * always had, so the Danish interface does not change; an English fund gets en-GB.
 */
function chartLocale(language: Language): string {
  return language === "da" ? "en-US" : LANGUAGE_TAGS[language];
}

function buildFormatters(language: Language) {
  const locale = chartLocale(language);
  return {
    shortDateFmt: new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }),
    weekdayDateFmt: new Intl.DateTimeFormat(locale, {
      weekday: "short",
      month: "short",
      day: "numeric",
    }),
    hmsTimeFmt: new Intl.DateTimeFormat(locale, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }),
    // `Intl.NumberFormat.prototype.format` is a bound getter — safe to extract.
    intFmt: new Intl.NumberFormat(locale).format,
  };
}

export type ChartFormatters = ReturnType<typeof buildFormatters>;

const cache = new Map<Language, ChartFormatters>();

/** The chart formatters for `language` (built once per language). */
export function chartFormattersFor(language: Language = DEFAULT_LANGUAGE): ChartFormatters {
  let formatters = cache.get(language);
  if (!formatters) {
    formatters = buildFormatters(language);
    cache.set(language, formatters);
  }
  return formatters;
}

const danish = chartFormattersFor("da");

/** The Danish (default) formatters; use `chartFormattersFor(useLanguage())` for the fund's language. */
export const shortDateFmt = danish.shortDateFmt;
export const weekdayDateFmt = danish.weekdayDateFmt;
export const hmsTimeFmt = danish.hmsTimeFmt;
export const intFmt = danish.intFmt;
