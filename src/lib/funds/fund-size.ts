/**
 * E2b: fondsstørrelse og hvor stor en ticket er i forhold til fonden. Regnet i kode
 * (princip 6), så prompten og guiden viser samme tal, og AI'en aldrig selv regner andelen.
 */

import { translate } from "../i18n/translate.ts";
import { LANGUAGE_TAGS, type Language } from "../i18n/language.ts";

export type TicketShare = { minPct: number | null; maxPct: number | null };

/** Samme regel som databasen (0026): ingen ticketgrænse må være større end fonden. */
export function ticketExceedsFund(
  fundSizeEur: number | null,
  ticketMinEur: number | null,
  ticketMaxEur: number | null,
): boolean {
  if (fundSizeEur === null || !Number.isFinite(fundSizeEur) || fundSizeEur <= 0) return false;
  return Math.max(ticketMinEur ?? 0, ticketMaxEur ?? 0) > fundSizeEur;
}

/** Ticket som procent af fonden; null, når fondsstørrelsen eller begge ticketgrænser mangler. */
export function ticketShareOfFund(
  fundSizeEur: number | null,
  ticketMinEur: number | null,
  ticketMaxEur: number | null,
): TicketShare | null {
  if (fundSizeEur === null || !Number.isFinite(fundSizeEur) || fundSizeEur <= 0) return null;
  if (ticketMinEur === null && ticketMaxEur === null) return null;
  const pct = (value: number | null) =>
    value === null || !Number.isFinite(value) ? null : (value / fundSizeEur) * 100;
  return { minPct: pct(ticketMinEur), maxPct: pct(ticketMaxEur) };
}

function percent(value: number, digits: number, language: Language) {
  return `${value.toLocaleString(LANGUAGE_TAGS[language], { maximumFractionDigits: digits })} %`;
}

type ShareKey = "range" | "atMost" | "atLeast";
type SharePhrase = (key: ShareKey, values: Record<string, string>) => string;

const SHARE_KEYS = {
  range: "fundSetup.fundSize.range",
  atMost: "fundSetup.fundSize.atMost",
  atLeast: "fundSetup.fundSize.atLeast",
} as const;

// i18n-keep: the analysis prompt's own words; the screen's words are in the dictionary.
const PROMPT_SHARE: Record<ShareKey, string> = {
  range: "{min}–{max} af investeringskapitalen",
  atMost: "højst {value} af investeringskapitalen",
  atLeast: "mindst {value} af investeringskapitalen",
};

/** Samme antal decimaler i begge ender; `phrase` sætter ordene om procenterne. */
function shareText(share: TicketShare | null, language: Language, phrase: SharePhrase) {
  if (!share) return null;
  const { minPct, maxPct } = share;
  const smallest = Math.min(minPct ?? Infinity, maxPct ?? Infinity);
  const digits = smallest < 1 ? 2 : 1;
  const percentOf = (value: number) => percent(value, digits, language);
  if (minPct !== null && maxPct !== null) {
    return phrase("range", { min: percentOf(minPct), max: percentOf(maxPct) });
  }
  if (maxPct !== null) return phrase("atMost", { value: percentOf(maxPct) });
  if (minPct !== null) return phrase("atLeast", { value: percentOf(minPct) });
  return null;
}

/** "0,83 %–6,67 % af kapitalen" eller "højst 6,7 % af kapitalen" på skærmen. */
export function ticketShareText(
  share: TicketShare | null,
  language: Language = "da",
): string | null {
  return shareText(share, language, (key, values) => translate(language, SHARE_KEYS[key], values));
}

/**
 * Linje til analysens kontekst; tom, når investeringskapitalen ikke er angivet. Prompten har sine
 * egne ord, adskilt fra skærmens (skiftede "fonden" ud med "investeringskapitalen").
 */
export function fundSizePromptLine(
  fundSizeEur: number | null,
  ticketMinEur: number | null,
  ticketMaxEur: number | null,
): string {
  if (fundSizeEur === null || !Number.isFinite(fundSizeEur) || fundSizeEur <= 0) return "";
  const share = shareText(
    ticketShareOfFund(fundSizeEur, ticketMinEur, ticketMaxEur),
    "da",
    (key, values) =>
      PROMPT_SHARE[key].replace(/\{(\w+)\}/g, (_, name: string) => values[name] ?? ""),
  );
  // i18n-keep: a line in the analysis prompt.
  return `Investeringskapital: ${Math.round(fundSizeEur)} EUR${share ? `; en ticket er ${share} (regnet i kode)` : ""}.`;
}
