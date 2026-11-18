/**
 * Which chart a specialist's card on Konklusion draws. Decided here, pure and tested, so the rule
 * holds for every case and not only for the ones
 * someone looked at:
 *
 * 1. A standard specialist's own chart from its sourced data: team radar (three scored axes),
 *    market line, bars against the industry, ownership ring, else the rounds on a time line.
 * 2. A run from before the card data (nothing was searched) and a team's own specialist keep
 *    their figures (`highlights`), else their criteria (radar or bars with the screening
 *    mark).
 * 3. Else what the specialist did find: its figures, else its criteria against the screening,
 *    else (a scored specialist with one criterion) a gauge of its score against the screening,
 *    else its findings by how sure they are, else what it wrote speaks for, against and is open.
 *    What the sources did not have is one "Ikke fundet" line under that chart (`notFound`).
 * 4. `missing` ("Mangler information") only for a specialist without a score and without
 *    anything to draw. A scored specialist always gets a chart.
 */
import type {
  DeepCardData,
  MarketCardData,
  OwnershipCardData,
  TeamCardData,
  TechBenchmarksCardData,
} from "../analysis/card-data.ts";
import { cardDataKindFor, teamHasRadar, type CardDataKind } from "../analysis/card-data-kinds.ts";
import {
  highlightsPlan,
  roundsTimeline,
  type HighlightsPlan,
  type RoundsTimeline,
} from "./card-fallback.ts";

/** What the plan reads of a specialist group (`SpecialistGroup` in `deep-view.ts`). */
export interface ChartPlanGroup {
  id: string;
  score: number | null;
  criteria: readonly unknown[];
  categories: readonly string[];
  strengths: readonly string[];
  weaknesses: readonly string[];
  unknowns: readonly string[];
  questions: readonly string[];
}

export interface ChartPlanFinding {
  category: string;
}

export type SpecialistChartPlan =
  | { chart: "team"; data: TeamCardData }
  | { chart: "market"; data: MarketCardData }
  | { chart: "techBenchmarks"; data: TechBenchmarksCardData }
  | { chart: "ownership"; data: OwnershipCardData }
  | { chart: "rounds"; timeline: RoundsTimeline }
  /** Before the card data: radar from three criteria, else bars with the screening mark. */
  | { chart: "criteriaMini" }
  | { chart: "highlights"; plan: HighlightsPlan; notFound: CardDataKind | null }
  /** The criteria as columns next to the screening's. */
  | { chart: "criteria"; notFound: CardDataKind | null }
  /** One criterion: the score on a gauge with the screening as a mark. */
  | { chart: "scoreGauge"; notFound: CardDataKind | null }
  /** How many findings it has; never how sure they are. */
  | { chart: "findings"; count: number; notFound: CardDataKind | null }
  | { chart: "balance"; notFound: CardDataKind | null }
  | { chart: "missing"; reason: string | null };

function slotReason(kind: CardDataKind | null, cardData: DeepCardData | null): string | null {
  if (!kind || !cardData) return null;
  if (kind === "team") return cardData.team.reason;
  if (kind === "market") return cardData.market.reason;
  if (kind === "techBenchmarks") return cardData.techBenchmarks.reason;
  return cardData.ownership.reason;
}

export function specialistChartPlan(
  group: ChartPlanGroup,
  cardData: DeepCardData | null,
  findings: readonly ChartPlanFinding[],
): SpecialistChartPlan {
  const kind = cardDataKindFor(group.id);
  if (kind && cardData) {
    if (kind === "team" && cardData.team.data && teamHasRadar(cardData.team.data))
      return { chart: "team", data: cardData.team.data };
    if (kind === "market" && cardData.market.data)
      return { chart: "market", data: cardData.market.data };
    if (kind === "techBenchmarks" && cardData.techBenchmarks.data)
      return { chart: "techBenchmarks", data: cardData.techBenchmarks.data };
    const ownership = kind === "ownership" ? cardData.ownership.data : null;
    if (ownership && ownership.holders.length > 0) return { chart: "ownership", data: ownership };
    const timeline = ownership ? roundsTimeline(ownership.rounds) : null;
    if (timeline) return { chart: "rounds", timeline };
  }
  const figures = cardData?.highlights[group.id];
  const highlights = figures ? highlightsPlan(figures.items) : null;
  // A run from before the card data (no slot has data or a reason: nothing was searched) and a
  // team's own specialist keep the chart they had. In a run with card data, an empty slot is
  // "not found", with or without a reason.
  const searched =
    cardData !== null &&
    [cardData.team, cardData.market, cardData.techBenchmarks, cardData.ownership].some(
      (entry) => entry.data !== null || entry.reason !== null,
    );
  if (highlights && (!kind || !searched))
    return { chart: "highlights", plan: highlights, notFound: null };
  if ((!kind || !searched) && group.criteria.length > 0) return { chart: "criteriaMini" };
  const notFound = kind;
  if (highlights) return { chart: "highlights", plan: highlights, notFound };
  if (group.criteria.length >= 2 || (group.criteria.length > 0 && group.score === null))
    return { chart: "criteria", notFound };
  if (group.score !== null) return { chart: "scoreGauge", notFound };
  const own = findings.filter((finding) => group.categories.includes(finding.category));
  if (own.length > 0) return { chart: "findings", count: own.length, notFound };
  const written =
    group.strengths.length +
    group.weaknesses.length +
    group.unknowns.length +
    group.questions.length;
  if (written > 0) return { chart: "balance", notFound };
  return { chart: "missing", reason: slotReason(kind, cardData) };
}
