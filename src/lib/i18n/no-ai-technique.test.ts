/**
 * (beslutningslog 15. okt): nowhere in the product does it say how the analysis was
 * made, who or what made it, or which data sources were used. No tokens, model or provider names,
 * prices, "Sådan blev analysen bygget", "Sådan analyserede Interlect det", "Datakilder" or a
 * method page. This test fails if any of it comes back in the texts customers see (both
 * dictionaries) or in the customer pages' code, and if /fond/metode becomes a page again.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { da } from "./dictionaries/da.ts";
import { en } from "./dictionaries/en.ts";

const ROOT = resolve(import.meta.dirname, "..", "..", "..");

/** Words and phrases that describe how the analysis was made, by what, or from which sources. */
const FORBIDDEN: RegExp[] = [
  /sådan blev analysen/i,
  /how the analysis was/i,
  /sådan analyserede/i,
  /how interlect analys/i,
  /sådan kom interlect/i,
  /how interlect reached/i,
  /datakilde/i,
  /data ?sources?\b/i,
  /analysemetode/i,
  /analysis method/i,
  /\btokens?\b/i,
  /faktisk forbrug/i,
  /actual (spend|cost)/i,
  /deterministi/i,
  /systemtrin/i,
  /system step/i,
  /kørselslog|run log/i,
  /prompt-version|prompt version/i,
  /største model|largest model/i,
  /\b(gpt|openai|perplexity|sonar|anthropic|claude|gemini|mistral|llama|jina)\b/i,
  /\b(supabase|vercel)\b/i,
  // A model id filled in at run time, e.g. in an error a customer can see.
  /\{model\}/,
];

/**
 * Texts customers never see: the internal prompt page (/intern/prompts, Danish only, behind
 * `internalPages`) and messages for whoever runs the installation, not for a customer.
 */
const INTERNAL_KEYS: RegExp[] = [
  /^fundSetup\.chain\./,
  /^fundEditor\.basic\.prompts/,
  /^auth\..*notConfigured/,
  /^analysisServer\.[^.]+\.vercelGatewayMissing$/,
];

function flatten(value: unknown, prefix = ""): Array<[string, string]> {
  if (typeof value === "string") return [[prefix, value]];
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, child]) =>
      flatten(child, prefix ? `${prefix}.${key}` : key),
    );
  }
  return [];
}

for (const [language, dictionary] of [
  ["da", da],
  ["en", en],
] as const) {
  test(`the ${language} texts never say how, by what or from which sources the analysis was made`, () => {
    const hits = flatten(dictionary)
      .filter(([key]) => !INTERNAL_KEYS.some((pattern) => pattern.test(key)))
      .flatMap(([key, text]) =>
        FORBIDDEN.filter((pattern) => pattern.test(text)).map(
          (pattern) => `${key}: "${text}" (${pattern})`,
        ),
      );
    assert.deepEqual(hits, []);
  });
}

/** Every .ts/.tsx file under a folder, tests and internal pages left out. */
function customerFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "internal" ? [] : customerFiles(path);
    if (!/\.tsx?$/.test(name) || /\.test\.tsx?$/.test(name) || name.startsWith("intern."))
      return [];
    return [path];
  });
}

/** The code without comments, so a comment may still name what was removed and why. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

test("the customer pages' code names no model or provider and links no method page", () => {
  const files = [
    ...customerFiles(join(ROOT, "src/components")),
    ...customerFiles(join(ROOT, "src/routes")),
  ];
  assert.ok(files.length > 50, "found the component and route files");
  const hits = files.flatMap((file) => {
    const code = withoutComments(readFileSync(file, "utf8"));
    return [
      /\b(gpt-|openai|perplexity|sonar|anthropic|claude|gemini|jina)\b/i,
      /["'`]\/fond\/metode["'`]/,
      /\b(modelName|actualCostUsd|totalTokens|tokenUsage)\b/,
    ]
      .filter((pattern) => {
        if (!pattern.test(code)) return false;
        // The old address only exists to send bookmarks on to Teamopsætning.
        return !(file.endsWith("fond.metode.tsx") && pattern.source.includes("metode"));
      })
      .map((pattern) => `${relative(ROOT, file)} (${pattern})`);
  });
  assert.deepEqual(hits, []);
});

test("/fond/metode is no page, only a redirect to Teamopsætning", () => {
  const route = readFileSync(join(ROOT, "src/routes/fond.metode.tsx"), "utf8");
  assert.match(route, /redirect\(\{ to: "\/fond"/);
  assert.doesNotMatch(route, /component:/);
});
