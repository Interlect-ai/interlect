/**
 * Fondsopsætningens faste grænser: de gælder uanset hvem der
 * redigerer, og serveren håndhæver dem ved udgivelse (og databasen ved skiftet til aktiv,
 * 0051). Ren fil uden database, så den kan testes med node --test.
 *
 * "Ukendt er aldrig 0" og "en bindende gate kan ikke opvejes af en høj score" er regler for
 * selve scoringen og holdes i scoring.ts (med tests), ikke for opsætningen.
 */
import { translate } from "../i18n/translate.ts";
import { LANGUAGE_TAGS, type Language } from "../i18n/language.ts";
import { type TeamTextFields } from "../analysis/team-text.ts";
import {
  chosenSetupStages,
  isSetupStage,
  rowsForStageList,
  stagesOfRows,
  teamTextBudgetByStage,
  type StagedTeamTextFields,
} from "../analysis/setup-stage.ts";
import { economyQuestionsByStage, type SetupInput } from "./setup-input.ts";

export const WEIGHT_MIN_PERCENT = 5;
export const WEIGHT_MAX_PERCENT = 40;
export const WEIGHT_TOTAL_PERCENT = 100;

export interface LimitedConfig extends Partial<Omit<TeamTextFields, "criteria" | "gates">> {
  /** `stage` (0133): null = shared by every stage; the text budget is counted per stage. */
  criteria: Array<{
    key: string;
    label?: string;
    weight: number;
    description?: string;
    stage?: string | null | undefined;
  }>;
  gates: Array<{ key: string; description?: string; stage?: string | null | undefined }>;
  analysisThreshold: number;
  /** The own economy questions per stage; they count in their stage's text budget. */
  economyQuestions?: StagedTeamTextFields["economyQuestions"];
  /**
   * The setup that is not rows (`fund_mandates.setup`). Its "Hvem er I" text, fixed-rule
   * edits and economy questions count in the text budget when the fields above are not given.
   */
  setup?: SetupInput | undefined;
  /** The team's chosen stages; each must have criteria (its own or the shared). */
  stages?: readonly string[] | undefined;
}

export type LimitViolationCode =
  | "no_criteria"
  | "weight_sum"
  | "weight_range"
  | "duplicate_criterion"
  | "duplicate_gate"
  | "threshold_range"
  | "team_text_budget";

export interface LimitViolation {
  code: LimitViolationCode;
  message: string;
  /** The criterion the violation is about, when it is about one (the stage for the text budget). */
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
  // Each list on its own: the shared criteria and each stage's own (rowsForStageList), as
  // the analysis reads them and the database checks them again (0134). Without anything per stage
  // this is the one list it always was.
  const shared = config.criteria.filter((criterion) => !isSetupStage(criterion.stage));
  const ownStages = stagesOfRows(config.criteria);
  for (const stage of [null, ...ownStages]) {
    const list = stage ? config.criteria.filter((criterion) => criterion.stage === stage) : shared;
    const total = list.reduce((sum, criterion) => sum + criterion.weight, 0);
    if (list.length > 0 && Math.abs(total - WEIGHT_TOTAL_PERCENT) > 0.005) {
      violations.push({
        code: "weight_sum",
        ...(stage ? { key: stage } : {}),
        message: translate(language, "fundEditor.limits.weightSum", {
          total: percent(total, language),
        }),
      });
    }
  }
  // A chosen stage with no criteria of its own reads the shared ones; with none of those either,
  // its cases would be scored on nothing.
  if (config.criteria.length > 0 && ownStages.length > 0) {
    for (const stage of chosenSetupStages(config.stages)) {
      if (rowsForStageList(config.criteria, stage).length === 0) {
        violations.push({
          code: "no_criteria",
          key: stage,
          message: translate(language, "fundEditor.limits.noCriteria"),
        });
      }
    }
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
  // The same key may stand once shared and once per stage (0133's key includes the stage).
  const seenCriteria = new Set<string>();
  for (const criterion of config.criteria) {
    const stagedKey = `${criterion.stage ?? ""}:${criterion.key}`;
    if (seenCriteria.has(stagedKey)) {
      violations.push({
        code: "duplicate_criterion",
        key: criterion.key,
        message: translate(language, "fundEditor.limits.duplicateCriterion", {
          name: criterion.label?.trim() || criterion.key,
        }),
      });
    }
    seenCriteria.add(stagedKey);
  }
  const seenGates = new Set<string>();
  for (const gate of config.gates) {
    const stagedKey = `${gate.stage ?? ""}:${gate.key}`;
    if (seenGates.has(stagedKey)) {
      violations.push({
        code: "duplicate_gate",
        message: translate(language, "fundEditor.limits.duplicateGate", { name: gate.key }),
      });
    }
    seenGates.add(stagedKey);
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
  // (TS-20): one character budget for the team's own words. Only checked when the text is
  // given (the publish and the AI proposals pass the whole draft; the editor's weight check does not).
  // The budget is per stage; the violation names the stage that is over (`key`).
  if (typeof config.thesis === "string") {
    const budget = teamTextBudgetByStage({
      thesis: config.thesis,
      riskPosture: config.riskPosture ?? "",
      ticketNote: config.ticketNote ?? "",
      stageExpectations: config.stageExpectations ?? {},
      dealbreakers: config.dealbreakers ?? [],
      screeningInstruction: config.screeningInstruction,
      about: config.about ?? config.setup?.about,
      fixedRules:
        config.fixedRules ??
        (config.setup?.fixedRules
          ? Object.values(config.setup.fixedRules).filter((text): text is string => !!text)
          : undefined),
      criteria: config.criteria,
      gates: config.gates,
      economyQuestions: config.economyQuestions ?? economyQuestionsByStage(config.setup),
    });
    if (budget.over) {
      violations.push({
        code: "team_text_budget",
        ...(budget.stage ? { key: budget.stage } : {}),
        message: translate(language, "fundEditor.limits.teamTextBudget", {
          used: budget.used.toLocaleString(LANGUAGE_TAGS[language]),
          limit: budget.limit.toLocaleString(LANGUAGE_TAGS[language]),
        }),
      });
    }
  }
  return violations;
}

/** One sentence for an error that stops a publish. */
export function limitViolationsMessage(violations: LimitViolation[]): string {
  return violations.map((violation) => violation.message).join(" ");
}
