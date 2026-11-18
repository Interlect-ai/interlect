/** Danish texts for the charts (ChartTypeSwitcher, chart primitives) and the analysis method's research categories. */
export const charts = {
  /** A share in percent, with the language's spacing ("14 %" / "14%"). */
  percent: "{value} %",
  notScored: "ikke scoret",
  switcher: {
    variant: {
      own: "Specialistens egen graf",
      column: "Søjler mod screeningen",
      bar: "Vandrette søjler",
      squares: "Prikker",
      radar: "Radar",
      slope: "Fra screening til dyb analyse",
      ring: "Ringe",
      pie: "Bidrag til scoren",
      gauge: "Måler",
    },
    pickType: "Vælg diagramtype",
    typeBar: "Vandrette søjler",
    typeColumn: "Lodrette søjler",
    typePie: "Bidrag til scoren",
    typeRing: "Ringe",
    typeRadar: "Radar",
    seriesLabel: "Score",
    compareLabel: "Sammenligning",
    empty: "Ingen scorede kriterier at vise endnu.",
    noWeights: "Ingen vægtede kriterier at vise.",
    pointsFromScored: "Point fra scorede",
    weightedScore: "Vægtet score",
    points: "+{points} p",
    criteriaScored: "kriterier scoret",
    unscoredList: "Ikke scoret: {list}",
  },
  fitDonut: {
    caption: "tesefit",
    ariaNone: "{caption}: ikke beregnet",
    aria: "{caption}: {score} af 100",
    threshold: "Tærskel {threshold}",
  },
  metricArea: {
    tooFew: "Der er færre end to datapunkter — kurven tegnes, når serien vokser.",
  },
  thresholdPlot: {
    empty: "Ingen scorede cases i denne investeringstese endnu.",
    aria: "Fordeling af tesefit for {count} cases",
    ariaWithThreshold: "Fordeling af tesefit for {count} cases mod tærsklen {threshold}",
    threshold: "tærskel {threshold}",
  },
  weightRing: {
    empty: "Profilen har ingen vægte endnu.",
    aria: "Vægtfordeling: {list}",
  },
  method: {
    category: {
      corporate_identity: "Selskabsidentitet og registre",
      financials: "Regnskaber og nøgletal",
      legal_regulatory: "Jura og regulering",
      team: "Founders og team",
      funding: "Finansiering og ejerskab",
      product_technology: "Produkt og teknologi",
      traction_customers: "Kunder og traction",
      market_competition: "Marked og konkurrenter",
      reputation: "Omdømme",
    },
    directSource: {
      annualReports:
        "Officielle årsregnskaber fra Erhvervsstyrelsen, hentet automatisk når CVR-matchet er entydigt",
    },
  },
} as const;
