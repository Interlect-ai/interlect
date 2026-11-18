/**
 * Finland: PRH (Patentti- ja rekisterihallitus). Gratis, ingen nøgle, CC BY 4.0.
 *  - YTJ open data (`avoindata.prh.fi/opendata-ytj-api/v3/companies`): selskabet, søgning på navn
 *    (også tidligere, parallelle og binavne) og på Y-tunnus.
 *  - XBRL open data (`avoindata.prh.fi/opendata-xbrl-api/v3`): `financials` lister de år, et selskab
 *    har indsendt digitalt, og `financial` giver ét års XBRL-instans (læses i `finland-xbrl.ts`).
 *
 * Dækningen er lille: kun digitalt indsendte regnskaber (ca. 10.000 for 2024, ca. 5 % af alle),
 * indtil kravet om digital indsendelse kommer i 2027–2028. For de øvrige er regnskabet "ikke
 * tilgængeligt i registret", og analysen bruger websøgningens tal. API'et svarer 429 ved for
 * mange kald, så et opslag bruger højst fire kald (liste + de tre seneste år).
 */
import { parseFinnishXbrl, type ParsedFinnishStatement } from "./finland-xbrl.ts";
import type {
  RegistryAdapter,
  RegistryCompany,
  RegistryStatement,
  RegistryStatementsResult,
} from "./types.ts";

import { serverText } from "../../i18n/server-text.ts";
import type { MessageKey, TranslateVars } from "../../i18n/translate.ts";
import { outboundUserAgent } from "../../outbound-user-agent.ts";

/** Messages to the person, in the page's language or the fund's in a worker. */
function msg(key: string, vars?: TranslateVars) {
  return serverText(`analysisServer.registries.${key}` as MessageKey, vars);
}

const YTJ = "https://avoindata.prh.fi/opendata-ytj-api/v3/companies";
const XBRL = "https://avoindata.prh.fi/opendata-xbrl-api/v3";
const USER_AGENT = outboundUserAgent();
const FETCH_TIMEOUT_MS = 12_000;
const MAX_RESPONSE_BYTES = 2_000_000;
const SEARCH_SIZE = 10;
const YEARS = 8;

const WEIGHTS = [7, 9, 10, 5, 8, 4, 2] as const;

/** PRH's kontrolciffer-regel (modulus 11) for Y-tunnus: syv cifre, bindestreg, kontrolciffer. */
export function isValidFinnishBusinessId(value: string): boolean {
  if (!/^\d{7}-\d$/.test(value)) return false;
  const sum = WEIGHTS.reduce((total, weight, index) => total + weight * Number(value[index]), 0);
  const remainder = sum % 11;
  if (remainder === 1) return false;
  return (remainder === 0 ? 0 : 11 - remainder) === Number(value[8]);
}

/** "2336509-6", "23365096", "FI23365096", "336509-6" (ældre, uden foranstillet nul) → "2336509-6". */
export function normalizeFinnishBusinessId(raw: string): string | null {
  const text = raw.trim().replace(/^FI/i, "").replace(/[\s.]/g, "");
  const match = /^(\d{6,7})-?(\d)$/.exec(text);
  if (!match) return null;
  const id = `${match[1]!.padStart(7, "0")}-${match[2]}`;
  return isValidFinnishBusinessId(id) ? id : null;
}

// "Y-tunnus 2336509-6", "Y-tunnus/Business ID: 2336509-6", "Business ID 2336509-6", "FO-nummer",
// og momsnummeret "FI23365096" / "ALV-tunnus FI 2336509-6" (kun med FI foran, så et telefonnummer ikke tæller).
const BUSINESS_ID_PATTERNS = [
  /\b(?:y-?tunnus|business\s*id|fo-?nummer|fo-?nr|yritys-?\s?ja\s?yhteis[öo]tunnus)\.?\s*[:#/]?\s*(?:business\s*id\s*)?[:#]?\s*(\d{6,7}\s?-\s?\d)\b/gi,
  /\bFI\s?(\d{8})\b/g,
];

/** Finske Y-tunnus nævnt i en tekst, i rækkefølge og uden dubletter; kun gyldige numre. */
export function findFinnishBusinessIds(text: string): string[] {
  const found: Array<{ index: number; id: string }> = [];
  for (const pattern of BUSINESS_ID_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const id = normalizeFinnishBusinessId((match[1] ?? "").replace(/\s/g, ""));
      if (id) found.push({ index: match.index, id });
    }
  }
  return found
    .sort((x, y) => x.index - y.index)
    .map((entry) => entry.id)
    .filter((id, index, all) => all.indexOf(id) === index);
}

export function finlandRegistryUrl(businessId: string): string {
  return `https://tietopalvelu.ytj.fi/yritys/${businessId}`;
}

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function descriptionOf(entry: unknown): string | null {
  const descriptions =
    isObject(entry) && Array.isArray(entry["descriptions"]) ? entry["descriptions"] : [];
  // Sprogkoderne i YTJ: 1 finsk, 2 svensk, 3 engelsk.
  const byLanguage = (code: string) =>
    descriptions.find((d) => isObject(d) && d["languageCode"] === code);
  const chosen = byLanguage("3") ?? byLanguage("1") ?? descriptions[0];
  return isObject(chosen) ? text(chosen["description"]) : null;
}

const SITUATIONS: Record<string, string> = {
  SANE: "under rekonstruktion",
  SELTILA: "under likvidation",
  KONK: "konkurs",
};

/** Et selskab fra YTJ (opslag eller søgning). null, hvis det ikke kan læses. */
export function parseYtjCompany(raw: unknown): RegistryCompany | null {
  if (!isObject(raw)) return null;
  const businessId = text(isObject(raw["businessId"]) ? raw["businessId"]["value"] : null);
  if (!businessId || !isValidFinnishBusinessId(businessId)) return null;
  const names = (Array.isArray(raw["names"]) ? raw["names"] : []).filter(isObject).map((entry) => ({
    name: text(entry["name"]),
    type: text(entry["type"]),
    current: entry["version"] === 1 && !text(entry["endDate"]),
  }));
  const main =
    names.find((entry) => entry.name && entry.current && entry.type === "1") ??
    names.find((entry) => entry.name && entry.current) ??
    names.find((entry) => entry.name);
  if (!main?.name) return null;
  // Parallelle navne (fx "Supercell Ltd"), binavne og tidligere navne kan stå i et deck.
  const formerNames = [
    ...new Set(
      names
        .map((entry) => entry.name)
        .filter((name): name is string => Boolean(name) && name !== main.name),
    ),
  ];

  const reasons: string[] = [];
  if (text(raw["endDate"])) reasons.push(msg("status.dissolved"));
  else if (text(raw["status"]) === "5") reasons.push("Y-tunnus ugyldiggjort");
  for (const situation of Array.isArray(raw["companySituations"]) ? raw["companySituations"] : []) {
    if (!isObject(situation) || text(situation["endDate"])) continue;
    const label = SITUATIONS[String(situation["type"])];
    if (label) reasons.push(label);
  }
  const website = isObject(raw["website"]) ? text(raw["website"]["url"]) : null;
  return {
    country: "FI",
    registryNumber: businessId,
    name: main.name,
    formerNames,
    active: reasons.length === 0,
    status: reasons.length ? reasons.join(", ") : msg("status.active"),
    website: website ? (/^https?:\/\//i.test(website) ? website : `https://${website}`) : null,
    registryUrl: finlandRegistryUrl(businessId),
  };
}

/** PRH's liste over de regnskabsår, et selskab har indsendt digitalt: nyeste først, højst `limit`. */
export function financialDatesFrom(raw: unknown, businessId: string, limit = YEARS): string[] {
  const rows = isObject(raw) && Array.isArray(raw["financials"]) ? raw["financials"] : [];
  const dates = rows
    .filter(isObject)
    .filter((row) => row["businessId"] === businessId)
    .map((row) => text(row["financialDate"]))
    .filter((date): date is string => !!date && /^\d{4}-\d{2}-\d{2}$/.test(date));
  return [...new Set(dates)].sort().reverse().slice(0, limit);
}

async function getBody(url: string, accept: string): Promise<string | null> {
  const response = await fetch(url, {
    headers: { accept, "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (response.status === 404 || response.status === 410) return null;
  if (response.status === 429) {
    throw new Error(msg("finland.tooManyCalls"));
  }
  if (!response.ok) {
    throw new Error(msg("common.status", { registry: "PRH", status: response.status }));
  }
  const body = await response.text();
  if (body.length > MAX_RESPONSE_BYTES) {
    throw new Error(msg("common.tooLarge", { registry: "PRH" }));
  }
  return body;
}

async function getJson(url: string): Promise<unknown | null> {
  const body = await getBody(url, "application/json");
  return body === null ? null : (JSON.parse(body) as unknown);
}

export const finlandRegistry: RegistryAdapter = {
  country: "FI",
  registryName: "PRH (Patentti- ja rekisterihallitus)",
  numberLabel: "Y-tunnus",
  sourceKind: "xbrl_structured",
  supportsNameSearch: true,
  configured: () => true,
  normalizeNumber: normalizeFinnishBusinessId,
  findNumbersInText: findFinnishBusinessIds,
  async searchByName(name) {
    const query = name.trim().slice(0, 200);
    if (!query) return [];
    const body = await getJson(`${YTJ}?name=${encodeURIComponent(query)}`);
    const companies = isObject(body) && Array.isArray(body["companies"]) ? body["companies"] : [];
    return companies
      .slice(0, SEARCH_SIZE)
      .map(parseYtjCompany)
      .filter((company): company is RegistryCompany => !!company);
  },
  async lookupByNumber(registryNumber) {
    const businessId = normalizeFinnishBusinessId(registryNumber);
    if (!businessId) return null;
    const body = await getJson(`${YTJ}?businessId=${encodeURIComponent(businessId)}`);
    const companies = isObject(body) && Array.isArray(body["companies"]) ? body["companies"] : [];
    return parseYtjCompany(companies.find((entry) => isObject(entry)) ?? null);
  },
  async fetchStatements(registryNumber): Promise<RegistryStatementsResult> {
    const businessId = normalizeFinnishBusinessId(registryNumber);
    if (!businessId) return { statements: [], warnings: [] };
    const list = await getJson(`${XBRL}/financials?businessId=${encodeURIComponent(businessId)}`);
    const dates = financialDatesFrom(list, businessId);
    if (dates.length === 0) {
      return {
        statements: [],
        warnings: [msg("finland.noDigital")],
      };
    }
    const statements: RegistryStatement[] = [];
    const warnings: string[] = [];
    for (const date of dates) {
      const url: string = `${XBRL}/financial?businessId=${encodeURIComponent(businessId)}&financialDate=${date}`;
      let parsed: ParsedFinnishStatement;
      try {
        const xml = await getBody(url, "text/xml");
        parsed = xml ? parseFinnishXbrl(xml, date, url) : { businessId: null, statement: null };
      } catch (cause) {
        // Et afbrudt år (fx 429) må ikke tage de år med, der allerede er hentet.
        if (statements.length === 0) throw cause;
        warnings.push(
          msg("finland.notFetched", {
            date,
            reason: cause instanceof Error ? cause.message : msg("common.unknownError"),
          }),
        );
        continue;
      }
      if (parsed.businessId && parsed.businessId !== businessId) {
        warnings.push(msg("finland.otherCompany", { date, id: parsed.businessId }));
        continue;
      }
      if (!parsed.statement) {
        warnings.push(msg("common.noFigures", { date }));
        continue;
      }
      statements.push(parsed.statement);
    }
    statements.sort((a, b) => (a.periodEnd < b.periodEnd ? 1 : -1));
    const currency = statements[0]?.currency;
    for (const statement of statements) {
      if (statement.currency !== currency) {
        warnings.push(
          msg("common.otherCurrency", {
            date: statement.periodEnd,
            currency: statement.currency,
            latest: currency ?? "",
          }),
        );
      }
    }
    return { statements: statements.filter((s) => s.currency === currency), warnings };
  },
};
