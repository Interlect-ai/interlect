/**
 * Fondsopsætningens faste grænser: de gælder uanset hvem der
 * redigerer, og serveren håndhæver dem ved udgivelse (og databasen ved skiftet til aktiv,
 * 0051). Ren fil uden database, så den kan testes med node --test.
 *
 * "Ukendt er aldrig 0" og "en bindende gate kan ikke opvejes af en høj score" er regler for
 * selve scoringen og holdes i scoring.ts (med tests), ikke for opsætningen.
 */
import { translate } from "../i18n/translate.ts";
import type { Language } from "../i18n/language.ts";

export const WEIGHT_MIN_PERCENT = 5;
export const WEIGHT_MAX_PERCENT = 40;
export const WEIGHT_TOTAL_PERCENT = 100;

export interface LimitedConfig {
  criteria: Array<{ key: string; label?: string; weight: number }>;
  gates: Array<{ key: string }>;
  analysisThreshold: number;
}

export type LimitViolationCode =
  | "no_criteria"
  | "weight_sum"
  | "weight_range"
  | "duplicate_criterion"
  | "duplicate_gate"
  | "threshold_range";

export interface LimitViolation {
  code: LimitViolationCode;
  message: string;
  /** The criterion the violation is about, when it is about one. */
  key?: string;
}

function percent(value: number, language: Language): string {
  const decimal = language === "da" ? "," : ".";
  return `${Number.isInteger(value) ? value : value.toFixed(1).replace(".", decimal)} %`;
}

/** Every violation, so the editor can show them all at once. An empty list means it may be published. */
export function checkConfigLimits(
  config: LimitedConfig,
  language: Language = "da",
): LimitViolation[] {
  const violations: LimitViolation[] = [];
  if (config.criteria.length === 0) {
    violations.push({
      code: "no_criteria",
      message: translate(language, "fundEditor.limits.noCriteria"),
    });
  }
  const total = config.criteria.reduce((sum, criterion) => sum + criterion.weight, 0);
  if (config.criteria.length > 0 && Math.abs(total - WEIGHT_TOTAL_PERCENT) > 0.005) {
    violations.push({
      code: "weight_sum",
      message: translate(language, "fundEditor.limits.weightSum", {
        total: percent(total, language),
      }),
    });
  }
  for (const criterion of config.criteria) {
    if (criterion.weight < WEIGHT_MIN_PERCENT || criterion.weight > WEIGHT_MAX_PERCENT) {
      violations.push({
        code: "weight_range",
        key: criterion.key,
        message: translate(language, "fundEditor.limits.weightRange", {
          name: criterion.label?.trim() || criterion.key,
          weight: percent(criterion.weight, language),
          min: WEIGHT_MIN_PERCENT,
          max: WEIGHT_MAX_PERCENT,
        }),
      });
    }
  }
  const seenCriteria = new Set<string>();
  for (const criterion of config.criteria) {
    if (seenCriteria.has(criterion.key)) {
      violations.push({
        code: "duplicate_criterion",
        key: criterion.key,
        message: translate(language, "fundEditor.limits.duplicateCriterion", {
          name: criterion.label?.trim() || criterion.key,
        }),
      });
    }
    seenCriteria.add(criterion.key);
  }
  const seenGates = new Set<string>();
  for (const gate of config.gates) {
    if (seenGates.has(gate.key)) {
      violations.push({
        code: "duplicate_gate",
        message: translate(language, "fundEditor.limits.duplicateGate", { name: gate.key }),
      });
    }
    seenGates.add(gate.key);
  }
  if (
    !Number.isFinite(config.analysisThreshold) ||
    config.analysisThreshold < 0 ||
    config.analysisThreshold > 100
  ) {
    violations.push({
      code: "threshold_range",
      message: translate(language, "fundEditor.limits.thresholdRange"),
    });
  }
  return violations;
}

/** One sentence for an error that stops a publish. */
export function limitViolationsMessage(violations: LimitViolation[]): string {
  return violations.map((violation) => violation.message).join(" ");
}
