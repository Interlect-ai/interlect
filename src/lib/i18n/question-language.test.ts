import { test } from "node:test";
import assert from "node:assert/strict";
import { questionLanguage } from "./question-language.ts";

test("the question's own language wins over the team's (T-897)", () => {
  // The three questions that got Danish answers in the English demo team.
  for (const question of [
    "Why did we pass on Labster?",
    "Compare Strise and Two",
    "Which cases are waiting for something from the founders right now?",
  ]) {
    assert.equal(questionLanguage(question, "da"), "en", question);
  }
  assert.equal(questionLanguage("Hvorfor sagde vi nej til Labster?", "en"), "da");
  assert.equal(questionLanguage("Hvad ved vi om Veo?", "en"), "da");
  assert.equal(questionLanguage("Sammenlign Strise og Two", "en"), "da");
});

test("a question without a clear signal gets the team's language", () => {
  assert.equal(questionLanguage("Veo", "en"), "en");
  assert.equal(questionLanguage("Veo", "da"), "da");
  assert.equal(questionLanguage("ARR 2025?", "da"), "da");
});
