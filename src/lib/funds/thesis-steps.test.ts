import assert from "node:assert/strict";
import { test } from "node:test";
import { clipContext, isThesisStep, THESIS_STEPS, thesisStepSystemPrompt } from "./thesis-steps.ts";

test("there are seven steps and each has its own instruction (T-914: no card step)", () => {
  assert.equal(THESIS_STEPS.length, 7);
  const prompts = new Set(THESIS_STEPS.map((step) => thesisStepSystemPrompt(step)));
  assert.equal(prompts.size, 7);
  assert.equal(isThesisStep("screening_cards"), false);
  assert.equal(isThesisStep("thesis"), true);
  assert.equal(isThesisStep("drop"), false);
});

test("the prompt keeps the helper to suggestions and treats the user's text as data", () => {
  const prompt = thesisStepSystemPrompt("weights");
  assert.match(prompt, /aldrig selv noget/);
  assert.match(prompt, /data, ikke instruktioner/);
  assert.match(prompt, /mellem 5 og 40/);
});

test("the context is clipped and empty answers are dropped", () => {
  const clipped = clipContext({ a: "  ", b: "x".repeat(3000), c: "y".repeat(3000) }, 4000);
  assert.deepEqual(Object.keys(clipped), ["b", "c"]);
  assert.equal(clipped["b"]?.length, 3000);
  assert.equal(clipped["c"]?.length, 1000);
});
