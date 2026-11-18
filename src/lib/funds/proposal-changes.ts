import { screeningCardLabels, type ScreeningCardId } from "./screening-setup.ts";
import { translate, type MessageKey } from "../i18n/translate.ts";
import { LANGUAGE_TAGS, type Language } from "../i18n/language.ts";
import { geographyKeys, geographyText, stageKeys, stageText } from "./basis-labels.ts";

/**
 * Batch 3: what an AI proposal changes, field by field, for the diff the person sees before
 * "Læg i kladden" (the old value struck through, the new one in bold). Computed in
 * code from the draft before and after the proposal's edits, never written by the model. Pure
 * file, so it can be tested with node --test; the server fills it in when it lists proposals.
 */

/** The fields of a draft the proposal can touch (the structural subset of the save arguments). */
export interface ProposalDraft {
  thesis: string;
  riskPosture: string;
  analysisThreshold: number;
  stages: string[];
  geographies: string[];
  sectors: string[];
  dealbreakers: string[];
  gates: Array<{
    key: string;
    label: string;
    description: string;
    treatment: "hard" | "review";
  }>;
  criteria: Array<{
    key: string;
    label: string;
    description: string;
    category?: string;
    weight: number;
    codeAnchor?: boolean | undefined;
  }>;
  /** The fund's own screening; compared only when both drafts have it. */
  screeningInstruction?: string;
  screeningCards?: ScreeningCardId[];
}

export interface FieldChange {
  /** Stable within one proposal. */
  id: string;
  /** What changed: "Tesen", "Traction: vægt", "Mandatregel: Geografi". */
  label: string;
  /** The old value, or null when the thing is new. */
  before: string | null;
  /** The new value, or null when the thing is removed. */
  after: string | null;
  /** Long text (thesis, descriptions) is shown as two paragraphs, short values on one line. */
  long: boolean;
}

const TREATMENT_KEY = {
  hard: "fundSetup.proposal.treatmentHard",
  review: "fundSetup.proposal.treatmentReview",
} as const satisfies Record<string, MessageKey>;

function percent(value: number, language: Language): string {
  return `${value.toLocaleString(LANGUAGE_TAGS[language], { maximumFractionDigits: 1 })} %`;
}

function joined(items: string[], language: Language): string {
  return items.length ? items.join(", ") : translate(language, "fundSetup.proposal.none");
}

/** Every change between two drafts, in the order a reader meets them (tese, vægte, mandat). */
export function describeFieldChanges(
  before: ProposalDraft,
  after: ProposalDraft,
  language: Language = "da",
): FieldChange[] {
  const changes: FieldChange[] = [];
  const tr = (key: MessageKey, vars?: Record<string, string>) => translate(language, key, vars);
  const treatment = (value: "hard" | "review") => tr(TREATMENT_KEY[value]);
  const text = (id: string, label: string, old: string, next: string) => {
    if (old.trim() !== next.trim())
      changes.push({ id, label, before: old, after: next, long: true });
  };
  const value = (id: string, label: string, old: string | null, next: string | null) => {
    if (old !== next) changes.push({ id, label, before: old, after: next, long: false });
  };

  text("thesis", tr("fundSetup.proposal.thesis"), before.thesis, after.thesis);
  text("risk", tr("fundSetup.proposal.risk"), before.riskPosture, after.riskPosture);
  if (before.screeningInstruction !== undefined && after.screeningInstruction !== undefined) {
    const old = before.screeningInstruction.trim();
    const next = after.screeningInstruction.trim();
    if (old !== next) {
      changes.push({
        id: "screening-instruction",
        label: tr("fundSetup.proposal.screeningInstruction"),
        before: old || null,
        after: next || null,
        long: true,
      });
    }
  }
  if (before.screeningCards && after.screeningCards) {
    const old = joined(screeningCardLabels(before.screeningCards), language);
    const next = joined(screeningCardLabels(after.screeningCards), language);
    if (old !== next) {
      value("screening-cards", tr("fundSetup.proposal.screeningCards"), old, next);
    }
  }
  if (before.analysisThreshold !== after.analysisThreshold) {
    value(
      "threshold",
      tr("fundSetup.proposal.threshold"),
      String(before.analysisThreshold),
      String(after.analysisThreshold),
    );
  }
  // Stages and geographies are compared as keys and shown by name ("Serie A" and "series_a" are one
  // stage); sectors and deal-breakers as written.
  for (const [field, label, keys, show] of [
    [
      "stages",
      tr("fundSetup.proposal.stages"),
      stageKeys,
      (item: string) => stageText(item, language),
    ],
    [
      "geographies",
      tr("fundSetup.proposal.geographies"),
      geographyKeys,
      (item: string) => geographyText(item, language),
    ],
    ["sectors", tr("fundSetup.proposal.sectors"), null, null],
    ["dealbreakers", tr("fundSetup.proposal.dealbreakers"), null, null],
  ] as const) {
    const old = keys ? keys(before[field]) : before[field];
    const next = keys ? keys(after[field]) : after[field];
    if (JSON.stringify(old) !== JSON.stringify(next)) {
      const names = (items: string[]) => joined(show ? items.map(show) : items, language);
      value(field, label, names(old), names(next));
    }
  }

  const criteriaBefore = new Map(before.criteria.map((criterion) => [criterion.key, criterion]));
  const criteriaAfter = new Map(after.criteria.map((criterion) => [criterion.key, criterion]));
  for (const criterion of after.criteria) {
    const old = criteriaBefore.get(criterion.key);
    if (!old) {
      value(
        `criterion-new-${criterion.key}`,
        tr("fundSetup.proposal.newCriterion", { label: criterion.label }),
        null,
        percent(criterion.weight, language),
      );
      // What the analyses will read for the new criterion: the text the model wrote.
      if (criterion.description.trim()) {
        changes.push({
          id: `criterion-new-text-${criterion.key}`,
          label: tr("fundSetup.proposal.criterionLooksFor", { label: criterion.label }),
          before: null,
          after: criterion.description,
          long: true,
        });
      }
      continue;
    }
    if (old.label.trim() !== criterion.label.trim()) {
      value(
        `criterion-label-${criterion.key}`,
        tr("fundSetup.proposal.criterionName"),
        old.label,
        criterion.label,
      );
    }
    if (old.weight !== criterion.weight) {
      value(
        `criterion-weight-${criterion.key}`,
        tr("fundSetup.proposal.criterionWeight", { label: criterion.label }),
        percent(old.weight, language),
        percent(criterion.weight, language),
      );
    }
    text(
      `criterion-text-${criterion.key}`,
      tr("fundSetup.proposal.criterionLooksFor", { label: criterion.label }),
      old.description,
      criterion.description,
    );
  }
  for (const criterion of before.criteria) {
    if (!criteriaAfter.has(criterion.key)) {
      value(
        `criterion-removed-${criterion.key}`,
        tr("fundSetup.proposal.criterionRemoved", { label: criterion.label }),
        percent(criterion.weight, language),
        null,
      );
    }
  }

  const gatesBefore = new Map(before.gates.map((gate) => [gate.key, gate]));
  const gatesAfter = new Map(after.gates.map((gate) => [gate.key, gate]));
  for (const gate of after.gates) {
    const old = gatesBefore.get(gate.key);
    if (!old) {
      value(
        `gate-new-${gate.key}`,
        tr("fundSetup.proposal.newGate", { label: gate.label }),
        null,
        treatment(gate.treatment),
      );
      if (gate.description.trim()) {
        changes.push({
          id: `gate-new-text-${gate.key}`,
          label: tr("fundSetup.proposal.gate", { label: gate.label }),
          before: null,
          after: gate.description,
          long: true,
        });
      }
      continue;
    }
    if (old.treatment !== gate.treatment) {
      value(
        `gate-treatment-${gate.key}`,
        tr("fundSetup.proposal.gate", { label: gate.label }),
        treatment(old.treatment),
        treatment(gate.treatment),
      );
    }
    text(
      `gate-text-${gate.key}`,
      tr("fundSetup.proposal.gate", { label: gate.label }),
      old.description,
      gate.description,
    );
  }
  for (const gate of before.gates) {
    if (!gatesAfter.has(gate.key)) {
      value(
        `gate-removed-${gate.key}`,
        tr("fundSetup.proposal.gateRemoved", { label: gate.label }),
        treatment(gate.treatment),
        null,
      );
    }
  }
  return changes;
}
