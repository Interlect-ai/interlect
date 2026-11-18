/**
 * Visning af fondens grundlag. Lande gemmes som ISO-koder ("DK"), stadier og regioner som
 * nøgler ("series_a", "nordics") og sektorer som nøgler ("b2b_saas"); en bruger, der selv
 * skriver, gemmer sin egen tekst. Før gemte opsætningen og guiden navne ("Serie A",
 * "Norden"); de læses som de samme nøgler, så de vises på teamets sprog og gemmes som nøgler,
 * næste gang opsætningen gemmes.
 */
import { DEFAULT_LANGUAGE, LANGUAGES, type Language } from "../i18n/language.ts";
import { DICTIONARIES, type Dictionary } from "../i18n/translate.ts";

type BasisGroup = keyof Dictionary["basis"];

/** The name of a known basis key in the language, or null for a key the dictionary lacks. */
function basisLabel(group: BasisGroup, value: string, language: Language): string | null {
  const names = DICTIONARIES[language].basis[group] as Readonly<Record<string, string>>;
  return Object.hasOwn(names, value) ? names[value]! : null;
}

/** Words that keep their own capitals when a key is turned into text ("software_b2b" → "Software B2B"). */
const ACRONYMS: Readonly<Record<string, string>> = {
  b2b: "B2B",
  b2c: "B2C",
  saas: "SaaS",
  ai: "AI",
  iot: "IoT",
  api: "API",
};

/** "developer_tools" → "Developer tools", når nøglen ikke er kendt. */
function humanizeKey(value: string) {
  const words = value
    .replaceAll("_", " ")
    .trim()
    .split(" ")
    .map((word) => ACRONYMS[word] ?? word);
  const text = words.join(" ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function isKey(value: string) {
  return /^[a-z0-9]+(_[a-z0-9]+)*$/.test(value);
}

const regionNames = new Map<Language, Intl.DisplayNames | null>();
function regionName(code: string, language: Language) {
  if (!regionNames.has(language)) {
    try {
      regionNames.set(language, new Intl.DisplayNames([language], { type: "region" }));
    } catch {
      regionNames.set(language, null);
    }
  }
  try {
    return regionNames.get(language)?.of(code) ?? code;
  } catch {
    return code;
  }
}

// i18n-keep: names saved (the editor's and the guide's old choices), read as keys.
const STAGE_ALIASES: Readonly<Record<string, string>> = {
  "serie a": "series_a",
  "serie b": "series_b",
  "serie b+": "series_b_plus",
  "pre seed": "pre_seed",
  "late stage": "later",
};
// i18n-keep: names saved, read as the ISO code of the country.
const GEOGRAPHY_ALIASES: Readonly<Record<string, string>> = {
  danmark: "DK",
  denmark: "DK",
  storbritannien: "GB",
  "united kingdom": "GB",
};

function fold(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Every key and its name in every language, folded, pointing at the key. */
function keyIndex(group: BasisGroup, aliases: Readonly<Record<string, string>>) {
  const index = new Map<string, string>(Object.entries(aliases));
  for (const language of LANGUAGES) {
    const names = DICTIONARIES[language].basis[group] as Readonly<Record<string, string>>;
    for (const [key, name] of Object.entries(names)) {
      // "unknown" is the absence of a stage, never something a team chose.
      if (key === "unknown") continue;
      index.set(key, key);
      index.set(fold(name), key);
    }
  }
  return index;
}

let stageIndex: Map<string, string> | null = null;
let geographyIndex: Map<string, string> | null = null;
const isCountryCode = (value: string) => /^[A-Z]{2}$/.test(value);

/** The neutral key of a stored stage ("Serie A", "Series A", "series_a" → "series_a"); own text stays as typed. */
export function stageKey(value: string): string {
  stageIndex ??= keyIndex("stage", STAGE_ALIASES);
  const text = value.trim();
  return stageIndex.get(fold(text)) ?? text;
}

/** The neutral key of a stored geography ("Norden" → "nordics", "Danmark" → "DK"); own text stays as typed. */
export function geographyKey(value: string): string {
  const text = value.trim();
  if (isCountryCode(text)) return text;
  geographyIndex ??= keyIndex("region", GEOGRAPHY_ALIASES);
  return geographyIndex.get(fold(text)) ?? text;
}

/** The values as keys, each once (the first spelling wins); blank entries are dropped. */
function keyList(values: readonly string[], toKey: (value: string) => string): string[] {
  const keys: string[] = [];
  for (const value of values) {
    const key = toKey(value);
    if (key && !keys.some((existing) => existing.toLowerCase() === key.toLowerCase())) {
      keys.push(key);
    }
  }
  return keys;
}

export const stageKeys = (values: readonly string[]) => keyList(values, stageKey);
export const geographyKeys = (values: readonly string[]) => keyList(values, geographyKey);

/** Stage expectations under the stages' keys; two old names for one stage keep the first text that says something. */
export function stageExpectationKeys(
  expectations: Readonly<Record<string, string>>,
): Record<string, string> {
  const keyed: Record<string, string> = {};
  for (const [stage, text] of Object.entries(expectations)) {
    const key = stageKey(stage);
    if (!key) continue;
    if (!keyed[key]?.trim()) keyed[key] = text;
  }
  return keyed;
}

/** A setup's stages, geographies and stage expectations as neutral keys. */
export function withBasisKeys<
  T extends {
    stages: string[];
    geographies: string[];
    stageExpectations: Record<string, string>;
  },
>(config: T): T {
  return {
    ...config,
    stages: stageKeys(config.stages),
    geographies: geographyKeys(config.geographies),
    stageExpectations: stageExpectationKeys(config.stageExpectations),
  };
}

export function stageText(value: string, language: Language = DEFAULT_LANGUAGE) {
  const key = stageKey(value);
  return (key !== "unknown" && basisLabel("stage", key, language)) || value;
}

export function geographyText(value: string, language: Language = DEFAULT_LANGUAGE) {
  const key = geographyKey(value);
  if (isCountryCode(key)) return regionName(key, language);
  return basisLabel("region", key, language) ?? (isKey(key) ? humanizeKey(key) : value);
}

export function sectorText(value: string, language: Language = DEFAULT_LANGUAGE) {
  return basisLabel("sector", value, language) ?? (isKey(value) ? humanizeKey(value) : value);
}
