/**
 * Tyskland, Spanien og Italien: selskabets identitet fra GLEIF (`api.gleif.org`, gratis,
 * ingen nøgle, CC0), regnskabstal "ikke tilgængelige i registret" (kun gratis kilder).
 *
 * De tre landes officielle registre har intet gratis API:
 * Handelsregister og Unternehmensregister kan kun ses på web (højst 60 opslag i timen), Registro
 * Mercantil og Registro Imprese tager betaling pr. opslag eller kræver en betalt aftale. GLEIF
 * har det juridiske navn, status og nummeret i det nationale register for alle selskaber med en
 * LEI, valideret af LEI-udstederen mod netop det register (`registeredAt`). Uden en LEI kendes
 * selskabet ikke her, og screeningen bruger websøgningen som før.
 *
 * Nøglen er LEI'en (20 tegn, kontrolcifre efter ISO 17442), ikke landets eget nummer: et tysk
 * HRB-nummer er kun entydigt sammen med sit amtsgericht, og GLEIF's spanske poster har tre slags
 * numre (NIF, IRUS og "hoja"). Landets eget nummer i decket (HRB, NIF/CIF, codice fiscale/partita
 * IVA) eller en LEI slås op i GLEIF og giver LEI'en. Enkeltmandsvirksomheder, filialer og fonde
 * slås aldrig op.
 */
import type { ForeignRegistryCountry, RegistryAdapter, RegistryCompany } from "./types.ts";

import { serverText } from "../../i18n/server-text.ts";
import type { MessageKey, TranslateVars } from "../../i18n/translate.ts";

/** Messages to the person, in the page's language or the fund's in a worker. */
function msg(key: string, vars?: TranslateVars) {
  return serverText(`analysisServer.registries.${key}` as MessageKey, vars);
}

const GLEIF = "https://api.gleif.org/api/v1";
const USER_AGENT = "interlect.ai/1.0 (+https://interlect.ai)";
const FETCH_TIMEOUT_MS = 12_000;
const MAX_RESPONSE_BYTES = 2_000_000;
const SEARCH_SIZE = 10;

export type GleifCountry = Extract<ForeignRegistryCountry, "DE" | "ES" | "IT">;

// ---------------------------------------------------------------------------------------------
// LEI

/** ISO 17442: 18 tegn + 2 kontrolcifre; hele koden modulus 97 (bogstaver A=10 … Z=35) er 1. */
export function isValidLei(value: string): boolean {
  if (!/^[0-9A-Z]{18}[0-9]{2}$/.test(value)) return false;
  let remainder = 0;
  for (const char of value) {
    const digits = /\d/.test(char) ? char : String(char.charCodeAt(0) - 55);
    for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

/** "5299 00DC E9HL EPY8 MW24", "lei: 529900dce9hlepy8mw24" → "529900DCE9HLEPY8MW24"; ugyldigt → null. */
export function normalizeLei(raw: string): string | null {
  const value = raw
    .trim()
    .replace(/^LEI\s*(?:code)?\s*[:#]?/i, "")
    .replace(/[\s-]/g, "")
    .toUpperCase();
  return isValidLei(value) ? value : null;
}

// Kun med mærket "LEI" (og gyldige kontrolcifre), så andre koder på 20 tegn aldrig tæller.
const LEI_PATTERN = /\bLEI(?:\s*(?:code|no\.?|number))?\s*[:#]?\s*([0-9A-Z]{18}[0-9]{2})\b/gi;

function findLeis(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(LEI_PATTERN)) {
    const lei = (match[1] ?? "").toUpperCase();
    if (isValidLei(lei) && !found.includes(lei)) found.push(lei);
  }
  return found;
}

export function gleifRecordUrl(lei: string): string {
  return `https://search.gleif.org/#/record/${lei}`;
}

// ---------------------------------------------------------------------------------------------
// Tyskland: HRB/HRA + amtsgericht

const COURT_PREFIX = /^(?:Local|District|Registry)\s+Court\s+/i;

/** "HRB 271697 B", "HRB271697B" → { kind: "HRB", number: "271697", suffix: "B" }. */
function parseHr(value: string): { kind: string; number: string; suffix: string } | null {
  const match = /^(HR[AB])\s*(?:Nr\.?\s*)?(\d{1,6})\s*([A-Z]{1,2})?$/i.exec(value.trim());
  if (!match || /^0+$/.test(match[2]!)) return null;
  return {
    kind: match[1]!.toUpperCase(),
    number: match[2]!.replace(/^0+/, ""),
    suffix: (match[3] ?? "").toUpperCase(),
  };
}

// "HRB 225439", "HRB-Nr. 225439", "HR B 271697 B". Retten står før eller efter:
// "Amtsgericht München, HRB 225439", "HRB 225439 (AG München)", "Registergericht: Berlin-Charlottenburg".
// Kun Berlins suffiks "B" tæller, så "HRB 225439 AG München" ikke læses som et suffiks.
const HR_PATTERN =
  /\b(HR\s?[AB])\s*(?:-?\s*Nr\.?\s*)?[:#]?\s*(\d{1,6})(?:\s?(B)(?![\p{L}]))?(?![\p{L}\d])/gu;
const COURT_PATTERN =
  /\b(?:Amtsgericht|Registergericht(?:\s*:)?|Local\s+Court|District\s+Court|Registry\s+Court|AG)\s+(?:of\s+)?(?!Amtsgericht\b)([A-ZÄÖÜ][a-zäöüß]+(?:[- ](?:am|an|der|in|im|i\.|v\.|a\.|d\.|\(?[A-ZÄÖÜ][a-zäöüß]+\)?)){0,3})/;

function courtNear(text: string, start: number, end: number): string | null {
  const before = text.slice(Math.max(0, start - 80), start);
  const after = text.slice(end, end + 80);
  const beforeMatches = [...before.matchAll(new RegExp(COURT_PATTERN, "g"))];
  const found = beforeMatches.at(-1) ?? COURT_PATTERN.exec(after);
  return found?.[1]?.replace(/[()]/g, "").trim() ?? null;
}

/** "HRB 225439, Amtsgericht München" eller "HRB 225439"; tysk registernummer i en tekst. */
function findGermanNumbers(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(HR_PATTERN)) {
    const parsed = parseHr(`${match[1]!.replace(/\s/g, "")} ${match[2]} ${match[3] ?? ""}`);
    if (!parsed) continue;
    const court = courtNear(text, match.index, match.index + match[0].length);
    const register = `${parsed.kind} ${parsed.number}${parsed.suffix ? ` ${parsed.suffix}` : ""}`;
    const value = court ? `${register}, Amtsgericht ${court}` : register;
    if (!found.includes(value)) found.push(value);
  }
  return found;
}

/** Passer rettens navn i decket ("Berlin", "Charlottenburg", "München") til GLEIF's ("Berlin-Charlottenburg")? */
function courtMatches(court: string, registryCourt: string): boolean {
  const words = (value: string) =>
    value
      .toLowerCase()
      .split(/[^a-zäöüß]+/)
      .filter((word) => word.length > 2);
  const registry = new Set(words(registryCourt));
  return words(court).some((word) => registry.has(word));
}

// ---------------------------------------------------------------------------------------------
// Spanien: NIF (CIF) for selskaber

/** Selskabers NIF: bogstav for selskabsformen, 7 cifre, kontroltegn (ciffer eller bogstav). */
export function isValidSpanishCif(value: string): boolean {
  const match = /^([ABCDEFGHJNPQRSUVW])(\d{7})([0-9A-J])$/.exec(value);
  if (!match) return false;
  const digits = [...match[2]!].map(Number);
  let sum = 0;
  digits.forEach((digit, index) => {
    if (index % 2 === 1) sum += digit;
    else {
      const doubled = digit * 2;
      sum += Math.floor(doubled / 10) + (doubled % 10);
    }
  });
  const control = (10 - (sum % 10)) % 10;
  const letter = "JABCDEFGHI"[control]!;
  const given = match[3]!;
  const kind = match[1]!;
  if ("PQRSNW".includes(kind)) return given === letter;
  if ("ABEH".includes(kind)) return given === String(control);
  return given === String(control) || given === letter;
}

/** "B-82827932", "ESB82827932", "b 8282793 2" → "B82827932"; ugyldigt → null. */
export function normalizeSpanishCif(raw: string): string | null {
  const value = raw
    .trim()
    .toUpperCase()
    .replace(/[\s.-]/g, "")
    .replace(/^ES(?=[A-Z])/, "");
  return isValidSpanishCif(value) ? value : null;
}

// "CIF B82827932", "NIF: B-82827932", "C.I.F. B 82827932", "VAT ESB82827932", "IVA ES B82827932".
const CIF_PATTERN =
  /\b(?:C\.?\s?I\.?\s?F\.?|N\.?\s?I\.?\s?F\.?|VAT(?:\s+(?:no|nr|number|id))?\.?|IVA)\s*[:#]?\s*(?:ES[-\s]?)?([A-HJNP-SUVW][-\s]?\d{2}[.\s]?\d{3}[.\s]?\d{2}[-\s]?[0-9A-J])\b|\bES([A-HJNP-SUVW]\d{7}[0-9A-J])\b/gi;

function findSpanishNumbers(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(CIF_PATTERN)) {
    const cif = normalizeSpanishCif(match[1] ?? match[2] ?? "");
    if (cif && !found.includes(`NIF ${cif}`)) found.push(`NIF ${cif}`);
  }
  return found;
}

// ---------------------------------------------------------------------------------------------
// Italien: codice fiscale / partita IVA (11 cifre)

/** 11 cifre; sidste er kontrolciffer (Luhn-variant). En persons codice fiscale (16 tegn) tæller aldrig. */
export function isValidItalianFiscalCode(value: string): boolean {
  if (!/^\d{11}$/.test(value) || /^0+$/.test(value)) return false;
  let sum = 0;
  [...value].forEach((char, index) => {
    const digit = Number(char);
    if (index % 2 === 0) sum += digit;
    else sum += digit * 2 > 9 ? digit * 2 - 9 : digit * 2;
  });
  return sum % 10 === 0;
}

/** "IT 10927360015", "10927360015" → "10927360015"; ugyldigt → null. */
export function normalizeItalianFiscalCode(raw: string): string | null {
  const value = raw
    .trim()
    .toUpperCase()
    .replace(/^IT/, "")
    .replace(/[\s.-]/g, "");
  return isValidItalianFiscalCode(value) ? value : null;
}

// "P.IVA 10927360015", "P. IVA: IT10927360015", "Partita IVA", "C.F.", "Codice Fiscale",
// "VAT IT10927360015". Kun med et mærke (og "VAT" kun med "IT"), så telefonnumre og andre landes
// momsnumre aldrig tæller.
const FISCAL_PATTERN =
  /\b(?:P\.?\s?IVA|Partita\s+IVA|C\.\s?F\.|Cod(?:ice|\.)\s*Fisc(?:ale|\.)|Reg(?:istro)?\.?\s+Imprese(?:\s+(?:di\s+)?[A-Z][a-z]+)?(?:\s+n\.?)?)\s*[:#]?\s*(?:IT[-\s]?)?(\d{11})\b|\bVAT(?:\s+(?:no|nr|number|id))?\.?\s*[:#]?\s*IT[-\s]?(\d{11})\b/gi;

function findItalianNumbers(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(FISCAL_PATTERN)) {
    const code = match[1] ?? match[2] ?? "";
    if (isValidItalianFiscalCode(code) && !found.includes(`C.F. ${code}`)) {
      found.push(`C.F. ${code}`);
    }
  }
  return found;
}

// ---------------------------------------------------------------------------------------------
// GLEIF

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

interface CountryConfig {
  registryName: string;
  /** Er GLEIF's registreringsmyndighed landets selskabsregister? */
  isCompanyRegister(authority: string): boolean;
  findNationalNumbers(text: string): string[];
  /** Which "no free statements" text the registry gets (registries.gleif.missing.*). */
  missingStatements: "de" | "es" | "it";
}

/** GLEIF's koder for de tyske amtsgerichters handelsregistre ligger i RA000197–RA000371. */
function isGermanCourt(authority: string): boolean {
  const number = /^RA(\d{6})$/.exec(authority)?.[1];
  return Boolean(number && Number(number) >= 197 && Number(number) <= 371);
}

const CONFIG: Record<GleifCountry, CountryConfig> = {
  DE: {
    registryName: "Handelsregister (via GLEIF)",
    isCompanyRegister: isGermanCourt,
    findNationalNumbers: findGermanNumbers,
    missingStatements: "de",
  },
  ES: {
    registryName: "Registro Mercantil (via GLEIF)",
    // Registro Mercantil, Registro Mercantil Central og skattevæsenet (NIF).
    isCompanyRegister: (authority) => ["RA000533", "RA000780", "RA000535"].includes(authority),
    findNationalNumbers: findSpanishNumbers,
    missingStatements: "es",
  },
  IT: {
    registryName: "Registro Imprese (via GLEIF)",
    // Registro Imprese (InfoCamere) og skattevæsenet (samme codice fiscale).
    isCompanyRegister: (authority) => ["RA000407", "RA000776"].includes(authority),
    findNationalNumbers: findItalianNumbers,
    missingStatements: "it",
  },
};

/** GLEIF-kategorier, der aldrig slås op: en enkeltmandsvirksomhed er en person. */
const EXCLUDED_CATEGORIES = new Set(["SOLE_PROPRIETOR", "BRANCH", "FUND"]);

export interface GleifCompany extends RegistryCompany {
  /** GLEIF's registreringsmyndighed (fx RA000304 = Amtsgericht München). */
  authority: string;
  /** Nummeret i landets register, som GLEIF har det (fx "HRB 225439", "B82827932"). */
  nationalNumber: string;
}

/** En LEI-post → selskabet, kun når det er et selskab i landets eget register. null ellers. */
export function parseGleifRecord(raw: unknown, country: GleifCountry): GleifCompany | null {
  if (!isObject(raw) || !isObject(raw["attributes"])) return null;
  const lei = text(raw["id"]) ?? text(raw["attributes"]["lei"]);
  const entity = raw["attributes"]["entity"];
  if (!lei || !isValidLei(lei) || !isObject(entity)) return null;
  const authority = isObject(entity["registeredAt"]) ? text(entity["registeredAt"]["id"]) : null;
  const nationalNumber = text(entity["registeredAs"]);
  const name = isObject(entity["legalName"]) ? text(entity["legalName"]["name"]) : null;
  const category = text(entity["category"]);
  if (
    !authority ||
    !CONFIG[country].isCompanyRegister(authority) ||
    !nationalNumber ||
    !name ||
    text(entity["jurisdiction"]) !== country ||
    (category && EXCLUDED_CATEGORIES.has(category))
  ) {
    return null;
  }
  const formerNames = (Array.isArray(entity["otherNames"]) ? entity["otherNames"] : [])
    .filter((other) => isObject(other) && text(other["type"])?.startsWith("PREVIOUS"))
    .map((other) => text((other as Json)["name"]))
    .filter((value): value is string => Boolean(value));
  // GLEIF: ACTIVE, eller INACTIVE (ophørt, fusioneret, opløst; årsagen står i `expiration`).
  const active = text(entity["status"]) !== "INACTIVE";
  const reason = isObject(entity["expiration"]) ? text(entity["expiration"]["reason"]) : null;
  return {
    country,
    registryNumber: lei,
    name,
    formerNames,
    active,
    status: active
      ? msg("status.active")
      : reason
        ? msg("status.ceasedWith", { reason: reason.toLowerCase() })
        : msg("status.ceased"),
    website: null,
    registryUrl: gleifRecordUrl(lei),
    authority,
    nationalNumber,
  };
}

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { accept: "application/vnd.api+json", "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(msg("common.status", { registry: "GLEIF", status: response.status }));
  }
  const body = await response.text();
  if (body.length > MAX_RESPONSE_BYTES)
    throw new Error(msg("common.tooLarge", { registry: "GLEIF" }));
  return JSON.parse(body) as unknown;
}

async function records(country: GleifCountry, filters: Record<string, string>) {
  const url = new URL(`${GLEIF}/lei-records`);
  for (const [key, value] of Object.entries(filters)) url.searchParams.set(`filter[${key}]`, value);
  url.searchParams.set("page[size]", String(SEARCH_SIZE));
  const parsed = await getJson(url.toString());
  const rows = isObject(parsed) && Array.isArray(parsed["data"]) ? parsed["data"] : [];
  return rows
    .map((row) => parseGleifRecord(row, country))
    .filter((company): company is GleifCompany => !!company);
}

const courtNames = new Map<string, string | null>();

/** Amtsgerichtets navn for en GLEIF-kode ("RA000304" → "München"); gemmes, mens processen kører. */
async function courtName(authority: string): Promise<string | null> {
  if (courtNames.has(authority)) return courtNames.get(authority) ?? null;
  const parsed = await getJson(`${GLEIF}/registration-authorities/${authority}`);
  const attributes =
    isObject(parsed) && isObject(parsed["data"]) && isObject(parsed["data"]["attributes"])
      ? parsed["data"]["attributes"]
      : null;
  const name =
    text(attributes?.["internationalOrganizationName"])?.replace(COURT_PREFIX, "") ?? null;
  courtNames.set(authority, name);
  return name;
}

/** Den aktive LEI vinder; flere aktive for samme nummer er flertydigt (null). */
function single(companies: GleifCompany[]): GleifCompany | null {
  const active = companies.filter((company) => company.active);
  const pool = active.length ? active : companies;
  return pool.length === 1 ? pool[0]! : null;
}

/** Et tysk registernummer (evt. med ret) → selskabet; uden ret kun, når nummeret er entydigt. */
async function lookupGerman(value: string): Promise<GleifCompany | null> {
  const [register, courtPart] = value.split(/,\s*Amtsgericht\s+/);
  const parsed = parseHr(register ?? "");
  if (!parsed) return null;
  // GLEIF skriver Berlins suffiks både "HRB 271697 B" og "HRB 244347B".
  const variants = parsed.suffix
    ? [
        `${parsed.kind} ${parsed.number} ${parsed.suffix}`,
        `${parsed.kind} ${parsed.number}${parsed.suffix}`,
        `${parsed.kind} ${parsed.number}`,
      ]
    : [`${parsed.kind} ${parsed.number}`];
  const found: GleifCompany[] = [];
  for (const variant of variants) {
    for (const company of await records("DE", {
      "entity.registeredAs": variant,
      "entity.jurisdiction": "DE",
    })) {
      if (!found.some((other) => other.registryNumber === company.registryNumber)) {
        found.push(company);
      }
    }
  }
  // Står retten i materialet, skal den passe, også når nummeret kun findes én gang i GLEIF.
  if (!courtPart) return single(found);
  const inCourt: GleifCompany[] = [];
  for (const company of found) {
    const court = await courtName(company.authority);
    if (court && courtMatches(courtPart, court)) inCourt.push(company);
  }
  return single(inCourt);
}

async function lookupNumber(country: GleifCountry, raw: string): Promise<GleifCompany | null> {
  const lei = normalizeLei(raw);
  if (lei) {
    return (
      (await records(country, { lei })).find((company) => company.registryNumber === lei) ?? null
    );
  }
  if (country === "DE") return lookupGerman(raw);
  const national =
    country === "ES"
      ? normalizeSpanishCif(raw.replace(/^NIF\s+/i, ""))
      : normalizeItalianFiscalCode(raw.replace(/^C\.F\.\s+/i, ""));
  if (!national) return null;
  return single(
    (
      await records(country, { "entity.registeredAs": national, "entity.jurisdiction": country })
    ).filter((company) => company.nationalNumber.replace(/[\s-]/g, "").toUpperCase() === national),
  );
}

function gleifAdapter(country: GleifCountry): RegistryAdapter {
  const config = CONFIG[country];
  return {
    country,
    registryName: config.registryName,
    numberLabel: "LEI",
    sourceKind: "registry_json",
    supportsNameSearch: true,
    configured: () => true,
    normalizeNumber: normalizeLei,
    /** LEI'er og landets egne numre ("HRB 225439, Amtsgericht München", "NIF B82827932", "C.F. 10927360015"). */
    findNumbersInText: (value) => [
      ...findLeis(value).map((lei) => `LEI ${lei}`),
      ...config.findNationalNumbers(value),
    ],
    describeNumber: (value) => value,
    async searchByName(name) {
      const query = name.trim().slice(0, 200);
      if (!query) return [];
      return records(country, { fulltext: query, "entity.legalAddress.country": country });
    },
    lookupByNumber: (registryNumber) => lookupNumber(country, registryNumber),
    async fetchStatements() {
      return {
        statements: [],
        warnings: [
          msg("gleif.freeOnly", { missing: msg(`gleif.missing.${config.missingStatements}`) }),
        ],
      };
    },
  };
}

export const germanyRegistry = gleifAdapter("DE");
export const spainRegistry = gleifAdapter("ES");
export const italyRegistry = gleifAdapter("IT");

export const __test = {
  findGermanNumbers,
  findSpanishNumbers,
  findItalianNumbers,
  courtMatches,
  findLeis,
};
