import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { estimateRequestMaximumUsd } from "../analysis/budgets.ts";
import { computeFinancialMetrics } from "../analysis/financial-metrics.ts";
import { buildMemoModel, type MemoModel } from "./memo-model.ts";
import {
  MEMO_DRAFT_BUDGET_USD,
  MEMO_DRAFT_MAX_OUTPUT_TOKENS,
  MEMO_DRAFT_MODEL,
  MEMO_DRAFT_SCHEMA,
  MEMO_DRAFT_SECTIONS,
  MEMO_DRAFT_MODEL_MAX_CHARS,
  cleanDraftText,
  draftProblems,
  inventedNumbers,
  memoDraftCheck,
  memoAiDraftSchema,
  memoDraftPacket,
  memoDraftRetryNote,
  memoDraftSystemPrompt,
  memoDraftUserMessage,
  memoNumbers,
  ownTextSections,
  parseMemoDraft,
  runMemoDraft,
  withProposerInput,
  writtenNumbers,
  type MemoDraftStop,
  type MemoDraftTrace,
} from "./draft.ts";
import { AS_OF, MEMO_FIXTURES, type MemoFixture } from "./memo.test.data.ts";

function build(fixture: MemoFixture): MemoModel {
  const financials =
    fixture.statements.length === 0
      ? null
      : computeFinancialMetrics(fixture.statements, AS_OF, {
          currency: fixture.currency,
          registryCountry: fixture.registryCountry,
          language: fixture.language,
        });
  return buildMemoModel(fixture.caseView, fixture.proposer, fixture.gateTasks, {
    language: fixture.language,
    financials,
    gapAnswers: fixture.gapAnswers,
  });
}

const fixture = (name: MemoFixture["name"]) => {
  const found = MEMO_FIXTURES.find((item) => item.name === name);
  assert.ok(found, name);
  return found;
};

/** Every property name and every value anywhere in a value. */
function walk(
  value: unknown,
  visit: (key: string | null, value: unknown) => void,
  key: string | null = null,
) {
  visit(key, value);
  if (Array.isArray(value)) for (const item of value) walk(item, visit);
  else if (value && typeof value === "object")
    for (const [name, inner] of Object.entries(value)) walk(inner, visit, name);
}

// English (Veo, the rich fixture) and Danish (Veo as a Danish team sees it), each written only with
// the fixtures' own numbers, as the AI is asked to write them.
const ENGLISH = {
  recommendation:
    "We propose Veo Technologies to the committee as the category leader in automated sports video. Clubs and schools use it broadly: around 25,000 matches are uploaded every week, more than 20,000 organisations are claimed as users and the product is used in 90 countries. The 2025 accounts show revenue of DKK 503.9 million, up 13 %, with a gross margin of 55 % and a result close to break-even (EBIT of DKK −16.4 million). With DKK 264 million in cash at the balance date, funding is not the pressing question.\n\nWe want to propose a small ticket, within our range of DKK 3,000,000–20,000,000, if the round fits our stages. That is the open point: the company is likely later stage than the mandate, and the terms of the round are not yet known.",
  thesis:
    "The case fits our thesis of backing European B2B software companies where technical founders build a product customers pay for early, but only partly. Product (79) and traction (76) hold: clubs use the product every week, which for the proposer settles product fit. Team (64), market (67), timing (66) and technology (68) are partly shown. Deal and terms is the weak point at 32 of 100: it is not yet shown that the round sits inside the mandate's stages, and the proposal depends on exactly that. To invest, the committee must believe that the current round is within Seed to Series B and that the terms can be agreed at a fair price.",
};

const DANISH = {
  recommendation:
    "Vi indstiller Veo Technologies til komiteen som førende inden for automatisk sportsvideo. Produktet er bredt udbredt i klubberne: omkring 25.000 kampe uploades hver uge, over 20.000 klubber og skoler er nævnt som brugere, og det bruges i 90 lande. Regnskabet for 2025 viser en omsætning på 503,9 mio. kr., en vækst på 13 % og en bruttomargin på 55 %, og resultatet er tæt på balance med et driftsresultat på -16,4 mio. kr. Med 264 mio. kr. i likvider ved balancedagen er finansieringen ikke det presserende spørgsmål.\n\nVi foreslår en lille billet, hvis runden passer til vores stadier; vilkårene for runden kendes endnu ikke.",
  thesis:
    "Casen passer delvist til vores tese om europæiske B2B-software- og fintechselskaber fra seed til serie B. Produkt (79) og traction (76) holder: klubberne bruger produktet hver uge, og det afgør produktet for forslagsstilleren. Team (64), marked (67), timing (66) og teknologi (68) er delvist vist. Deal og vilkår er det svage punkt med 32, fordi det endnu ikke er vist, hvilke vilkår runden har. For at investere skal komiteen tro på, at runden ligger inden for mandatets stadier, og at vilkårene kan aftales til en rimelig pris.",
};

const answer = (sections: { recommendation: string; thesis: string }) => JSON.stringify(sections);
const credits = (): MemoDraftStop => "credits";
const unavailable = (): MemoDraftStop => "unavailable";
const newTrace = (): MemoDraftTrace => ({ modelCalls: 0, costUsd: 0, rejected: [] });

// ---------------------------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------------------------

test("numbers are read as written in Danish and English, not inside words", () => {
  const values = (text: string, language?: "da" | "en") =>
    writtenNumbers(text, language).map((n) => [
      n.raw,
      n.candidates.map((c) => c.value),
      n.multiplier,
    ]);
  assert.deepEqual(values("503,9 mio. kr."), [["503,9", [503.9], 1_000_000]]);
  assert.deepEqual(values("DKK 503.9 million"), [["503.9", [503.9], 1_000_000]]);
  assert.deepEqual(values("264.382.000 kr."), [["264.382.000", [264_382_000], 1]]);
  assert.deepEqual(values("1,234,567.5"), [["1,234,567.5", [1_234_567.5], 1]]);
  assert.deepEqual(values("1 234 567"), [["1 234 567", [1_234_567], 1]]);
  assert.deepEqual(values("22.1m and 5k"), [
    ["22.1", [22.1], 1_000_000],
    ["5", [5], 1_000],
  ]);
  assert.deepEqual(values("4,5 mia."), [["4,5", [4.5], 1_000_000_000]]);
  assert.deepEqual(values("12 MNOK"), [["12", [12], 1_000_000]]);
  assert.deepEqual(values("503.900 t.kr.", "da"), [["503.900", [503_900], 1_000]]);
  // One separator: "000" is always thousands; otherwise the team's language decides (the model's
  // own texts mix languages, so both readings count there).
  assert.deepEqual(values("25.000"), [["25.000", [25_000], 1]]);
  assert.deepEqual(values("2.500"), [["2.500", [2_500, 2.5], 1]]);
  assert.deepEqual(values("2.500", "da"), [["2.500", [2_500], 1]]);
  assert.deepEqual(values("2.500", "en"), [["2.500", [2.5], 1]]);
  assert.deepEqual(values("2,500", "en"), [["2,500", [2_500], 1]]);
  // Glued to a currency or a unit: still a number.
  assert.deepEqual(values("DKK777m, 777MDKK, 777mdr., 777kr"), [
    ["777", [777], 1_000_000],
    ["777", [777], 1_000_000],
    ["777", [777], 1],
    ["777", [777], 1],
  ]);
  // Part of a word: not a number.
  assert.deepEqual(values("B2B, 5G, Q3, H1 and the 1st round"), []);
  // Years after each other stay apart.
  assert.deepEqual(values("2024 2025"), [
    ["2024", [2024], 1],
    ["2025", [2025], 1],
  ]);
});

test("every number the AI may use is one the model holds, written as it is or rounded", () => {
  const known = memoNumbers(build(fixture("rich")));
  assert.deepEqual(inventedNumbers(ENGLISH.recommendation, known, "en"), []);
  assert.deepEqual(inventedNumbers(ENGLISH.thesis, known, "en"), []);
  const danish = memoNumbers(build(fixture("danish")));
  assert.deepEqual(inventedNumbers(DANISH.recommendation, danish, "da"), []);
  assert.deepEqual(inventedNumbers(DANISH.thesis, danish, "da"), []);
  // Rounded: 503.9 million as 504 and as 500 (10 % at most), 12.97 % as 13 %.
  assert.deepEqual(
    inventedNumbers("504 mio. kr., ca. 500 mio. kr., 13 %, 12,97 %", known, "da"),
    [],
  );
  assert.deepEqual(inventedNumbers("503.900 t.kr.", known, "da"), []);
});

test("a number the model does not hold fails the test, in Danish and English", () => {
  const known = memoNumbers(build(fixture("rich")));
  assert.deepEqual(inventedNumbers("an ARR of DKK 47.3 million", known, "en"), ["47.3"]);
  assert.deepEqual(inventedNumbers("growth of 38.6 %", known, "en"), ["38.6"]);
  assert.deepEqual(inventedNumbers("revenue of DKK 730 million", known, "en"), ["730"]);
  assert.deepEqual(inventedNumbers("founded in 2011", known, "en"), ["2011"]);
  // Small whole numbers the model holds (counts, risk numbers, 100) are no amounts.
  for (const [text, language] of [
    ["7 mio. kr.", "da"],
    ["DKK 9 million", "en"],
    ["13 mia. kr.", "da"],
    ["DKK 100 million", "en"],
    ["100.000 kr.", "da"],
    ["6.000 kunder", "da"],
    ["11,000 customers", "en"],
  ] as const) {
    assert.equal(inventedNumbers(text, known, language).length, 1, text);
  }
  // Glued to a currency or a unit, still checked.
  for (const text of ["EUR777m", "DKK777m", "777mio. kr.", "777MDKK", "777mdr.", "777kr", "777pct"])
    assert.deepEqual(inventedNumbers(text, known, "da"), ["777"], text);
  const danish = memoNumbers(build(fixture("danish")));
  assert.deepEqual(inventedNumbers("en ARR på 47,3 mio. kr.", danish, "da"), ["47,3"]);
  assert.deepEqual(inventedNumbers("en vækst på 38,6 %", danish, "da"), ["38,6"]);
  // The right number on the wrong scale.
  assert.deepEqual(inventedNumbers("503,9 mia. kr.", danish, "da"), ["503,9"]);
  // And in the full check of a section.
  const problems = draftProblems(
    `${ENGLISH.recommendation} Its ARR is DKK 47.3 million.`,
    memoDraftCheck(build(fixture("rich")), "en"),
  );
  assert.deepEqual(problems, [{ kind: "invented_number", found: "47.3" }]);
});

test("a value the model holds in millions or billions counts in full", () => {
  const base = build(fixture("rich"));
  const model: MemoModel = {
    ...base,
    market: {
      ...base.market,
      size: {
        label: "SAM",
        scope: "sam",
        geography: "Europe",
        currency: "USD",
        unit: "billion",
        points: [{ year: 2030, value: 4.8, forecast: true }],
      },
    },
  };
  assert.deepEqual(inventedNumbers("USD 4.8 billion by 2030", memoNumbers(model), "en"), []);
  assert.deepEqual(inventedNumbers("USD 4.8 billion", memoNumbers(base), "en"), ["4.8"]);
});

test("the proposer's own numbers and the analysis's texts count as the model's", () => {
  const model = withProposerInput(build(fixture("rich")), {
    rationale: "I want to lead a DKK 12.5 m ticket at a 41 % discount.",
    beliefComments: {},
    authorId: null,
    updatedAt: "2026-11-09T10:00:00Z",
  });
  assert.deepEqual(
    inventedNumbers("a ticket of DKK 12.5 million at a 41 % discount", memoNumbers(model), "en"),
    [],
  );
});

// ---------------------------------------------------------------------------------------------
// Words the memo never has
// ---------------------------------------------------------------------------------------------

test("Interlect, its recommendation, threshold, confidence and technical words are refused", () => {
  const check = memoDraftCheck(build(fixture("rich")), "en");
  const kinds = (text: string) => draftProblems(text, check).map((problem) => problem.kind);
  for (const text of [
    "Interlect recommends the case.",
    "Interlects anbefaling er at gå videre.",
    "The analysis recommends going forward.",
    "Analysen anbefaler, at vi går videre.",
    "Analysen indstiller casen.",
    "Ifølge analysen bør vi investere.",
    "Analysen konkluderer, at vi bør investere.",
    "The analysis suggests we should invest.",
    "According to the analysis, we should invest.",
    "The platform recommends the case.",
    "The model's recommendation is to follow.",
    "The analysis' recommendation is to invest.",
    "The score clears the team's threshold.",
    "Scoren er over teamets tærskel.",
    "The analysis has high confidence in the team.",
    "We are highly confident in the team.",
    "Analysens konfidens er høj.",
    "Analysen vurderer med høj sikkerhed, at teamet holder.",
  ]) {
    assert.deepEqual(kinds(text), ["interlect_verdict"], text);
  }
  for (const text of [
    "This text was written by GPT.",
    "A language model wrote it.",
    "Tallene er beregnet i kode.",
    "This is how the analysis was made.",
  ]) {
    assert.deepEqual(kinds(text), ["technical"], text);
  }
  assert.deepEqual(kinds("Revenue is [amount] and the CEO is XX."), ["placeholder"]);
  // Ordinary prose about the company, and the proposer's own recommendation, pass.
  for (const text of [
    "Veo makes AI cameras for clubs and schools.",
    "Clubs gain confidence in the product.",
    "Selskabets AI anbefaler klip til trænerne.",
    "The system recommends highlights to coaches.",
    "The analysis shows broad adoption, and we recommend a small ticket.",
    "Vi indstiller casen til komiteen.",
  ]) {
    assert.deepEqual(kinds(text), [], text);
  }
});

test("a technical word the case's own texts use is the company's, not the memo's", () => {
  const base = build(fixture("rich"));
  const model: MemoModel = {
    ...base,
    company: { ...base.company, description: "An assistant for coaches built on OpenAI models." },
  };
  const text = "The product is built on OpenAI models.";
  assert.deepEqual(draftProblems(text, memoDraftCheck(model, "en")), []);
  assert.deepEqual(draftProblems(text, memoDraftCheck(base, "en")), [
    { kind: "technical", found: "OpenAI" },
  ]);
});

test("a text in the other language is refused; the samples are in the right one", () => {
  const model = build(fixture("rich"));
  const da = memoDraftCheck(model, "da");
  const en = memoDraftCheck(model, "en");
  assert.deepEqual(draftProblems(ENGLISH.thesis, da), [{ kind: "wrong_language" }]);
  assert.deepEqual(draftProblems(DANISH.thesis, en), [{ kind: "wrong_language" }]);
  assert.deepEqual(draftProblems(ENGLISH.thesis, en), []);
  assert.deepEqual(draftProblems(DANISH.thesis, da), []);
  assert.deepEqual(draftProblems("  ", da), [{ kind: "empty" }]);
});

// ---------------------------------------------------------------------------------------------
// What the AI reads
// ---------------------------------------------------------------------------------------------

for (const item of MEMO_FIXTURES) {
  test(`${item.name}: the packet and prompt hold no Interlect recommendation, threshold or confidence`, () => {
    const packet = memoDraftPacket(build(item));
    const forbidden = /recommend|threshold|confidence/i;
    const recommendations = new Set([
      "go_forward",
      "follow",
      "reject",
      "outside_thesis_interesting",
    ]);
    walk(packet, (key, value) => {
      if (key !== null) assert.doesNotMatch(key, forbidden, `field "${key}"`);
      if (typeof value === "string") assert.ok(!recommendations.has(value), `value "${value}"`);
      // The fixtures' confidences (criteria 0.73, gates 0.8, evidence 0.9) never pass through.
      if (typeof value === "number")
        assert.ok(![0.73, 0.8, 0.9].includes(value), `number ${value}`);
    });
    // The thesis's name ("Interlect Demo thesis") is not sent: the memo never names Interlect.
    assert.doesNotMatch(JSON.stringify(packet), /interlect/i);
    assert.ok(item.caseView.recommendation !== null && item.caseView.threshold !== null);
  });

  test(`${item.name}: the model from the sheet passes the server's schema`, () => {
    const model = JSON.parse(JSON.stringify(build(item))) as MemoModel;
    const parsed = memoAiDraftSchema.safeParse({
      fundId: "00000000-0000-4000-8000-000000000001",
      caseId: model.caseId,
      model,
    });
    assert.ok(parsed.success, parsed.success ? "" : parsed.error.message);
  });
}

test("one attempt fits its price cap, also for the longest case with a refused first answer", () => {
  for (const item of MEMO_FIXTURES) {
    const model = withProposerInput(build(item), {
      rationale: "x ".repeat(4000),
      beliefComments: {},
      authorId: null,
      updatedAt: "2026-11-09T10:00:00Z",
    });
    const retry = memoDraftRetryNote(
      MEMO_DRAFT_SECTIONS.map((section) => ({
        section,
        problems: Array.from({ length: 8 }, () => ({
          kind: "invented_number" as const,
          found: "1.234.567",
        })),
      })),
    );
    // The request as callCheapGateway sends it (the language rule and gateway options are small).
    const requestBody = {
      model: MEMO_DRAFT_MODEL,
      max_tokens: MEMO_DRAFT_MAX_OUTPUT_TOKENS,
      messages: [
        { role: "system", content: `${memoDraftSystemPrompt(item.language)}${"x".repeat(1500)}` },
        { role: "user", content: memoDraftUserMessage(model, retry) },
      ],
      response_format: { type: "json_schema", json_schema: { schema: MEMO_DRAFT_SCHEMA } },
    };
    const estimate = estimateRequestMaximumUsd({
      model: MEMO_DRAFT_MODEL,
      requestBody,
      maxOutputTokens: MEMO_DRAFT_MAX_OUTPUT_TOKENS,
    });
    assert.ok(
      estimate.maxCostUsd <= MEMO_DRAFT_BUDGET_USD,
      `${item.name}: ${estimate.maxCostUsd} USD > ${MEMO_DRAFT_BUDGET_USD}`,
    );
  }
});

test("the server refuses a model without a finished analysis, in another language or too large", () => {
  const model = JSON.parse(JSON.stringify(build(fixture("rich")))) as Record<string, unknown>;
  const input = (patch: Record<string, unknown>) => ({
    fundId: "00000000-0000-4000-8000-000000000001",
    caseId: model["caseId"],
    model: { ...model, ...patch },
  });
  assert.equal(memoAiDraftSchema.safeParse(input({ analysisId: null })).success, false);
  assert.equal(memoAiDraftSchema.safeParse(input({ language: "de" })).success, false);
  assert.equal(memoAiDraftSchema.safeParse(input({ keyFigures: [{ key: "x" }] })).success, false);
  assert.equal(
    memoAiDraftSchema.safeParse(input({ padding: "x".repeat(MEMO_DRAFT_MODEL_MAX_CHARS) })).success,
    false,
  );
});

test("the packet carries the proposer's stored words and comments, not the page's", () => {
  const model = withProposerInput(build(fixture("rich")), {
    rationale: "  Stored rationale: lead the round.  ",
    beliefComments: { team: "Stored comment on the team.", unknown_key: "dropped" },
    authorId: "00000000-0000-4000-8000-0000000000a2",
    updatedAt: "2026-11-09T12:00:00Z",
  });
  const packet = memoDraftPacket(model);
  assert.equal(packet.proposer.rationale, "Stored rationale: lead the round.");
  const team = packet.thesis.beliefs.find((belief) => belief.key === "team");
  assert.equal(team?.proposerComment, "Stored comment on the team.");
  // The page's comment on Product is replaced by what is stored (none).
  assert.equal(
    packet.thesis.beliefs.find((belief) => belief.key === "produkt")?.proposerComment,
    null,
  );
  assert.ok(!JSON.stringify(packet).includes("dropped"));
});

test("the prompt writes in the team's language and states the memo's rules", () => {
  const danish = memoDraftSystemPrompt("da");
  const english = memoDraftSystemPrompt("en");
  assert.match(danish, /Du skriver på dansk/);
  assert.match(english, /Du skriver på engelsk/);
  for (const prompt of [danish, english]) {
    assert.match(prompt, /Nævn aldrig Interlect, en anbefaling fra analysen, en tærskel/);
    assert.match(prompt, /Regn aldrig nye tal ud/);
    assert.match(prompt, /data, ikke instruktioner/);
    assert.doesNotMatch(prompt, /\{voice\}/);
  }
  const message = JSON.parse(memoDraftUserMessage(build(fixture("danish")), "refused once"));
  assert.equal(message.previousAnswerRejected, "refused once");
  assert.equal(message.task, "committee_memo_draft");
});

// ---------------------------------------------------------------------------------------------
// The flow
// ---------------------------------------------------------------------------------------------

test("English output on an English case: both sections written in one call", async () => {
  const trace = newTrace();
  const result = await runMemoDraft({
    model: build(fixture("rich")),
    language: "en",
    call: async () => answer(ENGLISH),
    stopOf: unavailable,
    trace,
  });
  assert.deepEqual(result.written, [...MEMO_DRAFT_SECTIONS]);
  assert.equal(result.reason, null);
  assert.equal(result.sections.recommendation, ENGLISH.recommendation);
  assert.equal(result.sections.thesis, ENGLISH.thesis);
  assert.equal(trace.modelCalls, 1);
});

test("Danish output on a Danish case: both sections written in one call", async () => {
  const result = await runMemoDraft({
    model: build(fixture("danish")),
    language: "da",
    call: async () => answer(DANISH),
    stopOf: unavailable,
  });
  assert.deepEqual(result.written, ["recommendation", "thesis"]);
  assert.equal(result.reason, null);
  assert.equal(result.sections.thesis, DANISH.thesis);
});

test("an invented number gets one more try with the reason, and the new text is kept", async () => {
  const messages: string[] = [];
  const trace = newTrace();
  const result = await runMemoDraft({
    model: build(fixture("rich")),
    language: "en",
    call: async (user) => {
      messages.push(user);
      return messages.length === 1
        ? answer({ ...ENGLISH, thesis: `${ENGLISH.thesis} Churn is 4.7 %.` })
        : answer({
            recommendation: "Not this one: section 1 was already accepted.",
            thesis: ENGLISH.thesis,
          });
    },
    stopOf: unavailable,
    trace,
  });
  assert.equal(messages.length, 2);
  const retry = JSON.parse(messages[1] ?? "{}").previousAnswerRejected as string;
  assert.match(retry, /Afsnit 2 \(thesis\): tallet 4\.7 står ikke i data/);
  assert.doesNotMatch(retry, /Afsnit 1/);
  assert.deepEqual(result.written, ["recommendation", "thesis"]);
  assert.equal(result.sections.recommendation, ENGLISH.recommendation);
  assert.equal(result.sections.thesis, ENGLISH.thesis);
  assert.deepEqual(trace.rejected, [
    { section: "thesis", problem: { kind: "invented_number", found: "4.7" } },
  ]);
});

test("refused twice: section 1 is the proposer's own text, section 2 is left out", async () => {
  const model = build(fixture("rich"));
  let calls = 0;
  const result = await runMemoDraft({
    model,
    language: "en",
    call: async () => {
      calls += 1;
      return answer({
        recommendation: `${ENGLISH.recommendation} Interlect recommends it.`,
        thesis: `${ENGLISH.thesis} The threshold is met.`,
      });
    },
    stopOf: unavailable,
  });
  assert.equal(calls, 2);
  assert.deepEqual(result.written, []);
  assert.equal(result.reason, "rejected");
  assert.deepEqual(result.sections, { recommendation: model.proposal.rationale });
  for (const text of Object.values(result.sections))
    assert.doesNotMatch(text, /interlect|threshold/i);
});

test("used-up credits: the memo is made with the proposer's own text and no AI section", async () => {
  const model = build(fixture("danish"));
  const result = await runMemoDraft({
    model,
    language: "da",
    call: async () => {
      throw new Error("credits used up");
    },
    stopOf: credits,
  });
  assert.equal(result.reason, "credits");
  assert.deepEqual(result.written, []);
  assert.deepEqual(result.sections, { recommendation: model.proposal.rationale });
});

test("an AI that does not answer, or answers with something else: the proposer's own text", async () => {
  const model = build(fixture("rich"));
  const silent = await runMemoDraft({
    model,
    language: "en",
    call: async () => {
      throw new Error("timeout");
    },
    stopOf: unavailable,
  });
  assert.equal(silent.reason, "unavailable");
  assert.deepEqual(silent.sections, { recommendation: model.proposal.rationale });
  const garbled = await runMemoDraft({
    model,
    language: "en",
    call: async () => "not json",
    stopOf: unavailable,
  });
  assert.equal(garbled.reason, "rejected");
  assert.deepEqual(garbled.sections, { recommendation: model.proposal.rationale });
});

test("credits run out on the second try: what passed the first time is kept", async () => {
  let calls = 0;
  const result = await runMemoDraft({
    model: build(fixture("rich")),
    language: "en",
    call: async () => {
      calls += 1;
      if (calls === 2) throw new Error("credits used up");
      return answer({ ...ENGLISH, thesis: `${ENGLISH.thesis} Churn is 4.7 %.` });
    },
    stopOf: credits,
  });
  assert.deepEqual(result.written, ["recommendation"]);
  assert.equal(result.reason, "credits");
  assert.deepEqual(result.sections, { recommendation: ENGLISH.recommendation });
});

test("the answer is read as plain prose", () => {
  assert.equal(parseMemoDraft("[]"), null);
  assert.equal(parseMemoDraft('{"recommendation": 1, "thesis": "x"}'), null);
  assert.deepEqual(parseMemoDraft('{"recommendation":"a","thesis":"b"}'), {
    recommendation: "a",
    thesis: "b",
  });
  assert.equal(
    cleanDraftText("## Heading\n**Bold** text\n\n\n\nNext  \n"),
    "Heading\nBold text\n\nNext",
  );
  assert.deepEqual(ownTextSections("  "), {});
  assert.deepEqual(ownTextSections(" Own. ", { thesis: "AI" }), {
    recommendation: "Own.",
    thesis: "AI",
  });
  assert.match(
    memoDraftRetryNote([{ section: "recommendation", problems: [{ kind: "wrong_language" }] }]),
    /Afsnit 1 \(recommendation\): det er skrevet på det forkerte sprog/,
  );
});

// ---------------------------------------------------------------------------------------------
// The server side, read from the source (it imports the server, so it is not run here)
// ---------------------------------------------------------------------------------------------

test("the draft is paid, masked and logged like every helper call, and stored as a draft", () => {
  const server = readFileSync(new URL("./draft.server.ts", import.meta.url), "utf8");
  assert.match(server, /callCheapGateway\(\{/);
  assert.match(server, /flow: "committee_memo"/);
  assert.match(server, /loop: "case:committee_memo"/);
  assert.match(server, /language: input\.language/);
  assert.match(server, /cause instanceof CreditsExhaustedError\) return "credits"/);
  assert.match(server, /cause instanceof AiUseLimitError\) return "limit"/);
  const functions = readFileSync(new URL("./memo.functions.ts", import.meta.url), "utf8");
  const handler = functions.slice(functions.indexOf("export const draftMemoWithAi"));
  assert.match(handler, /withDemoView\(/);
  assert.match(handler, /MEMO_WRITE_CAPABILITY/);
  assert.match(handler, /from\("case_memo_inputs"\)/);
  assert.match(handler, /memoServer\.rationaleMissing/);
  // The analysis is checked before the AI is paid for.
  assert.ok(handler.indexOf('from("analysis_runs")') < handler.indexOf("draftMemoProse("));
  assert.match(handler, /memoServer\.analysisNotComplete/);
  assert.match(handler, /fromDemoView\(data\.fundId, text\)/);
  assert.match(handler, /storeDraft\(/);
  assert.match(functions, /rpc\("create_case_memo_draft"/);
});
