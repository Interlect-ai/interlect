/** Tests of how database errors from the fund setup are shown. Run: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fundConfigErrorText, saveInputIssueText } from "./db-errors.ts";

test("our own Danish refusals are shown as they are; those that say fond in new words (T-633)", () => {
  assert.equal(
    fundConfigErrorText({ code: "P0001", message: "Mindst ét kriterie er påkrævet." }, "x"),
    "Mindst ét kriterie er påkrævet.",
  );
  assert.equal(
    fundConfigErrorText(
      { code: "P0001", message: "En ticket kan ikke være større end fonden." },
      "x",
    ),
    "En ticket kan ikke være større end investeringskapitalen.",
  );
});

test("a duplicate key says which kind of names collide, never the raw constraint", () => {
  const text = fundConfigErrorText(
    {
      code: "23505",
      message: 'duplicate key value violates unique constraint "assessment_criteria_pkey"',
    },
    "x",
  );
  assert.match(text, /samme navn/);
  assert.doesNotMatch(text, /constraint|duplicate/);
});

test("anything else becomes the plain fallback", () => {
  assert.equal(
    fundConfigErrorText(
      { code: "42703", message: 'column "x" does not exist' },
      "Kladden kunne ikke gemmes.",
    ),
    "Kladden kunne ikke gemmes.",
  );
  assert.equal(fundConfigErrorText(null, "Fallback"), "Fallback");
  assert.equal(fundConfigErrorText({ code: "P0001", message: "  " }, "Fallback"), "Fallback");
});

test("publishing: a unique key means someone else published, and the immutability guard names no table", () => {
  const publish = fundConfigErrorText(
    {
      code: "23505",
      message: 'duplicate key value violates unique constraint "fund_config_one_active_idx"',
    },
    "x",
    { duplicateNames: false },
  );
  assert.match(publish, /udgivet eller ændret af en anden/);
  const guard = fundConfigErrorText(
    {
      code: "P0001",
      message: "Publicerede fondsprofilversioner er uforanderlige (fund_assessment_criteria).",
    },
    "x",
  );
  assert.doesNotMatch(guard, /fund_assessment_criteria/);
  assert.match(guard, /Genindlæs siden/);
});

test("a validation issue names the field in Danish, with the number a person sees", () => {
  assert.equal(
    saveInputIssueText({ path: ["criteria", 2, "weight"] }),
    "Kriterie 3 skal have en vægt over 0 og højst 100 %.",
  );
  assert.match(
    saveInputIssueText({ path: ["gates", 0, "description"] }),
    /^Mandatregel 1: teksten/,
  );
  assert.match(saveInputIssueText({ path: ["dealbreakers", 1] }), /dealbreaker/);
  assert.match(saveInputIssueText(undefined), /Kontrollér felterne/);
  assert.doesNotMatch(saveInputIssueText({ path: ["unknown"] }), /[{}"]/);
});
