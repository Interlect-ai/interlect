/**
 * What a Ja and a Fortryd do to the editor (the prototype's `propText`, `propCritAdd`,
 * `propRuleAdd`, `propRuleMode`, `propFinToggle`, `propFinTh`, `propFinQ`).
 *
 * `applyChange` gives the editor's next state and an undo. The undo works on the state as it is
 * when Fortryd is pressed (other edits may have happened since): it puts back only what the change
 * touched, and gives null when that is gone (a removed criterion), so the page can say so.
 * A focus area belongs to the open specialist sheet, not to the editor: `applyFocusChange` works
 * on that sheet's list the same way.
 *
 * Pure file without a database, so it can be tested with node --test.
 */
import type { SetupStage } from "../analysis/setup-stage.ts";
import type { SaveFundConfigInput } from "./config.functions.ts";
import { normalizeWeights, weightsWithNewCriterion } from "./editor-rules.ts";
import { MAX_OWN_ECONOMY_QUESTIONS } from "./economy-points.ts";
import type { SpecialistFocus } from "./stage-specialists.ts";
import {
  criteriaOf,
  economyOf,
  SHARED_RULE_KEYS,
  freeKey,
  gatesOf,
  patchGate,
  withEconomyQuestions,
  withStageCriteria,
  withStageGate,
  type StageCriterion,
  type StageGate,
} from "./stage-editor.ts";
import type { AssistantChange } from "./setup-assistant.ts";

type EditorState = SaveFundConfigInput;

export interface ApplyContext {
  /** The stage on screen; null when the team has chosen no stage. */
  stage: SetupStage | null;
  /** The team's own word for the stage (`stageExpectations` is keyed by it). */
  rawStage: string | undefined;
  /**
   * A focus area text change: the focus area's name when the proposal was made, so a Ja on a list
   * that has moved since never writes into another focus area.
   */
  focusTitle?: string | undefined;
}

export interface Applied<T> {
  next: T;
  /** Puts back what the change touched; null when it can no longer be put back. */
  undo: (current: T) => T | null;
  /** The new criterion's or rule's key (so the page can open it). */
  createdKey?: string;
}

function withAbout(value: EditorState, text: string): EditorState {
  const setup = { ...value.setup, about: text };
  const { setup: _old, ...rest } = value;
  // As ThesisFrame: an empty "Hvem er I" on a version without anything per stage sends no setup.
  const onlyAbout = Object.keys(setup).every((key) => key === "about");
  return !text && onlyAbout ? rest : { ...value, setup };
}

type StoredPoint = { on?: boolean; threshold?: number } | undefined;

function storedPoint(value: EditorState, stage: SetupStage, key: string): StoredPoint {
  const points = value.setup?.stages?.[stage]?.economy?.points as
    Record<string, StoredPoint> | undefined;
  return points?.[key];
}

/** One point's stored record set as it was (undefined removes it, so it is the standard again). */
function withStoredPoint(
  value: EditorState,
  stage: SetupStage,
  key: string,
  point: StoredPoint,
): EditorState {
  const setup = value.setup ?? {};
  const own = setup.stages?.[stage] ?? {};
  const economy = own.economy ?? {};
  const { [key as never]: _old, ...others } = (economy.points ?? {}) as Record<string, unknown>;
  const points = point ? { ...others, [key]: point } : others;
  return {
    ...value,
    setup: {
      ...setup,
      stages: { ...setup.stages, [stage]: { ...own, economy: { ...economy, points } } },
    },
  };
}

function patchCriterion(
  value: EditorState,
  stage: SetupStage,
  key: string,
  patch: Partial<StageCriterion>,
): EditorState | null {
  const criteria = criteriaOf(value, stage);
  if (!criteria.some((criterion) => criterion.key === key)) return null;
  return withStageCriteria(
    value,
    stage,
    criteria.map((criterion) => (criterion.key === key ? { ...criterion, ...patch } : criterion)),
  );
}

function patchRule(
  value: EditorState,
  stage: SetupStage | null,
  key: string,
  patch: { description?: string; treatment?: "hard" | "review" },
): EditorState | null {
  // Without a stage only the shared rules exist (and only they can be changed).
  const rules = stage ? gatesOf(value, stage) : value.gates.filter((gate) => !gate.stage);
  const gate = rules.find((entry) => entry.key === key);
  if (!gate) return null;
  return patchGate(value, gate, patch, stage ?? undefined);
}

function ruleOf(value: EditorState, stage: SetupStage | null, key: string) {
  const rules = stage ? gatesOf(value, stage) : value.gates.filter((gate) => !gate.stage);
  return rules.find((entry) => entry.key === key);
}

/**
 * Puts a rule back. When the Ja made a stage's own copy of a shared rule (patchGate), the copy is
 * removed again, so the stage follows the shared rule as before; otherwise the field is patched.
 */
function restoreRule(
  current: EditorState,
  original: StageGate,
  stage: SetupStage | null,
  patch: { description?: string; treatment?: "hard" | "review" },
): EditorState | null {
  if (stage && !original.stage && !SHARED_RULE_KEYS.has(original.key)) {
    const copy = current.gates.some((gate) => gate.key === original.key && gate.stage === stage);
    if (copy) {
      return {
        ...current,
        gates: current.gates.filter((gate) => !(gate.key === original.key && gate.stage === stage)),
      };
    }
  }
  return patchRule(current, stage, original.key, patch);
}

/** The editor's state with the change made, and its undo; null when the change does not fit. */
export function applyChange(
  value: EditorState,
  change: AssistantChange,
  context: ApplyContext,
): Applied<EditorState> | null {
  const { stage, rawStage } = context;
  switch (change.kind) {
    case "text": {
      const target = change.target;
      if (target === "thesis") {
        const before = value.thesis;
        return {
          next: { ...value, thesis: change.text },
          // Only while the field still holds the proposal: later typing is never thrown away.
          undo: (current) =>
            current.thesis === change.text ? { ...current, thesis: before } : null,
        };
      }
      if (target === "about") {
        const before = value.setup?.about ?? "";
        return {
          next: withAbout(value, change.text),
          undo: (current) =>
            (current.setup?.about ?? "") === change.text ? withAbout(current, before) : null,
        };
      }
      if (target === "expectation") {
        if (!rawStage) return null;
        const before = value.stageExpectations[rawStage] ?? "";
        const set = (current: EditorState, text: string): EditorState => ({
          ...current,
          stageExpectations: { ...current.stageExpectations, [rawStage]: text },
        });
        return {
          next: set(value, change.text),
          undo: (current) =>
            (current.stageExpectations[rawStage] ?? "") === change.text
              ? set(current, before)
              : null,
        };
      }
      if (target.startsWith("criterion:") && stage) {
        const key = target.slice("criterion:".length);
        const before = criteriaOf(value, stage).find((c) => c.key === key)?.description;
        const next = patchCriterion(value, stage, key, { description: change.text });
        if (!next || before === undefined) return null;
        return {
          next,
          undo: (current) =>
            criteriaOf(current, stage).find((c) => c.key === key)?.description === change.text
              ? patchCriterion(current, stage, key, { description: before })
              : null,
        };
      }
      if (target.startsWith("rule:")) {
        const key = target.slice("rule:".length);
        const gate = ruleOf(value, stage, key);
        const next = patchRule(value, stage, key, { description: change.text });
        if (!next || !gate) return null;
        return {
          next,
          undo: (current) =>
            ruleOf(current, stage, key)?.description === change.text
              ? restoreRule(current, gate, stage, { description: gate.description })
              : null,
        };
      }
      return null;
    }
    case "add_criterion": {
      if (!stage) return null;
      const criteria = criteriaOf(value, stage);
      const weights = weightsWithNewCriterion(criteria.map((criterion) => criterion.weight));
      const before = new Map(criteria.map((criterion) => [criterion.key, criterion.weight]));
      const key = freeKey("criterion", value.criteria, stage);
      const next = withStageCriteria(value, stage, [
        ...criteria.map((item, i) => ({ ...item, weight: weights[i] ?? item.weight })),
        {
          key,
          label: change.label,
          description: change.description,
          category: "fund_thesis_fit",
          weight: weights[criteria.length] ?? 5,
        },
      ]);
      return {
        next,
        createdKey: key,
        undo: (current) => {
          const now = criteriaOf(current, stage);
          if (!now.some((criterion) => criterion.key === key)) return null;
          const rest = now.filter((criterion) => criterion.key !== key);
          // The same criteria as before the Ja: their weights as they were; else spread to 100.
          const same =
            rest.length === before.size && rest.every((criterion) => before.has(criterion.key));
          const spread = normalizeWeights(rest.map((criterion) => criterion.weight));
          return withStageCriteria(
            current,
            stage,
            rest.map((criterion, i) => ({
              ...criterion,
              weight: same
                ? (before.get(criterion.key) ?? criterion.weight)
                : (spread[i] ?? criterion.weight),
            })),
          );
        },
      };
    }
    case "add_rule": {
      if (!stage) return null;
      const key = freeKey("rule", value.gates, stage);
      const next = withStageGate(value, stage, {
        key,
        label: change.label,
        description: change.description,
        treatment: "review",
      });
      return {
        next,
        createdKey: key,
        undo: (current) => {
          const found = current.gates.some((gate) => gate.key === key && gate.stage === stage);
          if (!found) return null;
          return {
            ...current,
            gates: current.gates.filter((gate) => !(gate.key === key && gate.stage === stage)),
          };
        },
      };
    }
    case "rule_treatment": {
      const gate = ruleOf(value, stage, change.ruleKey);
      const next = patchRule(value, stage, change.ruleKey, { treatment: change.treatment });
      if (!next || !gate) return null;
      return {
        next,
        undo: (current) =>
          ruleOf(current, stage, change.ruleKey)?.treatment === change.treatment
            ? restoreRule(current, gate, stage, { treatment: gate.treatment })
            : null,
      };
    }
    case "economy_on":
    case "economy_limit": {
      if (!stage) return null;
      const keys = change.kind === "economy_on" ? change.points : [change.point];
      const before = new Map(keys.map((key) => [key, storedPoint(value, stage, key)]));
      const written = new Map<string, StoredPoint>();
      let next = value;
      for (const key of keys) {
        const point = storedPoint(next, stage, key);
        next = withStoredPoint(
          next,
          stage,
          key,
          change.kind === "economy_on"
            ? { ...point, on: change.on }
            : { ...point, on: true, threshold: change.value },
        );
        written.set(key, storedPoint(next, stage, key));
      }
      return {
        next,
        undo: (current) => {
          // Only points that still hold what the Ja wrote (a limit set by hand since is kept).
          const same = (a: StoredPoint, b: StoredPoint) => JSON.stringify(a) === JSON.stringify(b);
          const untouched = keys.filter((key) =>
            same(storedPoint(current, stage, key), written.get(key)),
          );
          if (!untouched.length) return null;
          let restored = current;
          for (const key of untouched) {
            restored = withStoredPoint(restored, stage, key, before.get(key));
          }
          return restored;
        },
      };
    }
    case "add_questions": {
      if (!stage) return null;
      const existing = economyOf(value, stage).questions.map((question) => ({
        text: question.text,
        answer: question.answer,
      }));
      if (existing.length + change.questions.length > MAX_OWN_ECONOMY_QUESTIONS) return null;
      const added = change.questions.map((question) => question.text.trim());
      return {
        next: withEconomyQuestions(value, stage, [...existing, ...change.questions]),
        undo: (current) => {
          const left = [...added];
          const now = economyOf(current, stage).questions;
          const kept = now.filter((question) => {
            const at = left.indexOf(question.text.trim());
            if (at < 0) return true;
            left.splice(at, 1);
            return false;
          });
          if (kept.length === now.length) return null;
          return withEconomyQuestions(
            current,
            stage,
            kept.map((question) => ({ text: question.text, answer: question.answer })),
          );
        },
      };
    }
    case "add_focus":
      return null;
  }
}

/** A focus area change on the open specialist sheet's list, and its undo. */
export function applyFocusChange(
  foci: readonly SpecialistFocus[],
  change: AssistantChange,
  focusTitle?: string,
): Applied<SpecialistFocus[]> | null {
  if (change.kind === "add_focus") {
    const added: SpecialistFocus = { title: change.title, text: change.text, evidence: "" };
    return {
      next: [...foci, added],
      createdKey: String(foci.length),
      undo: (current) => {
        const at = current.findIndex(
          (focus) => focus.title === added.title && focus.text === added.text,
        );
        return at < 0 ? null : current.filter((_, i) => i !== at);
      },
    };
  }
  if (change.kind === "text" && change.target.startsWith("focus:")) {
    const index = Number(change.target.slice("focus:".length));
    const focus = foci[index];
    // The list moved since the proposal: never write into another focus area.
    if (!focus || (focusTitle !== undefined && focus.title !== focusTitle)) return null;
    const before = focus.text;
    const title = focus.title;
    return {
      next: foci.map((item, i) => (i === index ? { ...item, text: change.text } : item)),
      undo: (current) => {
        // The same place, or the one with the same name if the list moved.
        const at =
          current[index]?.title === title ? index : current.findIndex((f) => f.title === title);
        if (at < 0 || current[at]!.text !== change.text) return null;
        return current.map((item, i) => (i === at ? { ...item, text: before } : item));
      },
    };
  }
  return null;
}

/** True when the change works on the open specialist sheet rather than the editor. */
export function isFocusChange(change: AssistantChange): boolean {
  return (
    change.kind === "add_focus" || (change.kind === "text" && change.target.startsWith("focus:"))
  );
}
