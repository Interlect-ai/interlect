import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assessGrounding,
  checkSuggestion,
  clipContext,
  isThesisStep,
  NOT_FOUND_PHRASE,
  retryNote,
  THESIS_STEPS,
  thesisStepSystemPrompt,
} from "./thesis-steps.ts";

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

// ---------------------------------------------------------------------------------------------
// (TS-6): "Give me a suggestion" only with grounding, never invented figures.

test("T-1034a: the prompt no longer asks for kroner or [square brackets] and says 'not found'", () => {
  for (const step of THESIS_STEPS) {
    for (const language of ["da", "en"] as const) {
      const prompt = thesisStepSystemPrompt(step, language);
      assert.doesNotMatch(prompt, /i kroner/, `${step}/${language}`);
      assert.doesNotMatch(prompt, /pladsholdere i \[kantede parenteser\]/);
      assert.match(prompt, /Brug aldrig pladsholdere/);
      assert.match(prompt, /Opfind aldrig/);
      assert.match(prompt, new RegExp(`"${NOT_FOUND_PHRASE[language]}"`));
    }
  }
  assert.match(thesisStepSystemPrompt("frames", "en"), /engelsk/);
  assert.match(thesisStepSystemPrompt("frames", "da"), /Du svarer på dansk/);
  assert.match(
    thesisStepSystemPrompt("frames"),
    /Nævn kun en ticketstørrelse, et beløb eller en valuta, hvis brugeren selv har skrevet det/,
  );
});

test("T-1034a: a suggestion needs 20 characters of own text or an earlier step", () => {
  const none = assessGrounding({
    step: "frames",
    question: "Suggest our framework: stages, geography, sectors and ticket.",
    presetQuestion: true,
    context: {},
  });
  assert.deepEqual(none, { enough: false, basis: [] });
  // The name alone is not enough, but it is named in the basis.
  const name = assessGrounding({
    step: "investor_type",
    question: "x",
    presetQuestion: true,
    context: { team_name: "Nordhav" },
  });
  assert.deepEqual(name, { enough: false, basis: ["name"] });
  // 19 characters of own text is too little, 20 is enough.
  const short = assessGrounding({
    step: "investor_type",
    question: "a".repeat(19),
    presetQuestion: false,
    context: {},
  });
  assert.equal(short.enough, false);
  assert.deepEqual(short.basis, ["own_text"]);
  const ok = assessGrounding({
    step: "investor_type",
    question: "We are three founders",
    presetQuestion: false,
    context: { team_name: "Nordhav" },
  });
  assert.deepEqual(ok, { enough: true, basis: ["own_text", "name"] });
  // The step's own field counts as own text, also with the fixed question.
  const field = assessGrounding({
    step: "thesis",
    question: "Write a draft",
    presetQuestion: true,
    context: { thesis: "B2B software for Nordic SMEs" },
  });
  assert.deepEqual(field, { enough: true, basis: ["own_text"] });
  // An earlier step is enough; a later step is not.
  const earlier = assessGrounding({
    step: "thesis",
    question: "q",
    presetQuestion: true,
    context: { frames: "Seed; Norden" },
  });
  assert.deepEqual(earlier, { enough: true, basis: ["earlier_steps"] });
  const later = assessGrounding({
    step: "frames",
    question: "q",
    presetQuestion: true,
    context: { weights: "Team 40 %" },
  });
  assert.equal(later.enough, false);
  // The review step looks at everything.
  const review = assessGrounding({
    step: "review",
    question: "q",
    presetQuestion: true,
    context: { dealbreakers: "No crypto (bindende)" },
  });
  assert.equal(review.enough, true);
});

test("T-1034a: answers with placeholders are rejected", () => {
  for (const answer of [
    "We are a [venture capital / family office] investing in [sectors].",
    "Ticket size: DKK XX per company.",
    "Our ticket is ____ per company.",
    "We invest in <sector> in <geography>.",
  ]) {
    assert.equal(
      checkSuggestion(answer, "We invest in software", "frames")?.kind,
      "placeholder",
      answer,
    );
  }
});

test("T-1034a: invented amounts and currencies are rejected, the user's own are kept", () => {
  // The bug from the product owner's review: the default ticket came back as the team's own.
  const bug = checkSuggestion(
    "Seed-stage B2B software in the Nordics, with a ticket size of DKK 1,000,000–5,000,000.",
    "Suggest our framework: stages, geography, sectors and ticket.\nSeed; Norden; software",
    "frames",
  );
  assert.ok(bug && bug.kind !== "placeholder", JSON.stringify(bug));
  const nordic = "seed in the Nordics";
  assert.equal(
    checkSuggestion("We write tickets of €2m.", nordic, "frames")?.kind,
    "invented_currency",
  );
  assert.equal(
    checkSuggestion("Ticket på 5 MDKK.", "seed i Norden, kr.", "frames")?.kind,
    "invented_number",
  );
  assert.equal(checkSuggestion("Ticket på 5 MDKK.", nordic, "frames")?.kind, "invented_currency");
  assert.equal(checkSuggestion("Tickets of 5 million.", nordic, "frames")?.kind, "invented_number");
  assert.equal(
    checkSuggestion("Team should weigh 30 %.", nordic, "thesis")?.kind,
    "invented_number",
  );
  assert.equal(
    checkSuggestion("Tickets of 25 mio.", "tickets of 2,5 mio.", "frames")?.kind,
    "invented_number",
  );
  assert.equal(checkSuggestion("Tickets of 400 NOK.", nordic, "frames")?.kind, "invented_currency");
  // The user's own figures may come back, also written another way.
  const source = "Seed i Norden, 1-3 m per company\nticket 500.000-2.000.000 kr.";
  assert.equal(checkSuggestion("Seed in the Nordics, 1–3 m per company.", source, "frames"), null);
  assert.equal(checkSuggestion("Tickets from DKK 500,000 to 2 million.", source, "frames"), null);
  assert.equal(checkSuggestion("Ticket: 0,5-2 mio. kr.", source, "frames"), null);
  assert.equal(checkSuggestion("Ticket: 5.000.000 kr.", "ticket 5 mio. kr.", "frames"), null);
  // "not found" instead of a guess is fine, and so are ordinary numbers in prose.
  assert.equal(
    checkSuggestion("Seed in the Nordics. Ticket size: not found.", "seed i Norden", "frames"),
    null,
  );
  for (const prose of [
    "Write 3 short points about what you never invest in.",
    "Vi ser på selskaber frem til 2030 og inden for 12 måneder.",
    "10. Deal: vilkår og pris.",
    "Ca. 50 virksomheder om året, 10x afkast over 7-10 år.",
    "Series A og Series B.",
    // "nok" and "sek." are Danish words, not currencies.
    "Det er nok en god idé at fokusere på seed; svar inden for 30 sek.",
  ]) {
    assert.equal(checkSuggestion(prose, "no crypto", "dealbreakers"), null, prose);
  }
});

test("T-1034a: comparisons are not placeholders", () => {
  assert.equal(checkSuggestion("Ticket < 5 mio. og > 1 mio.", "ticket 1-5 mio.", "frames"), null);
});

test("T-1034a: the weighting step may propose percentages, other steps may not", () => {
  const weights =
    "Team 30 %, market 20 %, product 15 %, traction 15 %, timing 5 %, technology 5 %, deal 10 %. Together 100.";
  assert.equal(checkSuggestion(weights, "we back founders first", "weights"), null);
  assert.equal(
    checkSuggestion("Team 30, marked 20, produkt 15.", "we back founders first", "weights"),
    null,
  );
  assert.equal(
    checkSuggestion("Team 30 %, but DKK 2,000,000 per deal.", "kr.", "weights")?.kind,
    "invented_number",
  );
});

test("T-1034a: the retry note names the problem and asks for 'not found' instead", () => {
  const note = retryNote({ kind: "invented_currency", found: "DKK" }, "en");
  assert.match(note, /DKK/);
  assert.match(note, /"not found"/);
  assert.match(retryNote({ kind: "placeholder", found: "[x]" }), /"ikke fundet"/);
});
