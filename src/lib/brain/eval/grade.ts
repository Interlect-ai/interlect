/**
 * One exam attempt graded: code grades its points, the judge the rest,
 * yes or no each. The attempt passes when every critical point is fine, at least 75 % of the facts
 * are there and no must-not happened. CRAG points: right +1, "I don't know" (or no answer) 0,
 * wrong or invented -1. Only the judge can tell "I don't know" from wrong, so it reads every
 * answer, also on questions code grades alone (M2); an answer it did not read has no CRAG.
 * Pure.
 */
import {
  contextUse,
  failureType,
  inContext,
  type FailureType,
  type PointGrade,
} from "./attribution.ts";
import { facitPoints, type DemoEvalItem, type GradedPoint } from "./demo-set.ts";
import { gradeCode } from "./grade-code.ts";
import type { JudgeOutput } from "./judge.ts";

/** Share of a question's facts that must be "yes". */
export const PASS_SHARE = 0.75;

export type AttemptGrade = {
  /** null: the judge did not grade it, so the attempt is not counted. */
  pass: boolean | null;
  points: PointGrade[];
  /** Facts that are "yes" / all facts. */
  coverage: number | null;
  failure: FailureType | null;
  crag: -1 | 0 | 1 | null;
  contextFound: number;
  contextUsed: number;
  citationsJudged: number;
  citationsSupported: number;
  unsupportedClaims: string[];
};

/**
 * An error that is not Brain's answer failing: the fund's budget, the data rules, the rate limit,
 * access, or the exam script itself. Such an attempt is ungraded, never a fail, so an empty budget
 * mid-run cannot pass for a regression. Only "failed" (the chat could not answer) is Brain's.
 */
export function isInfraError(error: string | null): boolean {
  return error !== null && error !== "failed";
}

const UNGRADED: AttemptGrade = {
  pass: null,
  points: [],
  coverage: null,
  failure: null,
  crag: null,
  contextFound: 0,
  contextUsed: 0,
  citationsJudged: 0,
  citationsSupported: 0,
  unsupportedClaims: [],
};

/** The points the judge must grade (the rest are code's). */
export function judgePoints(item: DemoEvalItem): GradedPoint[] {
  return facitPoints(item).filter((point) => point.check === "judge");
}

export function gradeAttempt(input: {
  item: DemoEvalItem;
  answer: string;
  /** The stream ended with an error event (its code), or the run threw ("script: …"). */
  error: string | null;
  /** All tool output the model saw, as text. */
  context: string;
  citedNumbers: readonly number[];
  judge: JudgeOutput | null;
}): AttemptGrade {
  const { item, answer, judge } = input;
  if (isInfraError(input.error)) return { ...UNGRADED, points: [], unsupportedClaims: [] };
  const points = facitPoints(item);
  const failedOutright = !!input.error || !answer.trim();
  const needsJudge = points.some((point) => point.check === "judge");
  if (!failedOutright && needsJudge && !judge) {
    return { ...UNGRADED, points: [], unsupportedClaims: [] };
  }
  const verdicts = new Map((judge?.points ?? []).map((point) => [point.id, point]));
  const graded: PointGrade[] = points.map((point) => {
    const found = inContext(point.text, input.context);
    if (point.code) {
      const result = failedOutright
        ? { holds: false, detail: "intet svar", wrong: [] }
        : gradeCode(point.code, answer);
      // A must-not "happens" when its check does not hold.
      const yes = point.negative ? !result.holds : result.holds;
      return {
        id: point.id,
        text: point.text,
        negative: point.negative,
        critical: point.critical,
        by: "code",
        yes,
        ok: point.negative ? !yes : yes,
        reason: null,
        detail: result.detail,
        wrong: result.wrong,
        inContext: found,
      };
    }
    const verdict = verdicts.get(point.id);
    const yes = failedOutright ? false : verdict?.verdict === "yes";
    return {
      id: point.id,
      text: point.text,
      negative: point.negative,
      critical: point.critical,
      by: "judge",
      yes,
      ok: point.negative ? !yes : yes,
      reason: failedOutright ? "missing" : (verdict?.reason ?? null),
      detail: failedOutright ? "intet svar" : (verdict?.why ?? ""),
      wrong: [],
      inContext: found,
    };
  });

  const facts = graded.filter((point) => !point.negative);
  const coverage = facts.length ? facts.filter((point) => point.ok).length / facts.length : 1;
  const pass =
    !failedOutright &&
    graded.every((point) => !point.critical || point.ok) &&
    coverage >= PASS_SHARE;
  const unsupportedClaims = judge?.unsupportedClaims ?? [];
  const cited = new Set(input.citedNumbers);
  const judged = (judge?.citations ?? []).filter((citation) => cited.has(citation.n));
  const { found, used } = contextUse(graded);
  const failure = pass
    ? null
    : failureType({
        category: item.category,
        error: input.error,
        answer,
        points: graded,
        unsupportedClaims,
      });
  return {
    pass,
    points: graded,
    coverage,
    failure,
    // No answer at all is not a wrong answer: 0, like "I don't know". An answer the judge did not
    // read (a code-only question without it) is not measured at all, passed or failed: counting
    // only its passes would lift the score.
    crag: failedOutright
      ? 0
      : !judge
        ? null
        : pass
          ? 1
          : judge.abstained && unsupportedClaims.length === 0
            ? 0
            : -1,
    contextFound: found,
    contextUsed: used,
    citationsJudged: judged.length,
    citationsSupported: judged.filter((citation) => citation.supports).length,
    unsupportedClaims,
  };
}
