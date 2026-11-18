/**
 * Sverige: Bolagsverkets API for værdifulde datasæt. Gratis og uden aftale, men med
 * en nøgle (OAuth2 client credentials), som Bolagsverket sender efter deres kundeformular
 * `BOLAGSVERKET_CLIENT_ID` og `BOLAGSVERKET_CLIENT_SECRET`. Uden nøglen er adapteren
 * "ikke sat op", og screeningen går videre som for et selskab uden register.
 *  - `POST /organisationer` {identitetsbeteckning}: selskabet på org.nr. (ingen navnesøgning).
 *  - `POST /dokumentlista` {identitetsbeteckning}: digitalt indsendte årsredovisningar.
 *  - `GET /dokument/{dokumentId}`: en zip med årsredovisningen i iXBRL (`sweden-ixbrl.ts`).
 * Kun digitalt indsendte regnskaber findes (53 % i 2024); for resten er regnskabet "ikke
 * tilgængeligt", og analysen bruger websøgningens tal. Kun juridiske personer: et
 * personnummer (enskild firma) slås aldrig op.
 *
 * Endpoints og felter er ikke prøvet mod det rigtige API endnu (nøglen mangler); de følger
 * Bolagsverkets beskrivelse og et åbent klientbibliotek. Prøves, når er løst.
 */
import { unzipSync } from "fflate";
import { parseSwedishIxbrl } from "./sweden-ixbrl.ts";
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

const API_URL = "https://gw.api.bolagsverket.se/vardefulla-datamangder/v1";
const TOKEN_URL = "https://portal.api.bolagsverket.se/oauth2/token";
const SCOPE = "vardefulla-datamangder:read vardefulla-datamangder:ping";
const USER_AGENT = outboundUserAgent();
const FETCH_TIMEOUT_MS = 20_000;
const MAX_ZIP_BYTES = 8_000_000;
/** De nyeste årsredovisningar; hver har også året før og en flerårsöversikt. */
const MAX_DOCUMENTS = 6;
const SAME_PERIOD_DAYS = 7;

/** Luhn-kontrolcifferet for svenske organisationsnummer (10 cifre). */
export function isValidSwedishOrgNumber(value: string): boolean {
  // Tredje ciffer ≥ 2: en juridisk person. Et personnummer (måned 01-12) er aldrig med.
  if (!/^\d{10}$/.test(value) || Number(value[2]) < 2) return false;
  let sum = 0;
  for (let index = 0; index < 10; index += 1) {
    let digit = Number(value[index]) * (index % 2 === 0 ? 2 : 1);
    if (digit > 9) digit -= 9;
    sum += digit;
  }
  return sum % 10 === 0;
}

/** "556036-0793", "16 556036-0793", momsnummeret "SE556036079301" → "5560360793". */
export function normalizeSwedishOrgNumber(raw: string): string | null {
  let digits = raw.replace(/^\s*SE/i, "").replace(/[\s.-]/g, "");
  if (/^\d{12}$/.test(digits) && raw.trim().toUpperCase().startsWith("SE")) {
    digits = digits.slice(0, 10); // momsnummer: org.nr. + "01"
  } else if (/^16\d{10}$/.test(digits)) {
    digits = digits.slice(2);
  }
  return isValidSwedishOrgNumber(digits) ? digits : null;
}

// "Org.nr 556036-0793", "Organisationsnummer: 556036-0793", "orgnr 5560360793" og momsnummeret
// "SE556036079301" (kun med SE foran og 01 bagefter, så andre numre ikke tæller).
const ORGNR_PATTERNS = [
  /\borg(?:anisations)?\.?\s*(?:nr|nummer|number|no)\.?\s*[:#]?\s*(\d{6}[\s-]?\d{4})\b/gi,
  /\bSE\s?(\d{10})\s?01\b/gi,
];

/** Svenske org.nr. nævnt i en tekst, i rækkefølge og uden dubletter; kun gyldige. */
export function findSwedishOrgNumbers(text: string): string[] {
  const found: Array<{ index: number; number: string }> = [];
  for (const pattern of ORGNR_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const digits = (match[1] ?? "").replace(/[\s-]/g, "");
      if (isValidSwedishOrgNumber(digits)) found.push({ index: match.index, number: digits });
    }
  }
  return found
    .sort((left, right) => left.index - right.index)
    .map((entry) => entry.number)
    .filter((number, index, all) => all.indexOf(number) === index);
}

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function at(node: unknown, path: string): unknown {
  let current: unknown = node;
  for (const key of path.split(".")) {
    if (!isObject(current)) return undefined;
    current = current[key];
  }
  return current;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Et selskab fra `POST /organisationer`. null, hvis svaret ikke kan læses. */
export function parseBolagsverketOrganisation(raw: unknown): RegistryCompany | null {
  const organisation = Array.isArray(at(raw, "organisationer"))
    ? (at(raw, "organisationer") as unknown[])[0]
    : undefined;
  if (!isObject(organisation)) return null;
  const number = text(at(organisation, "organisationsidentitet.identitetsbeteckning"));
  const names = at(organisation, "organisationsnamn.organisationsnamnLista");
  const allNames = Array.isArray(names)
    ? names.map((entry) => text(at(entry, "namn"))).filter((name): name is string => !!name)
    : [];
  const orgNumber = number ? number.replace(/\D/g, "") : null;
  if (!orgNumber || !isValidSwedishOrgNumber(orgNumber) || allNames.length === 0) return null;
  const reasons: string[] = [];
  if (text(at(organisation, "avregistreradOrganisation.avregistreringsdatum"))) {
    reasons.push("avregistrerad");
  }
  const winding = at(
    organisation,
    "pagaendeAvvecklingsEllerOmstruktureringsforfarande.pagaendeAvvecklingsEllerOmstruktureringsforfarandeLista",
  );
  if (Array.isArray(winding) && winding.length > 0) {
    const label = text(at(winding[0], "klartext"));
    reasons.push(label ? label.toLowerCase() : "under avveckling");
  }
  if (text(at(organisation, "verksamOrganisation.kod"))?.toUpperCase() === "NEJ") {
    reasons.push(msg("status.notTrading"));
  }
  return {
    country: "SE",
    registryNumber: orgNumber,
    name: allNames[0]!,
    formerNames: allNames.slice(1),
    active: reasons.length === 0,
    status: reasons.length ? reasons.join(", ") : msg("status.active"),
    website: null,
    registryUrl: `${API_URL}/organisationer`,
  };
}

export interface BolagsverketDocument {
  id: string;
  periodEnd: string;
  registeredAt: string;
}

/** Dokumentlisten → årsredovisningar med id og periode, nyeste periode først. */
export function parseDocumentList(raw: unknown): BolagsverketDocument[] {
  const documents = at(raw, "dokument");
  if (!Array.isArray(documents)) return [];
  return documents
    .map((entry) => ({
      id: text(at(entry, "dokumentId")) ?? "",
      periodEnd: (text(at(entry, "rapporteringsperiodTom")) ?? "").slice(0, 10),
      registeredAt: text(at(entry, "registreringstidpunkt")) ?? "",
      format: text(at(entry, "filformat")) ?? "",
    }))
    .filter((entry) => entry.id && /^\d{4}-\d{2}-\d{2}$/.test(entry.periodEnd))
    .sort((left, right) =>
      left.periodEnd === right.periodEnd
        ? right.registeredAt.localeCompare(left.registeredAt)
        : right.periodEnd.localeCompare(left.periodEnd),
    )
    .map(({ id, periodEnd, registeredAt }) => ({ id, periodEnd, registeredAt }));
}

function daysApart(left: string, right: string) {
  return Math.abs(Date.parse(`${left}T00:00:00Z`) - Date.parse(`${right}T00:00:00Z`)) / 86_400_000;
}

/**
 * Flere årsredovisningar → ét regnskab pr. år, nyeste først. Hvert års egen årsredovisning går
 * forud; et nyere regnskabs sammenligningstal udfylder kun år, der ellers mangler. Kun år i
 * samme valuta som det nyeste.
 */
export function mergeSwedishReports(
  reports: Array<{ periodEnd: string; statements: RegistryStatement[] }>,
): RegistryStatementsResult {
  const own: RegistryStatement[] = [];
  const comparatives: RegistryStatement[] = [];
  for (const report of reports) {
    for (const statement of report.statements) {
      (daysApart(statement.periodEnd, report.periodEnd) <= SAME_PERIOD_DAYS
        ? own
        : comparatives
      ).push(statement);
    }
  }
  const merged: RegistryStatement[] = [];
  for (const statement of [...own, ...comparatives]) {
    if (merged.some((kept) => daysApart(kept.periodEnd, statement.periodEnd) <= SAME_PERIOD_DAYS)) {
      continue;
    }
    merged.push(statement);
  }
  merged.sort((left, right) => (left.periodEnd < right.periodEnd ? 1 : -1));
  const currency = merged[0]?.currency;
  const warnings = merged
    .filter((statement) => statement.currency !== currency)
    .map((statement) =>
      msg("common.otherCurrency", {
        date: statement.periodEnd,
        currency: statement.currency,
        latest: currency ?? "",
      }),
    );
  return { statements: merged.filter((statement) => statement.currency === currency), warnings };
}

/** Grænser for zip'en: højst 5 XHTML-filer på hver højst 20 MB og 40 MB i alt (mod zip-bomber). */
const MAX_HTML_FILES = 5;
const MAX_HTML_BYTES = 20_000_000;
const MAX_UNZIPPED_BYTES = 40_000_000;

/**
 * XHTML-filerne i Bolagsverkets zip (årsredovisningen og evt. revisionsberetningen). Kun filer
 * inden for grænserne pakkes ud; en fil, der er større end den oplyser, eller som er skåret af
 * (slutter ikke med </html>), udelades.
 */
export function ixbrlFilesFromZip(bytes: Uint8Array): string[] {
  let total = 0;
  let count = 0;
  const files = unzipSync(bytes, {
    filter: (file) => {
      if (!/\.x?html?$/i.test(file.name) || file.originalSize > MAX_HTML_BYTES) return false;
      if (count >= MAX_HTML_FILES || total + file.originalSize > MAX_UNZIPPED_BYTES) return false;
      count += 1;
      total += file.originalSize;
      return true;
    },
  });
  return Object.keys(files)
    .sort()
    .map((name) => new TextDecoder().decode(files[name]))
    .filter((text) => /<\/(?:[a-z]+:)?html>\s*$/i.test(text));
}

/** Den fil i zip'en, der giver flest regnskabsår (årsredovisningen, ikke revisionsberetningen). */
export function readBestReport(bytes: Uint8Array, sourceDocumentUrl: string) {
  let best: ReturnType<typeof parseSwedishIxbrl> | null = null;
  for (const xhtml of ixbrlFilesFromZip(bytes)) {
    const parsed = parseSwedishIxbrl(xhtml, sourceDocumentUrl);
    if (!best || parsed.statements.length > best.statements.length) best = parsed;
  }
  return best;
}

export function bolagsverketConfigured(): boolean {
  return Boolean(
    process.env["BOLAGSVERKET_CLIENT_ID"] && process.env["BOLAGSVERKET_CLIENT_SECRET"],
  );
}

let cachedToken: { value: string; expiresAt: number } | null = null;

async function accessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value;
  const clientId = process.env["BOLAGSVERKET_CLIENT_ID"];
  const clientSecret = process.env["BOLAGSVERKET_CLIENT_SECRET"];
  if (!clientId || !clientSecret) throw new Error(msg("sweden.notSetUp"));
  const response = await fetch(process.env["BOLAGSVERKET_TOKEN_URL"] ?? TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": USER_AGENT },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: SCOPE,
    }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(msg("sweden.loginStatus", { status: response.status }));
  const body = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new Error(msg("sweden.noToken"));
  cachedToken = {
    value: body.access_token,
    expiresAt: Date.now() + Math.max(0, (body.expires_in ?? 3600) - 60) * 1000,
  };
  return cachedToken.value;
}

/** Et kald med nøglen; en afvist nøgle (401) hentes på ny én gang. 404 giver null. */
async function call(
  path: string,
  init: { body?: Json } = {},
  retry = true,
): Promise<Response | null> {
  const response = await fetch(`${process.env["BOLAGSVERKET_API_URL"] ?? API_URL}${path}`, {
    method: init.body ? "POST" : "GET",
    headers: {
      authorization: `Bearer ${await accessToken()}`,
      "user-agent": USER_AGENT,
      ...(init.body ? { "content-type": "application/json", accept: "application/json" } : {}),
    },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (response.status === 401 && retry) {
    cachedToken = null;
    return call(path, init, false);
  }
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(msg("common.status", { registry: "Bolagsverket", status: response.status }));
  }
  return response;
}

/** Svaret fra `/organisationer`: null kun ved en tom liste; et svar i et andet format er en fejl. */
export function organisationFromResponse(raw: unknown): RegistryCompany | null {
  const list = at(raw, "organisationer");
  if (Array.isArray(list) && list.length === 0) return null;
  const company = parseBolagsverketOrganisation(raw);
  if (!company) throw new Error(msg("sweden.companyUnreadable"));
  return company;
}

/** Svaret fra `/dokumentlista`: en manglende liste er en fejl, ikke "ingen regnskaber". */
export function documentsFromResponse(raw: unknown): BolagsverketDocument[] {
  if (!Array.isArray(at(raw, "dokument"))) {
    throw new Error(msg("sweden.documentsUnreadable"));
  }
  return parseDocumentList(raw);
}

export const swedenRegistry: RegistryAdapter = {
  country: "SE",
  registryName: "Bolagsverket",
  numberLabel: "Org.nr.",
  sourceKind: "ixbrl_structured",
  supportsNameSearch: false,
  configured: bolagsverketConfigured,
  normalizeNumber: normalizeSwedishOrgNumber,
  findNumbersInText: findSwedishOrgNumbers,
  // API'et for værdifulde datasæt kan ikke søge på navn; selskabet findes kun på org.nr.
  async searchByName() {
    return [];
  },
  async lookupByNumber(registryNumber) {
    const orgNumber = normalizeSwedishOrgNumber(registryNumber);
    if (!orgNumber) return null;
    const response = await call("/organisationer", { body: { identitetsbeteckning: orgNumber } });
    return response ? organisationFromResponse(await response.json()) : null;
  },
  async fetchStatements(registryNumber) {
    const orgNumber = normalizeSwedishOrgNumber(registryNumber);
    if (!orgNumber) return { statements: [], warnings: [] };
    const list = await call("/dokumentlista", { body: { identitetsbeteckning: orgNumber } });
    if (!list) console.warn(`[registry:SE] /dokumentlista answered 404 for ${orgNumber}`);
    const documents = list ? documentsFromResponse(await list.json()) : [];
    const reports: Array<{ periodEnd: string; statements: RegistryStatement[] }> = [];
    const warnings: string[] = [];
    const done = new Set<string>();
    let attempts = 0;
    for (const document of documents) {
      if (reports.length >= MAX_DOCUMENTS || attempts >= MAX_DOCUMENTS * 2) break;
      // Et år, der allerede er læst, springes over; en fejlet hentning prøver årets næste filing.
      if (done.has(document.periodEnd)) continue;
      attempts += 1;
      const url = `${API_URL}/dokument/${encodeURIComponent(document.id)}`;
      const response = await call(`/dokument/${encodeURIComponent(document.id)}`);
      const declared = Number(response?.headers.get("content-length") ?? "0");
      if (!response || declared > MAX_ZIP_BYTES) {
        warnings.push(msg("sweden.notFetched", { date: document.periodEnd }));
        continue;
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      const parsed = bytes.byteLength > MAX_ZIP_BYTES ? null : readBestReport(bytes, url);
      // Et regnskab for et andet org.nr. bruges aldrig.
      if (!parsed || (parsed.orgNumber && parsed.orgNumber !== orgNumber)) {
        warnings.push(msg("sweden.notRead", { date: document.periodEnd }));
        continue;
      }
      if (parsed.statements.length === 0) {
        warnings.push(msg("sweden.noFigures", { date: document.periodEnd }));
        continue;
      }
      done.add(document.periodEnd);
      reports.push({ periodEnd: document.periodEnd, statements: parsed.statements });
    }
    // Der fandtes årsredovisningar, men ingen kunne bruges: det er en fejl, ikke "ikke tilgængeligt".
    if (documents.length > 0 && reports.length === 0) {
      throw new Error(
        `${msg("sweden.noneReadable", { count: documents.length })} ${warnings.join(" ")}`.trim(),
      );
    }
    const merged = mergeSwedishReports(reports);
    return { statements: merged.statements, warnings: [...warnings, ...merged.warnings] };
  },
};
