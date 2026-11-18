/**
 * The points of Brain's exam that code grades: lists and counts by their
 * demo numbers, name twins, and masking placeholders left in an answer. A model never decides these. Pure (tested in grade-code.test.ts).
 */
import { placeholderPattern } from "../../ai/redact.ts";
import type { CodeCheck } from "./demo-set.ts";

const DEMO_MAX = 60;

const MONTHS =
  "januar|februar|marts|april|maj|juni|juli|august|september|oktober|november|december";

/**
 * One demo number: never part of a longer number, a decimal, a date, an amount
 * or a percentage, so "demo 07, 12 mio. kr." and "demo 07 - 2025" name demo 07 only.
 */
const DEMO_NUMBER = `\\d{1,2}(?!\\d|[.,]\\d|\\.\\s*(?:${MONTHS})|\\s*(?:%|procent|mio|mia|kr|eur|sek|nok|dkk|usd))`;
/** "demo" and its list of numbers; the same text is stripped before counts are read. */
const DEMO_GROUP = `\\bdemo\\s+(${DEMO_NUMBER}(?:\\s*(?:,|\\/|&|og|-|–|til)\\s*${DEMO_NUMBER})*)`;

/**
 * The demo numbers an answer names: "demo 07", "(demo 29-40)", "demo 01, 06 og 11",
 * "demo 23/47". A range counts every number in it; a number outside 1-60 is ignored.
 */
export function mentionedDemos(answer: string): Set<number> {
  const found = new Set<number>();
  const group = new RegExp(DEMO_GROUP, "gi");
  for (const match of answer.matchAll(group)) {
    const parts = (match[1] as string).split(/\s*(,|\/|&|og|-|–|til)\s*/i);
    let previous: number | null = null;
    let range = false;
    for (const part of parts) {
      if (/^(-|–|til)$/i.test(part)) {
        range = true;
        continue;
      }
      if (/^(,|\/|&|og)$/i.test(part)) {
        range = false;
        continue;
      }
      const value = Number(part);
      if (!Number.isInteger(value)) continue;
      if (range && previous !== null && value > previous) {
        for (let n = previous + 1; n <= value; n += 1) if (n <= DEMO_MAX) found.add(n);
      } else if (value >= 1 && value <= DEMO_MAX) {
        found.add(value);
      }
      previous = value;
      range = false;
    }
  }
  return found;
}

const NUMBER_WORDS: Record<string, number> = {
  to: 2,
  tre: 3,
  fire: 4,
  fem: 5,
  seks: 6,
  syv: 7,
  otte: 8,
  ni: 9,
  ti: 10,
  elleve: 11,
  tolv: 12,
  tretten: 13,
  fjorten: 14,
  femten: 15,
  seksten: 16,
  sytten: 17,
  atten: 18,
  nitten: 19,
  tyve: 20,
};

/**
 * The whole numbers an answer states as counts: digits and Danish number words, without demo
 * numbers, decimals, percentages, amounts, years and dates.
 */
export function statedCounts(answer: string): Set<number> {
  const text = answer
    .replace(new RegExp(DEMO_GROUP, "gi"), " ")
    .replace(new RegExp(`\\b\\d{1,2}\\.\\s*(?:${MONTHS})\\b`, "gi"), " ")
    .replace(/\b\d+[.,]\d+\b/g, " ")
    .replace(/\b\d+\s*(?:%|procent|mio\.?|mia\.?|kr\.?|eur|sek|nok|dkk|usd)/gi, " ")
    .replace(/\b(?:19|20)\d{2}\b/g, " ")
    .replace(/\bq[1-4]\b/gi, " ");
  const counts = new Set<number>();
  for (const match of text.matchAll(/\b\d{1,3}\b/g)) counts.add(Number(match[0]));
  for (const match of text.toLowerCase().matchAll(/\p{L}+/gu)) {
    const value = NUMBER_WORDS[match[0]];
    if (value !== undefined) counts.add(value);
  }
  return counts;
}

export type CodeGrade = {
  /** The check holds (for a must-not: the forbidden thing did not happen). */
  holds: boolean;
  detail: string;
  /** Demo numbers that should not be there (entity confusion when not 0). */
  wrong: number[];
};

const list = (values: Iterable<number>) =>
  [...values]
    .sort((a, b) => a - b)
    .map((n) => String(n).padStart(2, "0"))
    .join(", ") || "ingen";

export function gradeCode(check: CodeCheck, answer: string): CodeGrade {
  if (check.kind === "count") {
    const counts = statedCounts(answer);
    const holds = counts.has(check.value);
    return {
      holds,
      detail: holds ? `nævner ${check.value}` : `nævner ikke ${check.value} (tal: ${list(counts)})`,
      wrong: [],
    };
  }
  if (check.kind === "no_placeholders") {
    const found = [...new Set(answer.match(placeholderPattern()) ?? [])];
    return {
      holds: found.length === 0,
      detail: found.length ? `viser ${found.join(", ")}` : "ingen pladsholdere",
      wrong: [],
    };
  }
  const named = mentionedDemos(answer);
  if (check.kind === "no_demos") {
    const wrong = check.demos.filter((n) => named.has(n));
    return {
      holds: wrong.length === 0,
      detail: wrong.length ? `nævner demo ${list(wrong)}` : "nævner ingen af dem",
      wrong,
    };
  }
  const expected = new Set(check.expected);
  const allowed = new Set(check.allowed ?? []);
  const correct = [...named].filter((n) => expected.has(n));
  const wrong = [...named].filter((n) => !expected.has(n) && !allowed.has(n));
  const holds = correct.length >= check.minCorrect && wrong.length <= check.maxWrong;
  return {
    holds,
    detail: `${correct.length} rigtige af ${expected.size}${check.minCorrect ? ` (mindst ${check.minCorrect})` : ""}, forkerte: ${list(wrong)}`,
    wrong,
  };
}
