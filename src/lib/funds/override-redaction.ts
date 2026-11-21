/**
 * Review M1: the fund's customised specialist instructions and research questions are
 * prompt text. Only holders of `configure_fund` (Admin and Lead, who edit them) may read the
 * texts; everyone else gets the same keys (so "Tilpasset" and the counts still work) with the
 * texts emptied. Pure file, tested with node --test.
 */
import type { SetupInput } from "./setup-input.ts";
export interface ModuleOverrideTexts {
  mandate: string[];
  evidenceTests: string[];
  riskAreas: string[];
}

export interface OverrideMaps {
  moduleOverrides: Record<string, ModuleOverrideTexts>;
  researchModuleOverrides: Record<string, { questions: string[] }>;
  /** The fund's own screening instruction is prompt text too. */
  screeningInstruction?: string;
  /** The stages' own module texts. */
  stageModuleOverrides?: Partial<Record<string, Record<string, ModuleOverrideTexts>>>;
  /**
   * "Hvem er I" (which replaces the screening instruction), the fixed-rule edits and the
   * own economy questions are prompt text too; the rest of the setup (thresholds, points) is not.
   */
  setup?: SetupInput;
}

const emptyTexts = (keys: Iterable<string>) =>
  Object.fromEntries(
    [...keys].map((id) => [id, { mandate: [], evidenceTests: [], riskAreas: [] }]),
  );

/** The setup with its prompt texts emptied; the keys stay, so "Tilpasset" and counts still work. */
function redactSetup(setup: SetupInput): SetupInput {
  const stages = Object.fromEntries(
    Object.entries(setup.stages ?? {}).map(([stage, own]) => [
      stage,
      own?.economy?.questions
        ? {
            ...own,
            economy: {
              ...own.economy,
              questions: own.economy.questions.map((question) => ({ ...question, text: "" })),
            },
          }
        : own,
    ]),
  ) as SetupInput["stages"];
  return {
    ...(setup.about !== undefined ? { about: "" } : {}),
    ...(setup.fixedRules
      ? { fixedRules: Object.fromEntries(Object.keys(setup.fixedRules).map((id) => [id, ""])) }
      : {}),
    ...(setup.stages ? { stages } : {}),
  };
}

export function redactOverrides<T extends OverrideMaps>(config: T, canConfigure: boolean): T {
  if (canConfigure) return config;
  return {
    ...config,
    ...(config.screeningInstruction === undefined ? {} : { screeningInstruction: "" }),
    moduleOverrides: emptyTexts(Object.keys(config.moduleOverrides)),
    ...(config.stageModuleOverrides === undefined
      ? {}
      : {
          stageModuleOverrides: Object.fromEntries(
            Object.entries(config.stageModuleOverrides).map(([stage, overrides]) => [
              stage,
              emptyTexts(Object.keys(overrides ?? {})),
            ]),
          ),
        }),
    ...(config.setup === undefined ? {} : { setup: redactSetup(config.setup) }),
    researchModuleOverrides: Object.fromEntries(
      Object.keys(config.researchModuleOverrides).map((id) => [id, { questions: [] }]),
    ),
  };
}
