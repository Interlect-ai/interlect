/**
 * Hvilket selskab i et udenlandsk register er casens?. Samme regler som det danske
 * CVR-opslag (`identity-resolve.ts`), som rene funktioner uden netværk:
 * - Et registernummer fra casens eget materiale tæller kun, når registrets navn passer.
 * - Et navneopslag vælger kun ét selskab med præcis samme navn (uden selskabsform), aktive
 *   først, og kun ét. Et navn, der blot ligner (fx "Spond" i "Spondylitt..."), tæller kun,
 *   når hjemmesiden i registret også er casens domæne.
 * - Flere lige gode kandidater er "flertydigt": intet vælges, et menneske må afgøre det.
 */
import { buildNameAgrees, type NameContext } from "../identity-resolve.ts";
import {
  hostOf,
  identitySignal,
  namesEqual,
  registrableDomain,
  type IdentitySignal,
} from "../identity.ts";
import type { RegistryCompany } from "./types.ts";

import { serverText } from "../../i18n/server-text.ts";
import type { MessageKey, TranslateVars } from "../../i18n/translate.ts";

/** Messages to the person, in the page's language or the fund's in a worker. */
function msg(key: string, vars?: TranslateVars) {
  return serverText(`analysisServer.registries.${key}` as MessageKey, vars);
}

/**
 * Registrets navn uden en selskabsform, den fælles navneregel ikke kender: "KAHOOT! ASA" →
 * "KAHOOT!", "Bolt Technology OÜ" → "Bolt Technology", 'SIA "Printful Bits"' → '"Printful Bits"',
 * "BOOKSY SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ" → "BOOKSY", "ALAN SASU" → "ALAN", "Mollie B.V." → "Mollie",
 * "Celonis SE" → "Celonis", "Personio SE & Co. KG" → "Personio", "WALLAPOP SL" → "WALLAPOP",
 * "SCALAPAY S.R.L." → "SCALAPAY".
 * Kun som første eller sidste ord og kun her, så danske navne som "Asa Bryg ApS" er uændrede.
 * De tyske, spanske og italienske former fjernes kun for de tre lande, så fx en fransk
 * "LE SPA" eller en norsk "Nordic Spa" er uændret. Det samme gælder de litauiske:
 * 'UAB "Vinted"' og "Ignitis grupė, AB" kun for Litauen, så en svensk "Spotify AB" er uændret.
 */
export function comparableRegistryName(name: string, country?: string | null): string {
  const stripped = name
    .replace(/\s+(?:ASA|OÜ|OU|OYJ|UAB|SIA)\.?\s*$/i, "")
    .replace(
      /\s+(?:SARL|SASU|EURL|B\.V\.|N\.V\.|SP\.?\s?Z\s?O\.?\s?O\.?|S\.A\.|P\.S\.A\.|(?:PROSTA\s+)?SPÓŁKA\s+(?:Z\s+OGRANICZONĄ\s+ODPOWIEDZIALNOŚCIĄ|AKCYJNA))\s*$/iu,
      "",
    )
    .replace(/^\s*(?:SIA|Sabiedrība ar ierobežotu atbildību|Akciju sabiedrība)\s+/i, "");
  if (country === "LT") return withoutLithuanianForm(stripped);
  return country && GLEIF_FORM_COUNTRIES.has(country) ? withoutGleifForm(stripped) : stripped;
}

/** Litauiske selskabsformer, som JAR skriver dem: foran ('UAB "Vinted"') eller bagved ("Vinted, UAB"). */
function withoutLithuanianForm(name: string): string {
  return name
    .replace(/,?\s+(?:UAB|AB|MB|VšĮ|ŽŪB)\.?\s*$/iu, "")
    .replace(
      /^\s*(?:UAB|AB|MB|VšĮ|Uždaroji\s+akcinė\s+bendrovė|Akcinė\s+bendrovė|Mažoji\s+bendrija|Viešoji\s+įstaiga)\s+/iu,
      "",
    );
}

const GLEIF_FORM_COUNTRIES = new Set(["DE", "ES", "IT"]);

/** Tyske, spanske og italienske selskabsformer, som GLEIF skriver dem. */
function withoutGleifForm(name: string): string {
  return name
    .replace(/\s*\((?:SOCIEDAD\s+UNIPERSONAL|haftungsbeschränkt)\)\s*$/iu, "")
    .replace(
      /,?\s+(?:(?:GmbH|AG|SE)\s*&\s*Co\.?\s*(?:KGaA|KG)|AG|SE|KGaA|KG|UG|S\.L\.U?\.?|SLU?|S\.R\.L\.?S?|SRLS?|S\.P\.A\.?|SPA|SOCIEDAD\s+LIMITADA(?:\s+UNIPERSONAL)?|SOCIEDAD\s+AN[OÓ]NIMA|SOCIET[AÀ]'?\s+A\s+RESPONSABILIT[AÀ]'?\s+LIMITATA(?:\s+SEMPLIFICATA)?|SOCIET[AÀ]'?\s+PER\s+AZIONI)\s*$/iu,
      "",
    );
}

/** Passer et navn i registret til selskabet? Den fælles regel på det sammenlignelige navn. */
export function registryNameAgrees(
  context: NameContext,
  country?: string | null,
): (registryName: string) => boolean {
  const agrees = buildNameAgrees(context);
  return (registryName) => agrees(comparableRegistryName(registryName, country));
}

function exactName(company: RegistryCompany, context: NameContext): boolean {
  const registryName = comparableRegistryName(company.name, company.country);
  return [context.brandName, context.discoveredName, context.anchoredLegalName].some((name) =>
    Boolean(name && namesEqual(registryName, name)),
  );
}

/** Registrets hjemmeside og casens website er samme domæne (fx www.spond.com og spond.com/no). */
export function websiteMatches(company: RegistryCompany, websiteHost: string | null): boolean {
  const registryHost = hostOf(company.website);
  return Boolean(
    websiteHost &&
    registryHost &&
    registrableDomain(registryHost) === registrableDomain(websiteHost),
  );
}

function preferActive(companies: RegistryCompany[]): RegistryCompany[] {
  const active = companies.filter((company) => company.active);
  return active.length ? active : companies;
}

export function chooseRegistryMatch(input: {
  candidates: RegistryCompany[];
  context: NameContext;
  websiteHost: string | null;
}): { match: RegistryCompany | null; ambiguous: RegistryCompany[] } {
  const agrees = (name: string, country: string) =>
    registryNameAgrees(input.context, country)(name);
  const exact = preferActive(
    input.candidates.filter((company) => exactName(company, input.context)),
  );
  const onSite = exact.filter((company) => websiteMatches(company, input.websiteHost));
  if (onSite.length === 1) return { match: onSite[0]!, ambiguous: [] };
  if (exact.length === 1) return { match: exact[0]!, ambiguous: [] };
  if (exact.length > 1) return { match: null, ambiguous: exact };
  const loose = preferActive(
    input.candidates.filter(
      (company) =>
        (agrees(company.name, company.country) ||
          company.formerNames.some((name) => agrees(name, company.country))) &&
        websiteMatches(company, input.websiteHost),
    ),
  );
  if (loose.length === 1) return { match: loose[0]!, ambiguous: [] };
  return { match: null, ambiguous: loose };
}

/** Signalerne bag et valgt registermatch, til kortet "Sådan fandt vi selskabet". */
export function registryMatchSignals(input: {
  company: RegistryCompany;
  registryName: string;
  numberLabel: string;
  context: NameContext;
  websiteHost: string | null;
  fromMaterial: boolean;
  /** Nummeret, som det stod i materialet, når det ikke er selve registernummeret ("HRB 225439" → LEI). */
  materialNumberText?: string | null;
}): IdentitySignal[] {
  const { company, registryName, numberLabel, context } = input;
  const signals: IdentitySignal[] = [];
  if (input.fromMaterial) {
    signals.push(
      identitySignal(
        "registry_number_in_material",
        msg("match.inMaterial", {
          number: input.materialNumberText ?? `${numberLabel} ${company.registryNumber}`,
        }),
      ),
    );
  }
  // Trin 0's juridiske navn tæller ikke, når nummeret kom fra samme materiale (som for CVR).
  const nameContext = input.fromMaterial ? { ...context, anchoredLegalName: null } : context;
  if (exactName(company, nameContext)) {
    signals.push(
      identitySignal(
        "registry_name_exact",
        msg("match.nameExact", { registry: registryName, name: company.name }),
      ),
    );
  } else if (registryNameAgrees(nameContext, company.country)(company.name)) {
    signals.push(
      identitySignal(
        "registry_name_matches_brand",
        msg("match.nameLike", { registry: registryName, name: company.name }),
      ),
    );
  }
  if (websiteMatches(company, input.websiteHost)) {
    signals.push(
      identitySignal(
        "registry_website_matches_domain",
        msg("match.website", { registry: registryName, host: input.websiteHost ?? "" }),
      ),
    );
  }
  if (!company.active) {
    signals.push(
      identitySignal(
        "registry_inactive",
        msg("match.status", { registry: registryName, status: company.status }),
      ),
    );
  }
  return signals;
}
