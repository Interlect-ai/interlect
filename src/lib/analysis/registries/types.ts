/**
 * Fælles adapter-lag for udenlandske selskabsregistre. Ét land = én adapter, der kan
 * finde selskabet (identitet) og hente dets regnskaber som de samme regnskabsposter, den danske
 * XBRL-vej giver (`metric`-navnene i `financial-labels.ts`), så nøgletalsmotoren, gates og
 * scoren regner ens for alle lande. Tal kommer kun fra registret, aldrig fra en AI, og beløb
 * står i registrets valuta uden omregning.
 *
 * Danmark har sin egen, ældre vej (`cvr-lookup.ts` og `financial-statements.ts`), men gemmer
 * gennem samme fælles lagring (`storeRegistryStatements`).
 *
 * Ren fil (ingen netværk, ingen database).
 */

/** Lande med en udenlandsk adapter. Danmark (DK) har sin egen vej. */
export const FOREIGN_REGISTRY_COUNTRIES = [
  "NO",
  "SE",
  "FI",
  "EE",
  "LV",
  "LT",
  "FR",
  "PL",
  "NL",
  "DE",
  "ES",
  "IT",
] as const;
export type ForeignRegistryCountry = (typeof FOREIGN_REGISTRY_COUNTRIES)[number];
export type RegistryCountry = "DK" | ForeignRegistryCountry;

export function isForeignRegistryCountry(value: unknown): value is ForeignRegistryCountry {
  return (FOREIGN_REGISTRY_COUNTRIES as readonly unknown[]).includes(value);
}

/** Hvad registernummeret hedder i visningen: "CVR" i Danmark, ellers landets eget navn. */
export function registryNumberLabel(country: RegistryCountry | string | null | undefined): string {
  if (country === "FI") return "Y-tunnus";
  if (country === "EE") return "Registrikood";
  if (country === "LV") return "Reg.nr.";
  if (country === "LT") return "Įmonės kodas";
  if (country === "FR") return "SIREN";
  if (country === "PL") return "KRS";
  if (country === "NL") return "KVK";
  // Tyskland, Spanien og Italien kendes gennem GLEIF; nøglen er LEI'en.
  if (country === "DE" || country === "ES" || country === "IT") return "LEI";
  return !country || country === "DK" ? "CVR" : "Org.nr.";
}

/** Registrets offentlige side om selskabet; null, hvor registret ikke har en (Sverige, Letland, Polen, Holland). */
export function registryCompanyUrl(
  country: RegistryCountry | string,
  number: string,
): string | null {
  if (country === "NO") return `https://virksomhet.brreg.no/nb/oppslag/enheter/${number}`;
  if (country === "SE" || country === "LV" || country === "PL" || country === "NL") return null;
  if (country === "FI") return `https://tietopalvelu.ytj.fi/yritys/${number}`;
  if (country === "EE") return `https://ariregister.rik.ee/est/company/${number}`;
  if (country === "LT") return `https://www.registrucentras.lt/jar/p/dok.php?kod=${number}`;
  if (country === "FR") return `https://annuaire-entreprises.data.gouv.fr/entreprise/${number}`;
  if (country === "DE" || country === "ES" || country === "IT") {
    return `https://search.gleif.org/#/record/${number}`;
  }
  return `https://datacvr.virk.dk/enhed/virksomhed/${number}`;
}

/** Et selskab, som registret kender det. */
export interface RegistryCompany {
  country: ForeignRegistryCountry;
  /** Registernummeret i landets kanoniske skrivemåde (Norge: 9 cifre; Finland: 1234567-8). */
  registryNumber: string;
  name: string;
  /** Tidligere navne i registret (et omdøbt selskab kan stå under sit gamle navn i decket). */
  formerNames: string[];
  /** Falsk ved konkurs, likvidation eller sletning; `status` siger hvilken. */
  active: boolean;
  status: string;
  /** Hjemmesiden, som selskabet selv har oplyst til registret. */
  website: string | null;
  /** Registrets offentlige side om selskabet. */
  registryUrl: string;
}

/** Ét regnskabsår fra registret. */
export interface RegistryStatement {
  periodStart: string;
  periodEnd: string;
  /** ISO-valutakode, som registret oplyser den (fx NOK, USD). */
  currency: string;
  /** Præcis den post i registret, tallene står i (kan citeres). */
  sourceDocumentUrl: string;
  /** Kort beskrivelse af regnskabstypen, vist under tallene. */
  reportingClassText: string | null;
  /** null: registret oplyser det ikke. */
  goingConcernNote: boolean | null;
  /** `tag` er registrets eget feltnavn, så man kan se, hvor tallet kom fra. */
  lineItems: Array<{ metric: string; value: number; tag: string }>;
}

export interface RegistryStatementsResult {
  /** Nyeste først, alle i samme valuta. */
  statements: RegistryStatement[];
  /** Ikke-blokerende forbehold, fx et år i en anden valuta, der er udeladt. */
  warnings: string[];
}

export interface RegistryAdapter {
  country: ForeignRegistryCountry;
  /** Registrets navn, som det vises og citeres, fx "Brønnøysundregistrene". */
  registryName: string;
  /** Hvad nummeret hedder i landet, fx "Org.nr.". */
  numberLabel: string;
  /** Hvordan registret leverer regnskaberne (`financial_statements.source_kind`). */
  sourceKind: "registry_json" | "ixbrl_structured" | "xbrl_structured";
  /** Kan registret søge på navn? (Bolagsverkets gratis API kan ikke.) */
  supportsNameSearch: boolean;
  /** Er adapteren sat op (fx en nøgle, der skal ligge i miljøet)? */
  configured(): boolean;
  /** Cifrene i et gyldigt registernummer (kontrolciffer tjekket), ellers null. */
  normalizeNumber(raw: string): string | null;
  /** Gyldige registernumre nævnt i en tekst (deck, website), fx i en footer. */
  findNumbersInText(text: string): string[];
  /**
   * Et fundet nummer, som det skrives i en besked. Standard er "<numberLabel> <nummer>"; GLEIF-
   * landene finder landets egne numre ("HRB 225439"), der allerede bærer deres mærke.
   */
  describeNumber?(number: string): string;
  /** Op til 10 selskaber, registret selv rangerer bedst for navnet. */
  searchByName(name: string): Promise<RegistryCompany[]>;
  /** null, når nummeret ikke findes i registret. */
  lookupByNumber(registryNumber: string): Promise<RegistryCompany | null>;
  /** Tom liste, når selskabet ikke har indsendt regnskaber, registret kan levere. */
  fetchStatements(registryNumber: string): Promise<RegistryStatementsResult>;
}
