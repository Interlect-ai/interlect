/**
 * the 15 economy points in "Sådan screener vi" (punkt 5 og afsnit 6; the prototype `Teamopsaetning
 * v3.dc.html`, `fin`, `DRAFT.*.fin` and `finPrompt`). Each chosen stage has its own economy: which
 * points are on, the limit of each
 * point, the team's own questions about the economy, and what happens when a figure is missing
 * (a task on the case, or just "unknown"). The texts live in the dictionaries (`fundSetup.economy`).
 *
 * A point is never a requirement. A figure past its limit is marked on the case, a missing figure
 * is "missing" (never a break, never a minus), and nothing ever stops a case (beslutningsloggen 15.
 * nov 2026). Fixed requirements belong under Mandat.
 *
 * Stored per stage in `fund_mandates.setup.stages.<stage>.economy` (0133, shape only checked by
 * the database):
 *   { points?: { <key>: { on?: boolean, threshold?: number } },
 *     questions?: [{ text: string, answer: "yn" | "num" | "txt" }],
 *     missing?: "task" | "unknown" }
 * Anything left out has the stage's standard (the prototype's draft per stage), so "Nulstil" is
 * removing the key, and a stage without an `economy` reads as the standard the editor shows.
 *
 * Pure file without a database, so it can be tested with node --test.
 */
import { DICTIONARIES } from "../i18n/translate.ts";
import type { Language } from "../i18n/language.ts";
import { cleanTeamLine } from "../analysis/team-text.ts";
import type { SetupStage } from "../analysis/setup-stage.ts";

export const ECONOMY_GROUPS = ["growth", "margins", "cash", "round", "accounts"] as const;
export type EconomyGroup = (typeof ECONOMY_GROUPS)[number];

/**
 * Where a point's answer comes from (the prototype's last line in finPrompt: "Tal fra registrenes
 * årsrapporter regnes af Interlect. Øvrige tal læses ud af casens materiale og får en kilde."):
 * - `registry`: only the registry's annual accounts, computed in code; never asked of the AI;
 * - `registry_or_material`: computed in code when the registry has it, else read from the material;
 * - `material`: read from the case's material by the AI, with a source.
 */
export type EconomySource = "registry" | "registry_or_material" | "material";

/** "min": marked when the figure is under the limit; "max": marked when it is over. */
export type LimitDirection = "min" | "max";

export interface EconomyPointDefinition {
  key: string;
  group: EconomyGroup;
  source: EconomySource;
  /** A figure compared with a limit; the team can change the limit. */
  limit?: { value: number; direction: LimitDirection };
  /** A yes/no point; `expected` is the good answer (no going concern note: false). */
  yesNo?: { expected: boolean };
}

/** The 15 points in the prototype's order, with its standard limits. */
export const ECONOMY_POINTS = [
  {
    key: "revenue_growth",
    group: "growth",
    source: "registry_or_material",
    limit: { value: 100, direction: "min" },
  },
  {
    key: "customer_concentration",
    group: "growth",
    source: "material",
    limit: { value: 30, direction: "max" },
  },
  {
    key: "net_retention",
    group: "growth",
    source: "material",
    limit: { value: 100, direction: "min" },
  },
  {
    key: "gross_margin",
    group: "margins",
    source: "registry_or_material",
    limit: { value: 60, direction: "min" },
  },
  {
    key: "cac_payback",
    group: "margins",
    source: "material",
    limit: { value: 18, direction: "max" },
  },
  { key: "unit_economics", group: "margins", source: "material" },
  {
    key: "runway",
    group: "cash",
    source: "registry_or_material",
    limit: { value: 12, direction: "min" },
  },
  { key: "use_of_funds", group: "cash", source: "material" },
  { key: "round_size", group: "round", source: "material" },
  {
    key: "valuation_multiple",
    group: "round",
    source: "material",
    limit: { value: 15, direction: "max" },
  },
  {
    key: "founder_ownership",
    group: "round",
    source: "material",
    limit: { value: 50, direction: "min" },
  },
  { key: "positive_equity", group: "accounts", source: "registry", yesNo: { expected: true } },
  {
    key: "filing_age",
    group: "accounts",
    source: "registry",
    limit: { value: 18, direction: "max" },
  },
  { key: "going_concern", group: "accounts", source: "registry", yesNo: { expected: false } },
  {
    key: "nibd_ebitda",
    group: "accounts",
    source: "registry",
    limit: { value: 3, direction: "max" },
  },
] as const satisfies ReadonlyArray<EconomyPointDefinition>;

export type EconomyPointKey = (typeof ECONOMY_POINTS)[number]["key"];

export const ECONOMY_POINT_KEYS: readonly EconomyPointKey[] = ECONOMY_POINTS.map(
  (point) => point.key,
);

export function isEconomyPointKey(value: unknown): value is EconomyPointKey {
  return typeof value === "string" && (ECONOMY_POINT_KEYS as readonly string[]).includes(value);
}

export function economyPoint(key: EconomyPointKey): EconomyPointDefinition {
  return ECONOMY_POINTS.find((point) => point.key === key)!;
}

/**
 * The points that are on by standard per stage: the prototype's `DRAFT.<kind>.fin` (pre-seed,
 * seed, Series A; every later stage has all 15). Its limits are the same for every stage.
 */
const STANDARD_ON: Record<"pre" | "seed" | "a" | "late", readonly EconomyPointKey[] | "all"> = {
  pre: ["runway", "use_of_funds", "round_size", "founder_ownership"],
  seed: [
    "revenue_growth",
    "customer_concentration",
    "runway",
    "use_of_funds",
    "round_size",
    "filing_age",
  ],
  a: [
    "revenue_growth",
    "customer_concentration",
    "net_retention",
    "gross_margin",
    "cac_payback",
    "runway",
    "use_of_funds",
    "round_size",
    "valuation_multiple",
    "founder_ownership",
    "filing_age",
  ],
  late: "all",
};

function standardKind(stage: SetupStage): keyof typeof STANDARD_ON {
  if (stage === "pre_seed") return "pre";
  if (stage === "seed") return "seed";
  if (stage === "series_a") return "a";
  return "late";
}

export function isStandardOn(stage: SetupStage, key: EconomyPointKey): boolean {
  const on = STANDARD_ON[standardKind(stage)];
  return on === "all" || on.includes(key);
}

/** The answer an own question asks for (prototype FQOPT). */
export const OWN_QUESTION_ANSWERS = ["yn", "num", "txt"] as const;
export type OwnQuestionAnswer = (typeof OWN_QUESTION_ANSWERS)[number];

/** What happens when a figure is missing (prototype "Hvis en oplysning mangler"). */
export const MISSING_MODES = ["task", "unknown"] as const;
export type MissingMode = (typeof MISSING_MODES)[number];

/** At most this many own questions per stage; more are left out (they would crowd the screening). */
export const MAX_OWN_ECONOMY_QUESTIONS = 10;
/** The longest own question; a longer one is cut (team text, cleaned as one line). */
export const OWN_QUESTION_MAX_CHARS = 300;
/** A limit is a non-negative number below this (a typo like 1e9 is ignored, not sent on). */
const LIMIT_MAX = 1_000_000;

export interface EconomyPointSetup {
  key: EconomyPointKey;
  on: boolean;
  /** The limit the figure is compared with; null for a point without a limit. */
  limit: { value: number; direction: LimitDirection } | null;
}

export interface OwnEconomyQuestion {
  /** Stable within the stage: "own_1", "own_2" ... in the stored order. */
  key: string;
  text: string;
  answer: OwnQuestionAnswer;
}

/** One stage's economy as the analysis reads it: every point, with the standard where unset. */
export interface EconomySetup {
  points: EconomyPointSetup[];
  questions: OwnEconomyQuestion[];
  missing: MissingMode;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readLimit(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value < LIMIT_MAX
    ? value
    : null;
}

/**
 * A stage's stored economy (`setup.stages.<stage>.economy`) with the stage's standard where it is
 * unset or not valid. A bad value is ignored rather than sent to a prompt: the database checks
 * only the shape (fund_setup_ok, 0133). An own question is cleaned as team text.
 */
export function readEconomySetup(raw: unknown, stage: SetupStage): EconomySetup {
  const stored = record(raw);
  const storedPoints = record(stored?.["points"]);
  const points = ECONOMY_POINTS.map((definition): EconomyPointSetup => {
    const own = record(storedPoints?.[definition.key]);
    const on = typeof own?.["on"] === "boolean" ? own["on"] : isStandardOn(stage, definition.key);
    const base = "limit" in definition ? definition.limit : null;
    const value = base ? (readLimit(own?.["threshold"]) ?? base.value) : null;
    return {
      key: definition.key,
      on,
      limit: base && value !== null ? { value, direction: base.direction } : null,
    };
  });
  const questions: OwnEconomyQuestion[] = [];
  const rawQuestions = Array.isArray(stored?.["questions"]) ? stored["questions"] : [];
  for (const item of rawQuestions) {
    if (questions.length >= MAX_OWN_ECONOMY_QUESTIONS) break;
    const question = record(item);
    const text = cleanTeamLine(
      typeof question?.["text"] === "string" ? question["text"] : "",
    ).slice(0, OWN_QUESTION_MAX_CHARS);
    if (!text) continue;
    const answer = question?.["answer"];
    questions.push({
      key: `own_${questions.length + 1}`,
      text,
      answer: (OWN_QUESTION_ANSWERS as readonly unknown[]).includes(answer)
        ? (answer as OwnQuestionAnswer)
        : "txt",
    });
  }
  const missing = stored?.["missing"] === "unknown" ? "unknown" : "task";
  return { points, questions, missing };
}

/** The points that are on. */
export function pointsOn(setup: EconomySetup): EconomyPointSetup[] {
  return setup.points.filter((point) => point.on);
}

function economyTexts(language: Language) {
  return DICTIONARIES[language].fundSetup.economy;
}

/** A point's question in the language (the prompt uses Danish, the team's screens their own). */
export function economyPointQuestion(key: EconomyPointKey, language: Language): string {
  return economyTexts(language).points[key].question;
}

/** The unit after a point's limit ("% vækst år til år"); "" for a point without a limit (no text). */
export function economyPointUnit(key: EconomyPointKey, language: Language): string {
  const texts = economyTexts(language).points[key];
  return "unit" in texts ? texts.unit : "";
}

/** Where a point's figure is found ("Regnskab, deck og bilag"). */
export function economyPointSource(key: EconomyPointKey, language: Language): string {
  return economyTexts(language).points[key].source;
}

/** A point's short name in the one task about missing figures ("burn og runway"). */
export function economyPointShort(key: EconomyPointKey, language: Language): string {
  return economyTexts(language).points[key].short;
}

export function economyGroupTitle(group: EconomyGroup, language: Language): string {
  return economyTexts(language).groups[group];
}
