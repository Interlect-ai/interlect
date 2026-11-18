import { test } from "node:test";
import assert from "node:assert/strict";
import { cardHeadline, highlightsPlan, roundsTimeline, splitConclusion } from "./card-fallback.ts";

test("Brain's own headline wins", () => {
  assert.equal(
    cardHeadline("  Strong, complete team  ", "A long summary. Another one."),
    "Strong, complete team",
  );
});

test("a short first sentence is the headline", () => {
  assert.equal(
    cardHeadline(null, "Teamet er stærkt og komplet. Resten står på fanen."),
    "Teamet er stærkt og komplet.",
  );
});

test("a long sentence gives its first short clause, ended as a sentence", () => {
  assert.equal(
    cardHeadline(
      null,
      "The available evidence supports Veo as a sports-video company, rather than a fintech or regtech operator with licences in several markets and a long list of obligations.",
    ),
    "The available evidence supports Veo as a sports-video company.",
  );
});

test("a long sentence without a short clause is cut at a word, never four lines", () => {
  const headline = cardHeadline(
    null,
    "The strongest people signal is founder continuity around a product that clearly emerged from a specific sports-recording problem, combined with evidence that the company scaled.",
  )!;
  assert.ok(headline.endsWith(" …"));
  assert.ok(headline.split(/\s+/).length <= 14);
  assert.ok(!/\w…$/.test(headline));
});

test("no text gives no headline", () => {
  assert.equal(cardHeadline(null, "  "), null);
});

const round = (
  name: string,
  date: string | null,
  amount: number | null,
  currency: string | null,
) => ({
  name,
  date,
  amount,
  currency,
  investors: [],
  evidenceIds: ["e1"],
});

test("rounds in DKK and EUR are drawn in DKK at the fixed ERM II rate", () => {
  const timeline = roundsTimeline([
    round("Series C", "2022", 557_000_000, "DKK"),
    round("Series A", "2019", 40_000_000, "DKK"),
    round("Series B", "2021-01-06", 20_000_000, "EUR"),
  ])!;
  assert.equal(timeline.currency, "DKK");
  assert.deepEqual(
    timeline.bars.map((bar) => [bar.name, bar.year]),
    [
      ["Series A", 2019],
      ["Series B", 2021],
      ["Series C", 2022],
    ],
  );
  assert.equal(Math.round(timeline.bars[1]!.converted!), 149_207_600);
  assert.equal(timeline.bars[1]!.rate, 7.46038);
  assert.equal(timeline.max, 557_000_000);
});

test("a round in a currency without a fixed rate keeps its amount and gets no bar", () => {
  const timeline = roundsTimeline([
    round("Seed", "2021", 2_000_000, "EUR"),
    round("Series A", "2023", 10_800_000, "USD"),
    round("Series B", "2025", 30_000_000, "EUR"),
  ])!;
  assert.equal(timeline.currency, "EUR");
  assert.equal(timeline.bars[1]!.converted, null);
  assert.equal(timeline.bars[1]!.amount, 10_800_000);
});

test("fewer than two comparable rounds is no timeline", () => {
  assert.equal(
    roundsTimeline([round("A", "2023", 10_800_000, "USD"), round("B", null, 3_300_000, "EUR")]),
    null,
  );
  assert.equal(
    roundsTimeline([round("A", "2023", null, "EUR"), round("B", "2024", 5, "EUR")]),
    null,
  );
});

test("the conclusion's top is two short sentences, the rest folds out", () => {
  assert.deepEqual(splitConclusion("Strong team. Short runway. Customer concentration is high."), {
    lead: "Strong team. Short runway.",
    rest: "Customer concentration is high.",
  });
  const long = `${"Veo looks like a real and already substantial business ".repeat(5)}. Second sentence.`;
  assert.equal(splitConclusion(long).rest, "Second sentence.");
  assert.deepEqual(splitConclusion("Only one."), { lead: "Only one.", rest: null });
});

const fig = (label: string, value: number, unit: string, period: string | null = null) => ({
  label,
  value,
  unit,
  period,
});

test("highlights in one unit for different years are columns on a time line, oldest first", () => {
  const plan = highlightsPlan([
    fig("Revenue", 80, "EUR million", "2023"),
    fig("Revenue", 40, "EUR million", "2021"),
    fig("Revenue", 60, "eur million", "2022"),
  ]);
  assert.equal(plan?.kind, "columns");
  assert.deepEqual(plan && "figures" in plan ? plan.figures.map((f) => f.period) : [], [
    "2021",
    "2022",
    "2023",
  ]);
});

test("highlights in one unit without a shared time are bars, largest first, other units beside", () => {
  const plan = highlightsPlan([
    fig("Clubs", 12000, "clubs"),
    fig("Countries", 170, "clubs"),
    fig("Growth", 34, "%"),
  ]);
  assert.equal(plan?.kind, "bars");
  if (plan?.kind !== "bars") return;
  assert.deepEqual(
    plan.figures.map((f) => f.label),
    ["Clubs", "Countries"],
  );
  assert.deepEqual(
    plan.rest.map((f) => f.label),
    ["Growth"],
  );
  assert.equal(plan.scale, 12000);
});

test("calendar years are dates, never bars (T-951)", () => {
  const plan = highlightsPlan([
    fig("AMLA direct supervision start", 2028, "year"),
    fig("AMLR application year", 2027, "year"),
    fig("Entities screened", 12, "m"),
  ]);
  assert.equal(plan?.kind, "tiles");
});

test("a year beside amounts stays beside the bars, a number of years is an amount", () => {
  const plan = highlightsPlan([
    fig("Clubs", 12000, "clubs"),
    fig("Countries", 170, "clubs"),
    fig("Founded", 2015, ""),
  ]);
  assert.equal(plan?.kind, "bars");
  if (plan?.kind !== "bars") return;
  assert.deepEqual(
    plan.rest.map((f) => f.label),
    ["Founded"],
  );
  assert.equal(
    highlightsPlan([fig("Runway", 3, "years"), fig("Payback", 2, "years")])?.kind,
    "bars",
  );
});

test("two figures of the same year in one unit are bars, not a time line", () => {
  const plan = highlightsPlan([fig("A", 3, "x", "2024"), fig("B", 5, "x", "2024")]);
  assert.equal(plan?.kind, "bars");
});

test("percent bars share the 0-100 scale", () => {
  const plan = highlightsPlan([fig("A", 30, "%"), fig("B", 20, "%")]);
  assert.equal(plan?.kind === "bars" && plan.scale, 100);
});

test("figures that share no unit are tiles, nothing compared", () => {
  assert.equal(highlightsPlan([fig("A", 1, "clubs"), fig("B", 2, "%")])?.kind, "tiles");
  assert.equal(highlightsPlan([]), null);
});

test("a long own headline gives its first short clause; one without stays whole", () => {
  assert.equal(
    cardHeadline(
      "Real computer-vision product and some IP, but moat depth and auditability remain only partly evidenced.",
      "x",
    ),
    "Real computer-vision product and some IP.",
  );
  const whole =
    "Proven company-building, but founder-market fit and leadership coverage are still only partly evidenced.";
  assert.equal(cardHeadline(whole, "x"), whole);
});

test("different metrics in one unit are bars, never a time line", () => {
  const plan = highlightsPlan([
    fig("Revenue", 40, "DKK m", "2022"),
    fig("EBITDA", 5, "DKK m", "2023"),
  ]);
  assert.equal(plan?.kind, "bars");
});
