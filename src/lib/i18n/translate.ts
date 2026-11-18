/**
 * `t()` for the interface: a key into the fund's dictionary, with `{name}` filled in.
 * Pure, so pages, server code and tests translate the same way.
 */
import { da } from "./dictionaries/da.ts";
import { en } from "./dictionaries/en.ts";
import type { Language } from "./language.ts";

/** The dictionary's shape with plain strings: every language has exactly the Danish keys. */
export type Dictionary = { readonly [K in keyof typeof da]: Strings<(typeof da)[K]> };
type Strings<T> = T extends string ? string : { readonly [K in keyof T]: Strings<T[K]> };

/** Every key of the dictionary as "group.key" (nested groups as "a.b.c"). */
export type MessageKey = Paths<typeof da>;
type Paths<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${Paths<T[K]>}`;
}[keyof T & string];

export const DICTIONARIES: Record<Language, Dictionary> = { da, en };

export type TranslateVars = Record<string, string | number>;

function lookup(dictionary: Dictionary, key: string): string | undefined {
  let node: unknown = dictionary;
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : undefined;
}

/**
 * The text for `key` in `language`. A key the language lacks falls back to Danish (the source),
 * and an unknown key shows itself, so a gap is visible on the page instead of an empty space.
 * A `{name}` without a value is left as it stands.
 */
export function translate(language: Language, key: MessageKey, vars?: TranslateVars): string {
  const text = lookup(DICTIONARIES[language], key) ?? lookup(DICTIONARIES.da, key) ?? key;
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  );
}
