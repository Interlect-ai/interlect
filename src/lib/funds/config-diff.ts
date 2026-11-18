import type { ScreeningCardId } from "./screening-setup.ts";
import { translate } from "../i18n/translate.ts";
import type { Language } from "../i18n/language.ts";
import {
  geographyKeys,
  geographyText,
  stageExpectationKeys,
  stageKeys,
  stageText,
} from "./basis-labels.ts";

/**
 * E6: hvad er ændret mellem to versioner af en fondsopsætning. Ren fil (ingen database),
 * så den kan testes med node --test. Kun ændringer, der påvirker analysen, tælles med.
 */
export interface DiffableConfig {
  thesis: string;
  stages: string[];
  geographies: string[];
  sectors: string[];
  analysisThreshold: number;
  riskPosture: string;
  ticketMinEur: number | null;
  ticketMaxEur: number | null;
  fundSizeEur?: number | null;
  gates: Array<{
    key: string;
    label: string;
    treatment: "hard" | "review";
    description?: string;
  }>;
  criteria: Array<{
    key: string;
    label: string;
    weight: number;
    description?: string;
    category?: string;
    codeAnchor?: boolean | undefined;
  }>;
  strategyType?: string;
  dealbreakers?: string[];
  stageExpectations?: Record<string, string>;
  /** Specialist- og researchtilpasninger; sammenlignes kun som helhed. */
  moduleOverrides?: unknown;
  researchModuleOverrides?: unknown;
  /** Sammenlignes kun, når begge sider har feltet (editorens kladde har det ikke). */
  screeningInstruction?: string;
  /** No longer a choice and not compared; kept so the version rows still fit the type. */
  screeningCards?: ScreeningCardId[];
}

function sameJson(a: unknown, b: unknown) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function listChange(
  label: string,
  before: string[],
  after: string[],
  show: (item: string) => string = (item) => item,
): string | null {
  const added = after.filter((item) => !before.includes(item));
  const removed = before.filter((item) => !after.includes(item));
  if (!added.length && !removed.length) return null;
  const parts = [
    ...(added.length ? [`+ ${added.map(show).join(", ")}`] : []),
    ...(removed.length ? [`− ${removed.map(show).join(", ")}`] : []),
  ];
  return `${label}: ${parts.join(" · ")}`;
}

export function diffFundConfigs(
  before: DiffableConfig,
  after: DiffableConfig,
  language: Language = "da",
): string[] {
  const changes: string[] = [];
  if (before.thesis.trim() !== after.thesis.trim())
    changes.push(translate(language, "fundSetup.configDiff.thesisRewritten"));
  for (const change of [
    // An old name and its key ("Serie A", "series_a") are the same stage.
    listChange(
      translate(language, "fundSetup.configDiff.stages"),
      stageKeys(before.stages),
      stageKeys(after.stages),
      (stage) => stageText(stage, language),
    ),
    listChange(
      translate(language, "fundSetup.configDiff.countries"),
      geographyKeys(before.geographies),
      geographyKeys(after.geographies),
      (geography) => geographyText(geography, language),
    ),
    listChange(translate(language, "fundSetup.configDiff.sectors"), before.sectors, after.sectors),
  ]) {
    if (change) changes.push(change);
  }
  if (before.analysisThreshold !== after.analysisThreshold) {
    changes.push(
      translate(language, "fundSetup.configDiff.threshold", {
        before: before.analysisThreshold,
        after: after.analysisThreshold,
      }),
    );
  }
  if (before.ticketMinEur !== after.ticketMinEur || before.ticketMaxEur !== after.ticketMaxEur) {
    changes.push(translate(language, "fundSetup.configDiff.ticketChanged"));
  }
  if ((before.fundSizeEur ?? null) !== (after.fundSizeEur ?? null)) {
    changes.push(translate(language, "fundSetup.configDiff.fundSizeChanged"));
  }
  if (before.riskPosture.trim() !== after.riskPosture.trim()) {
    changes.push(translate(language, "fundSetup.configDiff.riskRewritten"));
  }
  if (
    before.screeningInstruction !== undefined &&
    after.screeningInstruction !== undefined &&
    before.screeningInstruction.trim() !== after.screeningInstruction.trim()
  ) {
    changes.push(
      after.screeningInstruction.trim()
        ? translate(language, "fundSetup.configDiff.screeningRewritten")
        : translate(language, "fundSetup.configDiff.screeningRemoved"),
    );
  }
  if (
    !sameJson(
      stageExpectationKeys(before.stageExpectations ?? {}),
      stageExpectationKeys(after.stageExpectations ?? {}),
    )
  ) {
    changes.push(translate(language, "fundSetup.configDiff.stageExpectationsChanged"));
  }
  const dealListChange = listChange(
    translate(language, "fundSetup.configDiff.dealbreakers"),
    before.dealbreakers ?? [],
    after.dealbreakers ?? [],
  );
  if (dealListChange) changes.push(dealListChange);
  if ((before.strategyType ?? "") !== (after.strategyType ?? "")) {
    changes.push(translate(language, "fundSetup.configDiff.strategyChanged"));
  }
  const gatesBefore = new Map(before.gates.map((gate) => [gate.key, gate]));
  const gatesAfter = new Map(after.gates.map((gate) => [gate.key, gate]));
  for (const gate of after.gates) {
    const old = gatesBefore.get(gate.key);
    if (!old)
      changes.push(translate(language, "fundSetup.configDiff.newGate", { label: gate.label }));
    else {
      if (old.treatment !== gate.treatment) {
        changes.push(
          translate(
            language,
            gate.treatment === "hard"
              ? "fundSetup.configDiff.gateNowHard"
              : "fundSetup.configDiff.gateNowReview",
            { label: gate.label },
          ),
        );
      }
      if ((old.description ?? "").trim() !== (gate.description ?? "").trim()) {
        changes.push(
          translate(language, "fundSetup.configDiff.gateQuestionRewritten", { label: gate.label }),
        );
      }
    }
  }
  for (const gate of before.gates) {
    if (!gatesAfter.has(gate.key))
      changes.push(translate(language, "fundSetup.configDiff.gateRemoved", { label: gate.label }));
  }
  const criteriaBefore = new Map(before.criteria.map((criterion) => [criterion.key, criterion]));
  const criteriaAfter = new Map(after.criteria.map((criterion) => [criterion.key, criterion]));
  for (const criterion of after.criteria) {
    const old = criteriaBefore.get(criterion.key);
    if (!old)
      changes.push(
        translate(language, "fundSetup.configDiff.newCriterion", {
          label: criterion.label,
          weight: criterion.weight,
        }),
      );
    else {
      if (old.label.trim() !== criterion.label.trim()) {
        changes.push(
          translate(language, "fundSetup.configDiff.criterionRenamed", {
            before: old.label,
            after: criterion.label,
          }),
        );
      }
      if (old.weight !== criterion.weight) {
        changes.push(
          translate(language, "fundSetup.configDiff.criterionWeight", {
            label: criterion.label,
            before: old.weight,
            after: criterion.weight,
          }),
        );
      }
      if ((old.category ?? "") !== (criterion.category ?? "")) {
        changes.push(
          translate(language, "fundSetup.configDiff.criterionSpecialist", {
            label: criterion.label,
          }),
        );
      }
      if ((old.description ?? "").trim() !== (criterion.description ?? "").trim()) {
        changes.push(
          translate(language, "fundSetup.configDiff.criterionDescription", {
            label: criterion.label,
          }),
        );
      }
      // Kun økonomi-kriterier kan forankres; ældre versioner uden valget var forankret.
      const anchoredBefore = old.category === "financial_strength" && old.codeAnchor !== false;
      const anchoredAfter =
        criterion.category === "financial_strength" && criterion.codeAnchor !== false;
      if (old.category === criterion.category && anchoredBefore !== anchoredAfter) {
        changes.push(
          translate(
            language,
            anchoredAfter
              ? "fundSetup.configDiff.criterionAnchored"
              : "fundSetup.configDiff.criterionByAi",
            { label: criterion.label },
          ),
        );
      }
    }
  }
  for (const criterion of before.criteria) {
    if (!criteriaAfter.has(criterion.key))
      changes.push(
        translate(language, "fundSetup.configDiff.criterionRemoved", { label: criterion.label }),
      );
  }
  if (!sameJson(before.moduleOverrides, after.moduleOverrides)) {
    changes.push(translate(language, "fundSetup.configDiff.specialistOverridesChanged"));
  }
  if (!sameJson(before.researchModuleOverrides, after.researchModuleOverrides)) {
    changes.push(translate(language, "fundSetup.configDiff.researchChanged"));
  }
  return changes;
}
