/**
 * Fase B: hvem analyserer vi? Rene funktioner, ingen AI og ingen netværk.
 *
 * - CVR-numre findes i casens eget materiale (deck og website) og tjekkes med
 *   Erhvervsstyrelsens modulus 11-regel, før de bruges.
 * - Match-scoren regnes i kode ud fra navngivne signaler, så kortet "Er dette det
 *   rigtige selskab?" altid kan vise, hvorfor Interlect er sikker eller usikker.
 */

const CVR_WEIGHTS = [2, 7, 6, 5, 4, 3, 2, 1] as const;

/** Erhvervsstyrelsens kontrolciffer-regel for CVR-numre (modulus 11). */
export function isValidCvrNumber(value: string): boolean {
  if (!/^[1-9][0-9]{7}$/.test(value)) return false;
  const sum = CVR_WEIGHTS.reduce(
    (total, weight, index) => total + weight * Number(value[index]),
    0,
  );
  return sum % 11 === 0;
}

// "CVR 12345678", "CVR-nr.: 12 34 56 78", "cvr.nr 12345678", "VAT DK12345678", "SE-nr. DK 12345678".
// Et løst "DK 12 34 56 78" tælles ikke: det rammer domæner som "firma.dk" efterfulgt af et
// telefonnummer, og hvert 11. telefonnummer består kontrolcifferet.
const CVR_PATTERN =
  /(?:\bcvr\b[\s.:-]*(?:nr|nummer|no)?[\s.:-]*|\b(?:vat|moms|se)[\s.:-]*(?:nr|no)?[\s.:-]*dk[\s-]?)((?:\d[\s.]?){7}\d)\b/gi;

/**
 * CVR-numre nævnt i en tekst, i den rækkefølge de optræder, uden dubletter. Kun
 * numre, der står ved "CVR", "VAT DK" eller "DK", og som består kontrolcifferet.
 */
export function findCvrNumbers(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(CVR_PATTERN)) {
    const digits = (match[1] ?? "").replace(/[\s.]/g, "");
    if (isValidCvrNumber(digits) && !found.includes(digits)) found.push(digits);
  }
  return found;
}

const LEGAL_SUFFIXES =
  /\b(aps|a\/s|as|ivs|i\/s|p\/s|k\/s|smba|amba|fmba|holding|group|gruppen|ltd|limited|inc|gmbh|ab|oy|bv|llc|plc|sa|sas)\b\.?/gi;

/** Selskabsnavn uden selskabsform og tegn, til sammenligning: "Too Good To Go ApS" → "toogoodtogo". */
export function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(LEGAL_SUFFIXES, " ")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/æ/g, "ae")
    .replace(/ø/g, "oe")
    .replace(/å/g, "aa")
    .replace(/[^a-z0-9]/g, "");
}

/** "https://www.toogoodtogo.dk/da" → "toogoodtogo.dk". */
export function hostOf(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(/^[a-z]+:\/\//i.test(value) ? value : `https://${value}`);
    return url.hostname.replace(/^www\./, "").toLowerCase() || null;
  } catch {
    return null;
  }
}

/** Domænets navnedel uden TLD: "toogoodtogo.co.uk" → "toogoodtogo". */
function domainLabel(host: string): string {
  const parts = host.split(".");
  const secondLevel = new Set(["co", "com", "org", "net", "gov", "ac"]);
  const trimmed =
    parts.length > 2 && secondLevel.has(parts[parts.length - 2]!)
      ? parts.slice(0, -2)
      : parts.slice(0, -1);
  return (trimmed[trimmed.length - 1] ?? parts[0] ?? "").replace(/[^a-z0-9]/g, "");
}

/** Deler to navne en tydelig kerne? Fx "Too Good To Go" og "toogoodtogo.dk". */
export function namesMatch(a: string, b: string): boolean {
  const left = normalizeCompanyName(a);
  const right = normalizeCompanyName(b);
  if (left.length < 3 || right.length < 3) return false;
  return left === right || left.includes(right) || right.includes(left);
}

/** Præcis samme navn, når selskabsform og tegn er fjernet. */
export function namesEqual(a: string, b: string): boolean {
  const left = normalizeCompanyName(a);
  return left.length >= 3 && left === normalizeCompanyName(b);
}

/** "www.shop.pleo.io" → "pleo.io"; "x.co.uk" → "x.co.uk" (til sammenligning af to værter). */
export function registrableDomain(host: string): string {
  const parts = host
    .toLowerCase()
    .replace(/^www\./, "")
    .split(".");
  const secondLevel = new Set(["co", "com", "org", "net", "gov", "ac"]);
  const keep = parts.length > 2 && secondLevel.has(parts[parts.length - 2]!) ? 3 : 2;
  return parts.slice(-keep).join(".");
}

/**
 * Streng: domænets navnedel er NETOP selskabets normaliserede navn (ingen præfiks-match, så
 * "pleo" aldrig godkender "pleonasm.com"), mindst fire tegn. Bruges til websøgningskandidater.
 */
export function domainLabelEqualsName(host: string, name: string): boolean {
  const label = domainLabel(host);
  const normalized = normalizeCompanyName(name);
  return normalized.length >= 4 && label === normalized;
}

export function domainMatchesName(host: string, name: string): boolean {
  const label = domainLabel(host);
  const normalized = normalizeCompanyName(name);
  if (label.length < 3 || normalized.length < 3) return false;
  return label === normalized || normalized.startsWith(label) || label.startsWith(normalized);
}

export type IdentitySignalKey =
  | "cvr_in_material"
  | "cvr_name_matches_brand"
  | "cvr_name_exact"
  | "cvr_in_public_sources"
  | "cvr_website_matches_domain"
  | "domain_matches_brand"
  | "founders_in_registry"
  | "research_confident"
  | "cvr_inactive"
  | "human_confirmed"
  | "cvr_on_related_domain"
  | "cvr_entered"
  | "registry_number_in_material"
  | "registry_name_exact"
  | "registry_name_matches_brand"
  | "registry_website_matches_domain"
  | "registry_inactive";

export interface IdentitySignal {
  key: IdentitySignalKey;
  /** Kort dansk forklaring til kortet "Er dette det rigtige selskab?". */
  label: string;
  /** Bidrag til match-scoren; negativ for et modsignal. */
  weight: number;
}

/** Vægte pr. signal. Et CVR-nummer i casens eget materiale er det stærkeste bevis. */
export const IDENTITY_SIGNAL_WEIGHTS: Record<IdentitySignalKey, number> = {
  cvr_in_material: 0.45,
  cvr_name_matches_brand: 0.2,
  // Samme navn som selskabet (uden selskabsform), fx "Too Good To Go ApS" = "Too Good To Go".
  cvr_name_exact: 0.35,
  // CVR-nummeret går igen i uafhængige offentlige kilder, som researchen fandt.
  cvr_in_public_sources: 0.25,
  cvr_website_matches_domain: 0.2,
  domain_matches_brand: 0.15,
  founders_in_registry: 0.2,
  research_confident: 0.1,
  cvr_inactive: -0.3,
  // Et menneske har valgt CVR-nummeret manuelt (hent regnskab for et bestemt CVR).
  human_confirmed: 1,
  // B3: CVR i footeren på selskabets andet domæne (fx .dk ved siden af .com).
  cvr_on_related_domain: 0.35,
  // Brugeren har selv skrevet CVR-nummeret ved oprettelsen (findes i registret).
  cvr_entered: 0.45,
  // De samme beviser fra et udenlandsk register (fx Brønnøysundregistrene), samme vægt.
  registry_number_in_material: 0.45,
  registry_name_exact: 0.35,
  registry_name_matches_brand: 0.2,
  // Hjemmesiden, selskabet selv har oplyst til registret, er casens website.
  registry_website_matches_domain: 0.2,
  registry_inactive: -0.3,
};

export type IdentityStatus = "confirmed" | "probable" | "uncertain";

export interface IdentityAssessment {
  confidence: number;
  status: IdentityStatus;
  signals: IdentitySignal[];
}

/** Sikker ≥ 0,8 · Sandsynlig 0,5-0,8 · Usikker < 0,5. Regnet i kode, aldrig af AI. */
export function assessIdentity(signals: IdentitySignal[]): IdentityAssessment {
  const raw = signals.reduce((sum, signal) => sum + signal.weight, 0);
  const confidence = Math.round(Math.min(1, Math.max(0, raw)) * 100) / 100;
  const status: IdentityStatus =
    confidence >= 0.8 ? "confirmed" : confidence >= 0.5 ? "probable" : "uncertain";
  return { confidence, status, signals };
}

export function identitySignal(key: IdentitySignalKey, label: string): IdentitySignal {
  return { key, label, weight: IDENTITY_SIGNAL_WEIGHTS[key] };
}
