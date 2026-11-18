/**
 * The sealed exam questions the product owner and the partner write, checked before
 * scripts/brain-eval-seal.ts stores them. A question's id comes from its text, so storing the
 * same file again updates the rows instead of adding copies (M4). Pure.
 */
import { DEMO_CASE_COUNT } from "./demo-story.ts";
import { demoId } from "./demo-id.ts";
import type { CodeCheck, DemoEvalItem, EvalCategory, FacitInput } from "./demo-set.ts";

const CATEGORIES: ReadonlySet<string> = new Set<EvalCategory>([
  "lookup",
  "aggregate",
  "multi_hop",
  "similar",
  "global",
  "temporal",
  "case_advice",
  "should_refuse",
  "injection",
]);

/** The highest demo number ("demo NN") a case can have. */
const DEMO_MAX = DEMO_CASE_COUNT;

/** Stable per question text: storing a file again updates its rows. Other spacing is the same. */
export function sealedItemId(question: string): string {
  return demoId(`sealed:${question.trim().replace(/\s+/g, " ")}`);
}

/** A typo in a key ("critcal") would silently drop what it says, so unknown keys are refused. */
function onlyKeys(value: Record<string, unknown>, allowed: readonly string[], where: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new Error(`${where}: unknown field ${unknown.join(", ")}`);
}

/** statedCounts (grade-code.ts) reads counts of at most three digits. */
const COUNT_MAX = 999;

const isInt = (value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): value is number =>
  Number.isInteger(value) && (value as number) >= min && (value as number) <= max;

function demoList(value: unknown, where: string, nonEmpty: boolean): number[] {
  if (!Array.isArray(value) || (nonEmpty && !value.length)) {
    throw new Error(`${where}: a list of demo numbers 1-${DEMO_MAX} is required`);
  }
  for (const n of value) {
    if (!isInt(n, 1, DEMO_MAX)) throw new Error(`${where}: ${String(n)} is not a demo number`);
  }
  // gradeCode counts distinct numbers, so a repeat would make minCorrect unreachable.
  if (new Set(value).size !== value.length) throw new Error(`${where}: a demo number twice`);
  return value as number[];
}

/**
 * A code check exactly as grade-code.ts reads it. A field that is missing would not fail loudly
 * there: `correct >= undefined` is false, so the point would fail every answer.
 */
export function parseCodeCheck(raw: unknown, where: string): CodeCheck {
  const check = (raw ?? {}) as Record<string, unknown>;
  switch (check["kind"]) {
    case "count":
      onlyKeys(check, ["kind", "value"], where);
      if (!isInt(check["value"], 0, COUNT_MAX))
        throw new Error(`${where}: count needs value (a whole number 0-${COUNT_MAX})`);
      return { kind: "count", value: check["value"] };
    case "no_demos":
      onlyKeys(check, ["kind", "demos"], where);
      return { kind: "no_demos", demos: demoList(check["demos"], `${where}.demos`, true) };
    case "no_placeholders":
      onlyKeys(check, ["kind"], where);
      return { kind: "no_placeholders" };
    case "demos": {
      onlyKeys(check, ["kind", "expected", "minCorrect", "maxWrong", "allowed"], where);
      const expected = demoList(check["expected"], `${where}.expected`, true);
      if (!isInt(check["minCorrect"], 0, expected.length)) {
        throw new Error(`${where}: demos needs minCorrect (0-${expected.length})`);
      }
      if (!isInt(check["maxWrong"], 0))
        throw new Error(`${where}: demos needs maxWrong (0 or more)`);
      const allowed =
        check["allowed"] === undefined
          ? undefined
          : demoList(check["allowed"], `${where}.allowed`, false);
      return {
        kind: "demos",
        expected,
        minCorrect: check["minCorrect"],
        maxWrong: check["maxWrong"],
        ...(allowed ? { allowed } : {}),
      };
    }
    default:
      throw new Error(`${where}: code.kind must be demos, count, no_demos or no_placeholders`);
  }
}

function parsePoint(raw: unknown, where: string): FacitInput {
  if (typeof raw === "string") {
    if (!raw.trim()) throw new Error(`${where}: empty text`);
    return raw;
  }
  const point = (raw ?? {}) as Record<string, unknown>;
  onlyKeys(point, ["text", "critical", "code"], where);
  if (typeof point["text"] !== "string" || !point["text"].trim()) {
    throw new Error(`${where}: text is required`);
  }
  if (point["critical"] !== undefined && typeof point["critical"] !== "boolean") {
    throw new Error(`${where}: critical must be true or false`);
  }
  return {
    text: point["text"],
    ...(point["critical"] === true ? { critical: true } : {}),
    ...(point["code"] !== undefined
      ? { code: parseCodeCheck(point["code"], `${where}.code`) }
      : {}),
  };
}

/**
 * The file's questions, checked: [{ question, category, caseIndex?, facts, mustNot, regression? }].
 * Throws with the question's number on the first problem; a question twice is a problem too.
 */
export function parseSealedItems(raw: unknown): DemoEvalItem[] {
  if (!Array.isArray(raw) || !raw.length) throw new Error("the file holds no questions");
  const seen = new Map<string, number>();
  return raw.map((entry, n) => {
    const where = `question ${n + 1}`;
    const item = (entry ?? {}) as Record<string, unknown>;
    onlyKeys(item, ["question", "category", "caseIndex", "facts", "mustNot", "regression"], where);
    const question = item["question"];
    if (typeof question !== "string" || !question.trim()) throw new Error(`${where}: no text`);
    const id = sealedItemId(question);
    const twin = seen.get(id);
    if (twin !== undefined) throw new Error(`${where}: the same question as question ${twin + 1}`);
    seen.set(id, n);
    if (typeof item["category"] !== "string" || !CATEGORIES.has(item["category"])) {
      throw new Error(`${where}: unknown category`);
    }
    const caseIndex = item["caseIndex"] ?? null;
    if (caseIndex !== null && !isInt(caseIndex, 0, DEMO_CASE_COUNT - 1)) {
      throw new Error(`${where}: caseIndex must be 0-${DEMO_CASE_COUNT - 1}`);
    }
    if (!Array.isArray(item["facts"]) || !item["facts"].length)
      throw new Error(`${where}: no facts`);
    if (!Array.isArray(item["mustNot"])) throw new Error(`${where}: mustNot must be a list`);
    if (item["regression"] !== undefined && typeof item["regression"] !== "boolean") {
      throw new Error(`${where}: regression must be true or false`);
    }
    return {
      // Asked as written (an injection question may span lines); only the id ignores spacing.
      question: question.trim(),
      category: item["category"] as EvalCategory,
      caseIndex: caseIndex as number | null,
      expected: [],
      facts: item["facts"].map((fact, i) => parsePoint(fact, `${where}, fact ${i + 1}`)),
      mustNot: item["mustNot"].map((rule, i) => parsePoint(rule, `${where}, must-not ${i + 1}`)),
      regression: item["regression"] === true,
    };
  });
}
