/**
 * The numbers and groups on the screening page (Case Screening v5), derived from the run in code
 * and never guessed. Pure (tested); only type imports, so `node --test` can load the file.
 *
 * - Profil mod tesen: each criterion's contribution is weight × score / 100; they add up to the
 *   weighted score, which is how the score is calculated (scoring.ts).
 * - Mandatfit: gates grouped as "Mangler svar", "Ikke opfyldt" and "Opfyldt", each with the task
 *   that answers it.
 * - Nøglefund: the run's key findings tied to criteria (prompt v8+), else its own strengths and
 *   weaknesses without a criterion.
 */
import type { KeyFinding } from "../analysis/contracts";
import { DEFAULT_LANGUAGE, LANGUAGE_TAGS, type Language } from "../i18n/language.ts";
import { translate } from "../i18n/translate.ts";
import { criterionColors } from "../charts/colors.ts";

export interface ProfileCriterionInput {
  criterionKey: string;
  label: string;
  weight: number;
  score: number | null;
  isStagePrior?: boolean | undefined;
}

export interface ProfileRow {
  key: string;
  label: string;
  /** Weight in percent. */
  weight: number;
  score: number | null;
  /** weight × score / 100: the criterion's points in the weighted score. */
  contribution: number;
  /** The criterion's colour (--series-N in the fund's own order). */
  color: string;
  isStagePrior: boolean;
}

export function profileRows(criteria: readonly ProfileCriterionInput[]): ProfileRow[] {
  // The fund's criteria in their own order get --series-1 … --series-10 (the prototype's rule).
  const colors = criterionColors(criteria.map((criterion) => criterion.criterionKey));
  return criteria.map((criterion) => ({
    key: criterion.criterionKey,
    label: criterion.label,
    weight: criterion.weight,
    score: criterion.score,
    contribution: ((criterion.score ?? 0) * criterion.weight) / 100,
    color: colors.of(criterion.criterionKey),
    isStagePrior: criterion.isStagePrior === true,
  }));
}

/** The weighted score, one decimal (scoring.ts rounds the same way). */
export function weightedScore(rows: readonly ProfileRow[]): number {
  return Math.round(rows.reduce((sum, row) => sum + row.contribution, 0) * 10) / 10;
}

/** "Løfter mest": the criterion with the most points in the score. */
export function liftsMost(rows: readonly ProfileRow[]): ProfileRow | null {
  return rows.reduce<ProfileRow | null>(
    (best, row) =>
      row.score !== null && (!best || row.contribution > best.contribution) ? row : best,
    null,
  );
}

/**
 * "Længst fra tesen": the criterion below the fund's threshold that costs the most points
 * (weight × distance to the threshold). The fund has no target per criterion, so the threshold
 * is the line (gap/R-5-screening.md, choice 5). null when every criterion reaches it.
 */
export function farthestFromThreshold(
  rows: readonly ProfileRow[],
  threshold: number | null,
): { row: ProfileRow; shortfall: number } | null {
  if (threshold === null) return null;
  let best: { row: ProfileRow; shortfall: number } | null = null;
  for (const row of rows) {
    if (row.score === null || row.score >= threshold) continue;
    const shortfall = ((threshold - row.score) * row.weight) / 100;
    if (!best || shortfall > best.shortfall) best = { row, shortfall };
  }
  return best;
}

const oneDecimal = new Map<Language, Intl.NumberFormat>();
const upToOneDecimal = new Map<Language, Intl.NumberFormat>();

function numberFormat(
  cache: Map<Language, Intl.NumberFormat>,
  language: Language,
  options: Intl.NumberFormatOptions,
): Intl.NumberFormat {
  let format = cache.get(language);
  if (!format) {
    format = new Intl.NumberFormat(LANGUAGE_TAGS[language], options);
    cache.set(language, format);
  }
  return format;
}

/** "+14,4" (a criterion's points without the unit, always one decimal and a sign). */
export function formatSignedPoints(points: number, language: Language = DEFAULT_LANGUAGE): string {
  const sign = points < 0 ? "−" : "+";
  const format = numberFormat(oneDecimal, language, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  return `${sign}${format.format(Math.abs(points))}`;
}

/** "+14,4 p" (a criterion's points, always one decimal and a sign). */
export function formatPoints(points: number, language: Language = DEFAULT_LANGUAGE): string {
  return `${formatSignedPoints(points, language)} ${translate(language, "screening.summary.pointsUnit")}`;
}

/**
 * The change between two scores as the reader sees it: both are rounded to one decimal first
 * (the way `formatScore` shows them), so "69,6 to 69,2" is -0,4, and only two scores that read
 * the same give 0.
 */
export function scoreChange(score: number, before: number): number {
  const round = (value: number) => Math.round(value * 10) / 10;
  return Math.round((round(score) - round(before)) * 10) / 10;
}

/**
 * The score as a whole number on the surface (as the prototype: "81"); the decimal stays on
 * the pages where the points are worked out (Profil mod tesen, the committee pack). Rounded down
 * (after the one-decimal rounding `formatScore` shows), so a 69,6 below a threshold of 70 never
 * reads as 70.
 */
export function wholeScore(score: number): number {
  return Math.floor(Math.round(score * 10) / 10);
}

/** "81", or "–" without a score. */
export function formatWholeScore(
  score: number | null,
  language: Language = DEFAULT_LANGUAGE,
): string {
  return score === null ? "–" : formatScore(wholeScore(score), language);
}

/** "72" or "72,5" (scores are shown with a Danish decimal comma, never a trailing ",0"). */
export function formatScore(score: number | null, language: Language = DEFAULT_LANGUAGE): string {
  return score === null
    ? "–"
    : numberFormat(upToOneDecimal, language, { maximumFractionDigits: 1 }).format(
        Math.round(score * 10) / 10,
      );
}

// ---------------------------------------------------------------------------
// Mandatfit
// ---------------------------------------------------------------------------

export interface MandatGateInput {
  key: string;
  label: string;
  passed: boolean | null;
  rationale: string | null;
  teamAnswered?: boolean | undefined;
}

export interface MandatTaskInput {
  id: string;
  linkedKind: "gate" | "criterion" | null;
  linkedKey: string | null;
  status: "open" | "resolved";
  resolvedAt: string | null;
  createdAt: string;
}

export interface MandatRow<G extends MandatGateInput, T extends MandatTaskInput> {
  gate: G;
  status: "passed" | "unknown" | "failed";
  /** The open task that answers the gate, else the newest answered one; null when none. */
  task: T | null;
}

/**
 * The gates in the prototype's groups, in the fund's order: "Mangler svar" (unknown), "Ikke
 * opfyldt" (a breach; not in the prototype, which has none) and "Opfyldt".
 */
export function mandatGroups<G extends MandatGateInput, T extends MandatTaskInput>(
  gates: readonly G[],
  tasks: readonly T[],
): { missing: MandatRow<G, T>[]; failed: MandatRow<G, T>[]; passed: MandatRow<G, T>[] } {
  const taskFor = (key: string): T | null => {
    const linked = tasks.filter((task) => task.linkedKind === "gate" && task.linkedKey === key);
    const open = linked.filter((task) => task.status === "open");
    // A live team answer is what the row edits; a stray open task must not shadow it, or saving
    // would write a second answer next to a binding one.
    const teamAnswered = gates.find((gate) => gate.key === key)?.teamAnswered === true;
    if (open.length && !(teamAnswered && linked.some((task) => task.resolvedAt !== null)))
      return open.reduce((a, b) => (a.createdAt >= b.createdAt ? a : b));
    const answered = linked.filter((task) => task.resolvedAt !== null);
    return answered.length
      ? answered.reduce((a, b) => ((a.resolvedAt ?? "") >= (b.resolvedAt ?? "") ? a : b))
      : null;
  };
  const rows = gates.map((gate) => ({
    gate,
    status: (gate.passed === true
      ? "passed"
      : gate.passed === false
        ? "failed"
        : "unknown") as MandatRow<G, T>["status"],
    task: taskFor(gate.key),
  }));
  return {
    missing: rows.filter((row) => row.status === "unknown"),
    failed: rows.filter((row) => row.status === "failed"),
    passed: rows.filter((row) => row.status === "passed"),
  };
}

// ---------------------------------------------------------------------------
// Nøglefund
// ---------------------------------------------------------------------------

export interface FindingRow {
  statement: string;
  /** The criterion it moves (null for runs before prompt v8). */
  criterionLabel: string | null;
  color: string | null;
  /** Betydning 1–3 (null for runs before prompt v8). */
  importance: 1 | 2 | 3 | null;
}

/**
 * "Styrker" and "Svagheder". Findings tied to criteria come first by importance; a run without
 * them shows its own strengths and weaknesses (at most four of each, as the prompt asks).
 */
export function findingColumns(input: {
  keyFindings: readonly KeyFinding[] | undefined;
  criteria: readonly { criterionKey: string; label: string }[];
  strengths: readonly string[];
  weaknesses: readonly string[];
}): { up: FindingRow[]; down: FindingRow[] } {
  const index = new Map(input.criteria.map((criterion, i) => [criterion.criterionKey, i]));
  const colors = criterionColors(input.criteria.map((criterion) => criterion.criterionKey));
  const tied = (input.keyFindings ?? []).filter((finding) => index.has(finding.criterionKey));
  if (tied.length) {
    const rows = (direction: "up" | "down") =>
      tied
        .filter((finding) => finding.direction === direction)
        .sort((a, b) => b.importance - a.importance)
        .map((finding) => {
          const i = index.get(finding.criterionKey)!;
          return {
            statement: finding.statement,
            criterionLabel: input.criteria[i]!.label,
            color: colors.of(finding.criterionKey),
            importance: Math.min(3, Math.max(1, Math.round(finding.importance))) as 1 | 2 | 3,
          };
        });
    return { up: rows("up"), down: rows("down") };
  }
  const plain = (statements: readonly string[]) =>
    statements.slice(0, 4).map((statement) => ({
      statement,
      criterionLabel: null,
      color: null,
      importance: null,
    }));
  return { up: plain(input.strengths), down: plain(input.weaknesses) };
}

/** Balance bar: the findings' weight on each side (importance, or 1 each without it). */
export function findingBalance(columns: { up: FindingRow[]; down: FindingRow[] }): {
  up: number;
  down: number;
} {
  const weight = (rows: FindingRow[]) => rows.reduce((sum, row) => sum + (row.importance ?? 1), 0);
  return { up: weight(columns.up), down: weight(columns.down) };
}

// ---------------------------------------------------------------------------
// Resumé
// ---------------------------------------------------------------------------

/** The line under the summary (Screening v5: "Interlect anbefaler dyb analyse. Hvorfor?"). */
export function recommendationLine(
  recommendation: string | null,
  language: Language = DEFAULT_LANGUAGE,
): string | null {
  switch (recommendation) {
    case "go_forward":
      return translate(language, "screening.summary.recGoForward");
    case "follow":
      return translate(language, "screening.summary.recFollow");
    case "reject":
      return translate(language, "screening.summary.recReject");
    case "outside_thesis_interesting":
      return translate(language, "screening.summary.recOutside");
    default:
      return null;
  }
}

/** "Læs mere om virksomheden" (v0.5): the six sections in their order. */
export const COMPANY_PROFILE_SECTIONS = [
  ["business", "screening.summary.sectionBusiness"],
  ["productModel", "screening.summary.sectionProductModel"],
  ["market", "screening.summary.sectionMarket"],
  ["team", "screening.summary.sectionTeam"],
  ["economyCapital", "screening.summary.sectionEconomyCapital"],
  ["status", "screening.summary.sectionStatus"],
] as const;

/** The sections with text (a section the model left empty is not shown). */
export function companyProfileSections(
  profile: Record<(typeof COMPANY_PROFILE_SECTIONS)[number][0], string> | null | undefined,
  language: Language = DEFAULT_LANGUAGE,
): { heading: string; text: string }[] {
  if (!profile) return [];
  return COMPANY_PROFILE_SECTIONS.flatMap(([key, headingKey]) => {
    const text = profile[key]?.trim();
    return text ? [{ heading: translate(language, headingKey), text }] : [];
  });
}

/**
 * "Sådan passer casen til tesen": the code's own reading of the score, from the numbers on the
 * page (the same sentences the screening stores, recalculated, so they never disagree with the
 * score shown).
 */
export function fitSummary(
  rows: readonly ProfileRow[],
  threshold: number | null,
  language: Language = DEFAULT_LANGUAGE,
): string | null {
  const scored = rows.filter((row) => row.score !== null);
  if (scored.length === 0) return null;
  const score = weightedScore(rows);
  const lines: string[] = [];
  if (threshold !== null) {
    const delta = Math.round((score - threshold) * 10) / 10;
    lines.push(
      translate(language, "screening.summary.fitScore", {
        score: formatScore(score, language),
        delta:
          delta >= 0
            ? translate(language, "screening.summary.fitOver", {
                points: formatScore(delta, language),
              })
            : translate(language, "screening.summary.fitUnder", {
                points: formatScore(Math.abs(delta), language),
              }),
        threshold: formatScore(threshold, language),
      }),
    );
  }
  const sorted = [...scored].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const strongest = sorted[0]!;
  const weakest = sorted[sorted.length - 1]!;
  if (strongest.key !== weakest.key) {
    lines.push(
      translate(language, "screening.summary.fitDrivers", {
        strong: strongest.label.toLowerCase(),
        strongScore: formatScore(strongest.score, language),
        weak: weakest.label.toLowerCase(),
        weakScore: formatScore(weakest.score, language),
      }),
    );
  }
  return lines.join(" ");
}
