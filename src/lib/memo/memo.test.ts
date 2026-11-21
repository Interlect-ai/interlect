import assert from "node:assert/strict";
import { test } from "node:test";
import { hasCapability } from "../domain/workflow.ts";
import { da } from "../i18n/dictionaries/da.ts";
import { en } from "../i18n/dictionaries/en.ts";
import {
  MEMO_BELIEF_COMMENTS_MAX,
  MEMO_SECTIONS_MAX,
  MEMO_WRITE_CAPABILITY,
  cleanBeliefComments,
  gapReasonOk,
  memoDraftSchema,
  memoGapAnswerFrom,
  memoGapAnswerSchema,
  memoInputFrom,
  memoInputSchema,
  memoRefusal,
  memoVersionFrom,
  type MemoRefusal,
} from "./memo.ts";

const FUND = "a1082000-0000-4000-8000-0000000000f1";
const CASE = "a1082000-0000-4000-8000-0000000000d1";
const RUN = "a1082000-0000-4000-8000-0000000000e1";

test("Admin, Lead and Medlem write the memo; Læser does not", () => {
  assert.equal(hasCapability(["admin"], MEMO_WRITE_CAPABILITY), true);
  assert.equal(hasCapability(["lead"], MEMO_WRITE_CAPABILITY), true);
  assert.equal(hasCapability(["member"], MEMO_WRITE_CAPABILITY), true);
  assert.equal(hasCapability(["reader"], MEMO_WRITE_CAPABILITY), false);
  assert.equal(hasCapability([], MEMO_WRITE_CAPABILITY), false);
});

test("'Not needed' needs a reason of at least 10 characters; 'filled' needs none", () => {
  assert.equal(gapReasonOk("filled", null), true);
  assert.equal(gapReasonOk("not_needed", null), false);
  assert.equal(gapReasonOk("not_needed", "   kort   "), false);
  assert.equal(gapReasonOk("not_needed", "Ingen kunder"), true);
  // Code points, like the database's char_length: 10 letters with diacritics are enough.
  assert.equal(gapReasonOk("not_needed", "æøåæøåæøåæ"), true);
  assert.equal(gapReasonOk("not_needed", "æøåæøåæøå"), false);
});

test("belief comments are trimmed and empty ones dropped", () => {
  assert.deepEqual(cleanBeliefComments({ a: "  Ja  ", b: "   ", " c ": "Nej", "": "x" }), {
    a: "Ja",
    c: "Nej",
  });
});

test("the proposal's input is checked before the database sees it", () => {
  const ok = memoInputSchema.parse({ fundId: FUND, caseId: CASE, rationale: "Godt team" });
  assert.deepEqual(ok.beliefComments, {});
  assert.throws(() =>
    memoInputSchema.parse({ fundId: FUND, caseId: CASE, rationale: "x".repeat(8001) }),
  );
  const tooMany = Object.fromEntries(
    Array.from({ length: MEMO_BELIEF_COMMENTS_MAX + 1 }, (_, i) => [`b${i}`, "x"]),
  );
  assert.throws(() =>
    memoInputSchema.parse({ fundId: FUND, caseId: CASE, rationale: "", beliefComments: tooMany }),
  );
  assert.throws(() =>
    memoInputSchema.parse({
      fundId: FUND,
      caseId: CASE,
      rationale: "",
      beliefComments: { a: "x".repeat(2001) },
    }),
  );
});

test("a gap answer has a known key and one of the two states", () => {
  const base = { fundId: FUND, caseId: CASE, state: "filled" };
  assert.equal(
    memoGapAnswerSchema.parse({ ...base, gapKey: "customer_references" }).state,
    "filled",
  );
  assert.equal(
    memoGapAnswerSchema.parse({ ...base, gapKey: "legal.review" }).gapKey,
    "legal.review",
  );
  for (const gapKey of ["", "Customer", "a b", "-x", "x".repeat(121)]) {
    assert.throws(() => memoGapAnswerSchema.parse({ ...base, gapKey }), gapKey);
  }
  assert.throws(() => memoGapAnswerSchema.parse({ ...base, gapKey: "x", state: "later" }));
});

test("a draft's sections are prose only, under known keys", () => {
  const base = { fundId: FUND, caseId: CASE, analysisRunId: RUN };
  assert.deepEqual(
    memoDraftSchema.parse({ ...base, sections: { recommendation: "Tekst", thesis: "Mere" } })
      .sections,
    { recommendation: "Tekst", thesis: "Mere" },
  );
  assert.throws(() => memoDraftSchema.parse({ ...base, sections: { recommendation: 42 } }));
  assert.throws(() => memoDraftSchema.parse({ ...base, sections: { recommendation: { a: 1 } } }));
  assert.throws(() => memoDraftSchema.parse({ ...base, sections: { "Bad key": "x" } }));
  const tooMany = Object.fromEntries(
    Array.from({ length: MEMO_SECTIONS_MAX + 1 }, (_, i) => [`s${i}`, "x"]),
  );
  assert.throws(() => memoDraftSchema.parse({ ...base, sections: tooMany }));
});

test("rows from the database map to the memo's shapes, and only text survives", () => {
  assert.deepEqual(
    memoInputFrom({
      id: "i1",
      rationale: null,
      belief_comments: { a: "Ja", b: 3, c: null },
      author_id: null,
      updated_at: "2026-11-09T10:00:00Z",
    }),
    {
      id: "i1",
      rationale: "",
      beliefComments: { a: "Ja" },
      authorId: null,
      updatedAt: "2026-11-09T10:00:00Z",
    },
  );
  assert.equal(memoGapAnswerFrom({ state: "not_needed" }).state, "not_needed");
  assert.equal(memoGapAnswerFrom({ state: "something" }).state, "filled");
  const version = memoVersionFrom({
    id: "v1",
    analysis_run_id: RUN,
    version: 2,
    sections: ["not", "an", "object"],
    status: "approved",
    approved_at: "2026-11-09T11:00:00Z",
  });
  assert.equal(version.version, 2);
  assert.equal(version.status, "approved");
  assert.deepEqual(version.sections, {});
  assert.equal(memoVersionFrom({ status: "other" }).status, "draft");
});

test("every refusal the database raises (0132) has its own message in both languages", () => {
  const raised: Array<[string, MemoRefusal]> = [
    ["Komitémemo: casen blev ikke fundet.", "notFound"],
    ["Komitémemo: kun Admin, Lead og Medlem kan skrive.", "writeOnly"],
    ["Komitémemo: begrundelsen er for lang.", "rationaleTooLong"],
    ["Komitémemo: begrundelsen for manglen er for lang.", "gapReasonTooLong"],
    ["Komitémemo: kommentarerne til teserne er ugyldige.", "beliefCommentsInvalid"],
    ["Komitémemo: manglens nøgle er ugyldig.", "gapKeyInvalid"],
    ["Komitémemo: ukendt svar på en mangel.", "gapStateInvalid"],
    ["Komitémemo: skriv en begrundelse på mindst 10 tegn.", "reasonTooShort"],
    ["Komitémemo: analysen hører ikke til casen.", "analysisNotOnCase"],
    ["Komitémemo: memoen bygger på en færdig dyb analyse.", "analysisNotComplete"],
    ["Komitémemo: afsnittene skal være tekst.", "sectionsInvalid"],
    ["Komitémemo: versionen blev ikke fundet.", "versionNotFound"],
    ["Komitémemo: versionen er allerede godkendt.", "alreadyApproved"],
    ["Komitémemo: en godkendt version kan ikke ændres.", "frozen"],
  ];
  for (const [message, refusal] of raised) {
    assert.equal(memoRefusal(message), refusal, message);
    assert.ok(da.memoServer[refusal], `da.memoServer.${refusal}`);
    assert.ok(en.memoServer[refusal], `en.memoServer.${refusal}`);
  }
  assert.equal(memoRefusal("casen blev ikke fundet"), null, "only the memo's own refusals");
  assert.equal(memoRefusal("duplicate key value"), null);
  assert.equal(memoRefusal(null), null);
});

test("the memo's server texts never name the fund (the team's word, rule 6)", () => {
  for (const value of Object.values(da.memoServer)) assert.doesNotMatch(value, /\bfond/i);
  for (const value of Object.values(en.memoServer)) assert.doesNotMatch(value, /\bfund\b/i);
});
