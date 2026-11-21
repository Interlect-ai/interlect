/**
 * Batch 3: the pure rules behind the editing flow ("Redigér"): how a weight slider
 * redistributes the others, which steps are done and what still blocks a publish, when a step
 * change autosaves, and how a removed gate is put back by "Fortryd". Pure file (no React, no
 * database), so it can be tested with node --test. The limits themselves live in config-limits.ts
 * and are enforced again by the server and the database; this file only makes the editor behave.
 */
import {
  WEIGHT_MAX_PERCENT,
  WEIGHT_MIN_PERCENT,
  WEIGHT_TOTAL_PERCENT,
  checkConfigLimits,
  type LimitViolation,
} from "./config-limits.ts";
import { ticketExceedsFund } from "./fund-size.ts";
import { translate, type MessageKey } from "../i18n/translate.ts";
import type { Language } from "../i18n/language.ts";

const round1 = (value: number) => Math.round(value * 10) / 10;

// ---------------------------------------------------------------------------
// Weights
// ---------------------------------------------------------------------------

/**
 * Splits `total` between the items proportionally to `base`, each within 5-40 % (pinned at the
 * limit when the proportional share falls outside it; the rest share what is left). One decimal;
 * the rounding residue goes on the item with the most room. Used for all 100 % (normalise) and for
 * "the others" when one slider is held.
 */
function shareWithinLimits(base: readonly number[], total: number): number[] {
  const count = base.length;
  if (count === 0) return [];
  const weights = base.map((weight) => (Number.isFinite(weight) && weight > 0 ? weight : 0));
  const fixed = new Map<number, number>();
  for (let pass = 0; pass <= count; pass += 1) {
    const pinned = [...fixed.values()].reduce((sum, value) => sum + value, 0);
    const free = weights.map((_, i) => i).filter((i) => !fixed.has(i));
    const freeSum = free.reduce((sum, i) => sum + weights[i]!, 0);
    const room = total - pinned;
    const valueOf = (i: number) =>
      freeSum > 0 ? (weights[i]! / freeSum) * room : room / free.length;
    let changed = false;
    for (const i of free) {
      const value = valueOf(i);
      if (value < WEIGHT_MIN_PERCENT) {
        fixed.set(i, WEIGHT_MIN_PERCENT);
        changed = true;
      } else if (value > WEIGHT_MAX_PERCENT) {
        fixed.set(i, WEIGHT_MAX_PERCENT);
        changed = true;
      }
    }
    if (!changed) {
      const result = weights.map((_, i) => (fixed.has(i) ? fixed.get(i)! : round1(valueOf(i))));
      return fixRounding(result, total);
    }
  }
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  return fixRounding(
    weights.map((weight) => round1((weight / sum) * total)),
    total,
  );
}

/** Puts the rounding residue (a tenth or two) on the weight with the most room. */
function fixRounding(weights: number[], total: number): number[] {
  const result = [...weights];
  let diff = round1(total - result.reduce((sum, weight) => sum + weight, 0));
  if (diff === 0) return result;
  const order = result
    .map((weight, index) => ({ weight, index }))
    .sort((a, b) => (diff > 0 ? a.weight - b.weight : b.weight - a.weight));
  for (const { index } of order) {
    const candidate = round1(result[index]! + diff);
    if (candidate >= WEIGHT_MIN_PERCENT && candidate <= WEIGHT_MAX_PERCENT) {
      result[index] = candidate;
      diff = 0;
      break;
    }
  }
  if (diff !== 0) result[0] = round1(result[0]! + diff);
  return result;
}

/**
 * Scales `weights` proportionally so they sum to 100, every one within 5-40 %. When the limits
 * cannot be met (fewer than three or more than twenty criteria) the plain proportional split is
 * returned, so the editor still shows the sum and the server refuses the publish.
 */
export function normalizeWeights(weights: readonly number[]): number[] {
  const count = weights.length;
  if (count === 0) return [];
  const feasible =
    count * WEIGHT_MIN_PERCENT <= WEIGHT_TOTAL_PERCENT &&
    count * WEIGHT_MAX_PERCENT >= WEIGHT_TOTAL_PERCENT;
  if (feasible) return shareWithinLimits(weights, WEIGHT_TOTAL_PERCENT);
  const sum = weights.reduce((acc, weight) => acc + Math.max(weight, 0), 0);
  return fixRounding(
    weights.map((weight) =>
      round1(
        sum > 0 ? (Math.max(weight, 0) / sum) * WEIGHT_TOTAL_PERCENT : WEIGHT_TOTAL_PERCENT / count,
      ),
    ),
    WEIGHT_TOTAL_PERCENT,
  );
}

/**
 * One slider moved: `index` gets `next` (kept within 5-40 % and within what the others can
 * absorb), and the rest are scaled proportionally so the sum stays 100 ("Vægtning").
 */
export function redistributeWeights(weights: readonly number[], index: number, next: number) {
  const count = weights.length;
  if (index < 0 || index >= count) return [...weights];
  if (count === 1) return [WEIGHT_TOTAL_PERCENT];
  const lowest = Math.max(
    WEIGHT_MIN_PERCENT,
    WEIGHT_TOTAL_PERCENT - (count - 1) * WEIGHT_MAX_PERCENT,
  );
  const highest = Math.min(
    WEIGHT_MAX_PERCENT,
    WEIGHT_TOTAL_PERCENT - (count - 1) * WEIGHT_MIN_PERCENT,
  );
  const wanted = Number.isFinite(next) ? next : weights[index]!;
  // Impossible limits (too few or too many criteria): do not clamp; the server refuses the publish.
  const possible = highest >= lowest;
  const chosen = possible ? round1(Math.min(highest, Math.max(lowest, wanted))) : round1(wanted);
  const otherIndexes = weights.map((_, i) => i).filter((i) => i !== index);
  const others = possible
    ? shareWithinLimits(
        otherIndexes.map((i) => weights[i]!),
        WEIGHT_TOTAL_PERCENT - chosen,
      )
    : otherIndexes.map((i) => weights[i]!);
  return weights.map((_, i) => (i === index ? chosen : others[otherIndexes.indexOf(i)]!));
}

/** The weights after a criterion is added: it gets an equal share and the others give way. */
export function weightsWithNewCriterion(weights: readonly number[]): number[] {
  const count = weights.length + 1;
  const share = Math.min(
    WEIGHT_MAX_PERCENT,
    Math.max(WEIGHT_MIN_PERCENT, round1(WEIGHT_TOTAL_PERCENT / count)),
  );
  return redistributeWeights([...weights, share], count - 1, share);
}

/** The weights after the criterion at `index` is removed: the rest scale up to 100. */
export function weightsWithoutCriterion(weights: readonly number[], index: number): number[] {
  return normalizeWeights(weights.filter((_, i) => i !== index));
}

export function weightTotal(weights: readonly number[]): number {
  return round1(weights.reduce((sum, weight) => sum + weight, 0));
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

export type GuideStepKey =
  "start" | "basis" | "thesis" | "weights" | "mandate" | "screening" | "specialists" | "publish";

export interface EditableDraft {
  fundName: string;
  thesis: string;
  stages: string[];
  geographies: string[];
  sectors: string[];
  riskPosture: string;
  /**
   * "Hvem er I, og hvordan tænker I?" (`setup.about`). Filled, it replaces the risk lens,
   * so the risk text is then not required (the server's rule).
   */
  setup?: { about?: string | undefined } | undefined;
  fundSizeEur: number | null;
  ticketMinEur: number | null;
  ticketMaxEur: number | null;
  analysisThreshold: number;
  gates: Array<{ key: string; label: string; description: string }>;
  criteria: Array<{ key: string; label: string; description: string; weight: number }>;
}

export interface StepStatus {
  done: Record<GuideStepKey, boolean>;
  /** What still blocks a publish, in plain Danish, for the last step. Empty when it can be published. */
  missing: string[];
  /** The draft can be published (every step that is required is done and the limits hold). */
  valid: boolean;
  /** The draft can be saved (autosave and "Gem kladde"). */
  canSave: boolean;
  ticketTooLarge: boolean;
  limitViolations: LimitViolation[];
  /**
   * Two criteria or two rules with the same key: the database would refuse the save, so the editor
   * does not try and says which names collide instead. Plain Danish, empty when there is none.
   */
  keyConflicts: string[];
}

/**
 * The labels of the items whose key another item of the same stage also has (in the order they
 * appear). The key is only unique within a stage: two stages may both have
 * "founder_market_fit".
 */
export function duplicateKeyLabels(
  items: ReadonlyArray<{ key: string; label: string; stage?: string | null | undefined }>,
): string[] {
  const slot = (item: { key: string; stage?: string | null | undefined }) =>
    `${item.stage ?? ""}\u0000${item.key}`;
  const count = new Map<string, number>();
  for (const item of items) count.set(slot(item), (count.get(slot(item)) ?? 0) + 1);
  return items
    .filter((item) => (count.get(slot(item)) ?? 0) > 1)
    .map((item) => item.label.trim() || item.key);
}

/**
 * Which steps are done and what blocks a publish. `visited` only matters for the two steps that
 * have nothing required in them (Start and the optional specialist step).
 */
export function stepStatus(
  draft: EditableDraft,
  visited: ReadonlySet<GuideStepKey>,
  language: Language = "da",
): StepStatus {
  const ticketTooLarge = ticketExceedsFund(
    draft.fundSizeEur,
    draft.ticketMinEur,
    draft.ticketMaxEur,
  );
  const limitViolations = checkConfigLimits(
    {
      criteria: draft.criteria,
      gates: draft.gates,
      analysisThreshold: draft.analysisThreshold,
    },
    language,
  );
  const criteriaTexts = Boolean(
    draft.criteria.length &&
    draft.criteria.every((criterion) => criterion.label.trim() && criterion.description.trim()),
  );
  const gatesValid = Boolean(
    draft.gates.length && draft.gates.every((gate) => gate.label.trim() && gate.description.trim()),
  );
  const weightsOk = limitViolations.length === 0;
  const criterionClashes = duplicateKeyLabels(draft.criteria);
  const gateClashes = duplicateKeyLabels(draft.gates);
  const keyConflicts = [
    ...(criterionClashes.length
      ? [
          translate(language, "fundEditor.rules.criterionClash", {
            names: [...new Set(criterionClashes)].join(", "),
          }),
        ]
      : []),
    ...(gateClashes.length
      ? [
          translate(language, "fundEditor.rules.gateClash", {
            names: [...new Set(gateClashes)].join(", "),
          }),
        ]
      : []),
  ];
  const hasAbout = Boolean(draft.setup?.about?.trim());
  const done: Record<GuideStepKey, boolean> = {
    start: visited.has("basis"),
    basis: Boolean(
      draft.fundName.trim() &&
      draft.stages.length &&
      draft.geographies.length &&
      draft.sectors.length &&
      !ticketTooLarge,
    ),
    thesis: Boolean(draft.thesis.trim() && (draft.riskPosture.trim() || hasAbout)),
    weights: weightsOk && criteriaTexts && criterionClashes.length === 0,
    mandate: gatesValid && gateClashes.length === 0,
    screening: visited.has("screening"),
    specialists: visited.has("specialists"),
    publish: false,
  };
  const missing: string[] = [];
  const say = (key: MessageKey) => translate(language, key);
  if (!draft.fundName.trim()) missing.push(say("fundEditor.rules.missingName"));
  if (!draft.thesis.trim()) missing.push(say("fundEditor.rules.missingThesis"));
  if (!draft.stages.length) missing.push(say("fundEditor.rules.missingStages"));
  if (!draft.geographies.length) missing.push(say("fundEditor.rules.missingGeographies"));
  if (!draft.sectors.length) missing.push(say("fundEditor.rules.missingSectors"));
  if (!draft.riskPosture.trim() && !hasAbout) missing.push(say("fundEditor.rules.missingRisk"));
  if (!gatesValid) missing.push(say("fundEditor.rules.missingGate"));
  if (!criteriaTexts) missing.push(say("fundEditor.rules.missingCriterionTexts"));
  for (const violation of limitViolations) missing.push(violation.message);
  if (ticketTooLarge) missing.push(say("fundEditor.rules.ticketTooLarge"));
  missing.push(...keyConflicts);
  const valid = missing.length === 0;
  done.publish = valid;
  return {
    done,
    missing,
    valid,
    canSave: Boolean(draft.fundName.trim()) && !ticketTooLarge && keyConflicts.length === 0,
    ticketTooLarge,
    limitViolations,
    keyConflicts,
  };
}

/**
 * The key for a criterion or rule whose name is `label`, unique among `otherKeys` (the keys of
 * every other item in the same list). The slug of the name, or `fallback` when the name has no
 * letters; a clash gets "_2", "_3" … so two items with the same name never share a key.
 */
export function uniqueKey(label: string, fallback: string, otherKeys: Iterable<string>): string {
  const taken = new Set(otherKeys);
  const base =
    label
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 76) || fallback;
  if (!taken.has(base)) return base;
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${base}_${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}_${taken.size + 1}`;
}

/**
 * Unsaved edits that were kept aside (another fund was chosen) laid onto the newest draft: only
 * the fields the person changed against the copy they started from come from the kept form; every
 * other field comes from the server, so a teammate's or a proposal's newer change is not reverted.
 */
export function mergeKeptEdits<T extends object>(server: T, kept: T, base: T): T {
  const result = { ...server };
  for (const key of Object.keys(kept) as Array<keyof T>) {
    if (JSON.stringify(kept[key]) !== JSON.stringify(base[key])) result[key] = kept[key];
  }
  return result;
}

/** The items with every repeated key made unique (the first keeps its key), e.g. after an import. */
export function withUniqueKeys<T extends { key: string; label: string }>(items: readonly T[]): T[] {
  // Every key some item already has is taken, so a renamed duplicate never takes a later item's
  // key (e.g. a basis or finance rule's fixed key).
  const taken = new Set(items.map((item) => item.key));
  const used = new Set<string>();
  return items.map((item) => {
    const clipped = item.key.slice(0, 80);
    const key = used.has(clipped)
      ? uniqueKey(item.label, clipped.slice(0, 76), new Set([...taken, ...used]))
      : clipped;
    used.add(key);
    taken.add(key);
    return key === item.key ? item : { ...item, key };
  });
}

// ---------------------------------------------------------------------------
// Autosave
// ---------------------------------------------------------------------------

/**
 * Autosave happens when the user moves to another step, the draft can be saved, nothing is
 * being saved right now, and the draft has changed since the last save. Never on a click that
 * stays on the same step, and never for an unchanged draft (no pointless versions in the log).
 */
export function shouldAutosave(input: {
  canSave: boolean;
  busy: boolean;
  fromStep: number;
  toStep: number;
  snapshot: string;
  lastSavedSnapshot: string;
}): boolean {
  return (
    input.canSave &&
    !input.busy &&
    input.fromStep !== input.toStep &&
    input.snapshot !== input.lastSavedSnapshot
  );
}

// ---------------------------------------------------------------------------
// Gates: remove with "Fortryd"
// ---------------------------------------------------------------------------

export interface RemovedItem<T> {
  item: T;
  index: number;
}

/** The list without the item at `index`, and what is needed to put it back. */
export function removeWithUndo<T>(
  items: readonly T[],
  index: number,
): { items: T[]; removed: RemovedItem<T> } | null {
  const item = items[index];
  if (item === undefined) return null;
  return { items: items.filter((_, i) => i !== index), removed: { item, index } };
}

/** Puts a removed item back where it was (or last, when the list has become shorter). Not twice. */
export function restoreItem<T>(
  items: readonly T[],
  removed: RemovedItem<T>,
  sameKey: (a: T, b: T) => boolean,
): T[] {
  if (items.some((existing) => sameKey(existing, removed.item))) return [...items];
  const at = Math.min(Math.max(removed.index, 0), items.length);
  return [...items.slice(0, at), removed.item, ...items.slice(at)];
}

// ---------------------------------------------------------------------------
// Gates: the builder ("Tilføj gate": type + value)
// ---------------------------------------------------------------------------

export const GATE_BUILDER_TYPES = [
  {
    id: "geography",
    labelKey: "fundEditor.rules.builder.geography.label",
    valueLabelKey: "fundEditor.rules.builder.geography.value",
  },
  {
    id: "stage",
    labelKey: "fundEditor.rules.builder.stage.label",
    valueLabelKey: "fundEditor.rules.builder.stage.value",
  },
  {
    id: "ticket",
    labelKey: "fundEditor.rules.builder.ticket.label",
    valueLabelKey: "fundEditor.rules.builder.ticket.value",
  },
  {
    id: "sector",
    labelKey: "fundEditor.rules.builder.sector.label",
    valueLabelKey: "fundEditor.rules.builder.sector.value",
  },
  {
    id: "ownership",
    labelKey: "fundEditor.rules.builder.ownership.label",
    valueLabelKey: "fundEditor.rules.builder.ownership.value",
  },
  {
    id: "custom",
    labelKey: "fundEditor.rules.builder.custom.label",
    valueLabelKey: "fundEditor.rules.builder.custom.value",
  },
] as const satisfies ReadonlyArray<{ id: string; labelKey: MessageKey; valueLabelKey: MessageKey }>;
export type GateBuilderType = (typeof GATE_BUILDER_TYPES)[number]["id"];

const BUILDER_TEXT: Record<
  Exclude<GateBuilderType, "custom">,
  { label: MessageKey; description: MessageKey }
> = {
  geography: {
    label: "fundEditor.gateText.geographyLabel",
    description: "fundEditor.gateText.geographyDescription",
  },
  stage: {
    label: "fundEditor.gateText.stageLabel",
    description: "fundEditor.gateText.stageDescription",
  },
  ticket: {
    label: "fundEditor.gateText.ticketLabel",
    description: "fundEditor.gateText.ticketDescription",
  },
  sector: {
    label: "fundEditor.gateText.sectorLabel",
    description: "fundEditor.gateText.sectorDescription",
  },
  ownership: {
    label: "fundEditor.gateText.ownershipLabel",
    description: "fundEditor.gateText.ownershipDescription",
  },
};

/**
 * The rule text for a builder type and a value, in the language of the page (it is saved in the
 * fund's setup, so an English fund gets English rules). Always "review" first: a human
 * can sharpen it.
 */
export function gateFromBuilder(
  type: GateBuilderType,
  value: string,
  language: Language = "da",
): { label: string; description: string; treatment: "review" } | null {
  const text = value.trim();
  if (!text) return null;
  const note = translate(language, "fundEditor.gateText.unknownNote");
  if (type === "custom") {
    return {
      label: text.length > 60 ? `${text.slice(0, 57).trimEnd()}…` : text,
      description: `${text.endsWith(".") ? text : `${text}.`} ${note}`,
      treatment: "review",
    };
  }
  const keys = BUILDER_TEXT[type];
  return {
    label: translate(language, keys.label),
    description: `${translate(language, keys.description, { value: text })} ${note}`,
    treatment: "review",
  };
}

/** A key for a new rule that is not in use (the key never changes once the rule exists). */
export function freeKey(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const slug =
    base
      .toLowerCase()
      .replace(/[æ]/g, "ae")
      .replace(/[ø]/g, "oe")
      .replace(/[å]/g, "aa")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 60) || "regel";
  const start = /^[a-z]/.test(slug) ? slug : `r_${slug}`;
  if (!used.has(start)) return start;
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${start}_${n}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${start}_${used.size + 1}`;
}
