import type { ScoreCategory } from "@/lib/domain/types";
import type { Language } from "../i18n/language.ts";
import { translate } from "../i18n/translate.ts";
import { STANDARD_SPECIALIST_COUNT } from "./model-tiers.ts";
import { specialistCatalog } from "./specialist-catalog.ts";
import {
  effectiveSpecialistModule,
  specialistModules,
  type DeepSpecialist,
  type PromptModuleOverrideRow,
} from "./specialist-prompts.ts";

/**
 * The fund's own set of specialists: the standard four can be
 * switched off and on again, and the fund can add its own. Stored per fund config version in
 * `fund_specialists` (migration 0076); a standard module without a row is active, so every
 * version from runs exactly the four as before. Pure and tested.
 */

/** Default of `ai_settings.max_custom_specialists` (a setting per installation). */
export const MAX_CUSTOM_SPECIALISTS_DEFAULT = 3;
/** The database's ceiling for that setting (0076). */
export const MAX_CUSTOM_SPECIALISTS_CEILING = 6;
/** The most specialists one deep run can have. */
export const MAX_SPECIALISTS = STANDARD_SPECIALIST_COUNT + MAX_CUSTOM_SPECIALISTS_CEILING;

export const CUSTOM_SPECIALIST_KEY = /^custom_[a-z0-9]{8,32}$/;

/** The score areas, in the order of the standard modules (each module owns its own). */
export const SCORE_CATEGORIES: readonly ScoreCategory[] = specialistCatalog.flatMap(
  (module) => module.categories,
);

export const FUND_SPECIALIST_COLUMNS =
  "specialist_key, kind, enabled, sort_order, name, purpose, mandate, evidence_tests, risk_areas, research_questions, output_focus, categories";

/** A `fund_specialists` row as read with FUND_SPECIALIST_COLUMNS. */
export interface FundSpecialistRow {
  specialist_key: string;
  kind: "standard" | "custom";
  enabled: boolean;
  sort_order: number;
  name: string | null;
  purpose: string | null;
  mandate: string[] | null;
  evidence_tests: string[] | null;
  risk_areas: string[] | null;
  research_questions: string[] | null;
  output_focus: string[] | null;
  categories: string[] | null;
}

function isScoreCategory(value: string): value is ScoreCategory {
  return (SCORE_CATEGORIES as readonly string[]).includes(value);
}

function isUsableCustom(row: FundSpecialistRow): boolean {
  return (
    row.kind === "custom" &&
    CUSTOM_SPECIALIST_KEY.test(row.specialist_key) &&
    Boolean(row.name?.trim()) &&
    (row.mandate?.length ?? 0) > 0
  );
}

function customOrder(a: FundSpecialistRow, b: FundSpecialistRow): number {
  return a.sort_order - b.sort_order || a.specialist_key.localeCompare(b.specialist_key);
}

/** The standard module ids the version has switched off. */
export function switchedOffStandard(rows: readonly FundSpecialistRow[]): Set<string> {
  return new Set(
    rows.filter((row) => row.kind === "standard" && !row.enabled).map((row) => row.specialist_key),
  );
}

/**
 * The specialists a deep run with this config version runs, in order: the active standard
 * modules (with the fund's own text from `prompt_module_overrides`), then the fund's own active
 * ones by `sort_order`.
 *
 * Every score area is assessed by exactly one specialist, so every criterion gets a specialist's
 * score and text: an active standard module keeps its own areas; an area whose module is switched
 * off goes to the first of the fund's own specialists that names it, and the areas nobody names go
 * to the fund's own specialists in turn (the fund replaced the module with its own), or to the
 * active standard modules in turn when the fund has none of its own.
 */
export function resolveSpecialistSet(
  rows: readonly FundSpecialistRow[],
  overrides: ReadonlyMap<string, PromptModuleOverrideRow> = new Map(),
): DeepSpecialist[] {
  const off = switchedOffStandard(rows);
  const standard: DeepSpecialist[] = specialistModules
    .filter((module) => !off.has(module.id))
    .map((module) => ({
      ...effectiveSpecialistModule(module, overrides.get(module.id)),
      categories: [...module.categories],
      kind: "standard" as const,
    }));
  const owned = new Set<ScoreCategory>(standard.flatMap((module) => module.categories));
  const custom: DeepSpecialist[] = rows
    .filter((row) => row.enabled && isUsableCustom(row))
    .sort(customOrder)
    .map((row) => {
      const categories: ScoreCategory[] = [];
      for (const value of row.categories ?? []) {
        if (isScoreCategory(value) && !owned.has(value)) {
          owned.add(value);
          categories.push(value);
        }
      }
      return {
        id: row.specialist_key,
        kind: "custom" as const,
        title: row.name!.trim(),
        categories,
        mandate: [...(row.mandate ?? [])],
        evidenceTests: [...(row.evidence_tests ?? [])],
        riskAreas: [...(row.risk_areas ?? [])],
        purpose: row.purpose?.trim() ?? null,
        questions: [...(row.research_questions ?? [])],
        deliverables: [...(row.output_focus ?? [])],
      };
    });
  // Areas nobody named go module by module (a switched-off module's areas stay together) to the
  // fund's own specialists in turn, or to the active standard modules in turn without own ones,
  // so one call is not given every area at once.
  const heirs = custom.length ? custom : standard;
  let turn = 0;
  for (const module of specialistModules) {
    const left = module.categories.filter((category) => !owned.has(category));
    if (left.length === 0 || heirs.length === 0) continue;
    const heir = heirs[turn % heirs.length]!;
    turn += 1;
    for (const category of left) owned.add(category);
    heir.categories = SCORE_CATEGORIES.filter(
      (category) => heir.categories.includes(category) || left.includes(category),
    );
  }
  return [...standard, ...custom];
}

/** More areas than this for one specialist makes its single call long (review). */
export const MANY_AREAS_FOR_ONE_SPECIALIST = 5;

/**
 * Not a publish rule, a warning for the page: a specialist that assesses many areas alone writes
 * a long answer in one call, which can be cut off. In `language`; empty when nothing stands out.
 */
export function specialistSetWarnings(
  set: readonly DeepSpecialist[],
  language: Language = "da",
): string[] {
  return set
    .filter((specialist) => specialist.categories.length > MANY_AREAS_FOR_ONE_SPECIALIST)
    .map((specialist) =>
      translate(language, "analysisServer.specialistSet.manyAreas", {
        title: specialist.title,
        count: specialist.categories.length,
      }),
    );
}

/** Active specialists of a version, as the publish rule in 0076 counts them. */
export function activeSpecialistCount(rows: readonly FundSpecialistRow[]): number {
  return (
    STANDARD_SPECIALIST_COUNT -
    switchedOffStandard(rows).size +
    rows.filter((row) => row.kind === "custom" && row.enabled).length
  );
}

export function activeCustomCount(rows: readonly FundSpecialistRow[]): number {
  return rows.filter((row) => row.kind === "custom" && row.enabled).length;
}

/**
 * What stops a version from being published (the same rules as the trigger in 0076), in
 * `language` for the page; empty when the set is fine.
 */
export function specialistSetProblems(
  rows: readonly FundSpecialistRow[],
  maxCustom: number,
  language: Language = "da",
): string[] {
  const problems: string[] = [];
  const customOn = activeCustomCount(rows);
  if (customOn > maxCustom) {
    problems.push(
      translate(language, "analysisServer.specialistSet.tooManyCustom", {
        max: maxCustom,
        count: customOn,
      }),
    );
  }
  if (activeSpecialistCount(rows) < 1) {
    problems.push(translate(language, "analysisServer.specialistSet.noneActive"));
  }
  return problems;
}

/**
 * The run's set as stored on a finished run (`raw_response.specialistSet`), so the case page and
 * Brain can name the specialists without reading the config version again.
 */
export function specialistSetSummary(set: readonly DeepSpecialist[]) {
  return set.map((specialist) => ({
    id: specialist.id,
    kind: specialist.kind ?? "standard",
    title: specialist.title,
    categories: [...specialist.categories],
  }));
}

/** A new key for the fund's own specialist; it follows the specialist from version to version. */
export function newCustomSpecialistKey(random: () => number = Math.random): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let suffix = "";
  for (let index = 0; index < 12; index += 1) {
    suffix += alphabet[Math.floor(random() * alphabet.length)] ?? "a";
  }
  return `custom_${suffix}`;
}
