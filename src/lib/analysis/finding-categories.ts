import type { Language } from "../i18n/language.ts";
import { translate, type MessageKey, type TranslateVars } from "../i18n/translate.ts";
import { DEEP_FINDING_CATEGORIES } from "./deep.contracts.ts";

/**
 * The nine analysis categories every deep analysis and every specialist must cover with at least
 * one finding (principle 7: missing data is uncertainty, never a failure after the model call
 * has been paid for). When the model skips a category, code adds an honest 'unknown' finding
 * instead of failing the run. Nothing is invented: no evidence, confidence 0, and the finding
 * says plainly that no data was found, so the gap is visible to the user (and becomes a task
 * through `buildAiTasks`). Pure and tested.
 */

/** The one list of the nine areas (the schema, the quality check and the prompt use it too). */
export const ANALYSIS_CATEGORIES = DEEP_FINDING_CATEGORIES;

/** The texts code writes into the findings, in the fund's language. */
function text(language: Language, key: string, vars?: TranslateVars) {
  return translate(language, `analysisServer.findings.${key}` as MessageKey, vars);
}

/** An area's name inside a sentence ("investeringstesen og mandatet"); an unknown key stays itself. */
function categoryLabel(category: string, language: Language) {
  return (ANALYSIS_CATEGORIES as readonly string[]).includes(category)
    ? text(language, `categories.${category}`)
    : category;
}

export interface FallbackFinding {
  /** Marks a finding made by code; stored with the database origin 'deterministic'. */
  origin: "deterministic";
  category: string;
  findingType: "unknown";
  statement: string;
  confidence: 0;
  nature: "judgement";
  evidenceIds: string[];
}

export function unknownFindingFor(category: string, language: Language = "da"): FallbackFinding {
  const label = categoryLabel(category, language);
  return {
    origin: "deterministic",
    category,
    findingType: "unknown",
    statement: text(language, "unknown", { label }),
    confidence: 0,
    nature: "judgement",
    evidenceIds: [],
  };
}

/**
 * For every required category without a finding: first the specialists' own findings for that
 * category are copied into the list (they are real, evidence-backed findings the synthesis left
 * out; at most three per category); only when there are none, an honest 'unknown' finding made
 * by code is added (`origin: "deterministic"`, stored as such). Returns the new list and which
 * categories were copied and which got the unknown fallback (for a visible audit warning).
 */
export function withCategoryFallbacks<T extends { category: string }>(
  findings: readonly T[],
  categories: readonly string[] = ANALYSIS_CATEGORIES,
  specialistFindings: readonly T[] = [],
  language: Language = "da",
): { findings: T[]; added: string[]; copied: string[] } {
  const missing = categories.filter(
    (category) => !findings.some((item) => item.category === category),
  );
  const extra: T[] = [];
  const added: string[] = [];
  const copied: string[] = [];
  for (const category of missing) {
    const own = specialistFindings.filter((item) => item.category === category).slice(0, 3);
    if (own.length > 0) {
      extra.push(...own);
      copied.push(category);
    } else {
      // The fallback has the shape of a stored finding, so it is returned as the caller's type.
      extra.push(unknownFindingFor(category, language) as unknown as T);
      added.push(category);
    }
  }
  return { findings: [...findings, ...extra], added, copied };
}

export function categoryFallbackWarning(
  added: readonly string[],
  copied: readonly string[] = [],
  language: Language = "da",
): string[] {
  const out: string[] = [];
  if (copied.length) {
    out.push(text(language, "copied", { categories: copied.join(", ") }));
  }
  if (added.length) {
    out.push(text(language, "added", { categories: added.join(", ") }));
  }
  return out;
}
