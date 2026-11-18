/**
 * The deep analysis searches the web per card topic before a specialist may
 * say "not found". After the research's first round, a topic whose figures the round did not find
 * gets one targeted search with several questions: the market's size over time, the product's
 * technical key figures and the company's key figures (the `highlights` a card falls back to).
 * The questions are fixed and name no fund text, so they are safe to send to the search engine
 * under ZDR (like CARD_DATA_RESEARCH_QUESTIONS). Pure, so it is tested without a search.
 */
import type { ResearchModule } from "./public-research.ts";

export type CardSearchTopic = "market" | "tech" | "figures";

interface FoundStatement {
  category: string;
  statement: string;
}

// i18n-keep: patterns matched against research findings, never shown.
const MONEY =
  /\b(million|billion|bn|mio\.?|mia\.?|trillion)\b|\$\s?\d|€\s?\d|\bUSD\b|\bEUR\b|\bDKK\b/i;
const MARKET = /\bmarket\b|\bTAM\b|\bSAM\b|CAGR|markedet/i;
const YEAR_OR_DATE = /\b(19|20)\d{2}(-\d{2}){0,2}\b/g;
const KEY_FIGURE =
  /customers?|clubs?|users?|subscribers?|countries|employees|units?|installed|revenue|growth|matches|teams|schools|organi[sz]ations/i;

/** A figure that is not only a year or a date. */
function hasFigure(text: string): boolean {
  return /\d/.test(text.replace(YEAR_OR_DATE, ""));
}

/** The topics the first round left without figures. */
export function missingCardTopics(findings: readonly FoundStatement[]): CardSearchTopic[] {
  const marketFigures = findings.filter(
    (finding) =>
      MARKET.test(finding.statement) &&
      MONEY.test(finding.statement) &&
      hasFigure(finding.statement),
  );
  const techFigures = findings.filter(
    (finding) => finding.category === "product_technology" && hasFigure(finding.statement),
  );
  const keyFigures = findings.filter(
    (finding) => KEY_FIGURE.test(finding.statement) && hasFigure(finding.statement),
  );
  const missing: CardSearchTopic[] = [];
  if (marketFigures.length === 0) missing.push("market");
  if (techFigures.length < 2) missing.push("tech");
  if (keyFigures.length < 3) missing.push("figures");
  return missing;
}

/** Per topic: the research track it is searched as (its categories) and its questions. */
export const CARD_SEARCH: Record<CardSearchTopic, { moduleId: string; questions: string[] }> = {
  market: {
    moduleId: "market_competition",
    questions: [
      "Published market-size estimates for the company's product category (the narrowest category that fits what it sells), each with value, currency, year, geography and the research firm or industry body that published it",
      "The same category's size in an earlier or later year, or the growth rate (CAGR) and forecast year the source states, so growth over time can be shown",
      "Market-size figures for the broader category or the customer segment the company sells into, with year, geography and source",
    ],
  },
  tech: {
    moduleId: "product_technology",
    questions: [
      "The company's own published product specifications and technical figures (for example resolution, frame rate, battery life, capacity, accuracy, latency, uptime, number of integrations or supported formats), each with value and unit",
      "The typical industry level for the same technical figures, from independent reviews, standards or comparable products' specification pages",
      "Patents granted to or applied for by the company, with number, title and date",
    ],
  },
  figures: {
    moduleId: "traction_customers_gtm",
    questions: [
      "The company's key figures with year: customers, users, countries, employees, units sold or installed, revenue and growth, as stated by the company, its filings or the press",
      "Dated milestones with figures: product launches, funding rounds, partnerships and expansion to new markets",
    ],
  },
};

/** The searches for the missing topics, as research tracks with their categories. */
export function cardSearchModules(
  findings: readonly FoundStatement[],
  baseModules: readonly ResearchModule[],
): Array<ResearchModule & { topic: CardSearchTopic }> {
  return missingCardTopics(findings).flatMap((topic) => {
    const base = baseModules.find((module) => module.id === CARD_SEARCH[topic].moduleId);
    return base ? [{ ...base, questions: CARD_SEARCH[topic].questions, topic }] : [];
  });
}
