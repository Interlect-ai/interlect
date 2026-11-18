/**
 * Norge: Brønnøysundregistrene. Gratis, ingen nøgle, NLOD 2.0.
 *  - Enhetsregisteret (`data.brreg.no/enhetsregisteret/api`): selskabet, søgning på navn.
 *  - Regnskapsregisteret (`data.brreg.no/regnskapsregisteret/regnskap/{orgnr}`): de seneste
 *    3 årsregnskaber som JSON, selskab og evt. koncern, med valuta pr. regnskab.
 * Kun selskabets eget regnskab (SELSKAP) bruges, aldrig koncernens, så tallene altid er samme
 * juridiske enhed som org.nr. Hvert tal står præcis, som registret giver det.
 *
 * Bevidst ikke med: `sumFordringer` er alle tilgodehavender,
 * ikke kun fra salg; `sumInnskuttEgenkaptial` indeholder overkurs, så den er ikke selskabskapital
 * (kapitaltab ville blive regnet forkert); `sumDriftsinntekter` kan indeholde tilskud, så kun
 * `salgsinntekter` bliver omsætning. Antal ansatte i Enhetsregisteret er i dag, ikke pr. år.
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

const ENHETSREGISTERET = "https://data.brreg.no/enhetsregisteret/api/enheter";
const REGNSKAPSREGISTERET = "https://data.brreg.no/regnskapsregisteret/regnskap";
const USER_AGENT = "interlect.ai/1.0 (+https://interlect.ai)";
const FETCH_TIMEOUT_MS = 12_000;
const MAX_RESPONSE_BYTES = 2_000_000;
const SEARCH_SIZE = 10;

const ORGNR_WEIGHTS = [3, 2, 7, 6, 5, 4, 3, 2] as const;

/** Brønnøysunds kontrolciffer-regel (modulus 11) for organisasjonsnummer. */
export function isValidNorwegianOrgNumber(value: string): boolean {
  if (!/^[89][0-9]{8}$/.test(value)) return false;
  const sum = ORGNR_WEIGHTS.reduce(
    (total, weight, index) => total + weight * Number(value[index]),
    0,
  );
  const remainder = sum % 11;
  const check = remainder === 0 ? 0 : 11 - remainder;
  return check !== 10 && check === Number(value[8]);
}

/** "998 209 218", "NO 998209218 MVA" → "998209218"; ugyldigt → null. */
export function normalizeNorwegianOrgNumber(raw: string): string | null {
  const digits = raw
    .replace(/^\s*NO/i, "")
    .replace(/MVA\s*$/i, "")
    .replace(/[\s.-]/g, "");
  return isValidNorwegianOrgNumber(digits) ? digits : null;
}

// "Org.nr. 998 209 218", "org nr: 998209218", "Organisasjonsnummer 998209218", "Org. no. 998 209 218",
// og momsnummeret "NO 998 209 218 MVA" (kun med MVA, så et telefonnummer efter "NO" ikke tæller).
const ORGNR_PATTERNS = [
  /\borg(?:anisasjons)?\.?\s*(?:nr|no|nummer|number)\.?\s*[:#]?\s*((?:\d[\s.]?){8}\d)\b/gi,
  /\bNO\s?((?:\d[\s.]?){8}\d)\s?MVA\b/gi,
];

/** Norske org.nr. nævnt i en tekst, i rækkefølge og uden dubletter; kun gyldige numre. */
export function findNorwegianOrgNumbers(text: string): string[] {
  const found: Array<{ index: number; number: string }> = [];
  for (const pattern of ORGNR_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const digits = (match[1] ?? "").replace(/[\s.]/g, "");
      if (isValidNorwegianOrgNumber(digits)) found.push({ index: match.index, number: digits });
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

/** "www.spond.com" → "https://www.spond.com". */
function websiteOf(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

export function registryUrlFor(orgNumber: string): string {
  return `https://virksomhet.brreg.no/nb/oppslag/enheter/${orgNumber}`;
}

/** En enhet fra Enhetsregisteret (opslag eller søgning). null, hvis den ikke kan læses. */
export function parseBrregEntity(raw: unknown): RegistryCompany | null {
  if (!isObject(raw)) return null;
  const orgNumber = text(raw["organisasjonsnummer"]);
  const name = text(raw["navn"]);
  if (!orgNumber || !name || !isValidNorwegianOrgNumber(orgNumber)) return null;
  const reasons: string[] = [];
  if (raw["konkurs"] === true) reasons.push("konkurs");
  if (raw["underAvvikling"] === true) reasons.push("under avvikling");
  if (raw["underTvangsavviklingEllerTvangsopplosning"] === true) {
    reasons.push("under tvangsavvikling");
  }
  if (text(raw["slettedato"])) reasons.push("slettet");
  const formerNames = Array.isArray(raw["historiskeNavn"])
    ? raw["historiskeNavn"]
        .map((entry) => (isObject(entry) ? text(entry["navn"]) : null))
        .filter((value): value is string => Boolean(value))
    : [];
  return {
    country: "NO",
    registryNumber: orgNumber,
    name,
    formerNames,
    active: reasons.length === 0,
    status: reasons.length ? reasons.join(", ") : "aktiv",
    website: websiteOf(raw["hjemmeside"]),
    registryUrl: registryUrlFor(orgNumber),
  };
}

/**
 * Regnskapsregisterets felter → vores regnskabsposter. Feltnavnene (også stavefejlen
 * `sumInnskuttEgenkaptial`) er registrets egne.
 */
const BRREG_FIELDS: Array<[metric: string, path: string]> = [
  ["revenue", "resultatregnskapResultat.driftsresultat.driftsinntekter.salgsinntekter"],
  ["employee_expense", "resultatregnskapResultat.driftsresultat.driftskostnad.loennskostnad"],
  ["operating_result", "resultatregnskapResultat.driftsresultat.driftsresultat"],
  ["finance_income", "resultatregnskapResultat.finansresultat.finansinntekt.sumFinansinntekter"],
  ["finance_expenses", "resultatregnskapResultat.finansresultat.finanskostnad.sumFinanskostnad"],
  ["result_before_tax", "resultatregnskapResultat.ordinaertResultatFoerSkattekostnad"],
  ["tax_expense", "resultatregnskapResultat.ordinaertResultatSkattekostnad"],
  ["net_result", "resultatregnskapResultat.aarsresultat"],
  ["assets", "eiendeler.sumEiendeler"],
  ["noncurrent_assets", "eiendeler.anleggsmidler.sumAnleggsmidler"],
  ["current_assets", "eiendeler.omloepsmidler.sumOmloepsmidler"],
  ["inventories", "eiendeler.sumVarer"],
  ["cash", "eiendeler.sumBankinnskuddOgKontanter"],
  ["equity", "egenkapitalGjeld.egenkapital.sumEgenkapital"],
  ["retained_earnings", "egenkapitalGjeld.egenkapital.opptjentEgenkapital.sumOpptjentEgenkapital"],
  ["liabilities", "egenkapitalGjeld.gjeldOversikt.sumGjeld"],
  ["shortterm_liabilities", "egenkapitalGjeld.gjeldOversikt.kortsiktigGjeld.sumKortsiktigGjeld"],
  ["longterm_liabilities", "egenkapitalGjeld.gjeldOversikt.langsiktigGjeld.sumLangsiktigGjeld"],
  ["liabilities_and_equity", "egenkapitalGjeld.sumEgenkapitalGjeld"],
];

// i18n-keep: the registry's own name.
const REGISTRY_NAME = "Brønnøysundregistrene";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// i18n-keep: the report's type, stored with the statement (register data).
function reportingClassOf(raw: Json): string {
  const rules = at(raw, "regnkapsprinsipper.regnskapsregler");
  const small = at(raw, "regnkapsprinsipper.smaaForetak") === true;
  const standard =
    rules === "IFRS"
      ? "IFRS"
      : rules === "forenkletAnvendelseIFRS"
        ? "forenklet IFRS"
        : "regnskapsloven";
  const parts = [`Norsk årsregnskab (${standard}${small ? ", små foretak" : ""})`];
  if (raw["avviklingsregnskap"] === true) parts.push("avviklingsregnskab");
  if (at(raw, "revisjon.ikkeRevidertAarsregnskap") === true) parts.push("ikke revideret");
  return parts.join(", ");
}

/**
 * Regnskapsregisterets svar → selskabets regnskaber, nyeste først. Kun SELSKAP; ét regnskab
 * pr. regnskabsår (det senest indsendte); kun år i samme valuta som det nyeste, så en
 * vækstrate aldrig blander to valutaer.
 */
export function parseBrregStatements(raw: unknown, orgNumber: string): RegistryStatementsResult {
  const rows = Array.isArray(raw) ? raw.filter(isObject) : [];
  const byPeriodEnd = new Map<string, { id: number; row: Json }>();
  for (const row of rows) {
    if (row["regnskapstype"] !== "SELSKAP") continue;
    const owner = text(at(row, "virksomhet.organisasjonsnummer"));
    if (owner && owner !== orgNumber) continue;
    const periodEnd = text(at(row, "regnskapsperiode.tilDato"));
    if (!periodEnd || !ISO_DATE.test(periodEnd)) continue;
    const id = typeof row["id"] === "number" ? row["id"] : 0;
    const existing = byPeriodEnd.get(periodEnd);
    if (!existing || id > existing.id) byPeriodEnd.set(periodEnd, { id, row });
  }

  const statements: RegistryStatement[] = [];
  const warnings: string[] = [];
  for (const [periodEnd, { id, row }] of byPeriodEnd) {
    const startText = text(at(row, "regnskapsperiode.fraDato"));
    const periodStart = startText && ISO_DATE.test(startText) ? startText : periodEnd;
    const currency = (text(row["valuta"]) ?? "NOK").toUpperCase();
    const lineItems: RegistryStatement["lineItems"] = [];
    for (const [metric, path] of BRREG_FIELDS) {
      const value = at(row, path);
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      lineItems.push({ metric, value, tag: `brreg:${path.split(".").pop()}` });
    }
    if (lineItems.length === 0) {
      warnings.push(msg("common.noFigures", { date: periodEnd }));
      continue;
    }
    statements.push({
      periodStart,
      periodEnd,
      currency,
      // Den præcise post i registret; uden id selskabets liste over regnskaber.
      sourceDocumentUrl: id
        ? `${REGNSKAPSREGISTERET}/${orgNumber}/${id}`
        : `${REGNSKAPSREGISTERET}/${orgNumber}`,
      reportingClassText: reportingClassOf(row),
      goingConcernNote: null,
      lineItems,
    });
  }
  statements.sort((a, b) => (a.periodEnd < b.periodEnd ? 1 : -1));

  const currency = statements[0]?.currency;
  const sameCurrency = statements.filter((statement) => statement.currency === currency);
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
  return { statements: sameCurrency, warnings };
}

async function getJson(url: string): Promise<unknown | null> {
  const response = await fetch(url, {
    headers: { accept: "application/json", "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (response.status === 404 || response.status === 410) return null;
  if (!response.ok) {
    throw new Error(msg("common.status", { registry: REGISTRY_NAME, status: response.status }));
  }
  const body = await response.text();
  if (body.length > MAX_RESPONSE_BYTES) {
    throw new Error(msg("common.tooLarge", { registry: REGISTRY_NAME }));
  }
  return JSON.parse(body) as unknown;
}

export const norwayRegistry: RegistryAdapter = {
  country: "NO",
  registryName: REGISTRY_NAME,
  numberLabel: "Org.nr.",
  sourceKind: "registry_json",
  supportsNameSearch: true,
  configured: () => true,
  normalizeNumber: normalizeNorwegianOrgNumber,
  findNumbersInText: findNorwegianOrgNumbers,
  async searchByName(name) {
    const query = name.trim().slice(0, 200);
    if (!query) return [];
    const body = await getJson(
      `${ENHETSREGISTERET}?navn=${encodeURIComponent(query)}&size=${SEARCH_SIZE}`,
    );
    const entities = at(body, "_embedded.enheter");
    return Array.isArray(entities)
      ? entities.map(parseBrregEntity).filter((entity): entity is RegistryCompany => !!entity)
      : [];
  },
  async lookupByNumber(registryNumber) {
    const orgNumber = normalizeNorwegianOrgNumber(registryNumber);
    if (!orgNumber) return null;
    return parseBrregEntity(await getJson(`${ENHETSREGISTERET}/${orgNumber}`));
  },
  async fetchStatements(registryNumber) {
    const orgNumber = normalizeNorwegianOrgNumber(registryNumber);
    if (!orgNumber) return { statements: [], warnings: [] };
    const body = await getJson(`${REGNSKAPSREGISTERET}/${orgNumber}`);
    return parseBrregStatements(body ?? [], orgNumber);
  },
};
