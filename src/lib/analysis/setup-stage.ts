/**
 * Teamopsætning pr. stadie in the analysis (afsnit 1-4; beslutningsloggen 15. nov 2026). Each stage
 * the team chose has its own setup:
 * criteria with weights, the mandate's rules, specialists and their texts (0133 puts a nullable
 * `stage` on the four tables, `fund_mandates.setup` holds the rest).
 *
 * Which stage a case is analysed with:
 * - the case's own stage, when the team chose it;
 * - unknown case stage: the earliest stage the team chose, marked "stadie antaget" (assumed);
 * - a known stage the team did not choose: the nearest chosen stage (the earlier on a tie), marked
 *   "outside". The shared mandate rule "Stadie" says on the case whether that breaks the mandate.
 * Nothing ever stops a case. A version with nothing per stage (every row `stage = null`, which is
 * every version from) has no stage choice and reads exactly as before.
 *
 * Which rows apply for the stage:
 * - lists that must add up (criteria with weights summing to 100, a stage's set of specialists):
 *   the stage's own rows when it has any, else the shared rows (`stage = null`);
 * - rules that add up (the mandate's gates, a specialist's own text): the shared rows, which are
 *   the thesis' shared mandate (Stadier, Geografi, Sektorer: Bindende or Op til vurdering), with
 *   the stage's own row in place of a shared row with the same key.
 * A partly filled new version thus falls back to the thesis' shared content, never to nothing.
 *
 * Pure file without a database, so it can be tested with node --test.
 */
import { stageKey } from "../funds/basis-labels.ts";
import { readFixedRuleEdits, type FixedRuleEdits } from "../funds/fixed-rules.ts";
import { readEconomySetup, type EconomySetup } from "../funds/economy-points.ts";
import {
  cleanTeamText,
  TEAM_TEXT_BUDGET,
  teamTextUsed,
  type TeamTextBudget,
  type TeamTextFields,
} from "./team-text.ts";

/** The seven setup stages (company_stage without 'unknown'), in the order the team sees them. */
export const SETUP_STAGES = [
  "pre_seed",
  "seed",
  "series_a",
  "series_b",
  "growth",
  "buyout",
  "later",
] as const;
export type SetupStage = (typeof SETUP_STAGES)[number];

export function isSetupStage(value: unknown): value is SetupStage {
  return typeof value === "string" && (SETUP_STAGES as readonly string[]).includes(value);
}

/**
 * A stored stage as a setup stage, or null for unknown or own text: a company_stage, a mandate key
 * ("series_a") or an old name ("Serie A"). "Series B+" (`series_b_plus`, the old alias "serie b+")
 * is the stage `series_b` ("Series B er stadie").
 */
export function setupStageOf(value: string | null | undefined): SetupStage | null {
  if (!value) return null;
  const key = stageKey(value);
  if (key === "series_b_plus") return "series_b";
  return isSetupStage(key) ? key : null;
}

/** The team's chosen stages (`fund_mandates.stages`) as setup stages, each once, in order. */
export function chosenSetupStages(stages: readonly string[] | null | undefined): SetupStage[] {
  const chosen = new Set<SetupStage>();
  for (const value of stages ?? []) {
    const stage = setupStageOf(value);
    if (stage) chosen.add(stage);
  }
  return SETUP_STAGES.filter((stage) => chosen.has(stage));
}

/** Why the analysis uses the stage it uses. */
export type SetupStageReason = "case" | "unknown" | "outside";

/** The stage a case is analysed with; kept on the run so a rescore uses the same setup. */
export interface SetupStageChoice {
  stage: SetupStage;
  /** The case's own stage as a setup stage; null when it is unknown. */
  caseStage: SetupStage | null;
  reason: SetupStageReason;
  /** "stadie antaget": the case's stage is unknown, so the earliest chosen stage is used. */
  assumed: boolean;
}

/**
 * The stage a case is analysed with, or null when the version has nothing per stage (`configured`
 * is empty): then every row is shared and the analysis reads as. The candidates are
 * the team's chosen stages, or the configured ones when the mandate names none of the seven.
 */
export function resolveSetupStage(input: {
  caseStage: string | null | undefined;
  chosen: readonly SetupStage[];
  configured: readonly SetupStage[];
}): SetupStageChoice | null {
  if (input.configured.length === 0) return null;
  const candidates = SETUP_STAGES.filter((stage) =>
    (input.chosen.length ? input.chosen : input.configured).includes(stage),
  );
  const caseStage = setupStageOf(input.caseStage);
  if (caseStage && candidates.includes(caseStage)) {
    return { stage: caseStage, caseStage, reason: "case", assumed: false };
  }
  if (!caseStage) {
    return { stage: candidates[0]!, caseStage: null, reason: "unknown", assumed: true };
  }
  const index = SETUP_STAGES.indexOf(caseStage);
  const distance = (stage: SetupStage) => Math.abs(SETUP_STAGES.indexOf(stage) - index);
  // `candidates` is in stage order, so the first of the nearest is the earlier one.
  const nearest = candidates.reduce((best, stage) =>
    distance(stage) < distance(best) ? stage : best,
  );
  return { stage: nearest, caseStage, reason: "outside", assumed: false };
}

/** A choice kept on a run (`validation_result.setupStage`), or null when it is not a valid one. */
export function readSetupStageChoice(value: unknown): SetupStageChoice | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (!isSetupStage(raw["stage"])) return null;
  const reason = raw["reason"];
  if (reason !== "case" && reason !== "unknown" && reason !== "outside") return null;
  return {
    stage: raw["stage"],
    caseStage: isSetupStage(raw["caseStage"]) ? raw["caseStage"] : null,
    reason,
    assumed: raw["assumed"] === true,
  };
}

/** A row of one of the four tables with `stage` (0133); old selects without the column read as shared. */
export interface StagedRow {
  stage?: string | null | undefined;
}

/** The stages a version's rows name (any row with a setup stage). */
export function stagesOfRows(rows: ReadonlyArray<StagedRow>): SetupStage[] {
  const named = new Set(rows.map((row) => row.stage).filter(isSetupStage));
  return SETUP_STAGES.filter((stage) => named.has(stage));
}

/**
 * A list that must add up for the stage (criteria, a stage's set of specialists): the stage's own
 * rows when it has any, else the shared rows. Without a stage: the shared rows.
 */
export function rowsForStageList<T extends StagedRow>(
  rows: readonly T[],
  stage: SetupStage | null,
): T[] {
  const shared = rows.filter((row) => !row.stage);
  if (!stage) return shared;
  const own = rows.filter((row) => row.stage === stage);
  return own.length ? own : shared;
}

/**
 * Rules that add up for the stage (the mandate's gates, a specialist's own text): the shared rows,
 * with the stage's own row in place of a shared row with the same key, then the stage's other rows.
 */
export function rowsForStageMerge<T extends StagedRow>(
  rows: readonly T[],
  stage: SetupStage | null,
  keyOf: (row: T) => string,
): T[] {
  const shared = rows.filter((row) => !row.stage);
  if (!stage) return shared;
  const own = rows.filter((row) => row.stage === stage);
  const ownKeys = new Set(own.map(keyOf));
  return [...shared.filter((row) => !ownKeys.has(keyOf(row))), ...own];
}

/** One stage's part of `setup.stages` that the analysis reads. */
export interface StageSetup {
  /** The stage's own threshold for deep analysis (0-100); missing = the mandate's threshold. */
  threshold?: number;
  /**
   * The stage's stored economy as it is (`economy`); read with the stage's standard by
   * `readEconomySetup` (funds/economy-points.ts). Missing = the standard.
   */
  economy?: unknown;
}

/** The part of `fund_mandates.setup` the analysis reads (0133); other keys are left to their sessions. */
export interface TeamSetup {
  /** "Hvem er I, og hvordan tænker I?", cleaned team text; "" when the team wrote nothing. */
  about: string;
  /** The team's edits to the 9 editable fixed rules (fixed-rules.ts). */
  fixedRules: FixedRuleEdits;
  stages: Partial<Record<SetupStage, StageSetup>>;
}

function readStageSetup(raw: unknown): StageSetup | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const threshold = (raw as Record<string, unknown>)["threshold"];
  const economy = (raw as Record<string, unknown>)["economy"];
  return {
    ...(typeof threshold === "number" &&
    Number.isInteger(threshold) &&
    threshold >= 0 &&
    threshold <= 100
      ? { threshold }
      : {}),
    ...(economy !== undefined ? { economy } : {}),
  };
}

/**
 * `fund_mandates.setup` as the analysis reads it, or null when it holds nothing (every version from
 * has `{}`). The database checks only the shape (`fund_setup_ok`); the values
 * are checked here, and a bad value is ignored rather than sent to a prompt.
 */
export function readTeamSetup(raw: unknown): TeamSetup | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const setup = raw as Record<string, unknown>;
  // The database keeps it at most 3,000 characters (fund_setup_ok); cleaning only shortens it.
  const about = typeof setup["about"] === "string" ? cleanTeamText(setup["about"]) : "";
  const fixedRules = readFixedRuleEdits(setup["fixed_rules"]);
  const stages: Partial<Record<SetupStage, StageSetup>> = {};
  const rawStages = setup["stages"];
  if (rawStages && typeof rawStages === "object" && !Array.isArray(rawStages)) {
    for (const [key, value] of Object.entries(rawStages as Record<string, unknown>)) {
      const stageSetup = isSetupStage(key) ? readStageSetup(value) : null;
      if (stageSetup && isSetupStage(key)) stages[key] = stageSetup;
    }
  }
  if (!about && Object.keys(fixedRules).length === 0 && Object.keys(stages).length === 0) {
    return null;
  }
  return { about, fixedRules, stages };
}

/** The text fields with the stage of each criterion and gate (0133). */
export interface StagedTeamTextFields extends Omit<TeamTextFields, "criteria" | "gates"> {
  criteria: ReadonlyArray<{ description?: string | undefined; stage?: string | null | undefined }>;
  gates: ReadonlyArray<{
    key: string;
    description?: string | undefined;
    stage?: string | null | undefined;
  }>;
  /**
   * The team's own questions about the economy per stage (`setup.stages.<stage>.economy`,
   * read with `readEconomySetup`); they reach the screening prompt, so they count in their stage.
   */
  economyQuestions?: Partial<Record<SetupStage, readonly string[]>> | undefined;
}

/**
 * The character budget (TEAM_TEXT_BUDGET) per stage, so a team with three stages
 * does not share 8,000 characters. Each stage the criteria or gates name counts the shared texts
 * and its own criteria and gates as the analysis reads them (rowsForStageList/Merge). A setup with
 * nothing per stage is counted once, exactly as before. The stage with the most text is returned
 * (null when nothing is per stage or the shared rows are the most), so a publish can say which
 * stage is over.
 */
export function teamTextBudgetByStage(
  fields: StagedTeamTextFields,
): TeamTextBudget & { stage: SetupStage | null } {
  const economyQuestions = fields.economyQuestions ?? {};
  const stages = stagesOfRows([
    ...fields.criteria,
    ...fields.gates,
    ...Object.keys(economyQuestions).map((stage) => ({ stage })),
  ]);
  // Stage null is the shared reading (every row of a setup with nothing per stage), which a chosen
  // stage without rows of its own uses, so it counts too.
  const count = (stage: SetupStage | null) =>
    teamTextUsed({
      ...fields,
      criteria: rowsForStageList(fields.criteria, stage),
      gates: rowsForStageMerge(fields.gates, stage, (gate) => gate.key),
    }) + (stage ? (economyQuestions[stage] ?? []).reduce((sum, text) => sum + text.length, 0) : 0);
  let worst: { stage: SetupStage | null; used: number } = { stage: null, used: count(null) };
  for (const stage of stages) {
    const used = count(stage);
    if (used > worst.used) worst = { stage, used };
  }
  return {
    used: worst.used,
    limit: TEAM_TEXT_BUDGET,
    over: worst.used > TEAM_TEXT_BUDGET,
    stage: worst.stage,
  };
}

/**
 * The part of a version the analysis reads for one case (mapProfile in fund-profile.ts): the
 * stage, the gates and criteria of that stage, the stage's threshold and the setup that is not
 * rows. A run's own choice wins while it is still one of the version's stages (a rescore and the
 * deep analysis use their screening's stage); else the case's stage is resolved. Without a case
 * (an editor or an assistant) the stage is unknown, so the earliest chosen stage is used.
 */
export function selectSetupForStage<
  G extends StagedRow & { gate_key: string },
  C extends StagedRow,
>(input: {
  gates: readonly G[];
  criteria: readonly C[];
  mandateStages: readonly string[] | null | undefined;
  setup: unknown;
  /** Other rows of the version that may name a stage (its specialists), only to find the stages. */
  otherRows?: ReadonlyArray<StagedRow> | undefined;
  caseStage?: string | null | undefined;
  runChoice?: SetupStageChoice | null | undefined;
}): {
  choice: SetupStageChoice | null;
  gates: G[];
  criteria: C[];
  threshold: number | undefined;
  setup: TeamSetup | null;
  /** The stage's economy (its standard where unset); null without a stage choice. */
  economy: EconomySetup | null;
} {
  const setup = readTeamSetup(input.setup);
  const configured = stagesOfRows([
    ...input.gates,
    ...input.criteria,
    ...(input.otherRows ?? []),
    ...Object.keys(setup?.stages ?? {}).map((stage) => ({ stage })),
  ]);
  const chosen = chosenSetupStages(input.mandateStages);
  const run = input.runChoice;
  const choice =
    configured.length === 0
      ? null
      : run && (chosen.includes(run.stage) || configured.includes(run.stage))
        ? run
        : resolveSetupStage({ caseStage: input.caseStage, chosen, configured });
  const stage = choice?.stage ?? null;
  return {
    choice,
    gates: rowsForStageMerge(input.gates, stage, (row) => row.gate_key),
    criteria: rowsForStageList(input.criteria, stage),
    threshold: stage ? setup?.stages[stage]?.threshold : undefined,
    setup,
    economy: stage ? readEconomySetup(setup?.stages[stage]?.economy, stage) : null,
  };
}
