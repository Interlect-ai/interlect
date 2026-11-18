/**
 * Review M1: the fund's customised specialist instructions and research questions are
 * prompt text. Only holders of `configure_fund` (Admin and Lead, who edit them) may read the
 * texts; everyone else gets the same keys (so "Tilpasset" and the counts still work) with the
 * texts emptied. Pure file, tested with node --test.
 */
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
}

export function redactOverrides<T extends OverrideMaps>(config: T, canConfigure: boolean): T {
  if (canConfigure) return config;
  return {
    ...config,
    ...(config.screeningInstruction === undefined ? {} : { screeningInstruction: "" }),
    moduleOverrides: Object.fromEntries(
      Object.keys(config.moduleOverrides).map((id) => [
        id,
        { mandate: [], evidenceTests: [], riskAreas: [] },
      ]),
    ),
    researchModuleOverrides: Object.fromEntries(
      Object.keys(config.researchModuleOverrides).map((id) => [id, { questions: [] }]),
    ),
  };
}
