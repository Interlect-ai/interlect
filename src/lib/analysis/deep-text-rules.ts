/**
 * How long the deep analysis's texts must be (prototype Case Dyb analyse v5: "5–15 linjer i afsnit"
 * per criterion; "Tekstmængde pr. fase"). One place for the numbers, so the
 * prompts, the JSON schemas and the quality control cannot drift apart. Pure and tested.
 *
 * The schema floors guide the model; the quality control's blocking floors are lower on purpose:
 * a paid run is only rejected for a text that is clearly too thin, never for being a little short
 * of the target (the shortfall is a warning).
 */

import type { Language } from "../i18n/language.ts";
import { translate, type MessageKey, type TranslateVars } from "../i18n/translate.ts";

/** A criterion's reasoning: 2–3 short paragraphs (blank line between), about 6–9 sentences. */
export const CRITERION_RATIONALE = {
  schemaMin: 400,
  schemaMax: 2_200,
  /** Below this the quality control rejects the run (the merged text is the specialist's). */
  blockingMin: 150,
  /** Below this the quality control only warns. */
  warnBelow: 600,
} as const;

/**
 * The synthesis's own criterion text is only a SHORT verdict-style paragraph (2–4 sentences).
 * The long text above is written by the specialists; code puts it into the stored assessments
 * after the synthesis (`mergeSpecialistRationales`), never the model. First paid run (Pleo,
 * Middel): a synthesis that repeated the long texts wrote 16 000 tokens and was cut off.
 */
export const SYNTHESIS_CRITERION_RATIONALE = { schemaMin: 150, schemaMax: 900 } as const;

/** The synthesis's overall assessment: 2 paragraphs, about 5–7 sentences. */
export const OVERALL_ASSESSMENT = {
  schemaMin: 300,
  schemaMax: 1_800,
  blockingMin: 200,
  warnBelow: 450,
} as const;

/** The synthesis's findings ("Det fandt vi"): 2–3 per category, 2 sentences each. */
export const SYNTHESIS_FINDINGS = { maxItems: 27, statementMax: 600 } as const;

/**
 * The curated next steps (~1 000 tokens): a short title of at most six words, the precise question
 * or action in one sentence, one sentence of why. Findings were trimmed (700 -> 600 chars;
 * 27 = 9 categories x 3, as the prompt says) to pay for them, so the synthesis stays near 12 000
 * output tokens (last real run: 11 500 without them).
 */
export const SYNTHESIS_NEXT_STEPS = {
  maxItems: 10,
  titleMax: 60,
  questionMax: 260,
  whyMax: 220,
} as const;
/** How many already-open task titles are shown to the synthesis (input tokens, ~400). */
export const OPEN_TASK_TITLES_FOR_SYNTHESIS = 25;

/**
 * The synthesis's risks: the prompt asks for 8–12 sentences of reasoning (normally 130–230 words);
 * texts are capped so the whole answer stays near 11 000 tokens. As for the other texts, only a
 * risk that is clearly too thin (the two- or three-sentence summary the prompt forbids) blocks;
 * one short of the target is a warning.: Let (gpt-5.4-mini) wrote five risks of 650+
 * characters and 6 sentences each, likelihood and impact both reasoned, and the paid run was
 * rejected at a floor of 7 sentences.
 */
export const SYNTHESIS_RISK = {
  rationaleMax: 1_800,
  mitigationMax: 900,
  /** The JSON schema's floor (guides the model). */
  rationaleSchemaMin: 650,
  /** Below either of these the quality control rejects the run. */
  rationaleBlockingMin: 400,
  rationaleBlockingSentences: 4,
  /** Below the prompt's target the quality control only warns. */
  rationaleTargetSentences: 8,
} as const;

/**
 * A specialist's short point for its card in the conclusion, at most two lines
 * ("Stærke founders, men salget hviler på CEO alene"). The summary stays on the specialist's tab.
 */
export const SPECIALIST_HEADLINE = { max: 120 } as const;

/**
 * The screening's summary is about five lines (2–4 sentences), and the short
 * label beside the company's name is stage, sector in 1–3 words and country.
 */
export const SCREENING_SUMMARY = { max: 600 } as const;
export const COMPANY_LABEL = {
  stageMax: 24,
  sectorMax: 40,
  sectorWords: 3,
  countryMax: 40,
} as const;

/** A specialist's conclusion: 2–3 sentences. */
export const SPECIALIST_SUMMARY = { schemaMin: 80, schemaMax: 700 } as const;

/**
 * THE TIME BUDGET. The project is on Vercel Pro, but 300 s is the chosen ceiling for a function
 * (`functions.maxDuration` in nitro.config.ts; Vercel rejects more with invalid_max_duration).
 *
 * How the steps run (deep-worker.server.ts): every phase is its own queue message and so its own
 * function invocation: public research, then specialists, then synthesis. Inside one invocation
 * the model calls run in PARALLEL (the four specialists; the research modules), never one after
 * another, so an invocation's longest chain is: set-up + ONE gateway call + saving. The synthesis
 * is one call followed by finance gates, saving and writing tasks.
 *
 * Therefore, shortest first:
 *   gateway timeout (<= MAX_CALL_TIMEOUT_MS, 220 s)  +  saving margin (80 s)  <=  function limit (300 s)  <  step lease
 * - 220 s at ~60 tokens/s is ~13k tokens including reasoning (measured: 11.1k tokens in 178 s), so
 *   the output caps are 12k for a
 *   specialist (one criterion group) and 16k for the synthesis (reasoning "medium" is counted).
 * - A call that times out or hits `finish_reason: length` is aborted by us, well before the
 *   platform would kill the function; the run fails with the tokens and cost of the failed call
 *   recorded on its step (no automatic retry; the team's own retry reuses finished research and
 *   specialists, so only the failed step is paid again).
 * - A step marked running is taken over by a later queue delivery only after STEP_STALE_AFTER_MS,
 *   which must exceed the function limit, or a redelivery could start a second paid call while
 *   the first is still running.
 * - Budget check (worst case reserved before each call): 12k tokens ~ $0,18 and 16k ~ $0,24 of
 *   output plus input, inside the step ceilings (specialists $2,75 / 4 each, synthesis $0,75).
 */
export const SPECIALIST_MAX_OUTPUT_TOKENS = 12_000;
export const SYNTHESIS_MAX_OUTPUT_TOKENS = 16_000;
/**
 * The most any single call may be given. The per-level timeouts live in `model-tiers.ts`
 * (`DEEP_CALL_TIMEOUT_MS`, session B's live-tested values) and must stay at or below this; a test
 * enforces it.
 */
/**
 * Step rows are readable by every fund member, so a failed call keeps only this much of the
 * cut-off model text on the step; the whole text goes to the server log.
 */
export const PARTIAL_TEXT_MAX_CHARS = 2_000;

export const MAX_CALL_TIMEOUT_MS = 220_000;
/** Time left in the invocation after the call for saving, finance gates and tasks. */
export const SAVE_MARGIN_MS = 80_000;
export const STEP_STALE_AFTER_MS = 360_000;
/** `functions.maxDuration` in nitro.config.ts (a test keeps the two equal). */
export const FUNCTION_MAX_DURATION_SECONDS = 300;

/** Findings per analysis category in the synthesis ("Det fandt vi"). */
export const FINDINGS_PER_CATEGORY = { min: 2, max: 3 } as const;

/** A finding ("Det fandt vi"): 2–3 sentences, observation and meaning. */
export const FINDING_STATEMENT = { schemaMax: 1_000 } as const;

export interface DeepTextSource {
  assessments: Array<{ criterionKey: string; rationale: string }>;
  overallAssessment: string;
}

/** The length checks of the quality control for the new, longer texts. */
export function auditDeepTextLengths(
  output: DeepTextSource,
  language: Language = "da",
): {
  blockingErrors: string[];
  warnings: string[];
} {
  const text = (key: string, vars: TranslateVars) =>
    translate(language, `analysisServer.deepText.${key}` as MessageKey, vars);
  const blockingErrors: string[] = [];
  const warnings: string[] = [];
  for (const assessment of output.assessments) {
    const length = assessment.rationale.trim().length;
    if (length < CRITERION_RATIONALE.blockingMin) {
      blockingErrors.push(
        text("criterionTooShort", { criterion: assessment.criterionKey, length }),
      );
    } else if (length < CRITERION_RATIONALE.warnBelow) {
      warnings.push(text("criterionShort", { criterion: assessment.criterionKey, length }));
    }
  }
  const overall = output.overallAssessment.trim().length;
  if (overall < OVERALL_ASSESSMENT.blockingMin) {
    blockingErrors.push(text("overallTooShort", { length: overall }));
  } else if (overall < OVERALL_ASSESSMENT.warnBelow) {
    warnings.push(text("overallShort", { length: overall }));
  }
  return { blockingErrors, warnings };
}

/** The length check of one synthesis risk's reasoning; `name` is the risk's title. */
export function auditRiskRationale(
  name: string,
  rationale: string,
  language: Language = "da",
): { blockingError: string | null; warning: string | null } {
  const length = rationale.trim().length;
  const count = countSentences(rationale);
  if (
    length < SYNTHESIS_RISK.rationaleBlockingMin ||
    count < SYNTHESIS_RISK.rationaleBlockingSentences
  ) {
    return {
      blockingError: translate(language, "analysisServer.deep.riskShort", { name, count }),
      warning: null,
    };
  }
  if (
    length < SYNTHESIS_RISK.rationaleSchemaMin ||
    count < SYNTHESIS_RISK.rationaleTargetSentences
  ) {
    return {
      blockingError: null,
      warning: translate(language, "analysisServer.deep.riskBelowTarget", {
        name,
        count,
        target: SYNTHESIS_RISK.rationaleTargetSentences,
      }),
    };
  }
  return { blockingError: null, warning: null };
}

export function countSentences(value: string): number {
  return value
    .split(/(?<=[.!?])\s+(?=[A-ZÆØÅ0-9])/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean).length;
}
