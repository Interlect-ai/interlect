/**
 * Estland: e-Äriregister (RIK). Selskabets identitet hentes gratis og uden nøgle fra
 * registrets autocomplete-tjeneste (`ariregister.rik.ee/est/api/autocomplete`: registerkode,
 * navn, tidligere navne, status, adresse). RIK oplyser, at tjenesten kan bruges uden aftale.
 *
 * Regnskabstallene er endnu ikke med: RIK leverer dem kun (a) som hele årsfiler på ca. 300 MB
 * pr. år, som ikke kan slås op pr. selskab, eller (b) gennem de åbne API-tjenester, som kræver en
 * gratis aftale med RIK (`avaandmed.ariregister.rik.ee`, "Introduction to API Services"). Aftalen
 * er en handling for produktejeren og står. Indtil da er tallene "ikke
 * tilgængelige i registret", og analysen bruger websøgningens tal (tal kun fra registret).
 */
import type { RegistryAdapter, RegistryCompany } from "./types.ts";

import { serverText } from "../../i18n/server-text.ts";
import type { MessageKey, TranslateVars } from "../../i18n/translate.ts";
import { outboundUserAgent } from "../../outbound-user-agent.ts";

/** Messages to the person, in the page's language or the fund's in a worker. */
function msg(key: string, vars?: TranslateVars) {
  return serverText(`analysisServer.registries.${key}` as MessageKey, vars);
}

const AUTOCOMPLETE = "https://ariregister.rik.ee/est/api/autocomplete";
const USER_AGENT = outboundUserAgent();
const FETCH_TIMEOUT_MS = 12_000;
const MAX_RESPONSE_BYTES = 1_000_000;
const SEARCH_SIZE = 10;

/** Registerkoden har otte cifre; sidste ciffer er kontrolciffer (modulus 11, to vægtsæt). */
export function isValidEstonianRegCode(value: string): boolean {
  if (!/^\d{8}$/.test(value)) return false;
  const digits = [...value].map(Number);
  const weighted = (weights: number[]) =>
    weights.reduce((total, weight, index) => total + weight * digits[index]!, 0) % 11;
  let check = weighted([1, 2, 3, 4, 5, 6, 7]);
  if (check === 10) {
    check = weighted([3, 4, 5, 6, 7, 8, 9]);
    if (check === 10) check = 0;
  }
  return check === digits[7];
}

/** "12417834", "1241 7834" → "12417834"; ugyldigt → null. */
export function normalizeEstonianRegCode(raw: string): string | null {
  const digits = raw.trim().replace(/[\s.-]/g, "");
  return isValidEstonianRegCode(digits) ? digits : null;
}

// "Registry code 12417834", "Reg. code: 12417834", "registrikood 12417834", "Reg nr 12417834",
// "Registration number 12417834". Momsnummeret (EE + 9 cifre) er et andet nummer og tæller ikke.
const REG_CODE_PATTERN =
  /\b(?:registry\s*code|reg(?:istry|istration)?\.?\s*(?:code|nr|no|number)|registrikood|äriregistri\s*kood)\.?\s*[:#]?\s*((?:\d[\s]?){7}\d)\b/gi;

/** Estiske registerkoder nævnt i en tekst, i rækkefølge og uden dubletter; kun gyldige. */
export function findEstonianRegCodes(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(REG_CODE_PATTERN)) {
    const digits = (match[1] ?? "").replace(/\s/g, "");
    if (isValidEstonianRegCode(digits) && !found.includes(digits)) found.push(digits);
  }
  return found;
}

export function estoniaRegistryUrl(regCode: string): string {
  return `https://ariregister.rik.ee/est/company/${regCode}`;
}

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Et selskab fra autocomplete-tjenesten. null, hvis det ikke kan læses. */
export function parseEstonianCompany(raw: unknown): RegistryCompany | null {
  if (!isObject(raw)) return null;
  const code = String(raw["reg_code"] ?? "");
  const name = text(raw["name"]);
  if (!name || !isValidEstonianRegCode(code)) return null;
  const status = text(raw["status"]) ?? "R";
  const formerNames = (Array.isArray(raw["historical_names"]) ? raw["historical_names"] : [])
    .map(text)
    .filter((value): value is string => Boolean(value));
  return {
    country: "EE",
    registryNumber: code,
    name,
    formerNames,
    active: status === "R",
    // R = i registret; andre koder gengives, som registret giver dem.
    status: status === "R" ? msg("status.active") : msg("status.notActiveCode", { code: status }),
    website: null,
    registryUrl: estoniaRegistryUrl(code),
  };
}

async function autocomplete(query: string): Promise<RegistryCompany[]> {
  const response = await fetch(`${AUTOCOMPLETE}?q=${encodeURIComponent(query)}`, {
    headers: { accept: "application/json", "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(msg("common.status", { registry: "e-Äriregister", status: response.status }));
  }
  const body = await response.text();
  if (body.length > MAX_RESPONSE_BYTES)
    throw new Error(msg("common.tooLarge", { registry: "e-Äriregister" }));
  const parsed = JSON.parse(body) as unknown;
  const rows = isObject(parsed) && Array.isArray(parsed["data"]) ? parsed["data"] : [];
  return rows
    .slice(0, SEARCH_SIZE)
    .map(parseEstonianCompany)
    .filter((company): company is RegistryCompany => !!company);
}

export const estoniaRegistry: RegistryAdapter = {
  country: "EE",
  registryName: "e-Äriregister (RIK)",
  numberLabel: "Registrikood",
  sourceKind: "registry_json",
  supportsNameSearch: true,
  configured: () => true,
  normalizeNumber: normalizeEstonianRegCode,
  findNumbersInText: findEstonianRegCodes,
  async searchByName(name) {
    const query = name.trim().slice(0, 200);
    return query ? autocomplete(query) : [];
  },
  async lookupByNumber(registryNumber) {
    const code = normalizeEstonianRegCode(registryNumber);
    if (!code) return null;
    return (await autocomplete(code)).find((company) => company.registryNumber === code) ?? null;
  },
  async fetchStatements() {
    return {
      statements: [],
      warnings: [msg("estonia.agreementNeeded")],
    };
  },
};
