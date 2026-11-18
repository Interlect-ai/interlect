/**
 * Frankrig: selskabet fra "Annuaire des entreprises" (`recherche-entreprises.api.gouv.fr`,
 * statens søgetjeneste oven på INSEE's SIRENE og INPI's RNE; gratis, ingen nøgle) og nøgletallene
 * fra de indsendte årsregnskaber i Finansministeriets åbne datasæt "Ratios financiers (BCE / INPI)"
 * på `data.economie.gouv.fr` (gratis, ingen nøgle, Licence Ouverte 2.0). Datasættet er INPI's
 * tal pr. SIREN og regnskabsår; et opslag er ét kald.
 *
 * Kun de beløb, registret selv oplyser, bruges: omsætning (`chiffre_d_affaires`), resultat af
 * primær drift (`ebit`) og årets resultat (`resultat_net`). "Marge brute" er ikke den danske
 * bruttofortjeneste (eksterne omkostninger er ikke trukket fra), og EBE har ingen dansk post, så de
 * bruges ikke. Koncernregnskaber (type K) bruges aldrig. Ca. 45 % af de små selskaber har erklæret
 * resultatopgørelsen fortrolig; så står omsætning og drift som 0 i datasættet, og kun årets
 * resultat (fra balancen) bruges. Franske regnskaber føres i euro.
 *
 * Enkeltmandsvirksomheder (juridisk form 1xxx) er personer og slås aldrig op.
 */
import type {
  RegistryAdapter,
  RegistryCompany,
  RegistryStatement,
  RegistryStatementsResult,
} from "./types.ts";

import { serverText } from "../../i18n/server-text.ts";
import type { MessageKey, TranslateVars } from "../../i18n/translate.ts";

/** Messages to the person, in the page's language or the fund's in a worker. */
function msg(key: string, vars?: TranslateVars) {
  return serverText(`analysisServer.registries.${key}` as MessageKey, vars);
}

const SEARCH = "https://recherche-entreprises.api.gouv.fr/search";
const RATIOS =
  "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/ratios_inpi_bce/records";
const USER_AGENT = "interlect.ai/1.0 (+https://interlect.ai)";
const FETCH_TIMEOUT_MS = 12_000;
const MAX_RESPONSE_BYTES = 2_000_000;
const SEARCH_SIZE = 10;
const RETRY_DELAY_MS = 750;
const YEARS = 8;

/** SIREN: ni cifre med Luhn-kontrol (La Poste, 356000000, er den kendte undtagelse). */
export function isValidSiren(value: string): boolean {
  if (!/^\d{9}$/.test(value)) return false;
  if (value === "356000000") return true;
  let sum = 0;
  for (let index = 0; index < 9; index += 1) {
    let digit = Number(value[8 - index]);
    if (index % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

/**
 * "952 418 325", "952418325", SIRET "952 418 325 00017" og momsnummeret "FR95952418325" →
 * "952418325"; ugyldigt → null.
 */
export function normalizeSiren(raw: string): string | null {
  const compact = raw.trim().replace(/[\s.-]/g, "");
  const vat = /^FR[0-9A-Z]{2}(\d{9})$/i.exec(compact);
  const digits = vat ? vat[1]! : compact.length === 14 ? compact.slice(0, 9) : compact;
  return isValidSiren(digits) ? digits : null;
}

// "SIREN 952 418 325", "RCS Paris 952 418 325", "R.C.S. Nanterre B 794 598 813",
// "SIRET : 794 598 813 00057" og momsnummeret "FR 95 952418325". Et nummer uden et af mærkerne
// kan være hvad som helst (telefon, beløb) og tæller ikke.
const SIREN_PATTERNS = [
  /\b(?:SIREN|SIRET|R\.?\s?C\.?\s?S\.?(?:\s+[A-Za-zÀ-ÿ'-]+){0,3}?(?:\s+[AB])?)\s*(?:n[°o]\.?\s*)?[:#]?\s*(\d{3}[\s.-]?\d{3}[\s.-]?\d{3})(?:[\s.-]?\d{5})?\b/gi,
  /\bFR\s?[0-9A-Z]{2}\s?(\d{3}\s?\d{3}\s?\d{3})\b/g,
];

/** SIREN-numre nævnt i en tekst, i rækkefølge og uden dubletter; kun gyldige numre. */
export function findSirens(text: string): string[] {
  const found: Array<{ index: number; number: string }> = [];
  for (const pattern of SIREN_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const digits = (match[1] ?? "").replace(/[\s.-]/g, "");
      if (isValidSiren(digits)) found.push({ index: match.index, number: digits });
    }
  }
  return found
    .sort((x, y) => x.index - y.index)
    .map((entry) => entry.number)
    .filter((number, index, all) => all.indexOf(number) === index);
}

export function franceRegistryUrl(siren: string): string {
  return `https://annuaire-entreprises.data.gouv.fr/entreprise/${siren}`;
}

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Et selskab fra søgetjenesten. null, hvis det ikke kan læses, eller hvis det er en
 * enkeltmandsvirksomhed (en person).
 */
export function parseFrenchCompany(raw: unknown): RegistryCompany | null {
  if (!isObject(raw)) return null;
  const siren = text(raw["siren"]);
  const name = text(raw["nom_raison_sociale"]) ?? text(raw["nom_complet"]);
  const legalForm = text(raw["nature_juridique"]) ?? "";
  if (!siren || !name || !isValidSiren(siren) || legalForm.startsWith("1")) return null;
  // `etat_administratif`: A = aktiv, C = ophørt (cessée).
  const active = text(raw["etat_administratif"]) !== "C";
  const closedOn = text(raw["date_fermeture"]);
  return {
    country: "FR",
    registryNumber: siren,
    name,
    formerNames: [],
    active,
    status: active
      ? msg("status.active")
      : closedOn
        ? msg("status.ceasedOn", { date: closedOn })
        : msg("status.ceased"),
    website: null,
    registryUrl: franceRegistryUrl(siren),
  };
}

/** Datasættets felter → vores poster. Kun de beløb, registret oplyser direkte. */
const FIELDS: Array<[metric: string, field: string]> = [
  ["revenue", "chiffre_d_affaires"],
  ["operating_result", "ebit"],
  ["net_result", "resultat_net"],
];
/** Står i balancen og er derfor offentligt, også når resultatopgørelsen er fortrolig. */
const BALANCE_FIELDS = new Set(["resultat_net"]);

interface RatioRow {
  periodEnd: string;
  /** C = fuldt regnskab, S = forenklet. */
  type: "C" | "S";
  public: boolean;
  values: Record<string, number | null>;
}

function sameFigures(a: RatioRow, b: RatioRow): boolean {
  const fields = FIELDS.map(([, field]) => field);
  const nonZero = fields.some((field) => (a.values[field] ?? 0) !== 0);
  return nonZero && fields.every((field) => a.values[field] === b.values[field]);
}

export function ratiosUrl(siren: string, periodEnd?: string): string {
  const where = periodEnd
    ? `siren="${siren}" and date_cloture_exercice=date'${periodEnd}'`
    : `siren="${siren}"`;
  return `${RATIOS}?where=${encodeURIComponent(where)}`;
}

/**
 * Datasættets rækker → regnskaber, nyeste først. Ét regnskab pr. slutdato: det fulde (C) før det
 * forenklede (S), aldrig koncernen (K). Datasættet har enkelte år, hvor et regnskab står dobbelt
 * under to slutdatoer med præcis de samme tal; da ved vi ikke, hvilket år tallene hører til, og
 * begge udelades.
 */
export function parseFrenchStatements(raw: unknown, siren: string): RegistryStatementsResult {
  const records = isObject(raw) && Array.isArray(raw["results"]) ? raw["results"] : [];
  const byEnd = new Map<string, RatioRow>();
  for (const record of records) {
    if (!isObject(record) || text(record["siren"]) !== siren) continue;
    const type = text(record["type_bilan"]);
    const periodEnd = text(record["date_cloture_exercice"])?.slice(0, 10);
    if ((type !== "C" && type !== "S") || !periodEnd || !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) {
      continue;
    }
    const existing = byEnd.get(periodEnd);
    if (existing && existing.type === "C") continue;
    byEnd.set(periodEnd, {
      periodEnd,
      type,
      public: text(record["confidentiality"]) === "Public",
      values: Object.fromEntries(FIELDS.map(([, field]) => [field, num(record[field])])),
    });
  }
  const rows = [...byEnd.values()].sort((a, b) => (a.periodEnd < b.periodEnd ? 1 : -1));
  const warnings: string[] = [];
  const doubtful = new Set<string>();
  for (let index = 1; index < rows.length; index += 1) {
    const [newer, older] = [rows[index - 1]!, rows[index]!];
    if (sameFigures(newer, older)) {
      doubtful.add(newer.periodEnd).add(older.periodEnd);
      warnings.push(msg("france.sameFigures", { older: older.periodEnd, newer: newer.periodEnd }));
    }
  }

  const statements: RegistryStatement[] = [];
  for (const row of rows) {
    if (doubtful.has(row.periodEnd)) continue;
    if (statements.length === YEARS) break;
    // Datasættet skriver 0, ikke null, for et tal, der mangler (fortrolig resultatopgørelse,
    // huller i ældre år). Et resultat på præcis 0 er derfor "ukendt"; en omsætning på 0 (en
    // startup uden salg) tæller kun, når året også har et resultat, der ikke er 0.
    const value = (field: string): number | null => {
      const raw = row.values[field];
      return raw === null || raw === undefined || raw === 0 ? null : raw;
    };
    const hasResult = value("ebit") !== null || value("resultat_net") !== null;
    const lineItems: RegistryStatement["lineItems"] = [];
    for (const [metric, field] of FIELDS) {
      // En fortrolig resultatopgørelse står som 0; kun balancens tal er rigtige.
      if (!row.public && !BALANCE_FIELDS.has(field)) continue;
      const amount =
        field === "chiffre_d_affaires" && row.values[field] === 0 && hasResult ? 0 : value(field);
      if (amount === null) continue;
      lineItems.push({ metric, value: amount, tag: `inpi:${field}` });
    }
    if (lineItems.length === 0) continue;
    if (!row.public) {
      warnings.push(msg("france.confidential", { date: row.periodEnd }));
    }
    // Regnskabsåret er normalt 12 måneder; datasættet oplyser kun slutdatoen. Et år før
    // slutdatoen (29. feb → 28. feb), plus én dag.
    const [year, month, day] = row.periodEnd.split("-").map(Number) as [number, number, number];
    const lastDay = new Date(Date.UTC(year - 1, month, 0)).getUTCDate();
    const start = new Date(Date.UTC(year - 1, month - 1, Math.min(day, lastDay) + 1));
    statements.push({
      periodStart: start.toISOString().slice(0, 10),
      periodEnd: row.periodEnd,
      currency: "EUR",
      sourceDocumentUrl: ratiosUrl(siren, row.periodEnd),
      // i18n-keep: the report's type, stored with the statement (register data).
      reportingClassText:
        row.type === "C"
          ? "Fransk årsregnskab (INPI, åbne data)"
          : "Fransk forenklet årsregnskab (INPI, åbne data)",
      goingConcernNote: null,
      lineItems,
    });
  }
  return { statements, warnings };
}

async function getJson(url: string, source: string): Promise<unknown> {
  // Statens søgetjeneste afbryder af og til forbindelsen eller svarer 5xx; ét nyt forsøg er nok.
  let response: Response | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const last = attempt === 1;
    try {
      response = await fetch(url, {
        headers: { accept: "application/json", "user-agent": USER_AGENT },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch (cause) {
      if (last) throw cause;
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      continue;
    }
    if (!last && (response.status >= 500 || response.status === 429)) {
      await response.body?.cancel();
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      continue;
    }
    break;
  }
  if (!response) throw new Error(msg("common.unreachable", { registry: source }));
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(msg("common.status", { registry: source, status: response.status }));
  }
  const body = await response.text();
  if (body.length > MAX_RESPONSE_BYTES) {
    throw new Error(msg("common.tooLarge", { registry: source }));
  }
  return JSON.parse(body) as unknown;
}

async function search(query: string): Promise<RegistryCompany[]> {
  const url = `${SEARCH}?q=${encodeURIComponent(query)}&per_page=${SEARCH_SIZE}`;
  const parsed = await getJson(url, "Annuaire des entreprises");
  const rows = isObject(parsed) && Array.isArray(parsed["results"]) ? parsed["results"] : [];
  return rows.map(parseFrenchCompany).filter((company): company is RegistryCompany => !!company);
}

export const franceRegistry: RegistryAdapter = {
  country: "FR",
  registryName: "INPI / Annuaire des entreprises",
  numberLabel: "SIREN",
  sourceKind: "registry_json",
  supportsNameSearch: true,
  configured: () => true,
  normalizeNumber: normalizeSiren,
  findNumbersInText: findSirens,
  async searchByName(name) {
    const query = name.trim().slice(0, 200);
    return query ? search(query) : [];
  },
  async lookupByNumber(registryNumber) {
    const siren = normalizeSiren(registryNumber);
    if (!siren) return null;
    return (await search(siren)).find((company) => company.registryNumber === siren) ?? null;
  },
  async fetchStatements(registryNumber) {
    const siren = normalizeSiren(registryNumber);
    if (!siren) return { statements: [], warnings: [] };
    const url = `${ratiosUrl(siren)}&order_by=${encodeURIComponent("date_cloture_exercice desc")}&limit=20`;
    const parsed = await getJson(url, "data.economie.gouv.fr");
    const result = parseFrenchStatements(parsed, siren);
    if (result.statements.length === 0) {
      result.warnings.push(msg("france.noFigures"));
    }
    return result;
  },
};
