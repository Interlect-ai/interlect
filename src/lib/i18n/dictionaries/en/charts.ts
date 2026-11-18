import type { Dictionary } from "../../translate";

/** English texts for the charts (ChartTypeSwitcher, chart primitives) and the analysis method's research categories: the same keys as `../da/charts.ts`. */
export const charts: Dictionary["charts"] = {
  percent: "{value}%",
  notScored: "not scored",
  switcher: {
    variant: {
      own: "The specialist's own chart",
      column: "Columns against the screening",
      bar: "Horizontal bars",
      squares: "Dots",
      radar: "Radar",
      slope: "From screening to deep analysis",
      ring: "Rings",
      pie: "Contribution to the score",
      gauge: "Gauge",
    },
    pickType: "Choose chart type",
    typeBar: "Horizontal bars",
    typeColumn: "Vertical bars",
    typePie: "Contribution to the score",
    typeRing: "Rings",
    typeRadar: "Radar",
    seriesLabel: "Score",
    compareLabel: "Comparison",
    empty: "No scored criteria to show yet.",
    noWeights: "No weighted criteria to show.",
    pointsFromScored: "Points from scored",
    weightedScore: "Weighted score",
    points: "+{points} pts",
    criteriaScored: "criteria scored",
    unscoredList: "Not scored: {list}",
  },
  fitDonut: {
    caption: "thesis fit",
    ariaNone: "{caption}: not calculated",
    aria: "{caption}: {score} of 100",
    threshold: "Threshold {threshold}",
  },
  metricArea: {
    tooFew: "There are fewer than two data points — the curve appears as the series grows.",
  },
  thresholdPlot: {
    empty: "No scored cases in this investment thesis yet.",
    aria: "Distribution of thesis fit for {count} cases",
    ariaWithThreshold:
      "Distribution of thesis fit for {count} cases against the threshold {threshold}",
    threshold: "threshold {threshold}",
  },
  weightRing: {
    empty: "The profile has no weights yet.",
    aria: "Weight distribution: {list}",
  },
  method: {
    category: {
      corporate_identity: "Corporate identity and registers",
      financials: "Financial statements and key figures",
      legal_regulatory: "Legal and regulatory",
      team: "Founders and team",
      funding: "Financing and ownership",
      product_technology: "Product and technology",
      traction_customers: "Customers and traction",
      market_competition: "Market and competitors",
      reputation: "Reputation",
    },
    directSource: {
      annualReports:
        "Official annual reports from the Danish Business Authority, fetched automatically when the CVR match is unambiguous",
    },
  },
};
