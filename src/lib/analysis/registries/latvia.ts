/**
 * Letland: Uzņēmumu reģistrs og Valsts ieņēmumu dienests (VID) på `data.gov.lv`. Gratis,
 * ingen nøgle, CC0. Alle selskaber indsender årsregnskabet elektronisk, og tallene ligger som
 * åbne data i CKAN's datastore, så hvert opslag er ét kald pr. tabel i stedet for en hel fil:
 *  - `uz` (Uzņēmumu reģistra atvērtie dati): selskabet (reg.nr., navn, form, status), søgning
 *    på navn.
 *  - `gada-parskatu-finansu-dati`: årsregnskabets grunddata (år, valuta, antal ansatte),
 *    balancen og resultatopgørelsen, koblet på `statement_id`.
 * Kun selskabets eget regnskab (UGP) bruges, aldrig koncernregnskabet (UKGP). Beløbene står i
 * den valuta og afrunding, registret oplyser (EUR; før 2014 LVL, som udelades).
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

const CKAN = "https://data.gov.lv/dati/api/3/action/datastore_search";
const REGISTER = "25e80bf3-f107-4ab4-89ef-251b5b9374e9";
const STATEMENTS = "27fcc5ec-c63b-4bfd-bb08-01f073a52d04";
const BALANCE = "50ef4f26-f410-4007-b296-22043ca3dc43";
const INCOME = "d5fd17ef-d32e-40cb-8399-82b780095af0";
const USER_AGENT = outboundUserAgent();
const FETCH_TIMEOUT_MS = 12_000;
const MAX_RESPONSE_BYTES = 2_000_000;
const SEARCH_SIZE = 10;
const YEARS = 8;

/**
 * Juridiske personer har 11 cifre og starter på 4, 5 eller 9. Personkoder (privatpersoner)
 * starter på 0–3 og slås aldrig op.
 */
export function isValidLatvianRegNumber(value: string): boolean {
  return /^[459]\d{10}$/.test(value);
}

/** "40203050078", "LV 40203050078", "4020 3050 078" → "40203050078"; ugyldigt → null. */
export function normalizeLatvianRegNumber(raw: string): string | null {
  const digits = raw
    .trim()
    .replace(/^LV/i, "")
    .replace(/[\s.-]/g, "");
  return isValidLatvianRegNumber(digits) ? digits : null;
}

// "Reģ. Nr. 40203050078", "reg. no. 40203050078", "Registration number: 40203050078",
// "reģistrācijas numurs 40203050078" og momsnummeret "LV40203050078" (kun med LV foran).
const REG_PATTERNS = [
  /\b(?:reģ\.?\s*(?:nr|numurs)|reg\.?\s*(?:nr|no|number)|registration\s*(?:no|number|nr)|reģistrācijas\s*(?:nr|numurs)|company\s*(?:reg(?:istration)?\.?\s*)?(?:no|number))\.?\s*[:#]?\s*((?:\d[\s]?){10}\d)\b/gi,
  /\bLV\s?(\d{11})\b/g,
];

/** Lettiske reg.nr. nævnt i en tekst, i rækkefølge og uden dubletter; kun gyldige numre. */
export function findLatvianRegNumbers(text: string): string[] {
  const found: Array<{ index: number; number: string }> = [];
  for (const pattern of REG_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const digits = (match[1] ?? "").replace(/\s/g, "");
      if (isValidLatvianRegNumber(digits)) found.push({ index: match.index, number: digits });
    }
  }
  return found
    .sort((x, y) => x.index - y.index)
    .map((entry) => entry.number)
    .filter((number, index, all) => all.indexOf(number) === index);
}

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function num(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function dateOf(value: unknown): string | null {
  const raw = text(value);
  return raw && /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : null;
}

/** Et selskab fra Uzņēmumu reģistrs (opslag eller søgning). null, hvis det ikke kan læses. */
export function parseLatvianCompany(raw: unknown): RegistryCompany | null {
  if (!isObject(raw)) return null;
  const regNumber = String(num(raw["regcode"]) ?? "");
  const name = text(raw["name"]);
  if (!name || !isValidLatvianRegNumber(regNumber)) return null;
  const reasons: string[] = [];
  const closed = text(raw["closed"]);
  // `terminated` er datoen for sletning fra registret (eller for en reorganisering).
  if (closed === "L") reasons.push(msg("status.liquidated"));
  else if (closed === "R") reasons.push(msg("status.reorganised"));
  else if (dateOf(raw["terminated"])) reasons.push(msg("status.deleted"));
  return {
    country: "LV",
    registryNumber: regNumber,
    name,
    formerNames: [],
    active: reasons.length === 0,
    status: reasons.length ? reasons.join(", ") : msg("status.active"),
    website: null,
    registryUrl: latviaRegistryUrl(regNumber),
  };
}

/** Registrets åbne data om selskabet (der er ingen gratis side pr. selskab). */
export function latviaRegistryUrl(regNumber: string): string {
  return `${CKAN}?resource_id=${REGISTER}&filters=${encodeURIComponent(
    JSON.stringify({ regcode: Number(regNumber) }),
  )}`;
}

/**
 * Balance (`balance_sheets`) → vores poster. Kun det, registret selv oplyser; `accounts_receivable`
 * er alle debitorer, ikke kun fra salg, så den bliver ikke til `trade_receivables`.
 */
const BALANCE_FIELDS: Array<[metric: string, field: string]> = [
  ["cash", "cash"],
  ["inventories", "inventories"],
  ["current_assets", "total_current_assets"],
  ["noncurrent_assets", "total_non_current_assets"],
  ["assets", "total_assets"],
  ["shortterm_liabilities", "current_liabilities"],
  ["longterm_liabilities", "non_current_liabilities"],
  ["provisions", "provisions"],
  ["equity", "equity"],
  ["liabilities_and_equity", "total_equities"],
];

/** Resultatopgørelse (`income_statements`), omkostninger står som positive tal i registret. */
const INCOME_FIELDS: Array<[metric: string, field: string]> = [
  ["revenue", "net_turnover"],
  ["cost_of_sales", "by_function_cost_of_goods_sold"],
  ["gross_profit", "by_function_gross_profit"],
  ["employee_expense", "by_nature_labour_expenses"],
  ["depreciation", "by_nature_depreciation_expenses"],
  ["finance_expenses", "interest_expenses"],
  ["result_before_tax", "income_before_income_taxes"],
  ["tax_expense", "provision_for_income_taxes"],
  ["net_result", "net_income"],
];

interface LatvianStatementRow {
  id: number;
  year: number;
  periodStart: string;
  periodEnd: string;
  currency: string;
  /** 1 ved "ONES", 1000 ved "THOUSANDS". */
  scale: number;
  employees: number | null;
}

/**
 * Årsregnskabernes grunddata → ét regnskab pr. regnskabsår, nyeste først. Koncernregnskaber
 * (UKGP) udelades; findes flere indsendelser for samme år, vinder den højeste id (den seneste).
 */
export function parseStatementRows(raw: unknown): LatvianStatementRow[] {
  const records = isObject(raw) && Array.isArray(raw["records"]) ? raw["records"] : [];
  const byEnd = new Map<string, LatvianStatementRow>();
  for (const record of records) {
    if (!isObject(record) || text(record["source_type"]) === "UKGP") continue;
    const id = num(record["id"]);
    const year = num(record["year"]);
    const periodEnd = dateOf(record["year_ended_on"]);
    const currency = text(record["currency"])?.toUpperCase();
    if (id === null || year === null || !periodEnd || !currency) continue;
    const rounded = text(record["rounded_to_nearest"]);
    const scale = rounded === "THOUSANDS" ? 1000 : rounded === "MILLIONS" ? 1_000_000 : 1;
    const existing = byEnd.get(periodEnd);
    if (existing && existing.id > id) continue;
    byEnd.set(periodEnd, {
      id,
      year,
      periodStart: dateOf(record["year_started_on"]) ?? periodEnd,
      periodEnd,
      currency,
      scale,
      employees: num(record["employees"]),
    });
  }
  return [...byEnd.values()].sort((a, b) => (a.periodEnd < b.periodEnd ? 1 : -1));
}

function recordsByStatement(raw: unknown): Map<number, Json> {
  const records = isObject(raw) && Array.isArray(raw["records"]) ? raw["records"] : [];
  const byStatement = new Map<number, Json>();
  for (const record of records) {
    if (!isObject(record)) continue;
    const id = num(record["statement_id"]);
    if (id !== null) byStatement.set(id, record);
  }
  return byStatement;
}

export function statementUrl(resource: string, statementId: number): string {
  return `${CKAN}?resource_id=${resource}&filters=${encodeURIComponent(
    JSON.stringify({ statement_id: statementId }),
  )}`;
}

/** Registrets rækker for balance og resultat → regnskaber, nyeste først, alle i samme valuta. */
export function parseLatvianStatements(
  rows: LatvianStatementRow[],
  balance: unknown,
  income: unknown,
): RegistryStatementsResult {
  const balanceByStatement = recordsByStatement(balance);
  const incomeByStatement = recordsByStatement(income);
  const statements: RegistryStatement[] = [];
  const warnings: string[] = [];
  for (const row of rows) {
    const lineItems: RegistryStatement["lineItems"] = [];
    const take = (record: Json | undefined, fields: Array<[string, string]>) => {
      if (!record) return;
      for (const [metric, field] of fields) {
        const value = num(record[field]);
        if (value === null) continue;
        // `-0` fra et negeret nul vises som 0.
        lineItems.push({ metric, value: value * row.scale || 0, tag: `data.gov.lv:${field}` });
      }
    };
    take(balanceByStatement.get(row.id), BALANCE_FIELDS);
    take(incomeByStatement.get(row.id), INCOME_FIELDS);
    if (row.employees !== null && row.employees > 0) {
      lineItems.push({
        metric: "average_employees",
        value: row.employees,
        tag: "data.gov.lv:employees",
      });
    }
    if (lineItems.length === 0) {
      warnings.push(msg("common.noFigures", { date: row.periodEnd }));
      continue;
    }
    // i18n-keep: the report's type, stored with the statement (register data).
    statements.push({
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      currency: row.currency,
      sourceDocumentUrl: statementUrl(BALANCE, row.id),
      reportingClassText: "Lettisk årsregnskab (VID, åbne data)",
      goingConcernNote: null,
      lineItems,
    });
  }
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
}

/**
 * Et navn → CKAN's tekstsøgning: ordene skal alle forekomme, det sidste som begyndelse
 * ("printful bits:*"). Alt andet end bogstaver og cifre fjernes, så søgeteksten ikke kan ændre
 * forespørgslen.
 */
export function nameQuery(name: string): string | null {
  const words = name
    .normalize("NFC")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 0)
    .slice(0, 6);
  if (words.length === 0) return null;
  return `${words.slice(0, -1).join(" & ")}${words.length > 1 ? " & " : ""}${words.at(-1)}:*`;
}

async function datastore(
  resource: string,
  params: { filters?: Json; q?: Json; sort?: string; limit: number },
): Promise<unknown | null> {
  const url = new URL(CKAN);
  url.searchParams.set("resource_id", resource);
  if (params.filters) url.searchParams.set("filters", JSON.stringify(params.filters));
  if (params.q) url.searchParams.set("q", JSON.stringify(params.q));
  if (params.sort) url.searchParams.set("sort", params.sort);
  url.searchParams.set("limit", String(params.limit));
  const response = await fetch(url, {
    headers: { accept: "application/json", "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(msg("common.status", { registry: "data.gov.lv", status: response.status }));
  }
  const body = await response.text();
  if (body.length > MAX_RESPONSE_BYTES)
    throw new Error(msg("common.tooLarge", { registry: "data.gov.lv" }));
  const parsed = JSON.parse(body) as unknown;
  if (!isObject(parsed) || parsed["success"] !== true) {
    throw new Error(msg("common.notUseful", { registry: "data.gov.lv" }));
  }
  return isObject(parsed["result"]) ? parsed["result"] : null;
}

export const latviaRegistry: RegistryAdapter = {
  country: "LV",
  registryName: "Uzņēmumu reģistrs (data.gov.lv)",
  numberLabel: "Reg.nr.",
  sourceKind: "registry_json",
  supportsNameSearch: true,
  configured: () => true,
  normalizeNumber: normalizeLatvianRegNumber,
  findNumbersInText: findLatvianRegNumbers,
  async searchByName(name) {
    const query = nameQuery(name);
    if (!query) return [];
    const result = await datastore(REGISTER, { q: { name: query }, limit: SEARCH_SIZE });
    const records = isObject(result) && Array.isArray(result["records"]) ? result["records"] : [];
    return records.map(parseLatvianCompany).filter((c): c is RegistryCompany => !!c);
  },
  async lookupByNumber(registryNumber) {
    const regNumber = normalizeLatvianRegNumber(registryNumber);
    if (!regNumber) return null;
    const result = await datastore(REGISTER, { filters: { regcode: Number(regNumber) }, limit: 1 });
    const records = isObject(result) && Array.isArray(result["records"]) ? result["records"] : [];
    return parseLatvianCompany(records[0] ?? null);
  },
  async fetchStatements(registryNumber) {
    const regNumber = normalizeLatvianRegNumber(registryNumber);
    if (!regNumber) return { statements: [], warnings: [] };
    const info = await datastore(STATEMENTS, {
      filters: { legal_entity_registration_number: Number(regNumber) },
      sort: "year desc",
      limit: 12,
    });
    const rows = parseStatementRows(info).slice(0, YEARS);
    if (rows.length === 0) return { statements: [], warnings: [] };
    const ids = rows.map((row) => row.id);
    const [balance, income] = await Promise.all([
      datastore(BALANCE, { filters: { statement_id: ids }, limit: ids.length * 2 }),
      datastore(INCOME, { filters: { statement_id: ids }, limit: ids.length * 2 }),
    ]);
    return parseLatvianStatements(rows, balance, income);
  },
};
