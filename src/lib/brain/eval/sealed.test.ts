import assert from "node:assert/strict";
import test from "node:test";
import { gradeCode } from "./grade-code.ts";
import { parseCodeCheck, parseSealedItems, sealedItemId } from "./sealed.ts";

const question = (extra: Record<string, unknown> = {}) => ({
  question: "Hvor mange cases har vi afvist i Q2?",
  category: "aggregate",
  facts: ["Nævner antallet"],
  mustNot: [],
  ...extra,
});

test("a sealed question's id comes from its text, so storing the file again updates it (T-512 M4)", () => {
  assert.equal(sealedItemId("Hvor mange?"), sealedItemId("  Hvor   mange? "));
  assert.notEqual(sealedItemId("Hvor mange?"), sealedItemId("Hvor mange cases?"));
  const [item] = parseSealedItems([question({ question: "  Hvor mange\ncases?\n" })]);
  assert.equal(item?.question, "Hvor mange\ncases?", "asked as written, only trimmed");
  assert.equal(item?.caseIndex, null);
});

test("the same question twice in a file is refused", () => {
  assert.throws(
    () =>
      parseSealedItems([
        question(),
        question({ question: "Hvor mange cases har vi  afvist i Q2? " }),
      ]),
    /question 2: the same question as question 1/,
  );
});

test("a code check without minCorrect is refused instead of failing every answer (T-512 M4)", () => {
  assert.throws(
    () =>
      parseSealedItems([
        question({
          facts: [{ text: "Nævner demo 07", code: { kind: "demos", expected: [7], maxWrong: 0 } }],
        }),
      ]),
    /question 1, fact 1\.code: demos needs minCorrect/,
  );
  assert.throws(
    () => parseCodeCheck({ kind: "demos", expected: [7], minCorrect: 2, maxWrong: 0 }, "x"),
    /minCorrect \(0-1\)/,
  );
  assert.throws(() => parseCodeCheck({ kind: "count" }, "x"), /count needs value/);
  assert.throws(() => parseCodeCheck({ kind: "no_demos", demos: [] }, "x"), /demo numbers/);
  assert.throws(
    () => parseCodeCheck({ kind: "no_demos", demos: [61] }, "x"),
    /61 is not a demo number/,
  );
  assert.throws(
    () => parseCodeCheck({ kind: "list" }, "x"),
    /demos, count, no_demos or no_placeholders/,
  );
});

test("a valid code check is kept as grade-code reads it", () => {
  const check = parseCodeCheck(
    { kind: "demos", expected: [7, 12], minCorrect: 2, maxWrong: 0, allowed: [3] },
    "x",
  );
  assert.deepEqual(check, {
    kind: "demos",
    expected: [7, 12],
    minCorrect: 2,
    maxWrong: 0,
    allowed: [3],
  });
  assert.equal(gradeCode(check, "demo 07 og demo 12, måske demo 03").holds, true);
});

test("fields are checked before anything is stored", () => {
  assert.throws(() => parseSealedItems([]), /no questions/);
  assert.throws(() => parseSealedItems([question({ category: "trivia" })]), /unknown category/);
  assert.throws(() => parseSealedItems([question({ caseIndex: 60 })]), /caseIndex must be 0-59/);
  assert.throws(() => parseSealedItems([question({ facts: [] })]), /no facts/);
  assert.throws(() => parseSealedItems([question({ mustNot: "x" })]), /mustNot must be a list/);
  assert.throws(
    () => parseSealedItems([question({ facts: [{ critical: true }] })]),
    /text is required/,
  );
  assert.throws(
    () => parseSealedItems([question({ facts: [{ text: "x", critical: "ja" }] })]),
    /critical must be true or false/,
  );
});

test("a typo in a key is refused instead of silently dropped (T-512 M4)", () => {
  assert.throws(
    () => parseSealedItems([question({ facts: [{ text: "x", critcal: true }] })]),
    /fact 1: unknown field critcal/,
  );
  assert.throws(() => parseSealedItems([question({ regresion: true })]), /unknown field regresion/);
  assert.throws(
    () => parseCodeCheck({ kind: "demos", expected: [7], minCorect: 1, maxWrong: 0 }, "x"),
    /unknown field minCorect/,
  );
});

test("code checks that could never pass are refused", () => {
  assert.throws(() => parseCodeCheck({ kind: "count", value: 1200 }, "x"), /0-999/);
  assert.throws(
    () => parseCodeCheck({ kind: "demos", expected: [7, 7], minCorrect: 2, maxWrong: 0 }, "x"),
    /a demo number twice/,
  );
});
