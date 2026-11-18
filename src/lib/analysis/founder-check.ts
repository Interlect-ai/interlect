/**
 * B5: founder-verifikation (research 04 T9). For hver founder fra decket eller casen:
 * nævnes personen på selskabets eget website, og nævnes personen sammen med selskabet i
 * en uafhængig offentlig kilde? CVR-ledelse kommer, når ERST-adgangen er givet; indtil da
 * bruges status "verificeret" aldrig. Ren fil, så navnematchet kan testes.
 */

export type FounderCheckStatus = "corroborated" | "company_stated" | "claimed";

export interface FounderCheckResult {
  name: string;
  role: string;
  onCompanyWebsite: boolean;
  /** Højst to uafhængige offentlige kilder, hvor navnet står sammen med selskabet. */
  publicSourceUrls: string[];
  status: FounderCheckStatus;
}

export interface PublicTextSource {
  url: string;
  /** Kildens egen tekst (uddrag), aldrig AI'ens sammenfatning. */
  text: string;
}

function normalize(value: string) {
  return (
    value
      .toLowerCase()
      // ø og æ nedbrydes ikke af NFKD; å gør (til a + ring).
      .replace(/ø/g, "o")
      .replace(/æ/g, "ae")
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim()
  );
}

/**
 * Del teksten i sætninger og listeled, så et navn aldrig matches på tværs af dem
 * ("Anders Holm, Peter Jensen" er ikke "Anders Jensen").
 */
function segments(text: string): string[] {
  return text
    .split(/[.,;:&/|()\n]+|\s+(?:og|and)\s+/i)
    .map((part) => ` ${normalize(part)} `)
    .filter((part) => part.trim().length > 0);
}

/**
 * Står personen i teksten? Hele navnet som ord, eller fornavn og efternavn med højst ét
 * mellemnavn imellem, inden for samme sætning eller listeled. Enkeltnavne matches aldrig.
 */
export function mentionsPerson(text: string, fullName: string): boolean {
  const tokens = normalize(fullName).split(" ").filter(Boolean);
  if (tokens.length < 2) return false;
  const first = tokens[0]!;
  const last = tokens[tokens.length - 1]!;
  for (const segment of segments(text)) {
    if (segment.includes(` ${tokens.join(" ")} `)) return true;
    const words = segment.trim().split(" ");
    for (let index = 0; index < words.length; index += 1) {
      if (words[index] !== first) continue;
      if (words[index + 1] === last || words[index + 2] === last) return true;
    }
  }
  return false;
}

function mentionsAny(text: string, names: string[]): boolean {
  const haystack = ` ${normalize(text)} `;
  return names.some((name) => {
    const needle = normalize(name);
    return needle.length >= 3 && haystack.includes(` ${needle} `);
  });
}

export function checkFounders(input: {
  founders: Array<{ name: string; role: string }>;
  websiteText: string;
  publicSources: PublicTextSource[];
  /** Selskabets navne (brand, juridisk navn); en offentlig kilde skal nævne mindst ét. */
  companyNames: string[];
}): FounderCheckResult[] {
  return input.founders.map((founder) => {
    const onCompanyWebsite = mentionsPerson(input.websiteText, founder.name);
    const publicSourceUrls = [
      ...new Set(
        input.publicSources
          .filter(
            (source) =>
              mentionsPerson(source.text, founder.name) &&
              mentionsAny(source.text, input.companyNames),
          )
          .map((source) => source.url),
      ),
    ].slice(0, 2);
    const status: FounderCheckStatus =
      publicSourceUrls.length > 0
        ? "corroborated"
        : onCompanyWebsite
          ? "company_stated"
          : "claimed";
    return { name: founder.name, role: founder.role, onCompanyWebsite, publicSourceUrls, status };
  });
}

const STATUS_TEXT: Record<FounderCheckStatus, string> = {
  corroborated: "nævnt sammen med selskabet i en uafhængig offentlig kilde",
  company_stated: "kun nævnt af selskabet selv",
  claimed: "kun påstået (ikke fundet på selskabets website eller i offentlige kilder)",
};

export const FOUNDER_CLAIM_PREFIX = "Founder-kontrol: ";

/** Evidensens tekst for én founder; starter altid med præfiks og navn (til dedupe). */
export function founderClaim(result: FounderCheckResult): string {
  const parts = [
    `${FOUNDER_CLAIM_PREFIX}${result.name} (${result.role}) er ${STATUS_TEXT[result.status]}.`,
    `Nævnt på selskabets website: ${result.onCompanyWebsite ? "ja" : "nej"}.`,
    result.publicSourceUrls.length
      ? `Uafhængige kilder: ${result.publicSourceUrls.join(", ")}.`
      : "Ingen uafhængig offentlig kilde fundet.",
    "CVR-ledelse er ikke kontrolleret endnu.",
  ];
  return parts.join(" ");
}
