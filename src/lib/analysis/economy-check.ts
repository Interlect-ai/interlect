/**
 * the stage's economy points on a screening (afsnit 6; funds/economy-points.ts has the 15 points
 * and the team's setup).
 *
 * - A figure from the registry's annual accounts is computed in code (the finance engine, princip
 *   6: financial maths never by AI); the AI only reads the other figures out of the case's
 *   material, each with a source. A registry figure wins over the AI's answer for the same point.
 * - The comparison with the team's limit is made here, never by the AI. A figure past the limit is
 *   `marked`, a figure within it `met`; a point without a limit is `answered`.
 * - A figure that is not found, or that the AI gives without a source, is `missing`: never a
 *   break, never a minus, and nothing stops the case.
 * - When the team chose "Lav en opgave på casen", every missing figure is gathered into one task
 *   ("Skaf økonomitallene: ..."), so the screening's four tasks stay four (fund 2 in the plan).
 *
 * Pure file without a database, so it can be tested with node --test.
 */
import {
  economyPoint,
  economyPointShort,
  isEconomyPointKey,
  pointsOn,
  type EconomyPointKey,
  type EconomySetup,
  type LimitDirection,
  type MissingMode,
  type OwnQuestionAnswer,
} from "../funds/economy-points.ts";
import type { Language } from "../i18n/language.ts";
import { translate } from "../i18n/translate.ts";
import type { FinanceGateContext } from "./financial-gates.ts";
import { isSetupStage, type SetupStage } from "./setup-stage.ts";

export type EconomyStatus = "met" | "marked" | "answered" | "missing";

export interface EconomyPointResult {
  key: EconomyPointKey;
  status: EconomyStatus;
  /** The figure in the point's unit (40 = 40 %), true/false for a yes/no point, else null. */
  value: number | boolean | null;
  /** The AI's short answer from the material; null for a registry figure. */
  answer: string | null;
  source: "registry" | "material" | null;
  evidenceIds: string[];
  limit: { value: number; direction: LimitDirection } | null;
  /**
   * Why a registry-only point is missing: no figure in the accounts, a registry match we are not
   * sure of, or accounts that could not be read (a technical failure, never asked for in the task).
   */
  missingReason?: RegistryGap;
}

/** Why the registry gave no figure (kept apart as in financial-gates.ts). */
export type RegistryGap = "not_found" | "identity_unsure" | "load_error";

export interface EconomyQuestionResult {
  key: string;
  text: string;
  answerKind: OwnQuestionAnswer;
  status: "answered" | "missing";
  value: number | boolean | null;
  answer: string | null;
  evidenceIds: string[];
}

/** The economy of one screening, kept on the run (`validation_result.economy`). */
export interface EconomyResult {
  stage: SetupStage;
  missingMode: MissingMode;
  points: EconomyPointResult[];
  questions: EconomyQuestionResult[];
}

/** One answer in the screening's `economy` (the AI's reading of the material). */
export interface EconomyAnswer {
  key: string;
  /** The figure in the point's unit; null for a text answer or when it is not found. */
  value: number | null;
  /** A yes/no question's answer; null (or left out) otherwise. */
  yes?: boolean | null | undefined;
  answer: string;
  evidenceIds: string[];
}

/** What the AI is asked: the points not only from the registry, and the own questions. */
export interface EconomyAsk {
  points: Array<{ key: EconomyPointKey; kind: "figure" | "text" }>;
  questions: EconomySetup["questions"];
}

/** The longest answer text kept from the AI (the JSON schema allows the same). */
export const ECONOMY_ANSWER_MAX = 300;

export function economyAsk(setup: EconomySetup | null | undefined): EconomyAsk | null {
  if (!setup) return null;
  const points = pointsOn(setup)
    .filter((point) => economyPoint(point.key).source !== "registry")
    .map((point) => ({
      key: point.key,
      kind: point.limit ? ("figure" as const) : ("text" as const),
    }));
  if (!points.length && !setup.questions.length) return null;
  return { points, questions: setup.questions };
}

/** Every key the AI must answer, in order (the JSON schema's enum and count). */
export function economyAskKeys(ask: EconomyAsk): string[] {
  return [
    ...ask.points.map((point) => point.key),
    ...ask.questions.map((question) => question.key),
  ];
}

interface RegistryFigure {
  value: number | boolean | null;
  /** The registry settles the point without a figure (a company that burns no money). */
  met?: boolean;
}

function latest(context: FinanceGateContext, key: string): number | null {
  const value = context.report?.metrics.find((metric) => metric.key === key)?.latest?.value;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * A point's figure from the registry's annual accounts, or null when the registry cannot give it:
 * no accounts, accounts that could not be read, or a registry match that is not certain (a figure
 * from a company we are not sure is this one never decides anything, as in financial-gates.ts).
 */
export function registryFigure(
  key: EconomyPointKey,
  context: FinanceGateContext | null | undefined,
): RegistryFigure | null {
  if (!context || registryGap(context) !== null) return null;
  const figure = (value: number | boolean | null) => (value === null ? null : { value });
  switch (key) {
    case "revenue_growth":
      return figure(latest(context, "revenue_growth"));
    case "gross_margin":
      return figure(latest(context, "gross_margin"));
    case "runway": {
      if (latest(context, "operating_burn") === 0) return { value: null, met: true };
      return figure(latest(context, "runway_today"));
    }
    case "positive_equity": {
      const equity = latest(context, "equity");
      return equity === null ? null : { value: equity > 0 };
    }
    case "filing_age":
      return figure(latest(context, "latest_filing_age"));
    case "going_concern": {
      const note = context.latestGoingConcernNote;
      return typeof note === "boolean" ? { value: note } : null;
    }
    case "nibd_ebitda":
      return figure(latest(context, "nibd_to_ebitda"));
    default:
      return null;
  }
}

/** Why the registry can give no figure at all for this case, or null when it can try. */
export function registryGap(context: FinanceGateContext | null | undefined): RegistryGap | null {
  if (context?.loadError) return "load_error";
  if (!context || !context.report || context.report.years.length === 0) return "not_found";
  if (!context.identityConfirmed) return "identity_unsure";
  return null;
}

/** The registry figures of the points that are on, for the prompt (the AI's text must agree). */
export function registryFigures(
  setup: EconomySetup | null | undefined,
  context: FinanceGateContext | null | undefined,
): Array<{ key: EconomyPointKey; value: number | boolean | null; met?: boolean }> {
  if (!setup || !context) return [];
  return pointsOn(setup).flatMap((point) => {
    if (economyPoint(point.key).source === "material") return [];
    const found = registryFigure(point.key, context);
    return found ? [{ key: point.key, ...found }] : [];
  });
}

/** Whether a figure is within the team's limit ("min": not under it; "max": not over it). */
export function withinLimit(
  value: number,
  limit: { value: number; direction: LimitDirection },
): boolean {
  return limit.direction === "min" ? value >= limit.value : value <= limit.value;
}

function cleanAnswer(text: string | null | undefined): string | null {
  const clean = (text ?? "").replace(/\s+/g, " ").trim().slice(0, ECONOMY_ANSWER_MAX);
  return clean || null;
}

/**
 * The stage's economy on a screening: the registry's figures, the AI's answers (only with a
 * source among the screening's evidence) and the comparison with each limit. Null without an
 * economy (an old version, or a version with nothing per stage).
 */
export function evaluateEconomy(input: {
  stage: SetupStage | null | undefined;
  setup: EconomySetup | null | undefined;
  registry: FinanceGateContext | null | undefined;
  answers: readonly EconomyAnswer[] | null | undefined;
  allowedEvidenceIds: ReadonlySet<string>;
}): EconomyResult | null {
  const { setup, stage } = input;
  if (!setup || !stage) return null;
  const answers = new Map<string, EconomyAnswer>();
  for (const answer of input.answers ?? []) {
    if (!answers.has(answer.key)) answers.set(answer.key, answer);
  }
  // An answer counts only with a source the screening actually had (princip: every figure has one).
  const sourced = (key: string) => {
    const answer = answers.get(key);
    if (!answer) return null;
    const evidenceIds = [...new Set(answer.evidenceIds)].filter((id) =>
      input.allowedEvidenceIds.has(id),
    );
    return evidenceIds.length ? { ...answer, evidenceIds } : null;
  };
  const points = pointsOn(setup).map((point): EconomyPointResult => {
    const definition = economyPoint(point.key);
    const base = { key: point.key, limit: point.limit };
    const missing: EconomyPointResult = {
      ...base,
      status: "missing",
      value: null,
      answer: null,
      source: null,
      evidenceIds: [],
    };
    const compare = (value: number | boolean): EconomyStatus => {
      if (typeof value === "boolean") {
        return value === definition.yesNo?.expected ? "met" : "marked";
      }
      return point.limit ? (withinLimit(value, point.limit) ? "met" : "marked") : "answered";
    };
    if (definition.source !== "material") {
      const found = registryFigure(point.key, input.registry);
      if (found) {
        return {
          ...base,
          status: found.met ? "met" : found.value === null ? "missing" : compare(found.value),
          value: found.value,
          answer: null,
          source: "registry",
          evidenceIds: [],
        };
      }
      if (definition.source === "registry") {
        return { ...missing, missingReason: registryGap(input.registry) ?? "not_found" };
      }
    }
    const answer = sourced(point.key);
    if (!answer) return missing;
    const text = cleanAnswer(answer.answer);
    if (point.limit) {
      return typeof answer.value === "number" && Number.isFinite(answer.value)
        ? {
            ...base,
            status: compare(answer.value),
            value: answer.value,
            answer: text,
            source: "material",
            evidenceIds: answer.evidenceIds,
          }
        : missing;
    }
    return text
      ? {
          ...base,
          status: "answered",
          value: null,
          answer: text,
          source: "material",
          evidenceIds: answer.evidenceIds,
        }
      : missing;
  });
  const questions = setup.questions.map((question): EconomyQuestionResult => {
    const base = { key: question.key, text: question.text, answerKind: question.answer };
    const answer = sourced(question.key);
    const text = cleanAnswer(answer?.answer);
    const value =
      question.answer === "yn"
        ? typeof answer?.yes === "boolean"
          ? answer.yes
          : null
        : question.answer === "num"
          ? typeof answer?.value === "number" && Number.isFinite(answer.value)
            ? answer.value
            : null
          : null;
    const answered = answer && (question.answer === "txt" ? text !== null : value !== null);
    return answered
      ? {
          ...base,
          status: "answered",
          value,
          answer: text,
          evidenceIds: answer.evidenceIds,
        }
      : { ...base, status: "missing", value: null, answer: null, evidenceIds: [] };
  });
  return { stage, missingMode: setup.missing, points, questions };
}

/**
 * The one task about missing figures ("Skaf økonomitallene: ..."), or null when nothing is missing
 * or the team chose "Skriv ukendt". The list names the missing points by their short names and
 * the team's own questions by their text.
 */
export function economyTask(
  result: EconomyResult | null | undefined,
  language: Language,
): { title: string; question: string; why: string } | null {
  if (!result || result.missingMode !== "task") return null;
  const missing = [
    ...result.points
      // A registry that could not be read is a technical failure, not a figure to get.
      .filter((point) => point.status === "missing" && point.missingReason !== "load_error")
      .map((point) => economyPointShort(point.key, language)),
    ...result.questions
      .filter((question) => question.status === "missing")
      .map((question) => `«${question.text}»`),
  ];
  if (!missing.length) return null;
  return {
    title: translate(language, "caseServer.tasks.economyTitle"),
    question: translate(language, "caseServer.tasks.economyQuestion", {
      list: missing.join(", "),
    }),
    why: translate(language, "caseServer.tasks.economyWhy"),
  };
}

/** A kept economy (`validation_result.economy`), or null when it is not one (an older run). */
export function readEconomyResult(value: unknown): EconomyResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw["points"]) || !Array.isArray(raw["questions"])) return null;
  if (!isSetupStage(raw["stage"])) return null;
  const points = (raw["points"] as unknown[]).filter(
    (point): point is EconomyPointResult =>
      !!point &&
      typeof point === "object" &&
      isEconomyPointKey((point as Record<string, unknown>)["key"]),
  );
  return {
    stage: raw["stage"],
    missingMode: raw["missingMode"] === "unknown" ? "unknown" : "task",
    points,
    questions: (raw["questions"] as unknown[]).filter(
      (question): question is EconomyQuestionResult =>
        !!question &&
        typeof question === "object" &&
        typeof (question as Record<string, unknown>)["key"] === "string" &&
        typeof (question as Record<string, unknown>)["text"] === "string",
    ),
  };
}
