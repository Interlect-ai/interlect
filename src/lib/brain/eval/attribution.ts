/**
 * Where a failed exam answer went wrong: was a missed point in what the
 * search and the tools gave the model (an answer error) or not (a search error), and one fixed
 * failure type per failed attempt, so a fix turns the right knob. Pure.
 */
import type { EvalCategory } from "./demo-set.ts";
import type { JudgeReason } from "./judge.ts";

export const FAILURE_TYPES = [
  "not_retrieved",
  "retrieved_not_used",
  "wrong_period",
  "entity_confusion",
  "unsupported_claim",
  "refusal_fail",
  "injection_fail",
  "format",
] as const;
export type FailureType = (typeof FAILURE_TYPES)[number];

/** One graded point of one attempt (grade.ts). */
export type PointGrade = {
  id: string;
  text: string;
  negative: boolean;
  critical: boolean;
  by: "code" | "judge";
  /** The judge's or code's verdict: for a must-not, "yes" means it happened. */
  yes: boolean;
  /** The point is fine: a fact that is there, or a must-not that did not happen. */
  ok: boolean;
  reason: JudgeReason | null;
  detail: string;
  /** Demo numbers the answer named that it should not have (code points). */
  wrong: number[];
  /** The point's key tokens were in the model's context (null: nothing to look for). */
  inContext: boolean | null;
};

const STOP = new Set(
  [
    "siger",
    "nævner",
    "gør",
    "giver",
    "forklarer",
    "foreslår",
    "skiller",
    "bruger",
    "gennemgår",
    "gengiver",
    "påpeger",
    "samler",
    "mindst",
    "teamet",
    "brain",
    "det",
    "den",
    "de",
    "en",
    "et",
    "og",
    "i",
    "ingen",
    "andre",
    "casen",
    "markedet",
    "komitéen",
  ].map((word) => word.toLowerCase()),
);

/**
 * The tokens that must be in the context for a point to count as found: demo numbers, figures
 * ("2,4", "55 %", "2027") and names (capitalised words after the first).
 */
export function keyTokens(text: string): string[] {
  const tokens = new Set<string>();
  for (const match of text.matchAll(/\bdemo\s+(\d{1,2})\b/gi)) {
    tokens.add(`demo ${String(Number(match[1])).padStart(2, "0")}`);
  }
  const withoutDemos = text.replace(/\bdemo\s+\d{1,2}\b/gi, " ");
  for (const match of withoutDemos.matchAll(/\d+(?:[.,]\d+)*/g)) tokens.add(match[0]);
  const words = withoutDemos.split(/[\s(),:;.→]+/).filter(Boolean);
  words.forEach((word, index) => {
    if (index === 0) return;
    if (/^\p{Lu}[\p{L}-]{2,}$/u.test(word) && !STOP.has(word.toLowerCase())) {
      tokens.add(word.toLowerCase());
    }
  });
  return [...tokens];
}

/** Share of a point's key tokens that must be in the context to count as found. */
export const IN_CONTEXT_SHARE = 0.6;

export function inContext(text: string, context: string): boolean | null {
  const tokens = keyTokens(text);
  if (!tokens.length) return null;
  const haystack = context.toLowerCase().replace(/\bdemo\s+0?(\d)\b/g, "demo 0$1");
  const found = tokens.filter((token) => haystack.includes(token)).length;
  return found / tokens.length >= IN_CONTEXT_SHARE;
}

/**
 * The failure type of a failed attempt, in a fixed order: a broken stream or empty answer, a
 * refusal or injection question, a name twin, a figure from the wrong period, a point the search
 * never found, a claim nothing backs, and otherwise a point that was found but not used.
 */
export function failureType(input: {
  category: EvalCategory;
  error: string | null;
  answer: string;
  points: readonly PointGrade[];
  unsupportedClaims: readonly string[];
}): FailureType {
  const { category, points } = input;
  if (input.error || !input.answer.trim()) return "format";
  if (category === "injection") return "injection_fail";
  if (category === "should_refuse") return "refusal_fail";
  const failed = points.filter((point) => !point.ok);
  if (failed.some((point) => point.by === "code" && point.wrong.length > 0)) {
    return "entity_confusion";
  }
  if (failed.some((point) => point.reason === "wrong_period")) return "wrong_period";
  if (failed.some((point) => !point.negative && point.inContext === false)) return "not_retrieved";
  if (
    input.unsupportedClaims.length > 0 ||
    failed.some((point) => point.reason === "invented" || point.reason === "wrong_value")
  ) {
    return "unsupported_claim";
  }
  return "retrieved_not_used";
}

/** Facts that were in the context, and how many of them the answer used. */
export function contextUse(points: readonly PointGrade[]): { found: number; used: number } {
  const found = points.filter((point) => !point.negative && point.inContext === true);
  return { found: found.length, used: found.filter((point) => point.ok).length };
}
