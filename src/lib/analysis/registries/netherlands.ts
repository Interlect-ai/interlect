/**
 * Holland: regnskaberne fra KVK's åbne datasæt "Jaarrekeningen"
 * (`opendata.kvk.nl/api/v1/hvds/jaarrekeningen/kvknummer/{kvk}`, gratis, ingen nøgle, CC BY 4.0)
 * og selskabets navn fra GLEIF (`api.gleif.org`, gratis, ingen nøgle, CC0).
 *
 * KVK udelader bevidst navn og adresse fra sine gratis data (de kan være persondata for en
 * enkeltmandsvirksomhed), og KVK's API med navn koster et abonnement, som udelukker. GLEIF
 * har det juridiske navn og KVK-nummeret (`registeredAt` RA000463 = KVK) for alle selskaber med
 * en LEI, valideret mod KVK. Uden en LEI kendes navnet ikke, og så bruges nummeret ikke: et
 * nummer i decket tæller kun, når registrets navn passer (som i alle lande).
 *
 * KVK's datasæt har kun det seneste regnskab, der er indsendt som XBRL ("vastgestelde
 * jaarrekening"), og kun selskabets eget regnskab bruges, aldrig koncernens. Små selskaber
 * oplyser ikke omsætning. Datasættet oplyser kun regnskabsåret (ikke datoer eller valuta);
 * hollandske regnskaber føres i euro, og regnskabsåret følger normalt kalenderåret. KVK
 * tillader ét kald pr. minut pr. IP-adresse, så et 429 er en fejl, der prøves ved næste screening.
 */
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

const KVK_STATEMENTS = "https://opendata.kvk.nl/api/v1/hvds/jaarrekeningen/kvknummer";
const GLEIF = "https://api.gleif.org/api/v1/lei-records";
/** GLEIF's kode for Kamer van Koophandel som registreringsmyndighed. */
const KVK_AUTHORITY = "RA000463";
const USER_AGENT = outboundUserAgent();
const FETCH_TIMEOUT_MS = 12_000;
const MAX_RESPONSE_BYTES = 2_000_000;
const SEARCH_SIZE = 10;

/** KVK-nummeret har otte cifre (ingen kontrolciffer). */
export function isValidKvkNumber(value: string): boolean {
  return /^\d{8}$/.test(value) && value !== "00000000";
}

/** "30204462", "3020 4462", "KvK 30204462" → "30204462"; ugyldigt → null. */
export function normalizeKvkNumber(raw: string): string | null {
  const digits = raw
    .trim()
    .replace(/^K\.?v\.?K\.?[-\s]?(?:nummer|nr\.?)?:?/i, "")
    .replace(/[\s.-]/g, "");
  return isValidKvkNumber(digits) ? digits : null;
}

// "KvK 30204462", "KvK-nummer: 30204462", "KVK nr. 30204462", "Chamber of Commerce 30204462",
// "CoC no. 30204462", "Kamer van Koophandel 30204462", "Handelsregister 30204462". Et
// vestigingsnummer (12 cifre) tæller ikke. Kun med et af mærkerne, så telefonnumre og
// beløb aldrig tæller.
const KVK_PATTERN =
  /\b(?:K\.?v\.?K\.?(?:[-\s]?(?:nummer|nr|no|number))?|Chamber\s+of\s+Commerce(?:\s+(?:no|nr|number))?|CoC(?:\s+(?:no|nr|number))?|Kamer\s+van\s+Koophandel|Handelsregister(?:nummer)?)\.?\s*[:#]?\s*(\d{4}\s?\d{4})(?!\s?\d)\b/gi;

/** KVK-numre nævnt i en tekst, i rækkefølge og uden dubletter. */
export function findKvkNumbers(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(KVK_PATTERN)) {
    const digits = (match[1] ?? "").replace(/\s/g, "");
    if (isValidKvkNumber(digits) && !found.includes(digits)) found.push(digits);
  }
  return found;
}

export function netherlandsRegistryUrl(kvk: string): string {
  return `${KVK_STATEMENTS}/${kvk}`;
}

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** En LEI-post fra GLEIF → selskabet, kun når det er registreret i KVK. null ellers. */
export function parseGleifCompany(raw: unknown): RegistryCompany | null {
  const entity = isObject(raw) && isObject(raw["attributes"]) ? raw["attributes"]["entity"] : null;
  if (!isObject(entity)) return null;
  const authority = isObject(entity["registeredAt"]) ? text(entity["registeredAt"]["id"]) : null;
  const kvk = text(entity["registeredAs"]);
  const name = isObject(entity["legalName"]) ? text(entity["legalName"]["name"]) : null;
  if (authority !== KVK_AUTHORITY || !kvk || !isValidKvkNumber(kvk) || !name) return null;
  const formerNames = (Array.isArray(entity["otherNames"]) ? entity["otherNames"] : [])
    .filter((other) => isObject(other) && text(other["type"])?.startsWith("PREVIOUS"))
    .map((other) => text((other as Json)["name"]))
    .filter((value): value is string => Boolean(value));
  // GLEIF: ACTIVE, eller INACTIVE (ophørt, fusioneret, opløst; årsagen står i `expiration`).
  const active = text(entity["status"]) !== "INACTIVE";
  const reason = isObject(entity["expiration"]) ? text(entity["expiration"]["reason"]) : null;
  return {
    country: "NL",
    registryNumber: kvk,
    name,
    formerNames,
    active,
    status: active
      ? msg("status.active")
      : reason
        ? msg("status.ceasedWith", { reason: reason.toLowerCase() })
        : msg("status.ceased"),
    website: null,
    registryUrl: netherlandsRegistryUrl(kvk),
  };
}

/** Selskabets egen balance, resultatopgørelse og pengestrømme → vores poster. */
const FIELDS: Record<string, string> = {
  AssetsNoncurrent: "noncurrent_assets",
  Inventories: "inventories",
  CashAndCashEquivalents: "cash",
  AssetsCurrent: "current_assets",
  Assets: "assets",
  ShareCapitalPaidCalledUp: "contributed_capital",
  RetainedEarnings: "retained_earnings",
  Equity: "equity",
  Provisions: "provisions",
  LiabilitiesNoncurrent: "longterm_liabilities",
  LiabilitiesCurrent: "shortterm_liabilities",
  EquityAndLiabilities: "liabilities_and_equity",
  GrossMargin: "gross_profit",
  EmployeeBenefitsExpenses: "employee_expense",
  DepreciationPropertyPlantEquipmentAmortisationIntangibleAssets: "depreciation",
  OperatingResult: "operating_result",
  ResultBeforeTax: "result_before_tax",
  IncomeTaxExpense: "tax_expense",
  ResultAfterTax: "net_result",
  CashFlowOperatingActivities: "cash_flow_operating",
  CashFlowInvestingActivities: "cash_flow_investing",
  CashFlowFinancingActivities: "cash_flow_financing",
};
/** Kun selskabets eget regnskab; de konsoliderede afsnit springes over. */
const OWN_SECTIONS = new Set(["BalanceSheet", "IncomeStatement", "CashFlowStatement"]);

/** Alle `key`/`value` under et afsnit, uanset hvor dybt KVK har lagt dem. */
function collect(fields: unknown, into: Map<string, string>): void {
  if (!Array.isArray(fields)) return;
  for (const field of fields) {
    if (!isObject(field)) continue;
    const key = text(field["key"]);
    const value = text(field["value"]);
    if (key && value !== null && !into.has(key)) into.set(key, value);
    collect(field["opendataFields"], into);
  }
}

/** KVK's svar → ét regnskab (det seneste XBRL-indsendte), i EUR. */
export function parseKvkStatement(raw: unknown, kvk: string): RegistryStatementsResult {
  const top = isObject(raw) && Array.isArray(raw["opendataFields"]) ? raw["opendataFields"] : [];
  const values = new Map<string, string>();
  let yearText: string | null = null;
  let adoptedOn: string | null = null;
  for (const field of top) {
    if (!isObject(field)) continue;
    const key = text(field["key"]);
    if (key === "FinancialYear") yearText = text(field["value"]);
    if (key === "DocumentAdoptionDate") adoptedOn = text(field["value"]);
    if (key && OWN_SECTIONS.has(key)) collect(field["opendataFields"], values);
  }
  if (!yearText) return { statements: [], warnings: [] };
  const year = /^\d{4}$/.test(yearText) ? Number(yearText) : null;
  if (!year || year < 1990) {
    return {
      statements: [],
      warnings: [msg("netherlands.yearUnreadable", { year: yearText })],
    };
  }
  // Datasættet oplyser kun regnskabsåret. Er regnskabet fastlagt inden årets udgang, kan året
  // ikke være kalenderåret, og så kendes perioden ikke.
  if (adoptedOn && /^\d{4}-\d{2}-\d{2}$/.test(adoptedOn) && adoptedOn <= `${year}-12-31`) {
    return {
      statements: [],
      warnings: [msg("netherlands.notCalendarYear", { year, date: adoptedOn })],
    };
  }
  const lineItems: RegistryStatement["lineItems"] = [];
  for (const [key, metric] of Object.entries(FIELDS)) {
    const rawValue = values.get(key);
    if (rawValue === undefined || !/^-?\d+(?:\.\d+)?$/.test(rawValue)) continue;
    lineItems.push({ metric, value: Number(rawValue), tag: `kvk:${key}` });
  }
  if (lineItems.length === 0) {
    return {
      statements: [],
      warnings: [msg("netherlands.noFigures", { year })],
    };
  }
  // En balance, der ikke går op, betyder, at vi har læst et forkert tal; intet bruges da.
  const amount = (metric: string) => lineItems.find((item) => item.metric === metric)?.value;
  const assets = amount("assets");
  const liabilitiesAndEquity = amount("liabilities_and_equity");
  if (
    assets !== undefined &&
    liabilitiesAndEquity !== undefined &&
    assets !== liabilitiesAndEquity
  ) {
    return {
      statements: [],
      warnings: [msg("netherlands.unbalanced", { year })],
    };
  }
  // i18n-keep: the report's type, stored with the statement (register data).
  return {
    statements: [
      {
        periodStart: `${year}-01-01`,
        periodEnd: `${year}-12-31`,
        currency: "EUR",
        sourceDocumentUrl: netherlandsRegistryUrl(kvk),
        reportingClassText: `Hollandsk årsregnskab for ${year}, seneste indsendt digitalt (KVK, åbne data)`,
        goingConcernNote: null,
        lineItems,
      },
    ],
    warnings: [],
  };
}

async function getJson(url: string, source: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { accept: "application/json", "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (response.status === 404) return null;
  if (response.status === 429) {
    throw new Error(msg("netherlands.rateLimited", { registry: source }));
  }
  if (!response.ok) {
    throw new Error(msg("common.status", { registry: source, status: response.status }));
  }
  const body = await response.text();
  if (body.length > MAX_RESPONSE_BYTES) {
    throw new Error(msg("common.tooLarge", { registry: source }));
  }
  return JSON.parse(body) as unknown;
}

async function gleif(filters: Record<string, string>): Promise<RegistryCompany[]> {
  const url = new URL(GLEIF);
  for (const [key, value] of Object.entries(filters)) url.searchParams.set(`filter[${key}]`, value);
  url.searchParams.set("page[size]", String(SEARCH_SIZE));
  const parsed = await getJson(url.toString(), "GLEIF");
  const rows = isObject(parsed) && Array.isArray(parsed["data"]) ? parsed["data"] : [];
  return rows.map(parseGleifCompany).filter((company): company is RegistryCompany => !!company);
}

// i18n-keep: the registry's name; stored in the sources' titles and the evidence (register data).
const REGISTRY_NAME = "KVK (regnskaber) og GLEIF (navn)";

export const netherlandsRegistry: RegistryAdapter = {
  country: "NL",
  registryName: REGISTRY_NAME,
  numberLabel: "KVK",
  sourceKind: "registry_json",
  supportsNameSearch: true,
  configured: () => true,
  normalizeNumber: normalizeKvkNumber,
  findNumbersInText: findKvkNumbers,
  async searchByName(name) {
    const query = name.trim().slice(0, 200);
    if (!query) return [];
    return gleif({ fulltext: query, "entity.legalAddress.country": "NL" });
  },
  async lookupByNumber(registryNumber) {
    const kvk = normalizeKvkNumber(registryNumber);
    if (!kvk) return null;
    const found = await gleif({ "entity.registeredAs": kvk, "entity.jurisdiction": "NL" });
    // GLEIF kan have flere LEI'er for ét nummer (fx en ophørt og en aktiv); den aktive vinder.
    const same = found.filter((company) => company.registryNumber === kvk);
    return same.find((company) => company.active) ?? same[0] ?? null;
  },
  async fetchStatements(registryNumber) {
    const kvk = normalizeKvkNumber(registryNumber);
    if (!kvk) return { statements: [], warnings: [] };
    const parsed = await getJson(netherlandsRegistryUrl(kvk), "KVK");
    if (parsed === null) {
      return {
        statements: [],
        warnings: [msg("netherlands.noXbrl")],
      };
    }
    return parseKvkStatement(parsed, kvk);
  },
};
