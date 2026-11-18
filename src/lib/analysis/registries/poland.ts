/**
 * Polen: Krajowy Rejestr Sądowy (KRS), Justitsministeriets åbne API
 * (`api-krs.ms.gov.pl`): den aktuelle udskrift som JSON pr. KRS-nummer, gratis og uden nøgle.
 * API'et kan ikke søge på navn, så et polsk selskab findes kun på et KRS-nummer i decket eller på
 * websitet (som Sverige).
 *
 * Regnskabstallene er ikke med: regnskaberne (XML efter Finansministeriets struktur) ligger i
 * Repozytorium Dokumentów Finansowych, som kun har en webside uden dokumenteret API, og som
 * afviser automatiske opslag (bot-beskyttelse, 403 fra skymiljøet). Udskriften fra KRS siger,
 * hvilke år selskabet har indsendt regnskab for; det vises, og tallene er "ikke tilgængelige i
 * registret" (tal kun fra registret), så analysen bruger websøgningens tal.
 *
 * Personer i udskriften (bestyrelse, ejere) er maskeret af registret og læses ikke.
 */
import type { RegistryAdapter, RegistryCompany } from "./types.ts";

import { serverText } from "../../i18n/server-text.ts";
import type { MessageKey, TranslateVars } from "../../i18n/translate.ts";

/** Messages to the person, in the page's language or the fund's in a worker. */
function msg(key: string, vars?: TranslateVars) {
  return serverText(`analysisServer.registries.${key}` as MessageKey, vars);
}

const KRS_API = "https://api-krs.ms.gov.pl/api/krs/OdpisAktualny";
const USER_AGENT = "interlect.ai/1.0 (+https://interlect.ai)";
const FETCH_TIMEOUT_MS = 12_000;
const MAX_RESPONSE_BYTES = 3_000_000;

/** KRS-nummeret har ti cifre med foranstillede nuller og intet kontrolciffer. */
export function isValidKrsNumber(value: string): boolean {
  return /^\d{10}$/.test(value) && value !== "0000000000";
}

/** "0000019193", "KRS 19193", "0000 019 193" → "0000019193"; ugyldigt → null. */
export function normalizeKrsNumber(raw: string): string | null {
  const digits = raw
    .trim()
    .replace(/^KRS:?/i, "")
    .replace(/[\s.-]/g, "");
  if (!/^\d{1,10}$/.test(digits)) return null;
  const padded = digits.padStart(10, "0");
  return isValidKrsNumber(padded) ? padded : null;
}

// "KRS 0000019193", "KRS: 0000019193", "nr KRS 0000019193", "numer KRS: 0000019193". Kun med
// mærket "KRS" (foranstillede nuller må mangle), så NIP, REGON og telefonnumre aldrig tæller.
const KRS_PATTERN =
  /\bKRS\s*(?:nr\.?|no\.?|number|numer)?\s*[:#]?\s*(\d{4}\s\d{3}\s\d{3}|\d{1,10})\b/gi;

/** KRS-numre nævnt i en tekst, i rækkefølge og uden dubletter. */
export function findKrsNumbers(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(KRS_PATTERN)) {
    const number = normalizeKrsNumber(match[1] ?? "");
    if (number && !found.includes(number)) found.push(number);
  }
  return found;
}

export function polandRegistryUrl(krs: string): string {
  return `${KRS_API}/${krs}?rejestr=P&format=json`;
}

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function at(value: unknown, ...path: string[]): unknown {
  let current = value;
  for (const key of path) current = isObject(current) ? current[key] : undefined;
  return current;
}

/** Afsnit 6 (opløsning, likvidation, konkurs) og en sletning fra registret gør selskabet inaktivt. */
function inactiveReasons(odpis: Json): string[] {
  const reasons: string[] = [];
  const keys = [
    ...Object.keys(
      isObject(at(odpis, "dane", "dzial6")) ? (at(odpis, "dane", "dzial6") as Json) : {},
    ),
    ...Object.keys(isObject(odpis["naglowekA"]) ? (odpis["naglowekA"] as Json) : {}),
  ].map((key) => key.toLowerCase());
  if (keys.some((key) => key.includes("likwidac"))) reasons.push(msg("status.inLiquidation"));
  if (keys.some((key) => key.includes("upadlos") || key.includes("upadłoś")))
    reasons.push(msg("status.bankruptcy"));
  if (keys.some((key) => key.includes("rozwiazan") || key.includes("wykresl"))) {
    reasons.push(msg("status.dissolvedOrDeleted"));
  }
  return reasons;
}

function website(raw: string | null): string | null {
  if (!raw) return null;
  const value = raw.toLowerCase();
  return /^https?:\/\//.test(value) ? value : `https://${value}`;
}

/** En udskrift fra KRS → selskabet. null, hvis den ikke kan læses. */
export function parsePolishCompany(raw: unknown): RegistryCompany | null {
  const odpis = at(raw, "odpis");
  if (!isObject(odpis)) return null;
  const krs = text(at(odpis, "naglowekA", "numerKRS"));
  const name = text(at(odpis, "dane", "dzial1", "danePodmiotu", "nazwa"));
  if (!krs || !name || !isValidKrsNumber(krs)) return null;
  const reasons = inactiveReasons(odpis);
  return {
    country: "PL",
    registryNumber: krs,
    name,
    formerNames: [],
    active: reasons.length === 0,
    status: reasons.length ? reasons.join(", ") : msg("status.active"),
    website: website(
      text(at(odpis, "dane", "dzial1", "siedzibaIAdres", "adresStronyInternetowej")),
    ),
    registryUrl: polandRegistryUrl(krs),
  };
}

/** Det seneste år, selskabet har indsendt årsregnskab for, som KRS skriver det; null uden. */
export function latestFiledPeriod(raw: unknown): { period: string; filedOn: string | null } | null {
  const mentions = at(
    raw,
    "odpis",
    "dane",
    "dzial3",
    "wzmiankiOZlozonychDokumentach",
    "wzmiankaOZlozeniuRocznegoSprawozdaniaFinansowego",
  );
  if (!Array.isArray(mentions) || mentions.length === 0) return null;
  const last = mentions.at(-1);
  const period = text(at(last, "zaOkresOdDo"));
  if (!period) return null;
  return {
    period: period.replace(/^OD\s+/i, "").replace(/\s+DO\s+/i, "–"),
    filedOn: text(at(last, "dataZlozenia")),
  };
}

async function fetchOdpis(krs: string): Promise<unknown> {
  const response = await fetch(polandRegistryUrl(krs), {
    headers: { accept: "application/json", "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(msg("common.status", { registry: "KRS", status: response.status }));
  }
  const body = await response.text();
  if (body.length > MAX_RESPONSE_BYTES) {
    throw new Error(msg("common.tooLarge", { registry: "KRS" }));
  }
  return JSON.parse(body) as unknown;
}

export const polandRegistry: RegistryAdapter = {
  country: "PL",
  registryName: "Krajowy Rejestr Sądowy (KRS)",
  numberLabel: "KRS",
  sourceKind: "registry_json",
  supportsNameSearch: false,
  configured: () => true,
  normalizeNumber: normalizeKrsNumber,
  findNumbersInText: findKrsNumbers,
  async searchByName() {
    return [];
  },
  async lookupByNumber(registryNumber) {
    const krs = normalizeKrsNumber(registryNumber);
    if (!krs) return null;
    return parsePolishCompany(await fetchOdpis(krs));
  },
  async fetchStatements(registryNumber) {
    const krs = normalizeKrsNumber(registryNumber);
    if (!krs) return { statements: [], warnings: [] };
    const filed = latestFiledPeriod(await fetchOdpis(krs));
    const filedText = filed
      ? ` ${
          filed.filedOn
            ? msg("poland.latestFiledOn", { period: filed.period, date: filed.filedOn })
            : msg("poland.latestFiled", { period: filed.period })
        }`
      : "";
    return {
      statements: [],
      warnings: [`${msg("poland.noApi")}${filedText}`],
    };
  },
};
