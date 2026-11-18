/** Display helpers for a fund configuration (shared by the Se view and the editor). */
import type { EditableFundConfig } from "@/lib/funds/config.functions";
import { LANGUAGE_TAGS, type Language } from "@/lib/i18n/language";
import { translate } from "@/lib/i18n/translate";

export function formatEur(value: number, language: Language = "da") {
  return new Intl.NumberFormat(LANGUAGE_TAGS[language], {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(value);
}

export function ticketText(config: EditableFundConfig, language: Language = "da"): string {
  if (config.ticketMinEur == null && config.ticketMaxEur == null) {
    return translate(language, "fundSetup.format.notSet");
  }
  const format = (value: number) => formatEur(value, language);
  return [
    config.ticketMinEur == null ? null : format(config.ticketMinEur),
    config.ticketMaxEur == null ? null : format(config.ticketMaxEur),
  ]
    .filter(Boolean)
    .join(" – ");
}

export function strategyTypeLabel(
  strategyType: EditableFundConfig["strategyType"],
  language: Language = "da",
): string {
  const keys = {
    venture: "fundSetup.format.strategyVenture",
    growth: "fundSetup.format.strategyGrowth",
    thematic: "fundSetup.format.strategyThematic",
    custom: "fundSetup.format.strategyCustom",
  } as const;
  return translate(language, keys[strategyType]);
}
