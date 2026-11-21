/**
 * (TS-2): "Research questions" is hidden in Team setup → Specialists, but nothing
 * the team saved stops working: screening and deep analysis still read the saved research
 * questions (research_module_overrides) at every run.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

const ROOT = resolve(import.meta.dirname, "..", "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

test("the Research questions section is hidden in Specialists", () => {
  const steps = read("src/components/funds/editor/BasicSteps.tsx");
  assert.match(steps, /const SHOW_RESEARCH_QUESTIONS = false;/);
  const gate = steps.indexOf("{SHOW_RESEARCH_QUESTIONS && (");
  assert.ok(gate > 0, "the section is behind the switch");
  for (const part of ["fundEditor.basic.researchTitle", "<ResearchStrategyEditor"]) {
    const at = steps.indexOf(part);
    assert.ok(at > gate, `${part} is only drawn behind the switch`);
  }
});

test("the saved research questions still steer screening and deep analysis", () => {
  for (const path of [
    "src/lib/analysis/screening.functions.ts",
    "src/lib/analysis/deep.functions.ts",
    "src/lib/analysis/deep-worker.server.ts",
  ]) {
    assert.match(read(path), /getResearchModuleOverrides\(service, config\.id\)/, path);
  }
});
