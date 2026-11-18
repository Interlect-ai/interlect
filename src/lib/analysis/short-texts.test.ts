import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cleanCompanyLabel,
  cleanSpecialistHeadline,
  clipAtWord,
  companyLabelText,
} from "./short-texts.ts";
import { SPECIALIST_HEADLINE } from "./deep-text-rules.ts";

test("the label beside the name is short: stage, sector in at most three words, country (T-753b, S03)", () => {
  const label = cleanCompanyLabel({
    stage: " Series B ",
    sector: "B2B SaaS: activation and attribution for mobile apps",
    country: "Danmark",
  });
  assert.deepEqual(label, {
    stage: "Series B",
    sector: "B2B SaaS: activation",
    country: "Danmark",
  });
  assert.equal(companyLabelText(label), "Series B, B2B SaaS: activation, Danmark");
  assert.equal(
    companyLabelText(cleanCompanyLabel({ stage: "Seed", sector: "", country: "Norge" })),
    "Seed, Norge",
  );
  assert.equal(cleanCompanyLabel({ stage: " ", sector: "", country: "" }), null);
  assert.equal(cleanCompanyLabel(undefined), null);
});

test("a specialist's point stays within two lines and is cut at a word (T-753b, D03)", () => {
  assert.equal(
    cleanSpecialistHeadline("Stærke founders, men salget hviler på CEO alene"),
    "Stærke founders, men salget hviler på CEO alene",
  );
  const long = cleanSpecialistHeadline("ord ".repeat(80)) ?? "";
  assert.ok(long.length <= SPECIALIST_HEADLINE.max);
  assert.ok(long.endsWith("ord…"));
  assert.equal(cleanSpecialistHeadline("  "), null);
  assert.equal(cleanSpecialistHeadline(undefined), null);
  assert.equal(clipAtWord("a\n b", 10), "a b");
});
