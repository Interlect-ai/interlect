/**
 * The research, the identity step, the deck reading and the registries write their
 * messages in the fund's language (a worker's scope); Danish is unchanged. Run: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { withLanguage } from "../i18n/language-scope.server.ts";
import { DICTIONARIES } from "../i18n/translate.ts";
import { parseLithuanianCompany } from "./registries/lithuania.ts";
import { parseCompanyQuery, resolveCompanyIdentity } from "./identity-resolve.ts";
import { noIdentityAnchorGap } from "./identity-anchor.ts";
import { recognisedPages } from "./deck-ocr-pages.ts";

const record = (
  JSON.parse(
    readFileSync(
      join(import.meta.dirname, "registries", "fixtures", "lt-entity-302767152.json"),
      "utf8",
    ),
  )["_data"] as Record<string, unknown>[]
)[0]!;

test("a registry's status follows the worker's language; Danish outside a scope", async () => {
  const liquidated = { ...record, statusas: { kodas: 11, name: "Liquidated" } };
  assert.equal(parseLithuanianCompany(liquidated)?.status, "likvideret");
  const english = await withLanguage("en", async () => parseLithuanianCompany(liquidated)?.status);
  assert.equal(english, "liquidated");
  assert.equal(
    await withLanguage("en", async () =>
      parseLithuanianCompany(record)?.status?.startsWith("active"),
    ),
    true,
  );
});

test("research notes and deck reasons follow the worker's language", async () => {
  assert.match(noIdentityAnchorGap(), /^Casen har hverken hjemmeside/);
  assert.match(
    await withLanguage("en", async () => noIdentityAnchorGap()),
    /^The case has no website/,
  );
  const wrong = await withLanguage("en", async () =>
    recognisedPages([{ page: 9, text: "x" }], [1], 2, 100),
  );
  assert.deepEqual(wrong, {
    ok: false,
    reason: "The page numbers in the answer did not match the deck.",
  });
});

test("the identity signals are written in the language the caller gives", () => {
  const input = {
    query: parseCompanyQuery("Havbrug Nord"),
    websiteHost: null,
    hits: [
      {
        cvrNumber: "26316804",
        name: "Havbrug Nord ApS",
        status: "NORMAL",
        origin: "registry_name" as const,
      },
    ],
  };
  const english = resolveCompanyIdentity({ ...input, language: "en" });
  const danish = resolveCompanyIdentity(input);
  const label = (result: typeof english) => result.candidates[0]!.assessment.signals[0]!.label;
  assert.match(
    label(english),
    /^The name in CVR \(Havbrug Nord ApS\) is exactly what you entered$/,
  );
  assert.match(label(danish), /^Navnet i CVR \(Havbrug Nord ApS\) er præcis det, I skrev$/);
});

test("every research key has a Danish and an English text with the same placeholders", () => {
  const groups = ["cvr", "cvrProfile", "deck", "founders", "identity", "registries", "research"];
  const entries = (node: unknown, prefix = ""): Array<[string, string]> =>
    typeof node === "string"
      ? [[prefix, node]]
      : Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
          entries(value, prefix ? `${prefix}.${key}` : key),
        );
  const holes = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  for (const group of groups) {
    const da = new Map(entries((DICTIONARIES.da.analysisServer as Record<string, unknown>)[group]));
    const en = new Map(entries((DICTIONARIES.en.analysisServer as Record<string, unknown>)[group]));
    assert.deepEqual([...en.keys()].sort(), [...da.keys()].sort(), group);
    for (const [key, text] of da)
      assert.deepEqual(holes(en.get(key)!), holes(text), `${group}.${key}`);
  }
});
