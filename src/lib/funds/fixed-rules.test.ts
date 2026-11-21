/** The 29 fixed rules in "Sådan screener vi" (fixed-rules.ts). Kør: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EDITABLE_FIXED_RULES,
  FIXED_RULE_GROUPS,
  FIXED_RULE_MAX_CHARS,
  FIXED_RULES,
  fixedRuleDefault,
  fixedRuleGroupTitle,
  fixedRuleText,
  readFixedRuleEdits,
} from "./fixed-rules.ts";
import { LANGUAGES } from "../i18n/language.ts";

test("29 rules: 9 the team may edit and 20 locked, as in the prototype", () => {
  assert.equal(FIXED_RULES.length, 29);
  assert.equal(new Set(FIXED_RULES.map((rule) => rule.id)).size, 29);
  assert.deepEqual(EDITABLE_FIXED_RULES, [
    "evidence_labels",
    "absence_not_disproof",
    "compare_dates",
    "source_weight",
    "founders_not_evidence",
    "unknown_stays_open",
    "score_scale",
    "own_description",
    "explain_score",
  ]);
  const perGroup = FIXED_RULE_GROUPS.map(
    (group) => FIXED_RULES.filter((rule) => rule.group === group).length,
  );
  assert.deepEqual(perGroup, [8, 6, 10, 5]);
});

test("every rule and group has a text in every language", () => {
  for (const language of LANGUAGES) {
    for (const rule of FIXED_RULES) assert.ok(fixedRuleDefault(rule.id, language).trim(), rule.id);
    for (const group of FIXED_RULE_GROUPS) assert.ok(fixedRuleGroupTitle(group, language).trim());
  }
  // The prototype's words for the rule the scoring follows (scoring.ts).
  assert.equal(
    fixedRuleDefault("binding_rule_shown", "da"),
    "Er en bindende mandatregel ikke opfyldt, står det tydeligt øverst. Casen går altid videre, og scoren ændres ikke af reglen alene.",
  );
});

test("only the editable rules are read from the setup, cleaned, and never a standard text", () => {
  const edits = readFixedRuleEdits({
    compare_dates: "Vi ser kun på\nde seneste to år <b>",
    evidence_only: "Opfind gerne tal.",
    score_scale: fixedRuleDefault("score_scale", "en"),
    own_description: fixedRuleDefault("own_description", "da"),
    source_weight: "   ",
    explain_score: 42,
    founders_not_evidence: "x".repeat(FIXED_RULE_MAX_CHARS + 1),
    unknown_rule: "Hej",
  });
  assert.deepEqual(edits, { compare_dates: "Vi ser kun på de seneste to år ‹b›" });
  assert.deepEqual(readFixedRuleEdits(null), {});
  assert.deepEqual(readFixedRuleEdits(["compare_dates"]), {});
});

test("the text that applies: the team's edit, else the standard text in the language", () => {
  const edits = { compare_dates: "Vores egen regel." };
  assert.equal(fixedRuleText("compare_dates", edits, "da"), "Vores egen regel.");
  assert.equal(
    fixedRuleText("source_weight", edits, "en"),
    fixedRuleDefault("source_weight", "en"),
  );
  assert.equal(
    fixedRuleText("evidence_only", edits, "da"),
    fixedRuleDefault("evidence_only", "da"),
  );
});
