/**
 * The editor's side of the setup draft. `draftFrameOf` is what the draft is made
 * from (the thesis as the editor has it now, not necessarily saved), `applyStageDrafts` lays the
 * finished stages into the editor's state: each stage's criteria, its own rules, threshold,
 * economy and "Hvad forventer I?". The specialists' texts are not rows of the editor: they go to
 * the module texts per stage (`draftModuleTexts`, saved one by one with `saveModulePromptOverride`).
 *
 * What the team changes afterwards is the valid setup (the plan, afsnit 1, punkt 7): the draft
 * only replaces what a stage has now when the team asks for a draft. The shared mandate (Stadier,
 * Geografi, Sektorer and any other shared rule) is never touched. Pure and tested.
 */
import { stageTabs, type StageGate, type StageCriterion } from "./stage-editor.ts";
import type { SaveFundConfigInput } from "./config.functions.ts";
import { draftSaveParts, type SetupDraftFrame, type StageDraft } from "./setup-draft.ts";
import { SETUP_STAGES, setupStageOf, type SetupStage } from "../analysis/setup-stage.ts";
import type { SpecialistModuleId } from "../analysis/specialist-catalog.ts";

type EditorState = SaveFundConfigInput;

/** The frame a draft is made from: the thesis as it stands in the editor. */
export function draftFrameOf(value: EditorState): SetupDraftFrame {
  return {
    thesisName: value.fundName.trim().slice(0, 160),
    investorType: value.strategyType,
    about: (value.setup?.about ?? "").slice(0, 3000),
    // The request's own limits (setupDraftFrameSchema); the editor has none, and a team over them
    // would otherwise be refused for good.
    thesis: value.thesis.slice(0, 5000),
    stages: value.stages,
    geographies: value.geographies.slice(0, 30),
    sectors: value.sectors.slice(0, 30),
    sharedRules: value.gates
      .filter((gate) => !gate.stage)
      .map((gate) => ({
        key: gate.key,
        label: gate.label,
        description: gate.description,
        treatment: gate.treatment,
      }))
      .slice(0, 20),
    ticketMinEur: value.ticketMinEur,
    ticketMaxEur: value.ticketMaxEur,
    ticketNote: value.ticketNote.slice(0, 1000),
    website: "",
  };
}

/** The stages that already have something of their own, which a new draft would replace. */
export function stagesWithOwnContent(value: EditorState): SetupStage[] {
  return stageTabs(value.stages)
    .map((tab) => tab.stage)
    .filter(
      (stage) =>
        value.criteria.some((criterion) => criterion.stage === stage) ||
        value.gates.some((gate) => gate.stage === stage) ||
        Boolean(value.setup?.stages?.[stage]?.economy),
    );
}

/** The finished drafts laid into the editor's state; stages without a draft stay as they are. */
export function applyStageDrafts(value: EditorState, drafts: readonly StageDraft[]): EditorState {
  if (!drafts.length) return value;
  const byStage = new Map(drafts.map((draft) => [draft.stage, draft]));
  const parts = draftSaveParts(drafts);
  const touched = new Set(byStage.keys());
  const criteria: StageCriterion[] = [
    ...value.criteria.filter((criterion) => !criterion.stage || !touched.has(criterion.stage)),
    ...parts.criteria.map((criterion) => ({
      key: criterion.key,
      label: criterion.label,
      description: criterion.description,
      category: criterion.category,
      weight: criterion.weight,
      stage: criterion.stage,
    })),
  ];
  const gates: StageGate[] = [
    ...value.gates.filter((gate) => !gate.stage || !touched.has(gate.stage)),
    ...parts.gates.map((gate) => ({
      key: gate.key,
      label: gate.label,
      description: gate.description,
      treatment: gate.treatment,
      stage: gate.stage,
    })),
  ];
  const setup = value.setup ?? {};
  const stages = { ...setup.stages };
  for (const stage of SETUP_STAGES) {
    const own = parts.stages[stage];
    if (!own) continue;
    stages[stage] = { ...stages[stage], threshold: own.threshold, economy: own.economy };
  }
  const stageExpectations = { ...value.stageExpectations };
  // Every entry of the team's own for a stage ("series_b" and "Series B+" are one stage).
  for (const raw of value.stages) {
    const stage = setupStageOf(raw);
    const text = stage ? parts.stageExpectations[stage] : undefined;
    if (text) stageExpectations[raw] = text;
  }
  return { ...value, criteria, gates, stageExpectations, setup: { ...setup, stages } };
}

export interface DraftModuleText {
  stage: SetupStage;
  moduleId: SpecialistModuleId;
  mandate: string[];
  evidenceTests: string[];
  riskAreas: string[];
}

/** The specialists' texts, one per stage and specialist, in the shape a module text is saved in. */
export function draftModuleTexts(drafts: readonly StageDraft[]): DraftModuleText[] {
  const parts = draftSaveParts(drafts);
  const texts: DraftModuleText[] = [];
  for (const stage of SETUP_STAGES) {
    const modules = parts.moduleOverrides[stage];
    if (!modules) continue;
    for (const [moduleId, text] of Object.entries(modules)) {
      texts.push({ stage, moduleId: moduleId as SpecialistModuleId, ...text });
    }
  }
  return texts;
}
