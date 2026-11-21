/**
 * What "Sådan screener vi" reads and writes for ONE stage (the prototype's `loadStg`/
 * `saveStg`, `Teamopsaetning v3.dc.html`), on top of the editor's state: criteria and rules with a
 * `stage`, and `setup` (`fixedRules`, and per stage the threshold and the economy).
 *
 * A stage's criteria are its own rows, else the shared rows (setup-stage.ts, `rowsForStageList`):
 * the first change in a stage copies the list into rows of its own. A stage's rules are the shared
 * rules with the stage's own on top (`rowsForStageMerge`). Writing a row with a stage always sends
 * `setup` with it (even `{}`), because the server refuses rows with a stage without it.
 *
 * Pure file without a database, so it can be tested with node --test.
 */
import {
  SETUP_STAGES,
  rowsForStageList,
  rowsForStageMerge,
  setupStageOf,
  type SetupStage,
} from "../analysis/setup-stage.ts";
import {
  MAX_OWN_ECONOMY_QUESTIONS,
  readEconomySetup,
  type EconomySetup,
  type MissingMode,
  type OwnQuestionAnswer,
} from "./economy-points.ts";
import { fixedRuleDefault, isEditableFixedRule, type EditableFixedRuleId } from "./fixed-rules.ts";
import type { SaveFundConfigInput } from "./config.functions.ts";
import type { Language } from "../i18n/language.ts";
import type { SetupInput, StageSetupInput } from "./setup-input.ts";

type EditorState = SaveFundConfigInput;
export type StageCriterion = EditorState["criteria"][number];
export type StageGate = EditorState["gates"][number];

/** The prototype's colours per stage (`SCOL`), as series numbers (`--series-N`). */
export const STAGE_SERIES: Record<SetupStage, number> = {
  pre_seed: 5,
  seed: 1,
  series_a: 2,
  series_b: 7,
  growth: 3,
  buyout: 8,
  later: 6,
};

export interface StageTab {
  stage: SetupStage;
  /** The team's own entry in `stages` (its words), which `stageExpectations` is keyed by. */
  raw: string;
}

/** The team's chosen stages as tabs, once each, in the prototype's order. */
export function stageTabs(stages: readonly string[]): StageTab[] {
  const found = new Map<SetupStage, string>();
  for (const raw of stages) {
    const stage = setupStageOf(raw);
    if (stage && !found.has(stage)) found.set(stage, raw);
  }
  return SETUP_STAGES.filter((stage) => found.has(stage)).map((stage) => ({
    stage,
    raw: found.get(stage)!,
  }));
}

function setupOf(value: EditorState): SetupInput {
  return value.setup ?? {};
}

// ---------------------------------------------------------------------------
// Criteria
// ---------------------------------------------------------------------------

/** The criteria that count for the stage (its own, else the shared ones). */
export function criteriaOf(value: EditorState, stage: SetupStage): StageCriterion[] {
  return rowsForStageList(value.criteria, stage);
}

/** The stage's criteria replaced by `next` (they get the stage); other stages' rows stay. */
export function withStageCriteria(
  value: EditorState,
  stage: SetupStage,
  next: readonly StageCriterion[],
): EditorState {
  return {
    ...value,
    criteria: [
      ...value.criteria.filter((criterion) => criterion.stage !== stage),
      ...next.map((criterion) => ({ ...criterion, stage })),
    ],
    setup: setupOf(value),
  };
}

// ---------------------------------------------------------------------------
// Rules (the mandate)
// ---------------------------------------------------------------------------

/** The rules that count for the stage: the shared ones, then the stage's own. */
export function gatesOf(value: EditorState, stage: SetupStage): StageGate[] {
  return rowsForStageMerge(value.gates, stage, (gate) => gate.key);
}

/**
 * The three shared rules "Jeres tese" weighs (stages, geography, sectors): they are the same for
 * every stage and are edited in place. Any other shared rule is copied into the stage on its first
 * change, so a change in one stage never silently changes another.
 */
export const SHARED_RULE_KEYS: ReadonlySet<string> = new Set([
  "stage_fit",
  "geography_fit",
  "sector_fit",
]);

/**
 * Changes one rule (found by identity: the rows `gatesOf` gave). Another shared rule than the
 * three above becomes the stage's own copy (same key, so it replaces the shared one for the stage).
 */
export function patchGate(
  value: EditorState,
  target: StageGate,
  patch: Partial<Pick<StageGate, "label" | "description" | "treatment">>,
  stage?: SetupStage,
): EditorState {
  if (stage && !target.stage && !SHARED_RULE_KEYS.has(target.key)) {
    return {
      ...value,
      gates: [...value.gates, { ...target, ...patch, stage }],
      setup: setupOf(value),
    };
  }
  return {
    ...value,
    gates: value.gates.map((gate) => (gate === target ? { ...gate, ...patch } : gate)),
    ...(target.stage ? { setup: setupOf(value) } : {}),
  };
}

/** Removes one rule. */
export function withoutGate(value: EditorState, target: StageGate): EditorState {
  return { ...value, gates: value.gates.filter((gate) => gate !== target) };
}

/** Puts a removed rule back where it was (the "Fortryd" next to a removal). */
export function withGateAt(value: EditorState, gate: StageGate, index: number): EditorState {
  const gates = [...value.gates];
  gates.splice(Math.min(index, gates.length), 0, gate);
  return { ...value, gates, ...(gate.stage ? { setup: setupOf(value) } : {}) };
}

/** A new rule of the stage's own, at the end. */
export function withStageGate(
  value: EditorState,
  stage: SetupStage,
  gate: Omit<StageGate, "stage">,
): EditorState {
  return { ...value, gates: [...value.gates, { ...gate, stage }], setup: setupOf(value) };
}

/** A key for a new rule or criterion that no other row of the same stage has. */
export function freeKey(
  base: string,
  rows: ReadonlyArray<{ key: string; stage?: string | null | undefined }>,
  stage: SetupStage,
): string {
  const taken = new Set(
    rows.filter((row) => !row.stage || row.stage === stage).map((row) => row.key),
  );
  // After the highest number in use, so a number is not reused (an undo can bring a rule back).
  let n = rows.length + 1;
  for (const key of taken) {
    const match = new RegExp(`^${base}_(\\d+)$`).exec(key);
    if (match) n = Math.max(n, Number(match[1]) + 1);
  }
  while (taken.has(`${base}_${n}`)) n += 1;
  return `${base}_${n}`;
}

// ---------------------------------------------------------------------------
// Threshold, economy
// ---------------------------------------------------------------------------

/** The stage's own threshold for deep analysis, else the mandate's. */
export function thresholdOf(value: EditorState, stage: SetupStage): number {
  return value.setup?.stages?.[stage]?.threshold ?? value.analysisThreshold;
}

function withStagePart(
  value: EditorState,
  stage: SetupStage,
  change: (own: StageSetupInput) => StageSetupInput,
): EditorState {
  const setup = setupOf(value);
  return {
    ...value,
    setup: {
      ...setup,
      stages: { ...setup.stages, [stage]: change(setup.stages?.[stage] ?? {}) },
    },
  };
}

export function withThreshold(value: EditorState, stage: SetupStage, threshold: number) {
  const next = Math.min(100, Math.max(0, Math.round(threshold)));
  return withStagePart(value, stage, (own) => ({ ...own, threshold: next }));
}

/** The stage's economy with the stage's standard where nothing is saved. */
export function economyOf(value: EditorState, stage: SetupStage): EconomySetup {
  return readEconomySetup(value.setup?.stages?.[stage]?.economy, stage);
}

type StoredEconomy = NonNullable<StageSetupInput["economy"]>;

function withEconomy(
  value: EditorState,
  stage: SetupStage,
  change: (economy: StoredEconomy) => StoredEconomy,
): EditorState {
  return withStagePart(value, stage, (own) => ({ ...own, economy: change(own.economy ?? {}) }));
}

/** One point switched on or off, or its limit changed. */
export function withEconomyPoint(
  value: EditorState,
  stage: SetupStage,
  key: string,
  patch: { on?: boolean; threshold?: number },
): EditorState {
  return withEconomy(value, stage, (economy) => ({
    ...economy,
    points: { ...economy.points, [key]: { ...economy.points?.[key as never], ...patch } },
  }));
}

export function withEconomyMissing(value: EditorState, stage: SetupStage, missing: MissingMode) {
  return withEconomy(value, stage, (economy) => ({ ...economy, missing }));
}

/** The own questions (only those with text; a blank row lives in the editor until it is written). */
export function withEconomyQuestions(
  value: EditorState,
  stage: SetupStage,
  questions: ReadonlyArray<{ text: string; answer: OwnQuestionAnswer }>,
): EditorState {
  const kept = questions
    .map((question) => ({ text: question.text.trim(), answer: question.answer }))
    .filter((question) => question.text)
    .slice(0, MAX_OWN_ECONOMY_QUESTIONS);
  return withEconomy(value, stage, (economy) => {
    const { questions: _old, ...rest } = economy;
    return kept.length ? { ...rest, questions: kept } : rest;
  });
}

// ---------------------------------------------------------------------------
// The 9 editable fixed rules
// ---------------------------------------------------------------------------

/** The text of a fixed rule now: the team's edit, else the standard text. */
export function fixedRuleNow(value: EditorState, id: string, language: Language): string {
  const own = isEditableFixedRule(id) ? value.setup?.fixedRules?.[id] : undefined;
  return own ?? fixedRuleDefault(id as never, language);
}

/** True when the team has changed the rule from its standard text. */
export function fixedRuleChanged(value: EditorState, id: string): boolean {
  return isEditableFixedRule(id) && typeof value.setup?.fixedRules?.[id] === "string";
}

/**
 * Writes one rule's text. The standard text (or nothing) removes the key ("Nulstil"), so the
 * stored setup only holds what differs. Returns the state unchanged for a locked rule.
 */
export function withFixedRule(
  value: EditorState,
  id: string,
  text: string | null,
  language: Language,
): EditorState {
  if (!isEditableFixedRule(id)) return value;
  const setup = setupOf(value);
  const { [id as EditableFixedRuleId]: _old, ...others } = setup.fixedRules ?? {};
  const trimmed = text?.trim() ?? "";
  const isStandard = trimmed === fixedRuleDefault(id, language).trim();
  const fixedRules = !trimmed || isStandard ? others : { ...others, [id]: trimmed };
  const { fixedRules: _all, ...rest } = setup;
  return {
    ...value,
    setup: Object.keys(fixedRules).length ? { ...rest, fixedRules } : rest,
  };
}
