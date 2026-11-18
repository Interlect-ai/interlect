import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { test } from "node:test";
import { AI_MODEL_POLICIES } from "./zdr-models.ts";

const ROOT = resolve(import.meta.dirname, "..", "..", "..");
const PROVIDERS = [
  "alibaba",
  "amazon",
  "anthropic",
  "bfl",
  "cohere",
  "deepseek",
  "google",
  "meta",
  "mistral",
  "moonshotai",
  "openai",
  "perplexity",
  "voyage",
  "xai",
  "zai",
];
// A quoted "provider/model" id, as the AI Gateway names models.
const MODEL_ID = new RegExp(`["'\`]((?:${PROVIDERS.join("|")})/[a-z0-9][a-z0-9.\\-]*)["'\`]`, "g");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === "node_modules" || name.startsWith(".")) return [];
    if (statSync(path).isDirectory()) return sourceFiles(path);
    if (!/\.(ts|tsx|mjs|js)$/.test(name) || /\.test\.(ts|tsx)$/.test(name)) return [];
    return [path];
  });
}

test("every model the code or a script names is in the ZDR table", () => {
  const missing: string[] = [];
  for (const file of [...sourceFiles(join(ROOT, "src")), ...sourceFiles(join(ROOT, "scripts"))]) {
    for (const match of readFileSync(file, "utf8").matchAll(MODEL_ID)) {
      const model = match[1] ?? "";
      if (!Object.prototype.hasOwnProperty.call(AI_MODEL_POLICIES, model)) {
        missing.push(`${relative(ROOT, file)}: ${model}`);
      }
    }
  }
  assert.deepEqual(
    missing,
    [],
    "Add the model to AI_MODEL_POLICIES (src/lib/ai/zdr-models.ts) after checking it in the AI Gateway catalog, then run npm run check:zdr",
  );
});

test("every model that is not a search engine can run with ZDR", () => {
  for (const [model, policy] of Object.entries(AI_MODEL_POLICIES)) {
    if (policy.kind !== "search") assert.ok(policy.zdr, `${model} has no ZDR provider`);
    assert.ok(policy.noTraining, `${model} may train on our data`);
    if (policy.euWithZdr) assert.ok(policy.eu, `${model}: euWithZdr implies eu`);
  }
});

// A file that calls a model through the AI SDK, the control point (model-call.ts) or the
// Gateway's own endpoint must set the data rules; the injected `embed(...)` helpers do not count.
const AI_CALL =
  /import\s*\{[^}]*\b(?:generateText|streamText|generateObject|streamObject|embed|embedMany|postChatCompletion)\b[^}]*\}\s*from\s*["'](?:ai|[^"']*\/model-call(?:\.ts)?)["']|await import\(["'](?:ai|[^"']*\/model-call(?:\.ts)?)["']\)|ai-gateway\.vercel\.sh\/v1\/(?:chat|embeddings|responses|messages)/;
// The control point checks the data rules on every call instead (assertDataRules).
const CONTROL_POINT = new Set(["src/lib/ai/model-call.ts"]);

test("every file that calls an AI model goes through aiGatewayOptions", () => {
  const bypass: string[] = [];
  for (const file of [...sourceFiles(join(ROOT, "src")), ...sourceFiles(join(ROOT, "scripts"))]) {
    const source = readFileSync(file, "utf8");
    const path = relative(ROOT, file);
    if (AI_CALL.test(source) && !source.includes("aiGatewayOptions") && !CONTROL_POINT.has(path)) {
      bypass.push(path);
    }
  }
  assert.deepEqual(bypass, [], "Pass aiGatewayOptions({ model, data }) as providerOptions");
});
