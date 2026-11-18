import assert from "node:assert/strict";
import { test } from "node:test";
import { FINANCE_GATES } from "../analysis/financial-gates.ts";
import { fundConfigTemplatesEn } from "./config-templates-en.ts";
import {
  fundConfigTemplateIn,
  fundConfigTemplates,
  fundTemplateKeys,
  type FundConfigTemplate,
} from "./config-templates.ts";
import { fundDraftRows } from "./fund-draft.ts";

/** Every piece of text a template saves in a team's setup. */
function texts(template: FundConfigTemplate): string[] {
  return [
    template.label,
    template.description,
    template.riskPosture,
    ...template.stages,
    ...Object.entries(template.stageExpectations).flat(),
    ...template.gates.flatMap((gate) => [gate.label, gate.description]),
    ...template.criteria.flatMap((criterion) => [criterion.label, criterion.description]),
  ].filter(Boolean);
}

test("Danish templates are the source, unchanged (T-632)", () => {
  for (const key of fundTemplateKeys) {
    assert.equal(fundConfigTemplateIn(key, "da"), fundConfigTemplates[key]);
  }
});

test("an English template has every text in English and the same rules (T-632)", () => {
  for (const key of fundTemplateKeys) {
    const da = fundConfigTemplates[key];
    const en = fundConfigTemplateIn(key, "en");
    const shape = (template: FundConfigTemplate) => ({
      key: template.key,
      strategyType: template.strategyType,
      analysisThreshold: template.analysisThreshold,
      sectors: template.sectors,
      stages: template.stages.length,
      expectations: Object.keys(template.stageExpectations).length,
      gates: template.gates.map(({ key, treatment }) => ({ key, treatment })),
      criteria: template.criteria.map(({ key, category, weight }) => ({ key, category, weight })),
    });
    assert.deepEqual(shape(en), shape(da), key);
    // Every stage keeps its expectation under its English name.
    assert.deepEqual(Object.keys(en.stageExpectations).sort(), [...en.stages].sort(), key);

    // No Danish text is left: a Danish word in the English draft means a missing translation.
    // Shared words (Venture, Seed, Team, Buyout …) are allowed when they are the same in both.
    const danish = new Set(texts(da));
    const english = texts(en);
    for (const value of english) {
      if (danish.has(value)) {
        assert.match(value, /^[A-Za-z /-]+$/, `${key}: still Danish: ${value}`);
      }
      assert.doesNotMatch(value, /[æøåÆØÅ]/, `${key}: ${value}`);
      assert.doesNotMatch(value, /fond|fund/i, `${key}: ${value}`);
    }
  }
});

test("the English words cover every gate and criterion the Danish templates have", () => {
  for (const key of fundTemplateKeys) {
    const words = fundConfigTemplatesEn[key];
    for (const gate of fundConfigTemplates[key].gates) {
      assert.ok(words.gates[gate.key], `${key}: gate ${gate.key}`);
    }
    for (const criterion of fundConfigTemplates[key].criteria) {
      assert.ok(words.criteria[criterion.key], `${key}: criterion ${criterion.key}`);
    }
    for (const stage of fundConfigTemplates[key].stages) {
      assert.ok(words.stages[stage], `${key}: stage ${stage}`);
    }
  }
  for (const gate of FINANCE_GATES) {
    assert.ok(fundConfigTemplatesEn.financial.gates[gate.key], gate.key);
  }
});

test("a new English team's draft says where it came from in English", () => {
  const rows = fundDraftRows(fundConfigTemplateIn("venture", "en"), "nordlys", "en");
  assert.equal(
    rows.config.source_basis,
    "Venture template created in Interlect.ai. Requires human review and publishing.",
  );
  assert.equal(rows.criteria[0]!.label, "Match with the investment thesis");
  // Known stages are saved as keys and shown in the team's language; the template's
  // own stage names stay as written.
  assert.deepEqual(rows.mandate.stages, ["pre_seed", "seed", "series_a"]);
  const financial = fundDraftRows(fundConfigTemplateIn("financial", "en"), "nordlys", "en");
  assert.deepEqual(financial.mandate.stages, [
    "Established and profitable",
    "growth",
    "Succession / Buyout",
  ]);
  // The sector-agnostic marker is a saved value the editor recognises, not shown text.
  assert.deepEqual(financial.mandate.sectors, ["Sektoragnostisk"]);
});
