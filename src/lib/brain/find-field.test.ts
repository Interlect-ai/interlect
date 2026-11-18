import assert from "node:assert/strict";
import { describe, it, test } from "node:test";
import {
  caseMaterialQuery,
  numbersInText,
  quoteSupportsValue,
  verifyFindAnswer,
  webQueryFor,
  type FindSource,
} from "./find-field.ts";

const deck: FindSource = {
  kind: "case_material",
  title: "Pitch deck",
  url: null,
  text: "Traction 2024: Omsætning 2024 var 12,5 mio. kr. (2023: 4,1 mio. kr.). Vi har 14 ansatte.",
};
const web: FindSource = {
  kind: "web",
  title: "Example News",
  url: "https://example.com/news",
  text: "In 2024 the company reported revenue of DKK 12.5 million, up from DKK 4.1 million in 2023.",
};
const base = { metric: "revenue", fiscalYear: 2024 } as const;

describe("numbersInText", () => {
  it("reads Danish and English formats and scale words", () => {
    assert.ok(numbersInText("12,5 mio. kr.").includes(12_500_000));
    assert.ok(numbersInText("DKK 12.5 million").includes(12_500_000));
    assert.ok(numbersInText("1.234.567 kr").includes(1_234_567));
    assert.ok(numbersInText("3,2 mia.").includes(3_200_000_000));
    assert.ok(numbersInText("EUR 800k").includes(800_000));
  });
});

describe("quoteSupportsValue", () => {
  it("accepts the value as written and rejects another", () => {
    assert.equal(quoteSupportsValue("Omsætning 2024 var 12,5 mio. kr.", 12_500_000), true);
    assert.equal(quoteSupportsValue("Omsætning 2024 var 12,5 mio. kr.", 12_000_000), false);
  });
  it("needs a sign or a word before a negative value", () => {
    assert.equal(quoteSupportsValue("Cash flow fra driften var 2,0 mio. kr.", -2_000_000), false);
    assert.equal(quoteSupportsValue("Cash flow fra driften var -2,0 mio. kr.", -2_000_000), true);
    assert.equal(quoteSupportsValue("Operating outflow of EUR 2.0 million", -2_000_000), true);
  });
  it("rejects non-finite values", () => {
    assert.equal(quoteSupportsValue("12", Number.NaN), false);
  });
});

describe("verifyFindAnswer", () => {
  const good = {
    found: true,
    value: 12_500_000,
    currency: "DKK",
    quote: "Omsætning 2024 var 12,5 mio. kr.",
    sourceIndex: 1,
  };
  it("accepts a quoted figure from the case's material as company-stated", () => {
    const result = verifyFindAnswer(good, { ...base, sources: [deck] });
    assert.ok(result.proposal);
    assert.equal(result.proposal.certainty, "company_stated");
    assert.equal(result.proposal.sourceKind, "case_material");
    assert.equal(result.proposal.sourceUrl, null);
  });
  it("marks a web figure likely and keeps the link", () => {
    const result = verifyFindAnswer(
      {
        ...good,
        quote: "In 2024 the company reported revenue of DKK 12.5 million",
        sourceIndex: 2,
      },
      { ...base, sources: [deck, web] },
    );
    assert.ok(result.proposal);
    assert.equal(result.proposal.certainty, "likely");
    assert.equal(result.proposal.sourceUrl, "https://example.com/news");
  });
  it("says not found when the model says so", () => {
    const result = verifyFindAnswer(
      { found: false, value: null, currency: null, quote: null, sourceIndex: null },
      { ...base, sources: [deck] },
    );
    assert.equal(result.proposal, null);
  });
  it("rejects a quote that is not in the source", () => {
    const result = verifyFindAnswer(
      { ...good, quote: "Omsætning 2024 var 99 mio. kr." },
      { ...base, sources: [deck] },
    );
    assert.deepEqual(result, { proposal: null, reason: "quote_not_in_source" });
  });
  it("rejects a value the quote does not state", () => {
    const result = verifyFindAnswer({ ...good, value: 99_000_000 }, { ...base, sources: [deck] });
    assert.deepEqual(result, { proposal: null, reason: "value_not_in_quote" });
  });
  it("rejects a bad source index, a bad currency and a source without the year", () => {
    assert.equal(
      verifyFindAnswer({ ...good, sourceIndex: 5 }, { ...base, sources: [deck] }).proposal,
      null,
    );
    assert.equal(
      verifyFindAnswer({ ...good, currency: "kr" }, { ...base, sources: [deck] }).proposal,
      null,
    );
    assert.deepEqual(verifyFindAnswer(good, { ...base, fiscalYear: 2022, sources: [deck] }), {
      proposal: null,
      reason: "year_not_in_quote",
    });
  });
});

describe("stricter checks", () => {
  const good = {
    found: true,
    value: 12_500_000,
    currency: "DKK",
    quote: "Omsætning 2024 var 12,5 mio. kr.",
    sourceIndex: 1,
  };
  it("does not read 12,5 mio as 125 mio or 12.5", () => {
    assert.equal(quoteSupportsValue("12,5 mio. kr.", 125_000_000), false);
    assert.equal(quoteSupportsValue("12,5 mio. kr.", 12.5), false);
  });
  it("refuses a quote that does not name the currency", () => {
    const source = { ...deck, text: "Omsætning 2024 var 12,5 mio." };
    const result = verifyFindAnswer(
      { ...good, quote: "Omsætning 2024 var 12,5 mio." },
      { ...base, sources: [source] },
    );
    assert.deepEqual(result, { proposal: null, reason: "currency_not_in_quote" });
  });
  it("refuses figures in thousands (tkr)", () => {
    const source = { ...deck, text: "Beløb i tkr. Omsætning 2024 var 12.500 kr." };
    const result = verifyFindAnswer(
      { ...good, value: 12_500, quote: "Omsætning 2024 var 12.500 kr." },
      { ...base, sources: [source] },
    );
    assert.deepEqual(result, { proposal: null, reason: "thousands_scale" });
  });
  it("binds the sign to the number, not to a date hyphen", () => {
    assert.equal(quoteSupportsValue("Cash 2024-12-31: 2,0 mio. kr.", 2_000_000), true);
    assert.equal(quoteSupportsValue("Cash 2024-12-31: 2,0 mio. kr.", -2_000_000), false);
    assert.equal(quoteSupportsValue("Cash flow: -2,0 mio. kr.", 2_000_000), false);
    assert.equal(quoteSupportsValue("Cash flow: (2,0) mio. kr.", -2_000_000), true);
  });
});

describe("queries", () => {
  it("keeps the queries short and about the figure only", () => {
    assert.equal(caseMaterialQuery("cash", 2024, "da"), "likvide beholdninger 2024");
    assert.equal(webQueryFor(" Acme ApS ", "revenue", 2024), "Acme ApS revenue 2024");
  });
});

/** The per-minute limit is one atomic count taken before anything is paid. */
test("a figure search is counted in the database before it starts, and refused at the limit", async () => {
  const { countFieldSearch } = await import("./find-field-limit.server.ts");
  const hits: Array<Record<string, unknown>> = [];
  let answer: { data: unknown; error: { message: string } | null } = { data: 0, error: null };
  const service = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      assert.equal(fn, "rate_limit_hit_all");
      hits.push(args);
      return answer;
    },
  } as unknown as Parameters<typeof countFieldSearch>[0];
  const input = { fundId: "fund-1", userId: "user-1", perMinute: 12 };
  assert.equal(await countFieldSearch(service, input), true);
  assert.deepEqual(hits[0], {
    _keys: ["brain:find_field:fund:fund-1:user:user-1"],
    _limits: [12],
    _window_seconds: 60,
  });
  answer = { data: 1, error: null };
  assert.equal(await countFieldSearch(service, input), false, "the limit is reached");
  answer = { data: null, error: { message: "down" } };
  assert.equal(await countFieldSearch(service, input), false, "no count, no search");
});
