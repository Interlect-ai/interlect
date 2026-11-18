/**
 * The steps of the editing flow ("Redigér"): title, one line under it and the text of the box
 * "Hvad betyder det for analysen?". The redesign's editing guide (prototype Fondsopsaetning v2)
 * has eight steps; here the flow keeps the steps the product has (the Screening step came with, once the choice
 * of extra screening cards and the instruction had data behind them).
 */
import type { GuideStepKey } from "@/lib/funds/editor-rules";
import type { MessageKey } from "@/lib/i18n/translate";

export type { GuideStepKey };

export interface GuideStep {
  key: GuideStepKey;
  /** Dictionary keys (fundEditor.guide.*); translate at render. */
  title: MessageKey;
  /** The big heading when it is not the title (the first step). */
  heading?: MessageKey;
  lead: MessageKey;
  explain: MessageKey;
  affects: MessageKey;
  optional?: boolean;
}

export const GUIDE_STEPS: GuideStep[] = [
  {
    key: "start",
    title: "fundEditor.guide.start.title",
    heading: "fundEditor.guide.start.heading",
    lead: "fundEditor.guide.start.lead",
    explain: "fundEditor.guide.start.explain",
    affects: "fundEditor.guide.start.affects",
  },
  {
    key: "basis",
    title: "fundEditor.guide.basis.title",
    lead: "fundEditor.guide.basis.lead",
    explain: "fundEditor.guide.basis.explain",
    affects: "fundEditor.guide.basis.affects",
  },
  {
    key: "thesis",
    title: "fundEditor.guide.thesis.title",
    lead: "fundEditor.guide.thesis.lead",
    explain: "fundEditor.guide.thesis.explain",
    affects: "fundEditor.guide.thesis.affects",
  },
  {
    key: "weights",
    title: "fundEditor.guide.weights.title",
    lead: "fundEditor.guide.weights.lead",
    explain: "fundEditor.guide.weights.explain",
    affects: "fundEditor.guide.weights.affects",
  },
  {
    key: "mandate",
    title: "fundEditor.guide.mandate.title",
    lead: "fundEditor.guide.mandate.lead",
    explain: "fundEditor.guide.mandate.explain",
    affects: "fundEditor.guide.mandate.affects",
  },
  {
    key: "screening",
    title: "fundEditor.guide.screening.title",
    lead: "fundEditor.guide.screening.lead",
    explain: "fundEditor.guide.screening.explain",
    affects: "fundEditor.guide.screening.affects",
    optional: true,
  },
  {
    key: "specialists",
    title: "fundEditor.guide.specialists.title",
    lead: "fundEditor.guide.specialists.lead",
    explain: "fundEditor.guide.specialists.explain",
    affects: "fundEditor.guide.specialists.affects",
    optional: true,
  },
  {
    key: "publish",
    title: "fundEditor.guide.publish.title",
    lead: "fundEditor.guide.publish.lead",
    explain: "fundEditor.guide.publish.explain",
    affects: "fundEditor.guide.publish.affects",
  },
];

export function stepIndex(key: GuideStepKey | null | undefined): number {
  const index = GUIDE_STEPS.findIndex((step) => step.key === key);
  return index < 0 ? 0 : index;
}
