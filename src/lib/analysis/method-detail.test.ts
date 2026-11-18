/**
 * Customers never get the literal prompts from the server. The only server function
 * here checks the Admin role before it builds one (the customer method page is gone).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { canReadPrompts } from "./prompt-access.ts";

const ROOT = resolve(import.meta.dirname, "..", "..", "..");
const source = readFileSync(join(ROOT, "src/lib/analysis/method-detail.functions.ts"), "utf8");

function body(name: string): string {
  const parts = source.split(/export const (\w+) = createServerFn/);
  for (let index = 1; index < parts.length; index += 2) {
    if (parts[index] === name)
      return parts[index + 1]!.split(/\n\/\*\*|\nexport |\n\/\*\* User/)[0]!;
  }
  throw new Error(`${name} not found`);
}

const PROMPT_BUILDERS = [
  "buildScreeningPrompt",
  "buildSpecialistPrompt",
  "buildInvestmentCommitteeSynthesisPrompt",
  "buildResearchMessages",
  "buildFundResearchBrief",
  "globalDeepInstruction",
  "effectiveSpecialistModule",
  "getResearchModuleOverrides",
];

test("only Admin may read prompts", () => {
  assert.equal(canReadPrompts(["admin"]), true);
  assert.equal(canReadPrompts(["admin", "lead"]), true);
  assert.equal(canReadPrompts(["lead"]), false);
  assert.equal(canReadPrompts(["member"]), false);
  assert.equal(canReadPrompts(["reader"]), false);
  assert.equal(canReadPrompts(["lead", "member", "reader"]), false);
  assert.equal(canReadPrompts([]), false);
});

test("the prompt function checks the Admin role before building any prompt", () => {
  const admin = body("getAnalysisPromptDetail");
  const guard = admin.indexOf("canReadPrompts(");
  assert.ok(guard > 0, "no Admin check");
  for (const builder of PROMPT_BUILDERS) {
    const at = admin.indexOf(builder);
    if (at >= 0) assert.ok(guard < at, `${builder} is used before the Admin check`);
  }
});

test("no other server function in the file delivers prompts", () => {
  const names = [...source.matchAll(/export const (\w+) = createServerFn/g)].map((m) => m[1]);
  assert.deepEqual(names.sort(), ["getAnalysisPromptDetail"]);
});
