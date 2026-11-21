/**
 * `fund_mandates.setup` as the server saves it (afsnit 3; 0133 for the shape, 0134 for the save).
 * The database checks only the shape
 * (`fund_setup_ok`); the content is checked and cleaned here before it is saved:
 *
 *   about        "Hvem er I, og hvordan tænker I?" (at most 3,000 characters, trimmed)
 *   fixed_rules  edits to the 9 editable fixed rules only, each 1-600 characters; an edit that is
 *                the standard text is dropped ("Nulstil" removes the key, fixed-rules.ts)
 *   stages       {stage: {threshold?, economy?}}: the stage's threshold for deep analysis (an
 *                integer 0-100) and its economy (economy-points.ts: points on/off with a limit,
 *                at most 10 own questions, what a missing figure gives)
 *
 * Every stage the team chose gets an entry, also an empty one: a stage is found from its rows and
 * `setup.stages` (setup-stage.ts), and a stage whose only own content is a module text
 * (`prompt_module_overrides`, which only Admin and Lead may read, 0104) would otherwise not be
 * found (overdragelsen fra session 2, punkt g).
 *
 * Pure file without a database, so it can be tested with node --test.
 */
import { z } from "zod";
import { SETUP_STAGES, chosenSetupStages, type SetupStage } from "../analysis/setup-stage.ts";
import { EDITABLE_FIXED_RULES, FIXED_RULE_MAX_CHARS, readFixedRuleEdits } from "./fixed-rules.ts";
import {
  ECONOMY_POINT_KEYS,
  MAX_OWN_ECONOMY_QUESTIONS,
  MISSING_MODES,
  OWN_QUESTION_ANSWERS,
  OWN_QUESTION_MAX_CHARS,
  readEconomySetup,
} from "./economy-points.ts";

/** The longest "Hvem er I, og hvordan tænker I?" (the database's limit, 0133). */
export const ABOUT_MAX_CHARS = 3000;

export const setupStageSchema = z.enum(SETUP_STAGES);

const economyInputSchema = z
  .object({
    points: z
      .partialRecord(
        z.enum(ECONOMY_POINT_KEYS as [string, ...string[]]),
        z
          .object({
            on: z.boolean().optional(),
            threshold: z.number().finite().min(0).max(999_999).optional(),
          })
          .strict(),
      )
      .optional(),
    questions: z
      .array(
        z
          .object({
            text: z.string().trim().min(1).max(OWN_QUESTION_MAX_CHARS),
            answer: z.enum(OWN_QUESTION_ANSWERS),
          })
          .strict(),
      )
      .max(MAX_OWN_ECONOMY_QUESTIONS)
      .optional(),
    missing: z.enum(MISSING_MODES).optional(),
  })
  .strict();

const stageInputSchema = z
  .object({
    threshold: z.number().int().min(0).max(100).optional(),
    economy: economyInputSchema.optional(),
  })
  .strict();

/** What the editor sends; unknown keys are refused rather than stored. */
export const setupInputSchema = z
  .object({
    about: z.string().max(ABOUT_MAX_CHARS).optional(),
    // Only the 9 editable rules; a locked rule can never be changed through the setup.
    fixedRules: z
      .partialRecord(
        z.enum(EDITABLE_FIXED_RULES as [string, ...string[]]),
        z.string().trim().min(1).max(FIXED_RULE_MAX_CHARS),
      )
      .optional(),
    stages: z.partialRecord(setupStageSchema, stageInputSchema).optional(),
  })
  .strict();

export type SetupInput = z.infer<typeof setupInputSchema>;
export type StageSetupInput = z.infer<typeof stageInputSchema>;

/** The stored form (`fund_mandates.setup`), in the database's own key names. */
export interface StoredSetup {
  about?: string;
  fixed_rules?: Record<string, string>;
  stages?: Partial<Record<SetupStage, StageSetupInput>>;
}

/**
 * The editor's setup as it is stored: trimmed, only valid fixed-rule edits, and an entry for every
 * chosen stage. `chosenStages` is the mandate's `stages` (any stored form, setupStageOf reads it).
 */
export function toStoredSetup(
  input: SetupInput,
  chosenStages: readonly string[] | null | undefined,
): StoredSetup {
  const stored: StoredSetup = {};
  const about = input.about?.trim() ?? "";
  if (about) stored.about = about;
  const fixedRules = readFixedRuleEdits(input.fixedRules ?? {});
  if (Object.keys(fixedRules).length) stored.fixed_rules = fixedRules as Record<string, string>;
  const stages: Partial<Record<SetupStage, StageSetupInput>> = {};
  for (const stage of SETUP_STAGES) {
    const own = input.stages?.[stage];
    if (own) stages[stage] = cleanStage(own);
  }
  for (const stage of chosenSetupStages(chosenStages)) stages[stage] ??= {};
  if (Object.keys(stages).length) stored.stages = stages;
  return stored;
}

function cleanStage(input: StageSetupInput): StageSetupInput {
  const stage: StageSetupInput = {};
  if (input.threshold !== undefined) stage.threshold = input.threshold;
  if (input.economy) {
    const economy: NonNullable<StageSetupInput["economy"]> = {};
    if (input.economy.points && Object.keys(input.economy.points).length)
      economy.points = input.economy.points;
    if (input.economy.questions?.length) economy.questions = input.economy.questions;
    if (input.economy.missing) economy.missing = input.economy.missing;
    if (Object.keys(economy).length) stage.economy = economy;
  }
  return stage;
}

/**
 * A stored setup in the editor's shape (`fixed_rules` → `fixedRules`); `{}` for an old version.
 * Read part by part: a part the editor cannot read (a point key a later version renamed, one
 * question too many) is left out on its own, never the whole setup, so a save of the whole setup
 * keeps everything else (the analysis reads the stored setup just as leniently, setup-stage.ts).
 */
export function readStoredSetup(raw: unknown): SetupInput {
  const stored = asRecord(raw);
  if (!stored) return {};
  const dropped: string[] = [];
  const setup: SetupInput = {};
  if (typeof stored["about"] === "string") setup.about = stored["about"].slice(0, ABOUT_MAX_CHARS);
  else if (stored["about"] !== undefined) dropped.push("about");
  const fixedRules = readFixedRuleEdits(stored["fixed_rules"] ?? {});
  if (Object.keys(fixedRules).length) setup.fixedRules = fixedRules;
  const stages: NonNullable<SetupInput["stages"]> = {};
  for (const [key, value] of Object.entries(asRecord(stored["stages"]) ?? {})) {
    const parsedStage = setupStageSchema.safeParse(key);
    const own = asRecord(value);
    if (!parsedStage.success || !own) {
      dropped.push(`stages.${key}`);
      continue;
    }
    stages[parsedStage.data] = readStoredStage(own, `stages.${key}`, dropped);
  }
  if (Object.keys(stages).length) setup.stages = stages;
  if (dropped.length) console.warn("[setup-input] stored setup parts not readable", dropped);
  return setup;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readStoredStage(
  own: Record<string, unknown>,
  where: string,
  dropped: string[],
): StageSetupInput {
  const stage: StageSetupInput = {};
  const threshold = stageInputSchema.shape.threshold.safeParse(own["threshold"]);
  if (threshold.success && threshold.data !== undefined) stage.threshold = threshold.data;
  else if (own["threshold"] !== undefined) dropped.push(`${where}.threshold`);
  const economy = asRecord(own["economy"]);
  if (!economy) {
    if (own["economy"] !== undefined) dropped.push(`${where}.economy`);
    return stage;
  }
  const shape = economyInputSchema.shape;
  const read: NonNullable<StageSetupInput["economy"]> = {};
  const points: NonNullable<NonNullable<StageSetupInput["economy"]>["points"]> = {};
  for (const [key, value] of Object.entries(asRecord(economy["points"]) ?? {})) {
    const one = z.object({ [key]: shape.points.unwrap().valueType }).safeParse({ [key]: value });
    if ((ECONOMY_POINT_KEYS as readonly string[]).includes(key) && one.success) {
      points[key as keyof typeof points] = one.data[key];
    } else dropped.push(`${where}.economy.points.${key}`);
  }
  if (Object.keys(points).length) read.points = points;
  const questions = Array.isArray(economy["questions"]) ? economy["questions"] : [];
  const kept = questions
    .map((question) => shape.questions.unwrap().element.safeParse(question))
    .flatMap((result) => (result.success ? [result.data] : []))
    .slice(0, MAX_OWN_ECONOMY_QUESTIONS);
  if (kept.length < questions.length) dropped.push(`${where}.economy.questions`);
  if (kept.length) read.questions = kept;
  const missing = shape.missing.safeParse(economy["missing"]);
  if (missing.success && missing.data) read.missing = missing.data;
  else if (economy["missing"] !== undefined) dropped.push(`${where}.economy.missing`);
  if (Object.keys(read).length) stage.economy = read;
  return stage;
}

/** The own economy questions per stage, as they reach the prompt (they count in the text budget). */
export function economyQuestionsByStage(
  setup: SetupInput | undefined,
): Partial<Record<SetupStage, string[]>> {
  const questions: Partial<Record<SetupStage, string[]>> = {};
  for (const stage of SETUP_STAGES) {
    const own = setup?.stages?.[stage];
    if (!own?.economy) continue;
    const texts = readEconomySetup(own.economy, stage).questions.map((question) => question.text);
    if (texts.length) questions[stage] = texts;
  }
  return questions;
}

/** True when a setup holds anything (every version from has `{}`). */
export function hasSetup(setup: SetupInput | undefined): boolean {
  return Boolean(
    setup &&
    (setup.about?.trim() ||
      Object.keys(setup.fixedRules ?? {}).length ||
      Object.keys(setup.stages ?? {}).length),
  );
}
