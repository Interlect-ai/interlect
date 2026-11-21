import { test } from "node:test";
import assert from "node:assert/strict";
import { decimalSeparatorOf, parseTypedNumber } from "./typed-number.ts";
import { LANGUAGE_TAGS } from "../i18n/language.ts";

test("the decimal separator follows the language", () => {
  assert.equal(decimalSeparatorOf(LANGUAGE_TAGS.da), ",");
  assert.equal(decimalSeparatorOf(LANGUAGE_TAGS.en), ".");
});

test("grouped amounts are read in both formats in either language", () => {
  for (const decimal of [",", "."] as const) {
    assert.equal(parseTypedNumber("1.500.000", decimal), 1_500_000);
    assert.equal(parseTypedNumber("1,500,000", decimal), 1_500_000);
    assert.equal(parseTypedNumber("1 500 000", decimal), 1_500_000);
    assert.equal(parseTypedNumber("1.500.000,5", decimal), 1_500_000.5);
    assert.equal(parseTypedNumber("1,500,000.5", decimal), 1_500_000.5);
    assert.equal(parseTypedNumber("250000", decimal), 250_000);
  }
});

test("a single separator: the language's own is a decimal, the other groups three digits", () => {
  // Danish
  assert.equal(parseTypedNumber("2,5", ","), 2.5);
  assert.equal(parseTypedNumber("2.5", ","), 2.5);
  assert.equal(parseTypedNumber("1.000", ","), 1000);
  assert.equal(parseTypedNumber("500,000", ","), 500);
  // English
  assert.equal(parseTypedNumber("2.5", "."), 2.5);
  assert.equal(parseTypedNumber("2,5", "."), 2.5);
  assert.equal(parseTypedNumber("1,000", "."), 1000);
  assert.equal(parseTypedNumber("500.000", "."), 500);
  // Whole amounts (no language): three digits after one separator group.
  assert.equal(parseTypedNumber("500,000"), 500_000);
  assert.equal(parseTypedNumber("500.000"), 500_000);
  assert.equal(parseTypedNumber("2,5"), 2.5);
});

test("the shown value reads back to the same number (focus and leave changes nothing)", () => {
  for (const language of ["da", "en"] as const) {
    const tag = LANGUAGE_TAGS[language];
    for (const value of [3, 1.5, 12, 100, 1000, 2500.25, 1_500_000]) {
      const shown = value.toLocaleString(tag, { maximumFractionDigits: 2 });
      assert.equal(parseTypedNumber(shown, decimalSeparatorOf(tag)), value, `${language} ${shown}`);
    }
  }
});

test("text that is not a number is null", () => {
  for (const text of ["", " ", "abc", "1.50.000", "1,5,0", "1.5,0.0", "1,500.000,5", "-5", "5%"]) {
    assert.equal(parseTypedNumber(text, ","), null, text);
  }
});
