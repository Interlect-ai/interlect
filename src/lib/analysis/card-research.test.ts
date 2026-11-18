import { test } from "node:test";
import assert from "node:assert/strict";
import { CARD_SEARCH, cardSearchModules, missingCardTopics } from "./card-research.ts";

// The deep research's tracks (public-research.ts `researchModules`), as far as the searches use them.
const researchModules = ["market_competition", "product_technology", "traction_customers_gtm"].map(
  (id) => ({ id, categories: [id], questions: ["q"] }),
);

const finding = (category: string, statement: string) => ({ category, statement });

test("a topic the first round found figures for is not searched again (T-761)", () => {
  // Veo, 15 Oct: the market size was found, the technical figures were not.
  const findings = [
    finding(
      "market_competition",
      "One report estimates a USD 820 million global automated sports-camera market in 2025, forecasting USD 2.37 billion by 2034.",
    ),
    finding(
      "traction_customers",
      "A Twilio story reports more than 12,000 clubs across 80 countries.",
    ),
    finding("traction_customers", "Over 750,000 matches have been recorded."),
    finding("financials", "Revenue grew 40% in 2024."),
    finding("product_technology", "The camera records in 2023 with automatic tracking."),
  ];
  assert.deepEqual(missingCardTopics(findings), ["tech"]);
});

test("without figures every topic is searched, as its own track (T-761)", () => {
  const modules = cardSearchModules(
    [finding("team", "Founded in 2015 in Copenhagen.")],
    researchModules,
  );
  assert.deepEqual(
    modules.map((module) => [module.topic, module.id]),
    [
      ["market", "market_competition"],
      ["tech", "product_technology"],
      ["figures", "traction_customers_gtm"],
    ],
  );
  assert.deepEqual(modules[0]!.questions, CARD_SEARCH.market.questions);
  // The fixed questions name no fund text and carry no number (safe under ZDR).
  for (const { questions } of Object.values(CARD_SEARCH)) {
    for (const question of questions) assert.doesNotMatch(question, /\d/);
  }
});
