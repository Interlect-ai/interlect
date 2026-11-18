/**
 * Litauen: Registrų centras' juridiske personregister (JAR) som åbne data på
 * `get.data.gov.lt` (Spinta/UAPI). Gratis, ingen nøgle, CC BY 4.0 (kilde: Registrų centras).
 * Hvert opslag er ét kald pr. tabel:
 *  - `iregistruoti/JuridinisAsmuo`: selskabet (kode, navn, form, status, slettedato); søgning på
 *    navn uden hensyn til store og små bogstaver.
 *  - `balanso_ataskaitos/BalansoAtaskaita` og `pelno_ataskaitos/PelnoAtaskaita`: de indsendte
 *    regnskabers balance og resultat, én række pr. post, koblet på selskabets interne id.
 * Registret oplyser kun hovedposterne (anlægs- og omsætningsaktiver, egenkapital, gæld, omsætning,
 * resultat før skat og årets resultat). Kun selskabets eget regnskab bruges, aldrig koncernens
 * ("Konsoliduot…"). Beløbene står i euro (Litauen fra 1. januar 2015); ældre regnskaber var i
 * litas og udelades. Individuelle virksomheder og interessentskaber (personligt hæftende ejere)
 * er anonymiseret i registret og slås aldrig op.
 */
import { normalizeCompanyName } from "../identity.ts";
import { comparableRegistryName } from "./match.ts";
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

const API = "https://get.data.gov.lt/datasets/gov/rc/jar";
const ENTITY = `${API}/iregistruoti/JuridinisAsmuo`;
const BALANCE = `${API}/balanso_ataskaitos/BalansoAtaskaita`;
const INCOME = `${API}/pelno_ataskaitos/PelnoAtaskaita`;
const USER_AGENT = "interlect.ai/1.0 (+https://interlect.ai)";
const FETCH_TIMEOUT_MS = 15_000;
const RETRY_DELAY_MS = 750;
const MAX_RESPONSE_BYTES = 2_000_000;
const SEARCH_FETCH = 500;
const SEARCH_SIZE = 10;
const STATEMENT_ROWS = 300;
const YEARS = 8;
const EURO_FROM = "2015-01-01";

const ENTITY_FIELDS =
  "select(_id,ja_kodas,ja_pavadinimas,reg_data,isreg_data,statusas.kodas,statusas.name,forma.kodas)";
const LINE_FIELDS =
  "select(laikotarpis_nuo,laikotarpis_iki,reg_date,template_id,template_name,line_type_id,line_name,reiksme)";

/**
 * Selskabskoden (juridinio asmens kodas) har ni cifre; sidste ciffer er kontrolciffer (modulus 11,
 * vægtene 1–8 og ved rest 10 vægtene 3–9, 1). Personkoder har 11 cifre og passer aldrig.
 */
export function isValidLithuanianCompanyCode(value: string): boolean {
  if (!/^\d{9}$/.test(value)) return false;
  const digits = [...value].map(Number);
  const weighted = (weights: number[]) =>
    weights.reduce((total, weight, index) => total + weight * digits[index]!, 0) % 11;
  let check = weighted([1, 2, 3, 4, 5, 6, 7, 8]);
  if (check === 10) {
    check = weighted([3, 4, 5, 6, 7, 8, 9, 1]);
    if (check === 10) check = 0;
  }
  return check === digits[8];
}

/** "302767152", "302 767 152" → "302767152"; ugyldigt → null. */
export function normalizeLithuanianCompanyCode(raw: string): string | null {
  const digits = raw.trim().replace(/[\s.-]/g, "");
  return isValidLithuanianCompanyCode(digits) ? digits : null;
}

// "Įmonės kodas 302767152", "Įm. k. 302767152", "juridinio asmens kodas", "JA kodas", "Company
// code: 302767152", "Registration code/number 302767152", "Reg. No. 302767152". Momskoden
// (PVM kodas, "LT" + 9 eller 12 cifre) er et andet nummer og tæller ikke. `\b` virker ikke før
// "į", så starten er "intet bogstav eller ciffer lige før".
const CODE_PATTERN =
  /(?<![\p{L}\p{N}])(?:įmonės\s+kodas|įm\.\s*k(?:odas)?\.?|juridinio\s+asmens\s+kodas|ja\s+kodas|company\s+(?:code|reg(?:istration)?\.?\s*(?:no|nr|number|code))|reg(?:istration)?\.?\s*(?:code|no|nr|number))\.?\s*[:#]?\s*((?:\d\s?){8}\d)(?!\d)/giu;

/** Litauiske selskabskoder nævnt i en tekst, i rækkefølge og uden dubletter; kun gyldige. */
export function findLithuanianCompanyCodes(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(CODE_PATTERN)) {
    const digits = (match[1] ?? "").replace(/\s/g, "");
    if (isValidLithuanianCompanyCode(digits) && !found.includes(digits)) found.push(digits);
  }
  return found;
}

/** Registrets gratis side om selskabet. */
export function lithuaniaRegistryUrl(code: string): string {
  return `https://www.registrucentras.lt/jar/p/dok.php?kod=${code}`;
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

function dateOf(value: unknown): string | null {
  const raw = text(value);
  return raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

function rowsOf(raw: unknown): Json[] {
  return isObject(raw) && Array.isArray(raw["_data"]) ? raw["_data"].filter(isObject) : [];
}

/**
 * Individuel virksomhed (810, 820), interessentskab (210–212) og kommanditselskab (220–222):
 * ejerne hæfter personligt, og registret har fjernet navnet. De slås aldrig op.
 */
const PERSONAL_FORMS = new Set([210, 211, 212, 220, 221, 222, 810, 820]);

/**
 * Statuskoder, hvor selskabet er ophørt eller på vej ud (nøglen i registries.status.*). Andre
 * koder er stadig aktive.
 */
const ENDED_STATUS: Record<number, string> = {
  5: "underBankruptcy",
  6: "bankrupt",
  7: "underLiquidation",
  9: "liquidationStarted",
  10: "deleted",
  11: "liquidated",
  12: "notReregistered",
  13: "underBankruptcy",
  26: "liquidationAfterBankruptcy",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Registrets interne id for selskabet; regnskabsrækkerne peger på det. */
export function entityIdOf(raw: unknown): string | null {
  const id = isObject(raw) ? text(raw["_id"]) : null;
  return id && UUID.test(id) ? id.toLowerCase() : null;
}

/** Et selskab fra JAR (opslag eller søgning). null, hvis det ikke kan læses eller er personligt. */
export function parseLithuanianCompany(raw: unknown): RegistryCompany | null {
  if (!isObject(raw)) return null;
  const code = String(num(raw["ja_kodas"]) ?? "");
  const name = text(raw["ja_pavadinimas"]);
  if (!name || !isValidLithuanianCompanyCode(code)) return null;
  const form = isObject(raw["forma"]) ? num(raw["forma"]["kodas"]) : null;
  if (form !== null && PERSONAL_FORMS.has(form)) return null;
  const status = isObject(raw["statusas"]) ? raw["statusas"] : {};
  const statusCode = num(status["kodas"]);
  const statusName = text(status["name"]);
  const endedKey = statusCode !== null ? ENDED_STATUS[statusCode] : undefined;
  const ended = endedKey ? msg(`status.${endedKey}`) : undefined;
  const removed = dateOf(raw["isreg_data"]);
  const reasons = [
    ...(ended ? [ended] : []),
    ...(removed && statusCode !== 10 ? [msg("status.deleted")] : []),
  ];
  const active = reasons.length === 0;
  return {
    country: "LT",
    registryNumber: code,
    name,
    formerNames: [],
    active,
    status: !active
      ? reasons.join(", ")
      : statusCode === 0 || statusCode === null || !statusName
        ? msg("status.active")
        : msg("status.activeWith", { status: statusName }),
    website: null,
    registryUrl: lithuaniaRegistryUrl(code),
  };
}

/**
 * Registrets poster (linje-id, ens på tværs af skabelonerne) → vores poster. "PAJAMOS" i
 * foreningers og institutioners regnskaber er alle indtægter (også tilskud), ikke omsætning, og
 * bruges ikke. Balancens gæld er "įsipareigojimai" (al gæld). De ældre skabeloners "mokėtinos
 * sumos ir (kiti) įsipareigojimai" er kun leverandør- og anden gæld (uden tilskud, hensættelser og
 * periodeafgrænsning), så den tæller kun som gæld, når balancen går op med den (`PAYABLES`).
 */
export const LINE_METRICS: Record<string, string> = {
  BSLT00001: "noncurrent_assets",
  BSLT00021: "current_assets",
  BSLT00115: "assets",
  BSLT00040: "equity",
  BSLT00055: "payables",
  BSLT00110: "liabilities",
  BSLT00467: "payables",
  ISLT00001: "revenue",
  ISLT00345: "revenue",
  ISLT00017: "result_before_tax",
  ISLT00211: "result_before_tax",
  ISLT00309: "result_before_tax",
  ISLT00365: "result_before_tax",
  BSLT00612: "result_before_tax",
  ISLT00019: "net_result",
  ISLT00222: "net_result",
  ISLT00310: "net_result",
  ISLT00350: "net_result",
  BSLT00614: "net_result",
};

interface LithuanianLine {
  part: "balance" | "income";
  periodStart: string;
  periodEnd: string;
  regDate: string;
  lineId: string;
  lineName: string;
  value: number;
}

function parseLines(raw: unknown, part: LithuanianLine["part"]): LithuanianLine[] {
  const lines: LithuanianLine[] = [];
  for (const row of rowsOf(raw)) {
    // Koncernregnskabet ("Konsoliduotųjų …", "Konsoliduotosios …") er aldrig selskabets eget.
    if (/konsoliduot/i.test(text(row["template_name"]) ?? "")) continue;
    const periodEnd = dateOf(row["laikotarpis_iki"]);
    const regDate = dateOf(row["reg_date"]);
    const lineId = text(row["line_type_id"]);
    const value = num(row["reiksme"]);
    if (!periodEnd || !regDate || !lineId || value === null) continue;
    lines.push({
      part,
      periodStart: dateOf(row["laikotarpis_nuo"]) ?? periodEnd,
      periodEnd,
      regDate,
      lineId,
      lineName: text(row["line_name"]) ?? lineId,
      value,
    });
  }
  return lines;
}

export function statementSourceUrl(entityId: string, periodEnd: string): string {
  return `${BALANCE}?juridinis_asmuo._id=${encodeURIComponent(`"${entityId}"`)}&laikotarpis_iki=${encodeURIComponent(`"${periodEnd}"`)}`;
}

/** Midlertidig post: leverandør- og anden gæld, før det er afgjort, om den er al gæld. */
const PAYABLES = "payables";

/**
 * "Mokėtinos sumos ir (kiti) įsipareigojimai" er al gæld, når anlæg + omsætning = egenkapital +
 * den (så er der intet andet på nogen af siderne); ellers mangler tilskud, hensættelser eller
 * periodeafgrænsning, og den udelades i stedet for at blive en for lav "gæld i alt".
 */
function payablesAsLiabilities(
  items: RegistryStatement["lineItems"],
  periodEnd: string,
  warnings: string[],
): RegistryStatement["lineItems"] {
  const payables = items.find((item) => item.metric === PAYABLES);
  if (!payables) return items;
  const rest = items.filter((item) => item.metric !== PAYABLES);
  if (rest.some((item) => item.metric === "liabilities")) return rest;
  const value = (metric: string) => rest.find((item) => item.metric === metric)?.value;
  const [noncurrent, current, equity] = [
    value("noncurrent_assets"),
    value("current_assets"),
    value("equity"),
  ];
  const complete =
    noncurrent !== undefined &&
    current !== undefined &&
    equity !== undefined &&
    noncurrent + current === equity + payables.value;
  if (complete) return [...rest, { ...payables, metric: "liabilities" }];
  warnings.push(msg("lithuania.liabilitiesIncomplete", { date: periodEnd }));
  return rest;
}

/** Pr. del (balance, resultat) kun den seneste indsendelse: en rettelse erstatter den gamle. */
function latestSubmission(lines: LithuanianLine[]): LithuanianLine[] {
  const latest = new Map<LithuanianLine["part"], string>();
  for (const line of lines) {
    if (line.regDate > (latest.get(line.part) ?? "")) latest.set(line.part, line.regDate);
  }
  return lines.filter((line) => line.regDate === latest.get(line.part));
}

/**
 * Registrets rækker for balance og resultat → regnskaber, nyeste først, i euro. Pr. regnskabsår
 * gælder den seneste indsendelse. Registret leverer hver række to gange; ens tal tælles én gang,
 * og to forskellige tal for samme post udelader posten.
 */
export function parseLithuanianStatements(
  entityId: string,
  balance: unknown,
  income: unknown,
): RegistryStatementsResult {
  const byEnd = new Map<string, LithuanianLine[]>();
  for (const line of [...parseLines(balance, "balance"), ...parseLines(income, "income")]) {
    byEnd.set(line.periodEnd, [...(byEnd.get(line.periodEnd) ?? []), line]);
  }
  const periods = [...byEnd.keys()].sort((a, b) => (a < b ? 1 : -1)).slice(0, YEARS);
  const statements: RegistryStatement[] = [];
  const warnings: string[] = [];
  for (const periodEnd of periods) {
    if (periodEnd < EURO_FROM) {
      warnings.push(msg("lithuania.litas", { date: periodEnd }));
      continue;
    }
    const lines = latestSubmission(byEnd.get(periodEnd)!);
    const byMetric = new Map<string, LithuanianLine[]>();
    for (const line of lines) {
      const metric = LINE_METRICS[line.lineId];
      if (metric) byMetric.set(metric, [...(byMetric.get(metric) ?? []), line]);
    }
    let lineItems: RegistryStatement["lineItems"] = [];
    for (const [metric, found] of byMetric) {
      const values = new Set(found.map((line) => line.value));
      if (values.size > 1) {
        warnings.push(
          msg("lithuania.conflictingFigures", { date: periodEnd, line: found[0]!.lineName }),
        );
        continue;
      }
      // `-0` fra registret vises som 0.
      lineItems.push({
        metric,
        value: found[0]!.value || 0,
        tag: `data.gov.lt:${found[0]!.lineId}`,
      });
    }
    lineItems = payablesAsLiabilities(lineItems, periodEnd, warnings);
    if (lineItems.length === 0) {
      warnings.push(msg("common.noFigures", { date: periodEnd }));
      continue;
    }
    // i18n-keep: the report's type, stored with the statement (register data).
    statements.push({
      periodStart: lines[0]!.periodStart,
      periodEnd,
      currency: "EUR",
      sourceDocumentUrl: statementSourceUrl(entityId, periodEnd),
      reportingClassText: "Litauisk årsregnskab (Registrų centras, åbne data)",
      goingConcernNote: null,
      lineItems,
    });
  }
  return { statements, warnings };
}

/** Selskabsformer, der ikke er en del af navnet, når der søges. */
const FORM_WORDS = new Set([
  "uab",
  "ab",
  "mb",
  "všį",
  "vši",
  "iį",
  "uždaroji",
  "akcinė",
  "bendrovė",
  "mažoji",
  "bendrija",
  "viešoji",
  "įstaiga",
  "ltd",
  "limited",
  "inc",
  "llc",
]);

/**
 * Et navn → søgeord: kun bogstaver og cifre (så søgeteksten ikke kan ændre forespørgslen), små
 * bogstaver, uden selskabsform. Hvert ord skal forekomme i registrets navn. Tom: intet at søge på.
 */
export function nameWords(name: string): string[] {
  const words = name
    .normalize("NFC")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 0 && !FORM_WORDS.has(word))
    .slice(0, 5);
  return words.join("").length >= 2 ? words : [];
}

/**
 * Registret rangerer ikke sine svar, så her: samme navn som søgningen først, så aktive, så de
 * korteste navne (det navn, der næsten kun er søgeordene).
 */
export function rankCompanies(companies: RegistryCompany[], name: string): RegistryCompany[] {
  const wanted = normalizeCompanyName(name);
  const key = (company: RegistryCompany) =>
    normalizeCompanyName(comparableRegistryName(company.name, "LT"));
  return [...companies].sort(
    (a, b) =>
      Number(key(b) === wanted) - Number(key(a) === wanted) ||
      Number(b.active) - Number(a.active) ||
      key(a).length - key(b).length,
  );
}

/** Spintas forespørgsel: hvert udtryk for sig, så `=` i et filter ikke bliver kodet. */
function query(base: string, parts: string[]): string {
  return `${base}?${parts.join("&")}`;
}

function quoted(value: string): string {
  return encodeURIComponent(`"${value}"`);
}

async function getJson(url: string): Promise<unknown> {
  // get.data.gov.lt svarer af og til 500 eller afbryder (prøvet 8. okt: ca. hvert tiende kald, og
  // samme kald virker straks efter); ét nyt forsøg er nok, som for Frankrig.
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
  if (!response) throw new Error(msg("common.unreachable", { registry: "data.gov.lt" }));
  if (!response.ok) {
    throw new Error(msg("common.status", { registry: "data.gov.lt", status: response.status }));
  }
  const body = await response.text();
  if (body.length > MAX_RESPONSE_BYTES)
    throw new Error(msg("common.tooLarge", { registry: "data.gov.lt" }));
  const parsed = JSON.parse(body) as unknown;
  if (!isObject(parsed) || !Array.isArray(parsed["_data"])) {
    throw new Error(msg("common.notUseful", { registry: "data.gov.lt" }));
  }
  return parsed;
}

/** Selskabets række i JAR på koden; null, når koden ikke findes. */
async function entityByCode(code: string): Promise<Json | null> {
  const raw = await getJson(
    query(ENTITY, [`ja_kodas=${code}`, encodeURIComponent(ENTITY_FIELDS), "limit(1)"]),
  );
  return rowsOf(raw)[0] ?? null;
}

async function linesFor(base: string, entityId: string): Promise<unknown> {
  return getJson(
    query(base, [
      `juridinis_asmuo._id=${quoted(entityId)}`,
      encodeURIComponent("sort(-laikotarpis_iki)"),
      encodeURIComponent(LINE_FIELDS),
      `limit(${STATEMENT_ROWS})`,
    ]),
  );
}

export const lithuaniaRegistry: RegistryAdapter = {
  country: "LT",
  registryName: "Registrų centras (JAR, data.gov.lt)",
  numberLabel: "Įmonės kodas",
  sourceKind: "registry_json",
  supportsNameSearch: true,
  configured: () => true,
  normalizeNumber: normalizeLithuanianCompanyCode,
  findNumbersInText: findLithuanianCompanyCodes,
  async searchByName(name) {
    const words = nameWords(name);
    if (words.length === 0) return [];
    const raw = await getJson(
      query(ENTITY, [
        ...words.map((word) => encodeURIComponent(`ja_pavadinimas.lower().contains("${word}")`)),
        encodeURIComponent(ENTITY_FIELDS),
        `limit(${SEARCH_FETCH + 1})`,
      ]),
    );
    // Registret sorterer ikke efter navn. Er der flere end vi henter, kan et selskab med præcis
    // samme navn ligge uden for svaret, så intet vælges hellere end et forkert.
    if (rowsOf(raw).length > SEARCH_FETCH) return [];
    const companies = rowsOf(raw)
      .map(parseLithuanianCompany)
      .filter((company): company is RegistryCompany => !!company);
    return rankCompanies(companies, words.join(" ")).slice(0, SEARCH_SIZE);
  },
  async lookupByNumber(registryNumber) {
    const code = normalizeLithuanianCompanyCode(registryNumber);
    if (!code) return null;
    return parseLithuanianCompany(await entityByCode(code));
  },
  async fetchStatements(registryNumber) {
    const code = normalizeLithuanianCompanyCode(registryNumber);
    if (!code) return { statements: [], warnings: [] };
    const entity = await entityByCode(code);
    const entityId = entityIdOf(entity);
    // Et personligt hæftende selskab (eller en ukendt kode) har intet regnskab, vi henter.
    if (!entityId || !parseLithuanianCompany(entity)) return { statements: [], warnings: [] };
    const [balance, income] = await Promise.all([
      linesFor(BALANCE, entityId),
      linesFor(INCOME, entityId),
    ]);
    return parseLithuanianStatements(entityId, balance, income);
  },
};
