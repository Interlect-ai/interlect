/**
 * E2b: forslag til mandatregler ud fra fondens grundlag (stadier, lande, sektorer og ticket).
 * Grundlaget stopper ikke selv en case; kun en mandatregel gør. Forslagene gør det let at
 * gøre grundlaget til regler, men et menneske vælger dem og kan skærpe dem til bindende.
 *
 * Reglerne henviser til grundlaget ("en af fondens valgte geografier") i stedet for at kopiere
 * listen, så de ikke forældes, når grundlaget ændres; prompten viser altid de aktuelle værdier.
 * Nøglerne er skabelonernes egne, så en fond fra en skabelon ikke får samme regel to gange.
 * Beskrivelsen siger altid, at manglende evidens er ukendt, ikke et brud (princip 7).
 */

import { geographyText, sectorText, stageText } from "./basis-labels.ts";
import { translate, type MessageKey } from "../i18n/translate.ts";
import { LANGUAGE_TAGS, type Language } from "../i18n/language.ts";

export const SECTOR_AGNOSTIC = "Sektoragnostisk";

export type GateSuggestion = {
  key: string;
  label: string;
  description: string;
  treatment: "hard" | "review";
  /** Grundlaget, reglen henviser til, vist ved forslaget (ikke en del af reglen). */
  basis: string;
};

export type GateSuggestionBasis = {
  stages: string[];
  geographies: string[];
  sectors: string[];
  ticketMinEur: number | null;
  ticketMaxEur: number | null;
};

/** Regler, hvis nøgle står fast, når navnet rettes (så forslaget ikke dukker op igen). */
export const BASIS_GATE_KEYS = new Set([
  "geography_fit",
  "stage_fit",
  "sector_fit",
  "ticket_fit",
  "liquidity_ticket",
]);

/** Skabelonregler, der dækker det samme som et forslag. */
const COVERED_BY: Record<string, string[]> = {
  ticket_fit: ["liquidity_ticket"],
};

function eur(value: number, language: Language) {
  return new Intl.NumberFormat(LANGUAGE_TAGS[language], {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(value);
}

function ticketRange(min: number | null, max: number | null, language: Language) {
  if (min !== null && max !== null) return `${eur(min, language)} – ${eur(max, language)}`;
  if (min !== null)
    return translate(language, "fundEditor.rules.ticketAtLeast", { amount: eur(min, language) });
  if (max !== null)
    return translate(language, "fundEditor.rules.ticketAtMost", { amount: eur(max, language) });
  return null;
}

/** Forslag, der ikke allerede findes som regel, i fast rækkefølge. Alle til review. */
export function suggestBasisGates(
  basis: GateSuggestionBasis,
  existingKeys: Iterable<string>,
  language: Language = "da",
): GateSuggestion[] {
  const existing = new Set(existingKeys);
  const suggestions: GateSuggestion[] = [];
  // Saved in the fund's setup when accepted, so in the language of the page.
  const note = translate(language, "fundEditor.gateText.unknownNote");
  const text = (label: MessageKey, description: MessageKey) => ({
    label: translate(language, label),
    description: `${translate(language, description)} ${note}`,
  });
  const geographies = basis.geographies.filter((item) => item.trim());
  if (geographies.length) {
    suggestions.push({
      key: "geography_fit",
      ...text(
        "fundEditor.gateText.geographyFitLabel",
        "fundEditor.gateText.geographyFitDescription",
      ),
      treatment: "review",
      basis: geographies.map((value) => geographyText(value, language)).join(", "),
    });
  }
  const stages = basis.stages.filter((item) => item.trim());
  if (stages.length) {
    suggestions.push({
      key: "stage_fit",
      ...text("fundEditor.gateText.stageFitLabel", "fundEditor.gateText.stageFitDescription"),
      treatment: "review",
      basis: stages.map((value) => stageText(value, language)).join(", "),
    });
  }
  const sectors = basis.sectors.filter((item) => item.trim() && item !== SECTOR_AGNOSTIC);
  if (sectors.length && !basis.sectors.includes(SECTOR_AGNOSTIC)) {
    suggestions.push({
      key: "sector_fit",
      ...text("fundEditor.gateText.sectorFitLabel", "fundEditor.gateText.sectorFitDescription"),
      treatment: "review",
      basis: sectors.map((value) => sectorText(value, language)).join(", "),
    });
  }
  const ticket = ticketRange(basis.ticketMinEur, basis.ticketMaxEur, language);
  if (ticket) {
    suggestions.push({
      key: "ticket_fit",
      ...text("fundEditor.gateText.ticketFitLabel", "fundEditor.gateText.ticketFitDescription"),
      treatment: "review",
      basis: ticket,
    });
  }
  return suggestions.filter(
    (suggestion) =>
      !existing.has(suggestion.key) &&
      !(COVERED_BY[suggestion.key] ?? []).some((key) => existing.has(key)),
  );
}
