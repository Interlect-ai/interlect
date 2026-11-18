import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";

/**
 * every model call is paid from the credit ledger, so an empty balance stops it (once the
 * installation enforces credits). A file that calls a model through model-call.ts must
 * reserve itself (reserveCallCredits in credits.server.ts) or be listed here with the reservation
 * that pays for it. A new AI helper that forgets the ledger fails this test.
 */
const ROOT = join(import.meta.dirname, "..", "..", "..");

const CALL_FUNCTIONS = new Set([
  "generateText",
  "streamText",
  "embed",
  "embedMany",
  "postChatCompletion",
]);

/** Paid by a reservation elsewhere, or deliberately not reserved (with the reason). */
const COVERED: Record<string, string> = {
  "src/lib/analysis/screening.functions.ts": "the screening run reserves its cap (T-204)",
  "src/lib/analysis/deep.functions.ts": "the deep analysis run reserves its cap (T-204)",
  "src/lib/analysis/public-research.ts": "runs inside a screening or deep analysis run",
  "src/lib/analysis/search-topics.server.ts": "runs inside a run (public-research.ts)",
  "src/lib/analysis/research-plan.server.ts":
    "runs inside a run (public-research.ts), paid from its research budget (T-724)",
  "src/lib/analysis/research-followup.server.ts":
    "runs inside a run (public-research.ts), paid from its research budget (T-725)",
  "src/lib/analysis/question-neutralizer.server.ts":
    "runs inside a run (public-research.ts), paid from its research budget (T-729)",
  "src/lib/analysis/evidence-sheet.server.ts":
    "runs inside a screening or deep analysis run, paid from its research budget (T-726)",
  "src/lib/analysis/identity-extraction.ts": "runs inside a run (public-research.ts)",
  "src/lib/analysis/deck-ocr.ts": "runs inside a run (public-research.ts)",
  "src/lib/cases/candidate-web-lookup.server.ts":
    "its caller, find-candidates.functions.ts, reserves WEB_LOOKUP_CAP_USD",
  "src/lib/analysis/memory.ts":
    "one small embedding (text-embedding-3-small, far below 0.01 kr.) per memory entry; inside a " +
    "run it is part of the run, and at a decision or a history import, stopping it at 0 kr. " +
    "would leave holes in the fund's memory for an amount nobody can see",
};

/** Every Brain call reserves through brain_reserve_budget, which reserves in the ledger (0071). */
const BRAIN_PREFIX = "src/lib/brain/";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === "node_modules" || name.startsWith(".")) return [];
    if (statSync(path).isDirectory()) return sourceFiles(path);
    if (!/\.(ts|tsx)$/.test(name) || /\.test\.(ts|tsx)$/.test(name)) return [];
    return [path];
  });
}

/** True when the source imports one of the model call functions from model-call.ts. */
function callsModel(source: string): boolean {
  // A namespace or dynamic import can reach every call function.
  if (/import\s*\*\s*as\s+\w+\s*from\s*["'][^"']*\bmodel-call(?:\.ts)?["']/.test(source))
    return true;
  if (/import\(\s*["'][^"']*\bmodel-call(?:\.ts)?["']\s*\)/.test(source)) return true;
  for (const m of source.matchAll(
    /import\s*\{([^}]*)\}\s*from\s*["'][^"']*\bmodel-call(?:\.ts)?["']/g,
  )) {
    for (const item of (m[1] ?? "").split(",")) {
      const name = item.trim().split(/\s+as\s+/)[0] ?? "";
      if (CALL_FUNCTIONS.has(name)) return true;
    }
  }
  return false;
}

test("every model call outside analyses and Brain reserves in the credit ledger", () => {
  const unpaid: string[] = [];
  for (const file of sourceFiles(join(ROOT, "src"))) {
    const path = relative(ROOT, file).split("\\").join("/");
    if (path === "src/lib/ai/model-call.ts" || path.startsWith(BRAIN_PREFIX)) continue;
    if (path in COVERED) continue;
    const source = readFileSync(file, "utf8");
    if (callsModel(source) && !source.includes("reserveCallCredits(")) unpaid.push(path);
  }
  assert.deepEqual(
    unpaid,
    [],
    "Reserve the call with reserveCallCredits (src/lib/ai/credits.server.ts), or use " +
      "callCheapGateway, which does; list the file in credit-coverage.test.ts only when another " +
      "reservation pays for it",
  );
});

test("the listed files exist, and the company search's caller reserves", () => {
  for (const path of Object.keys(COVERED)) assert.ok(existsSync(join(ROOT, path)), path);
  const caller = readFileSync(join(ROOT, "src/lib/cases/find-candidates.functions.ts"), "utf8");
  assert.ok(caller.includes("reserveCallCredits(") && caller.includes("WEB_LOOKUP_CAP_USD"));
});

test("the scan finds a model call", () => {
  assert.ok(callsModel(`import { postChatCompletion } from "@/lib/ai/model-call";`));
  assert.ok(callsModel(`import {\n  generateText,\n  maskedModel,\n} from "../ai/model-call.ts";`));
  assert.ok(callsModel(`import { embed as e } from "./model-call";`));
  assert.ok(!callsModel(`import { isPermanentPolicyStop } from "@/lib/ai/model-call";`));
  assert.ok(callsModel(`import * as calls from "@/lib/ai/model-call";`));
  assert.ok(callsModel(`const { embed } = await import("../ai/model-call.ts");`));
  assert.ok(!callsModel(`import { generateText } from "ai";`));
});
