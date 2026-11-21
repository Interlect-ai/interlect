/**
 * the pure part of the setup draft ("Lav udkast til hvert stadie" in Teamopsætning; punkt 7, fund 4
 * and 5, session 5). After the thesis is
 * written, Interlect drafts how the team screens and analyses each chosen stage, in passes:
 *
 *   A  criteria and weights            (step "Skriver kriterier og vægte")
 *   B  the stage's own mandate rules,   (steps "Vurderer mandat og bindende regler" and
 *      the economy points, the stage's   "Vælger tal om økonomien")
 *      expectation and threshold
 *   C  the specialists' texts          (step "Skriver specialisternes tekster")
 *   D  consistency: code checks first, (step "Tjekker at det hænger sammen")
 *      then one review call whose fixes are applied only where they are safe
 *
 * The draft is a starting point the team edits freely; what the team saves is what the analysis
 * uses (beslutningsloggen 15. nov 2026). It is never saved by the generator: the editor holds it
 * and saves it with the whole setup (`saveFundConfigDraft` with `setup`).
 *
 * This file holds the request shape, the models' JSON schemas, the code checks (weights 5-40 that
 * sum to 100, unique keys, no rule that repeats the shared mandate, a binding rule only from the
 * team's own words, the text budget per stage) and the mapping to what the server saves. Pure file
 * without a database, so it can be tested with node --test.
 */
import { z } from "zod";
import { chosenSetupStages, type SetupStage } from "../analysis/setup-stage.ts";
import { SCORE_CATEGORIES } from "../analysis/specialist-set.ts";
import { specialistCatalog, type SpecialistModuleId } from "../analysis/specialist-catalog.ts";
import {
  TEAM_TEXT_BUDGET,
  cleanTeamLine,
  cleanTeamText,
  teamTextUsed,
} from "../analysis/team-text.ts";
import {
  ECONOMY_POINT_KEYS,
  MISSING_MODES,
  OWN_QUESTION_ANSWERS,
  OWN_QUESTION_MAX_CHARS,
  economyPoint,
  isStandardOn,
  type EconomyPointKey,
  type MissingMode,
  type OwnQuestionAnswer,
} from "./economy-points.ts";
import { WEIGHT_MAX_PERCENT, WEIGHT_MIN_PERCENT, WEIGHT_TOTAL_PERCENT } from "./config-limits.ts";
import type { ScoreCategory } from "../domain/types.ts";

// ---------------------------------------------------------------------------------------------
// The request: the thesis as the editor has it now (it may not be saved yet, as in the prototype,
// where the draft is made from "Hvad investerer I i?").
// ---------------------------------------------------------------------------------------------

const line = (max: number) => z.string().trim().max(max);

export const setupDraftFrameSchema = z
  .object({
    /** The thesis' name ("Tesens navn"), e.g. "Nordhav Ventures III". */
    thesisName: line(160).default(""),
    /** The kind of investor the team chose ("Venturekapital", "Family office" ...), as shown. */
    investorType: line(120).default(""),
    /** "Hvem er I, og hvordan tænker I?" (setup.about). */
    about: z.string().max(3000).default(""),
    thesis: z.string().max(5000).default(""),
    /** The chosen stages in any stored form ("seed", "Series A"); at least one setup stage. */
    stages: z.array(line(80)).max(12),
    geographies: z.array(line(120)).max(30).default([]),
    sectors: z.array(line(120)).max(30).default([]),
    /** The shared mandate (Stadier, Geografi, Sektorer and any other shared rule). */
    sharedRules: z
      .array(
        z
          .object({
            key: line(80).default(""),
            label: line(160),
            description: line(1000).default(""),
            treatment: z.enum(["hard", "review"]),
          })
          .strict(),
      )
      .max(20)
      .default([]),
    ticketMinEur: z.number().nonnegative().finite().nullable().default(null),
    ticketMaxEur: z.number().nonnegative().finite().nullable().default(null),
    ticketNote: z.string().max(1000).default(""),
    /** The team's own website, read with the SSRF-safe fetching; optional. */
    website: z.union([z.string().trim().url().max(500), z.literal("")]).default(""),
  })
  .strict();

export type SetupDraftFrame = z.infer<typeof setupDraftFrameSchema>;

export const setupDraftRequestSchema = z
  .object({
    fundId: z.guid(),
    configId: z.guid(),
    frame: setupDraftFrameSchema,
  })
  .strict();

export type SetupDraftRequest = z.infer<typeof setupDraftRequestSchema>;

/** The stages the draft is made for, in the team's order; empty means nothing to draft. */
export function draftStages(frame: Pick<SetupDraftFrame, "stages">): SetupStage[] {
  return chosenSetupStages(frame.stages);
}

// ---------------------------------------------------------------------------------------------
// Limits and the run's price cap (fund 4).
// ---------------------------------------------------------------------------------------------

/** The drafting passes A-C: the stronger model, as the thesis help with a website. */
export const SETUP_DRAFT_MODEL = "openai/gpt-5.4" as const;
/** Pass D only reviews a finished draft; the code repairs what it can before it. */
export const SETUP_DRAFT_REVIEW_MODEL = "openai/gpt-5.4-mini" as const;
/** The web research (fund 5): a search model, public search terms only (D4). */
export const SETUP_DRAFT_SEARCH_MODEL = "perplexity/sonar-pro" as const;

/**
 * The whole run may cost at most this (about 10 kr.): reserved once in the credit ledger before
 * the first call and settled with what the calls cost. A call that would pass it is not sent; the
 * run stops and keeps the stages that were finished.
 */
export const SETUP_DRAFT_RUN_BUDGET_USD = 1.5;

/** Each call's own cap, checked before (on its maximum) and after (on its price). */
export const SETUP_DRAFT_CALL_BUDGET_USD = {
  search: 0.06,
  criteria: 0.12,
  mandate: 0.15,
  specialists: 0.2,
  review: 0.05,
} as const;

export const SETUP_DRAFT_MAX_OUTPUT_TOKENS = {
  search: 900,
  criteria: 4_500,
  mandate: 6_000,
  specialists: 8_000,
  review: 4_000,
} as const;

/** Criteria per stage: enough to spread 100 % with 5-40 % each, few enough to stay readable. */
export const DRAFT_CRITERIA_MIN = 4;
export const DRAFT_CRITERIA_MAX = 8;
/** The stage's own mandate rules (beyond the shared ones). */
export const DRAFT_RULES_MAX = 6;
/** Own economy questions the draft may suggest per stage (the editor allows 10). */
export const DRAFT_QUESTIONS_MAX = 3;
export const DRAFT_CRITERION_DESCRIPTION_MAX = 700;
export const DRAFT_RULE_DESCRIPTION_MAX = 400;
export const DRAFT_EXPECTATION_MAX = 1200;
/**
 * With several stages every stage's expectation counts in every stage's text budget, so
 * each is kept to this; it is also what draftTextAllowance reserves for each other stage.
 */
export const DRAFT_EXPECTATION_SHARED_MAX = 600;
export const DRAFT_FOCUS_MIN = 2;
export const DRAFT_FOCUS_MAX = 4;
/** The stage's deep-analysis threshold the draft may suggest (the editor allows 0-100). */
export const DRAFT_THRESHOLD_MIN = 40;
export const DRAFT_THRESHOLD_MAX = 90;
export const DRAFT_THRESHOLD_DEFAULT = 70;

/** The stage names the prompts use (the prototype's names; the model writes in the team's language). */
// i18n-keep: names inside the prompt to the model.
export const STAGE_PROMPT_NAME: Record<SetupStage, string> = {
  pre_seed: "Pre-seed",
  seed: "Seed",
  series_a: "Series A",
  series_b: "Series B+",
  growth: "Vækst (growth)",
  buyout: "Buyout",
  later: "Senere (later stage)",
};

export const STANDARD_SPECIALISTS: readonly SpecialistModuleId[] = specialistCatalog.map(
  (specialist) => specialist.id,
);

// ---------------------------------------------------------------------------------------------
// What a finished stage looks like (what the editor receives).
// ---------------------------------------------------------------------------------------------

export interface DraftCriterion {
  key: string;
  label: string;
  description: string;
  category: ScoreCategory;
  weight: number;
}

export interface DraftRule {
  key: string;
  label: string;
  description: string;
  treatment: "hard" | "review";
}

export interface DraftEconomy {
  points: Partial<Record<EconomyPointKey, { on: boolean; threshold?: number }>>;
  questions: Array<{ text: string; answer: OwnQuestionAnswer }>;
  missing: MissingMode;
}

export interface DraftFocus {
  title: string;
  /** What the specialist assesses in this focus area, in the team's words. */
  text: string;
  /** What counts as evidence for it. */
  evidence: string;
}

export interface DraftSpecialist {
  key: SpecialistModuleId;
  foci: DraftFocus[];
  /** Named risk areas (risk areas with names). */
  riskAreas: string[];
}

export interface StageDraft {
  stage: SetupStage;
  criteria: DraftCriterion[];
  rules: DraftRule[];
  economy: DraftEconomy;
  /** The stage's threshold for deep analysis (setup.stages.<stage>.threshold). */
  threshold: number;
  /** "Hvad forventer I?" for the stage (stage_expectations). */
  expectation: string;
  specialists: DraftSpecialist[];
  /** What pass D found and fixed (code and review together); never shown as a log. */
  consistency: { problems: number; fixed: number };
}

/** The counts the waiting screen shows when a stage is done ("6 kriterier, 11 tal, 4 specialister"). */
export function stageSummary(draft: StageDraft): {
  criteria: number;
  points: number;
  specialists: number;
} {
  return {
    criteria: draft.criteria.length,
    points: ECONOMY_POINT_KEYS.filter(
      (key) => draft.economy.points[key]?.on ?? isStandardOn(draft.stage, key),
    ).length,
    specialists: draft.specialists.length,
  };
}

// ---------------------------------------------------------------------------------------------
// The models' answers (strict JSON schemas, checked again with zod).
// ---------------------------------------------------------------------------------------------

const criteriaAnswerSchema = z.object({
  criteria: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(80),
        description: z
          .string()
          .trim()
          .min(1)
          .max(DRAFT_CRITERION_DESCRIPTION_MAX * 2),
        category: z.enum(SCORE_CATEGORIES as [ScoreCategory, ...ScoreCategory[]]),
        weight: z.number().finite(),
      }),
    )
    .min(3)
    .max(12),
});
export type CriteriaAnswer = z.infer<typeof criteriaAnswerSchema>;

const mandateAnswerSchema = z.object({
  rules: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(160),
        description: z
          .string()
          .trim()
          .max(DRAFT_RULE_DESCRIPTION_MAX * 2),
        treatment: z.enum(["hard", "review"]),
        basis: z.enum(["team_text", "research", "practice"]),
      }),
    )
    .max(12),
  points: z
    .array(
      z.object({
        key: z.string(),
        on: z.boolean(),
        threshold: z.number().finite().nullable(),
      }),
    )
    .max(30),
  questions: z
    .array(
      z.object({
        text: z
          .string()
          .trim()
          .min(1)
          .max(OWN_QUESTION_MAX_CHARS * 2),
        answer: z.enum(OWN_QUESTION_ANSWERS),
      }),
    )
    .max(10),
  expectation: z
    .string()
    .trim()
    .max(DRAFT_EXPECTATION_MAX * 2),
  threshold: z.number().finite(),
});
export type MandateAnswer = z.infer<typeof mandateAnswerSchema>;

const specialistsAnswerSchema = z.object({
  specialists: z
    .array(
      z.object({
        key: z.string(),
        foci: z
          .array(
            z.object({
              title: z.string().trim().min(1).max(160),
              text: z.string().trim().min(1).max(800),
              evidence: z.string().trim().max(800),
            }),
          )
          .min(1)
          .max(8),
        riskAreas: z.array(z.string().trim().min(1).max(240)).max(10),
      }),
    )
    .max(8),
});
export type SpecialistsAnswer = z.infer<typeof specialistsAnswerSchema>;

export const REVIEW_ACTIONS = [
  "rewrite",
  "make_review",
  "remove_rule",
  "turn_off_point",
  "turn_on_point",
] as const;
export type ReviewAction = (typeof REVIEW_ACTIONS)[number];

const reviewAnswerSchema = z.object({
  issues: z
    .array(
      z.object({
        area: z.enum(["criteria", "rules", "specialists", "economy", "expectation"]),
        ref: z.string().max(200),
        problem: z.string().max(600),
        action: z.enum(REVIEW_ACTIONS),
        text: z.string().max(1600),
      }),
    )
    .max(12),
});
export type ReviewAnswer = z.infer<typeof reviewAnswerSchema>;

export function parseCriteriaAnswer(content: string): CriteriaAnswer {
  return criteriaAnswerSchema.parse(JSON.parse(content));
}
export function parseMandateAnswer(content: string): MandateAnswer {
  return mandateAnswerSchema.parse(JSON.parse(content));
}
export function parseSpecialistsAnswer(content: string): SpecialistsAnswer {
  return specialistsAnswerSchema.parse(JSON.parse(content));
}
export function parseReviewAnswer(content: string): ReviewAnswer {
  return reviewAnswerSchema.parse(JSON.parse(content));
}

const text = (maxLength: number) => ({ type: "string", maxLength });

export const CRITERIA_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["criteria"],
  properties: {
    criteria: {
      type: "array",
      minItems: DRAFT_CRITERIA_MIN,
      maxItems: DRAFT_CRITERIA_MAX,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "description", "category", "weight"],
        properties: {
          label: text(80),
          description: text(DRAFT_CRITERION_DESCRIPTION_MAX),
          category: { type: "string", enum: [...SCORE_CATEGORIES] },
          weight: { type: "integer", minimum: WEIGHT_MIN_PERCENT, maximum: WEIGHT_MAX_PERCENT },
        },
      },
    },
  },
} as const;

export const MANDATE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["rules", "points", "questions", "expectation", "threshold"],
  properties: {
    rules: {
      type: "array",
      maxItems: DRAFT_RULES_MAX,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "description", "treatment", "basis"],
        properties: {
          label: text(120),
          description: text(DRAFT_RULE_DESCRIPTION_MAX),
          treatment: { type: "string", enum: ["hard", "review"] },
          basis: { type: "string", enum: ["team_text", "research", "practice"] },
        },
      },
    },
    points: {
      type: "array",
      maxItems: ECONOMY_POINT_KEYS.length,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "on", "threshold"],
        properties: {
          key: { type: "string", enum: [...ECONOMY_POINT_KEYS] },
          on: { type: "boolean" },
          threshold: { type: ["number", "null"], minimum: 0 },
        },
      },
    },
    questions: {
      type: "array",
      maxItems: DRAFT_QUESTIONS_MAX,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "answer"],
        properties: {
          text: text(OWN_QUESTION_MAX_CHARS),
          answer: { type: "string", enum: [...OWN_QUESTION_ANSWERS] },
        },
      },
    },
    expectation: text(DRAFT_EXPECTATION_MAX),
    threshold: { type: "integer", minimum: DRAFT_THRESHOLD_MIN, maximum: DRAFT_THRESHOLD_MAX },
  },
} as const;

export const SPECIALISTS_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["specialists"],
  properties: {
    specialists: {
      type: "array",
      minItems: STANDARD_SPECIALISTS.length,
      maxItems: STANDARD_SPECIALISTS.length,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "foci", "riskAreas"],
        properties: {
          key: { type: "string", enum: [...STANDARD_SPECIALISTS] },
          foci: {
            type: "array",
            minItems: DRAFT_FOCUS_MIN,
            maxItems: DRAFT_FOCUS_MAX,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["title", "text", "evidence"],
              properties: { title: text(80), text: text(400), evidence: text(400) },
            },
          },
          riskAreas: {
            type: "array",
            minItems: 1,
            maxItems: 5,
            items: text(120),
          },
        },
      },
    },
  },
} as const;

export const REVIEW_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["issues"],
  properties: {
    issues: {
      type: "array",
      maxItems: 10,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["area", "ref", "problem", "action", "text"],
        properties: {
          area: {
            type: "string",
            enum: ["criteria", "rules", "specialists", "economy", "expectation"],
          },
          ref: text(120),
          problem: text(300),
          action: { type: "string", enum: [...REVIEW_ACTIONS] },
          text: text(DRAFT_CRITERION_DESCRIPTION_MAX),
        },
      },
    },
  },
} as const;

// ---------------------------------------------------------------------------------------------
// Code checks and repairs.
// ---------------------------------------------------------------------------------------------

const FOLD: Record<string, string> = { æ: "ae", ø: "oe", å: "aa", ä: "ae", ö: "oe", ü: "ue" };

/** A stable key from a label, unique among `taken` (which it extends). */
export function keyFromLabel(label: string, taken: Set<string>, fallback: string): string {
  const base =
    label
      .toLowerCase()
      .replace(/[æøåäöü]/g, (letter) => FOLD[letter] ?? letter)
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 60)
      .replace(/_+$/g, "") || fallback;
  let key = base;
  for (let n = 2; taken.has(key); n += 1) key = `${base}_${n}`;
  taken.add(key);
  return key;
}

/**
 * Whole-number weights that each lie in 5-40 and sum to 100, as close to the model's proportions
 * as the limits allow (the editor and the publish require it, config-limits.ts). Needs 3-20
 * criteria; outside that the weights cannot meet the limits and an error is thrown.
 */
export function normalizeWeights(raw: readonly number[]): number[] {
  const n = raw.length;
  if (
    n * WEIGHT_MIN_PERCENT > WEIGHT_TOTAL_PERCENT ||
    n * WEIGHT_MAX_PERCENT < WEIGHT_TOTAL_PERCENT
  )
    throw new Error(`weights: ${n} criteria cannot sum to 100 with 5-40 each`);
  const positive = raw.map((weight) => (Number.isFinite(weight) && weight > 0 ? weight : 1));
  // Proportional shares with the limits: fix the ones that hit a limit, spread the rest, repeat.
  const share = new Array<number>(n).fill(0);
  const fixed = new Array<boolean>(n).fill(false);
  for (let round = 0; round <= n; round += 1) {
    const free = positive.map((_, i) => i).filter((i) => !fixed[i]);
    const left =
      WEIGHT_TOTAL_PERCENT - share.reduce((sum, value, i) => sum + (fixed[i] ? value : 0), 0);
    const freeTotal = free.reduce((sum, i) => sum + positive[i]!, 0);
    for (const i of free) share[i] = (positive[i]! / freeTotal) * left;
    // The ones over the maximum first: fixing them gives the others more, which may lift a share
    // that was under the minimum. Fixing a minimum only takes from the others, never past a max.
    const over = free.filter((i) => share[i]! > WEIGHT_MAX_PERCENT);
    const under = over.length ? [] : free.filter((i) => share[i]! < WEIGHT_MIN_PERCENT);
    for (const i of over) share[i] = WEIGHT_MAX_PERCENT;
    for (const i of under) share[i] = WEIGHT_MIN_PERCENT;
    for (const i of [...over, ...under]) fixed[i] = true;
    if (!over.length && !under.length) break;
  }
  // Largest remainder to whole numbers; the limits are whole numbers, so they still hold.
  const floors = share.map(Math.floor);
  let missing = WEIGHT_TOTAL_PERCENT - floors.reduce((sum, value) => sum + value, 0);
  const order = share
    .map((value, i) => ({ i, rest: value - Math.floor(value) }))
    .sort((a, b) => b.rest - a.rest || a.i - b.i);
  for (const { i } of order) {
    if (missing <= 0) break;
    if (floors[i]! < WEIGHT_MAX_PERCENT) {
      floors[i]! += 1;
      missing -= 1;
    }
  }
  return floors;
}

/** Text cut at the last sentence (or word) end within `max` characters. */
export function clipText(value: string, max: number): string {
  const clean = value.trim();
  if ([...clean].length <= max) return clean;
  const cut = [...clean].slice(0, max).join("");
  const sentence = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  if (sentence > max * 0.5) return cut.slice(0, sentence + 1).trim();
  const word = cut.lastIndexOf(" ");
  // The ellipsis counts too: never more than `max` characters (the save schemas are strict).
  const body = word > max * 0.5 ? cut.slice(0, word) : [...cut].slice(0, max - 1).join("");
  return body.replace(/[,;:\s]+$/, "").trim() + "…";
}

/** Words of a label, for "does this rule repeat a shared one". */
function words(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length > 2),
  );
}

const SHARED_TOPICS = [
  /\b(stadie|stage|stages|stadier|fase)\b/i,
  /\b(geografi|geography|land|lande|country|countries|region)\b/i,
  /\b(sektor|sektorer|sector|sectors|branche|industry)\b/i,
];

/**
 * A stage rule that repeats the shared mandate: the same label, mostly the same words, or a rule
 * about stage, geography or sector (those three are shared lists in the thesis, punkt 2).
 */
export function repeatsSharedRule(
  rule: { label: string; description: string },
  shared: ReadonlyArray<{ label: string }>,
): boolean {
  const label = rule.label.trim().toLowerCase();
  if (SHARED_TOPICS.some((topic) => topic.test(rule.label))) return true;
  const own = words(rule.label);
  return shared.some((item) => {
    if (item.label.trim().toLowerCase() === label) return true;
    const theirs = words(item.label);
    if (!own.size || !theirs.size) return false;
    const common = [...own].filter((word) => theirs.has(word)).length;
    return common / Math.min(own.size, theirs.size) >= 0.8;
  });
}

export interface DraftProblems {
  /** What the code found (each counted once). */
  problems: string[];
  /** What the code repaired on its own. */
  fixed: number;
}

/** Pass A's answer as criteria: unique keys, clipped texts, weights that meet the limits. */
export function criteriaFromAnswer(answer: CriteriaAnswer, log: DraftProblems): DraftCriterion[] {
  const seen = new Set<string>();
  const unique = answer.criteria.filter((criterion) => {
    const label = cleanTeamLine(criterion.label).toLowerCase();
    if (!label || seen.has(label)) {
      log.problems.push("criteria_duplicate");
      log.fixed += 1;
      return false;
    }
    seen.add(label);
    return true;
  });
  // Too many: keep the heaviest (the schema asks for at most 8; zod lets up to 12 through).
  const kept = [...unique]
    .map((criterion, index) => ({ criterion, index }))
    .sort((a, b) => b.criterion.weight - a.criterion.weight || a.index - b.index)
    .slice(0, DRAFT_CRITERIA_MAX)
    .sort((a, b) => a.index - b.index)
    .map(({ criterion }) => criterion);
  if (kept.length < unique.length) {
    log.problems.push("criteria_too_many");
    log.fixed += 1;
  }
  if (kept.length < 3) throw new Error("criteria: fewer than three distinct criteria");
  const weights = normalizeWeights(kept.map((criterion) => criterion.weight));
  if (weights.some((weight, i) => weight !== kept[i]!.weight)) {
    log.problems.push("criteria_weights");
    log.fixed += 1;
  }
  const taken = new Set<string>();
  return kept.map((criterion, i) => ({
    key: keyFromLabel(criterion.label, taken, `criterion_${i + 1}`),
    label: clipText(cleanTeamLine(criterion.label), 80),
    description: clipText(cleanTeamText(criterion.description), DRAFT_CRITERION_DESCRIPTION_MAX),
    category: criterion.category,
    weight: weights[i]!,
  }));
}

/**
 * Pass B's rules: none that repeats the shared mandate, and binding only when the team's own words
 * say so (`basis: team_text`); a rule from research or practice is "Op til vurdering". Nothing ever
 * stops a case either way (beslutningsloggen 15. nov 2026), but "Bindende" must be the team's own.
 */
export function rulesFromAnswer(
  answer: MandateAnswer,
  shared: ReadonlyArray<{ key?: string; label: string }>,
  takenKeys: ReadonlySet<string>,
  log: DraftProblems,
): DraftRule[] {
  const taken = new Set(takenKeys);
  const rules: DraftRule[] = [];
  for (const rule of answer.rules) {
    const label = clipText(cleanTeamLine(rule.label), 120);
    if (!label) continue;
    if (repeatsSharedRule({ label, description: rule.description }, shared)) {
      log.problems.push("rule_repeats_shared");
      log.fixed += 1;
      continue;
    }
    if (rules.some((own) => own.label.toLowerCase() === label.toLowerCase())) {
      log.problems.push("rule_duplicate");
      log.fixed += 1;
      continue;
    }
    if (rules.length >= DRAFT_RULES_MAX) {
      log.problems.push("rules_too_many");
      log.fixed += 1;
      break;
    }
    let treatment = rule.treatment;
    if (treatment === "hard" && rule.basis !== "team_text") {
      treatment = "review";
      log.problems.push("rule_binding_without_team_text");
      log.fixed += 1;
    }
    rules.push({
      key: keyFromLabel(label, taken, `rule_${rules.length + 1}`),
      label,
      description: clipText(cleanTeamText(rule.description), DRAFT_RULE_DESCRIPTION_MAX),
      treatment,
    });
  }
  return rules;
}

/**
 * Pass B's economy: every point the model named, on or off, with a limit only where the point has
 * one and the value is sane; points it did not name keep the stage's standard (economy-points.ts).
 * Only differences from the standard are kept, so "Nulstil" in the editor means the same as before.
 */
export function economyFromAnswer(
  answer: MandateAnswer,
  stage: SetupStage,
  log: DraftProblems,
): DraftEconomy {
  const points: DraftEconomy["points"] = {};
  for (const point of answer.points) {
    if (!(ECONOMY_POINT_KEYS as readonly string[]).includes(point.key)) {
      log.problems.push("economy_unknown_point");
      log.fixed += 1;
      continue;
    }
    const key = point.key as EconomyPointKey;
    const definition = economyPoint(key);
    const own: { on: boolean; threshold?: number } = { on: point.on };
    if (definition.limit && point.threshold !== null) {
      if (point.threshold >= 0 && point.threshold < 1_000_000) {
        if (point.threshold !== definition.limit.value) own.threshold = point.threshold;
      } else {
        log.problems.push("economy_bad_threshold");
        log.fixed += 1;
      }
    }
    const standard = isStandardOn(stage, key);
    if (own.on !== standard || own.threshold !== undefined) points[key] = own;
  }
  const questions: DraftEconomy["questions"] = [];
  for (const question of answer.questions) {
    const text = clipText(cleanTeamLine(question.text), OWN_QUESTION_MAX_CHARS);
    if (!text || questions.some((own) => own.text.toLowerCase() === text.toLowerCase())) continue;
    if (questions.length >= DRAFT_QUESTIONS_MAX) break;
    questions.push({ text, answer: question.answer });
  }
  return { points, questions, missing: MISSING_MODES[0] };
}

export function thresholdFromAnswer(value: number): number {
  if (!Number.isFinite(value)) return DRAFT_THRESHOLD_DEFAULT;
  return Math.min(DRAFT_THRESHOLD_MAX, Math.max(DRAFT_THRESHOLD_MIN, Math.round(value)));
}

/** Pass C's answer: the four standard specialists, each with 2-4 focus areas and named risks. */
export function specialistsFromAnswer(
  answer: SpecialistsAnswer,
  log: DraftProblems,
): DraftSpecialist[] {
  const byKey = new Map<SpecialistModuleId, DraftSpecialist>();
  for (const specialist of answer.specialists) {
    if (!(STANDARD_SPECIALISTS as readonly string[]).includes(specialist.key)) continue;
    const key = specialist.key as SpecialistModuleId;
    if (byKey.has(key)) continue;
    const titles = new Set<string>();
    const foci = specialist.foci
      .map((focus) => ({
        title: clipText(cleanTeamLine(focus.title), 80),
        text: clipText(cleanTeamText(focus.text), 400),
        evidence: clipText(cleanTeamText(focus.evidence), 400),
      }))
      .filter((focus) => {
        const title = focus.title.toLowerCase();
        if (!focus.title || !focus.text || titles.has(title)) return false;
        titles.add(title);
        return true;
      })
      .slice(0, DRAFT_FOCUS_MAX);
    const risks = [
      ...new Set(specialist.riskAreas.map((risk) => clipText(cleanTeamLine(risk), 120))),
    ]
      .filter(Boolean)
      .slice(0, 5);
    if (!foci.length) continue;
    byKey.set(key, { key, foci, riskAreas: risks });
  }
  const missing = STANDARD_SPECIALISTS.filter((key) => !byKey.has(key));
  if (missing.length) throw new Error(`specialists: no draft for ${missing.join(", ")}`);
  return STANDARD_SPECIALISTS.map((key) => byKey.get(key)!);
}

/**
 * Applies pass D's fixes where they are safe: a new text for a criterion, a rule, a focus area or
 * the expectation; a rule made "Op til vurdering" (never binding) or removed; a point turned on or
 * off. Weights, keys, categories and treatment towards "binding" are never changed by the review.
 * Returns how many fixes were applied; a reference that does not exist is ignored.
 */
export function applyReview(draft: StageDraft, review: ReviewAnswer): number {
  let applied = 0;
  for (const issue of review.issues) {
    const value = issue.text.trim();
    if (issue.area === "criteria" && issue.action === "rewrite" && value) {
      const criterion = draft.criteria.find((item) => item.key === issue.ref);
      if (!criterion) continue;
      criterion.description = clipText(cleanTeamText(value), DRAFT_CRITERION_DESCRIPTION_MAX);
      applied += 1;
    } else if (issue.area === "rules") {
      const index = draft.rules.findIndex((item) => item.key === issue.ref);
      if (index < 0) continue;
      if (issue.action === "remove_rule") {
        draft.rules.splice(index, 1);
        applied += 1;
      } else if (issue.action === "make_review" && draft.rules[index]!.treatment === "hard") {
        draft.rules[index]!.treatment = "review";
        applied += 1;
      } else if (issue.action === "rewrite" && value) {
        draft.rules[index]!.description = clipText(
          cleanTeamText(value),
          DRAFT_RULE_DESCRIPTION_MAX,
        );
        applied += 1;
      }
    } else if (issue.area === "specialists" && issue.action === "rewrite" && value) {
      // ref "<specialist key>:<focus number from 1>"
      const [key, number] = issue.ref.split(":");
      const specialist = draft.specialists.find((item) => item.key === key);
      const focus = specialist?.foci[Number(number) - 1];
      if (!focus) continue;
      focus.text = clipText(cleanTeamText(value), 400);
      applied += 1;
    } else if (issue.area === "expectation" && issue.action === "rewrite" && value) {
      draft.expectation = clipText(cleanTeamText(value), DRAFT_EXPECTATION_MAX);
      applied += 1;
    } else if (
      issue.area === "economy" &&
      (issue.action === "turn_off_point" || issue.action === "turn_on_point")
    ) {
      if (!(ECONOMY_POINT_KEYS as readonly string[]).includes(issue.ref)) continue;
      const key = issue.ref as EconomyPointKey;
      const on = issue.action === "turn_on_point";
      const own = draft.economy.points[key];
      const threshold = own?.threshold;
      if (on === isStandardOn(draft.stage, key) && threshold === undefined)
        delete draft.economy.points[key];
      else draft.economy.points[key] = threshold === undefined ? { on } : { on, threshold };
      applied += 1;
    }
  }
  return applied;
}

/**
 * The text budget per stage (8,000 characters): the shared texts of the thesis, every
 * stage's expectation, and this stage's criteria, rules and own economy questions, as
 * teamTextBudgetByStage counts them at publish. When the draft would pass it, the
 * longest texts are shortened (criteria first, then the expectation) until it fits; the team's own
 * texts are never touched. Returns whether anything was shortened.
 */
export function fitStageToBudget(
  draft: StageDraft,
  frame: SetupDraftFrame,
  otherExpectations: readonly string[],
): boolean {
  const used = () =>
    teamTextUsed({
      thesis: frame.thesis,
      riskPosture: "",
      ticketNote: frame.ticketNote,
      stageExpectations: Object.fromEntries(
        [...otherExpectations, draft.expectation].map((value, i) => [String(i), value]),
      ),
      dealbreakers: [],
      about: frame.about,
      criteria: draft.criteria,
      gates: [
        ...frame.sharedRules.map((rule) => ({ description: rule.description })),
        ...draft.rules,
      ],
    }) +
    // The stage's own economy questions count in its budget too (teamTextBudgetByStage).
    draft.economy.questions.reduce((sum, question) => sum + question.text.length, 0);
  let changed = false;
  for (let round = 0; round < 40 && used() > TEAM_TEXT_BUDGET; round += 1) {
    const longest = [...draft.criteria].sort(
      (a, b) => b.description.length - a.description.length,
    )[0];
    if (longest && longest.description.length > 160) {
      longest.description = clipText(
        longest.description,
        Math.floor(longest.description.length * 0.8),
      );
    } else if (draft.expectation.length > 200) {
      draft.expectation = clipText(draft.expectation, Math.floor(draft.expectation.length * 0.8));
    } else {
      const rule = [...draft.rules].sort((a, b) => b.description.length - a.description.length)[0];
      if (!rule || rule.description.length <= 80) break;
      rule.description = clipText(rule.description, Math.floor(rule.description.length * 0.8));
    }
    changed = true;
  }
  return changed;
}

/**
 * The characters this stage's drafted texts may use in all, given the team's own texts, so the
 * prompts can ask for texts that fit (fitStageToBudget is the safety net).
 */
export function draftTextAllowance(frame: SetupDraftFrame, stageCount: number): number {
  const own = teamTextUsed({
    thesis: frame.thesis,
    riskPosture: "",
    ticketNote: frame.ticketNote,
    stageExpectations: {},
    dealbreakers: [],
    about: frame.about,
    criteria: [],
    gates: frame.sharedRules.map((rule) => ({ description: rule.description })),
  });
  // Every stage's expectation counts in every stage; give each about 600 characters of room.
  const left = TEAM_TEXT_BUDGET - own - Math.max(0, stageCount - 1) * DRAFT_EXPECTATION_SHARED_MAX;
  return Math.max(1200, left);
}

// ---------------------------------------------------------------------------------------------
// Into what the server saves (saveFundConfigDraft with `setup`, specialists' texts per stage).
// ---------------------------------------------------------------------------------------------

export interface DraftSaveParts {
  criteria: Array<DraftCriterion & { stage: SetupStage }>;
  gates: Array<DraftRule & { stage: SetupStage }>;
  /** `setup.stages`: each stage's threshold and economy (setup-input.ts). */
  stages: Partial<
    Record<
      SetupStage,
      {
        threshold: number;
        economy: {
          points?: DraftEconomy["points"];
          questions?: DraftEconomy["questions"];
          missing: MissingMode;
        };
      }
    >
  >;
  /** stage_expectations, keyed by the stage. */
  stageExpectations: Partial<Record<SetupStage, string>>;
  /**
   * The specialists' texts per stage in the shape a module text is saved in
   * (prompt_module_overrides with `stage`, module-prompt-override.functions.ts): each focus area
   * is a line of the mandate ("Title: text"), its evidence a test, the named risks the risk areas.
   */
  moduleOverrides: Partial<
    Record<
      SetupStage,
      Record<
        SpecialistModuleId,
        { mandate: string[]; evidenceTests: string[]; riskAreas: string[] }
      >
    >
  >;
}

export function draftSaveParts(drafts: readonly StageDraft[]): DraftSaveParts {
  const parts: DraftSaveParts = {
    criteria: [],
    gates: [],
    stages: {},
    stageExpectations: {},
    moduleOverrides: {},
  };
  for (const draft of drafts) {
    parts.criteria.push(
      ...draft.criteria.map((criterion) => ({ ...criterion, stage: draft.stage })),
    );
    parts.gates.push(...draft.rules.map((rule) => ({ ...rule, stage: draft.stage })));
    const economy: NonNullable<DraftSaveParts["stages"][SetupStage]>["economy"] = {
      missing: draft.economy.missing,
    };
    if (Object.keys(draft.economy.points).length) economy.points = draft.economy.points;
    if (draft.economy.questions.length) economy.questions = draft.economy.questions;
    parts.stages[draft.stage] = { threshold: draft.threshold, economy };
    if (draft.expectation) parts.stageExpectations[draft.stage] = draft.expectation;
    const overrides = {} as Record<
      SpecialistModuleId,
      { mandate: string[]; evidenceTests: string[]; riskAreas: string[] }
    >;
    for (const specialist of draft.specialists) {
      const mandate = specialist.foci.map((focus) =>
        clipText(`${focus.title}: ${focus.text}`, 400),
      );
      const evidenceTests = specialist.foci
        .map((focus) => focus.evidence)
        .filter(Boolean)
        .map((value) => clipText(value, 400));
      overrides[specialist.key] = {
        mandate,
        evidenceTests: evidenceTests.length ? evidenceTests : mandate,
        riskAreas: specialist.riskAreas.length ? specialist.riskAreas : [specialist.foci[0]!.title],
      };
    }
    parts.moduleOverrides[draft.stage] = overrides;
  }
  return parts;
}

// ---------------------------------------------------------------------------------------------
// The web research's search terms (fund 5): public identity only.
// ---------------------------------------------------------------------------------------------

export function siteDomain(website: string): string | null {
  if (!website) return null;
  try {
    return new URL(website).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * The searches about the team: who they are, what they invested in before, and how they describe
 * their own focus. Only the team's name (and its thesis' name and website, when given) leaves us:
 * Perplexity has no ZDR, so the thesis and everything else the team wrote never go into a search
 * (D4, plan).
 */
// i18n-keep: search terms to the search engine.
export function teamSearchQueries(input: {
  teamName: string;
  thesisName: string;
  website: string;
}): string[] {
  const name = cleanTeamLine(input.teamName).slice(0, 120);
  const thesis = cleanTeamLine(input.thesisName).slice(0, 120);
  const domain = siteDomain(input.website);
  if (!name && !thesis) return [];
  const who = [name || thesis, domain ? `(${domain})` : ""].filter(Boolean).join(" ");
  const queries = [
    `${who} investment firm: who they are, the team behind it, fund size and what they invest in`,
    `${who} portfolio companies and previous investments: company, stage, sector, country, year`,
    `${who} investment focus and thesis: stages, ticket size, sectors and geography in their own words`,
  ];
  if (thesis && name && thesis.toLowerCase() !== name.toLowerCase()) {
    queries[2] = `${who} "${thesis}" fund: investment focus, stages, ticket size, sectors and geography`;
  }
  return queries.map((query) => query.slice(0, 300));
}
