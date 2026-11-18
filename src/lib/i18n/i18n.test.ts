/** Fondens sprog, ordbøgerne og sprogreglen til AI. Kør: npm test */
import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  danishPromptWords,
  englishPromptLanguageName,
  outputLanguageDirective,
  outputLanguageTag,
} from "./ai-language.ts";
import { da } from "./dictionaries/da.ts";
import { en } from "./dictionaries/en.ts";
import { fundLanguageOf, parseLanguage } from "./language.ts";
import { translate } from "./translate.ts";

function paths(node: unknown, prefix = ""): string[] {
  if (typeof node === "string") return [prefix];
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
    paths(value, prefix ? `${prefix}.${key}` : key),
  );
}

test("the English dictionary has exactly the Danish keys, none empty", () => {
  assert.deepEqual(paths(en).sort(), paths(da).sort());
  for (const key of paths(en)) {
    assert.ok(translate("en", key as never).trim().length > 0, key);
  }
});

test("both dictionaries use the same {placeholders} per key", () => {
  const holes = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  for (const key of paths(da)) {
    assert.deepEqual(
      holes(translate("en", key as never)),
      holes(translate("da", key as never)),
      key,
    );
  }
});

test("no product text says fond or fund: not every customer is a fund (T-629)", () => {
  // {fund} is a placeholder, not text. In Danish "fund"/"fundet" means a finding / found.
  const text = (language: "da" | "en", key: string) =>
    translate(language, key as never).replace(/\{\w+\}/g, "");
  for (const key of paths(da)) {
    assert.doesNotMatch(text("da", key), /fond/i, `da: ${key}`);
    assert.doesNotMatch(text("en", key), /fond|fund/i, `en: ${key}`);
  }
  // The templates are saved in a new team's setup (they need the @-alias, so their string
  // literals are read as text). Prompt input such as scoreCategoryLabel changes.
  const templates = readFileSync(new URL("../funds/config-templates.ts", import.meta.url), "utf8");
  const literals = templates.match(/"(?:[^"\\]|\\.)*"/g) ?? [];
  for (const value of literals) {
    assert.doesNotMatch(value, /fond/i, value);
  }
});

test("translate fills placeholders and shows an unknown key instead of nothing", () => {
  assert.equal(translate("da", "nav.fundSetup"), "Teamopsætning");
  assert.equal(translate("en", "nav.fundSetup"), "Team setup");
  assert.match(translate("en", "language.changed", { language: "English" }), /now English/);
  assert.equal(translate("en", "no.such.key" as never), "no.such.key");
  assert.equal(translate("da", "language.changed", {}).includes("{language}"), true);
});

test("unknown or missing languages are Danish", () => {
  assert.equal(parseLanguage("en"), "en");
  assert.equal(parseLanguage("de"), "da");
  assert.equal(parseLanguage(null), "da");
  assert.equal(fundLanguageOf({ language: "en" }), "en");
  assert.equal(fundLanguageOf([{ language: "en" }]), "en");
  assert.equal(fundLanguageOf(null), "da");
  assert.equal(fundLanguageOf({}), "da");
});

test("a Danish fund gets no extra AI rule; an English fund gets one, last and in English", () => {
  assert.equal(outputLanguageDirective("da"), "");
  const directive = outputLanguageDirective("en");
  assert.match(directive, /^\n\nOUTPUT LANGUAGE: ENGLISH\./);
  assert.match(directive, /Not stated in the material\./);
  assert.match(directive, /Keep JSON keys, enum values/);
  assert.equal(outputLanguageTag("da"), "da-DK");
  assert.equal(outputLanguageTag("en"), "en-GB");
  assert.deepEqual(danishPromptWords("da"), {
    name: "dansk",
    other: "engelsk",
    otherPlural: "engelske",
  });
  assert.deepEqual(danishPromptWords("en"), {
    name: "engelsk",
    other: "dansk",
    otherPlural: "danske",
  });
  assert.equal(englishPromptLanguageName("en"), "English");
  assert.equal(englishPromptLanguageName("da"), "Danish");
});
