/**
 * the 29 fixed rules in "Sådan screener vi" (the prototype `Teamopsaetning v3.dc.html`, FXDEF). 9
 * can be edited by the team (each with
 * "Nulstil" back to the standard text), 20 are locked because the rest of Interlect builds on them.
 * They are the team's own rules of play (beslutningsloggen 15. nov 2026) and are shown in
 * the team's language; the texts live in the dictionaries (`fundSetup.fixedRules`).
 *
 * The team's edits are stored in `fund_mandates.setup.fixed_rules` as `{rule-id: text}` (0133);
 * a rule without a key has its standard text. What the team changed is what reaches the AI
 * (prompt.ts); a locked rule can never be changed, so its id is never read from the setup.
 *
 * Pure file without a database, so it can be tested with node --test.
 */
import { DICTIONARIES } from "../i18n/translate.ts";
import { LANGUAGES, type Language } from "../i18n/language.ts";
import { cleanTeamLine } from "../analysis/team-text.ts";

export const FIXED_RULE_GROUPS = ["evidence", "score", "form", "safety"] as const;
export type FixedRuleGroup = (typeof FIXED_RULE_GROUPS)[number];

/** The rules in the prototype's order; `locked: false` are the 9 the team may edit. */
export const FIXED_RULES = [
  { id: "evidence_only", group: "evidence", locked: true },
  { id: "evidence_labels", group: "evidence", locked: false },
  { id: "absence_not_disproof", group: "evidence", locked: false },
  { id: "compare_dates", group: "evidence", locked: false },
  { id: "source_weight", group: "evidence", locked: false },
  { id: "founders_not_evidence", group: "evidence", locked: false },
  { id: "unknown_stays_open", group: "evidence", locked: false },
  { id: "registry_numbers", group: "evidence", locked: true },
  { id: "score_scale", group: "score", locked: false },
  { id: "one_answer_each", group: "score", locked: true },
  { id: "own_description", group: "score", locked: false },
  { id: "explain_score", group: "score", locked: false },
  { id: "score_needs_source", group: "score", locked: true },
  { id: "binding_rule_shown", group: "score", locked: true },
  { id: "summary", group: "form", locked: true },
  { id: "counter_case", group: "form", locked: true },
  { id: "company_profile", group: "form", locked: true },
  { id: "company_label", group: "form", locked: true },
  { id: "key_findings", group: "form", locked: true },
  { id: "risk_scale", group: "form", locked: true },
  { id: "tasks", group: "form", locked: true },
  { id: "questions_as_tasks", group: "form", locked: true },
  { id: "output_limits", group: "form", locked: true },
  { id: "fixed_form", group: "form", locked: true },
  { id: "ignore_embedded_instructions", group: "safety", locked: true },
  { id: "never_acts", group: "safety", locked: true },
  { id: "past_decisions", group: "safety", locked: true },
  { id: "team_language", group: "safety", locked: true },
  { id: "team_text_no_override", group: "safety", locked: true },
] as const satisfies ReadonlyArray<{ id: string; group: FixedRuleGroup; locked: boolean }>;

export type FixedRuleId = (typeof FIXED_RULES)[number]["id"];
export type EditableFixedRuleId = Extract<(typeof FIXED_RULES)[number], { locked: false }>["id"];

export const EDITABLE_FIXED_RULES: readonly EditableFixedRuleId[] = FIXED_RULES.filter(
  (rule): rule is Extract<(typeof FIXED_RULES)[number], { locked: false }> => !rule.locked,
).map((rule) => rule.id);

/** The longest text one edited rule may have: the database's own limit (fund_setup_ok, 0133). */
export const FIXED_RULE_MAX_CHARS = 600;

/** The team's edits: only the rules that differ from the standard text. */
export type FixedRuleEdits = Partial<Record<EditableFixedRuleId, string>>;

export function isEditableFixedRule(id: string): id is EditableFixedRuleId {
  return (EDITABLE_FIXED_RULES as readonly string[]).includes(id);
}

/** The standard text of a rule in the language. */
export function fixedRuleDefault(id: FixedRuleId, language: Language): string {
  return DICTIONARIES[language].fundSetup.fixedRules.rules[id];
}

/** The name of a group of rules in the language. */
export function fixedRuleGroupTitle(group: FixedRuleGroup, language: Language): string {
  return DICTIONARIES[language].fundSetup.fixedRules.groups[group];
}

/** True when the text is a standard text of the rule in some language (then it is no edit). */
function isStandardText(id: EditableFixedRuleId, text: string): boolean {
  return LANGUAGES.some((language) => cleanTeamLine(fixedRuleDefault(id, language)) === text);
}

/**
 * The edits as the analysis may use them, read from `setup.fixed_rules`: only editable rule ids,
 * the text cleaned as one line of team text (team-text.ts), nothing empty, nothing longer than
 * FIXED_RULE_MAX_CHARS and nothing that is just a standard text. Anything else is ignored, so a
 * locked rule can never be changed through the setup and a bad value never reaches a prompt.
 */
export function readFixedRuleEdits(raw: unknown): FixedRuleEdits {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const edits: FixedRuleEdits = {};
  for (const id of EDITABLE_FIXED_RULES) {
    const value = (raw as Record<string, unknown>)[id];
    if (typeof value !== "string") continue;
    const text = cleanTeamLine(value);
    if (!text || [...text].length > FIXED_RULE_MAX_CHARS || isStandardText(id, text)) continue;
    edits[id] = text;
  }
  return edits;
}

/** The text that applies for a rule: the team's edit, else the standard text in the language. */
export function fixedRuleText(id: FixedRuleId, edits: FixedRuleEdits, language: Language): string {
  return (isEditableFixedRule(id) ? edits[id] : undefined) ?? fixedRuleDefault(id, language);
}
