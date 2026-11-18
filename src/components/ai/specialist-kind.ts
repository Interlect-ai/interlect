import { ECONOMY_COLOR, ownSpecialistColor, specialistColor } from "@/lib/charts/colors";

export type SpecialistKind =
  "team" | "market" | "tech" | "finance" | "deal" | "own1" | "own2" | "own3" | "own4";

const OWN_KINDS = ["own1", "own2", "own3", "own4"] as const;

/** Fondens egen specialist nr. `index` (0 = den første i opsætningen) til sin egen figur. */
export function ownSpecialistKind(index: number): SpecialistKind {
  return OWN_KINDS[((index % OWN_KINDS.length) + OWN_KINDS.length) % OWN_KINDS.length]!;
}

/** Figurens farve, til prikker og toner ved siden af den (fra den fælles farvekilde, b). */
export const SPECIALIST_KIND_COLOR: Record<SpecialistKind, string> = {
  team: specialistColor("people_team"),
  market: specialistColor("product_market_gtm"),
  tech: specialistColor("technology_risk"),
  finance: ECONOMY_COLOR,
  deal: specialistColor("fund_finance_deal"),
  own1: ownSpecialistColor(0),
  own2: ownSpecialistColor(1),
  own3: ownSpecialistColor(2),
  own4: ownSpecialistColor(3),
};

/**
 * Specialistmodulerne i analysemotoren og i Ny investeringstese til en figur. i18n-keep: the
 * Danish names are keys from older setups, never shown.
 */
export function specialistKind(key: string): SpecialistKind {
  switch (key) {
    case "people_team":
    case "Team":
      return "team";
    case "product_market_gtm":
    case "Kunder og marked":
      return "market";
    case "technology_risk":
    case "Produkt og teknologi":
      return "tech";
    case "Økonomi":
      return "finance";
    default:
      return "deal";
  }
}
