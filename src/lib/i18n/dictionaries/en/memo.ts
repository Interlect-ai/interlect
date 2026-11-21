/** English texts in the committee memo's data model; same keys as `da/memo.ts`. */
export const memo = {
  sections: {
    recommendation: {
      title: "Recommendation",
      question: "Why we recommend this case, and the proposal",
    },
    thesis: {
      title: "Thesis and what must be believed",
      question: "The beliefs the decision rests on, and whether they hold",
    },
    company: {
      title: "Company and customer",
      question: "What the company does, and for whom",
    },
    market: {
      title: "Market and timing",
      question: "Whether the market can carry a venture outcome",
    },
    competition: {
      title: "Competition",
      question: "What the customer chooses instead",
    },
    product: {
      title: "Product and technology",
      question: "Whether it works, scales and can be defended",
    },
    team: {
      title: "Team",
      question: "Why this team, and what is missing",
    },
    traction: {
      title: "Traction and references",
      question: "The proof so far, and what customers say",
    },
    economics: {
      title: "Economics",
      question: "Revenue, burn and runway",
    },
    deal: {
      title: "Round, deal and returns",
      question: "What we would pay, and what we could win",
    },
    risks: {
      title: "Risks and counter-argument",
      question: "What could go wrong, and the case for investing",
    },
    diligence: {
      title: "Diligence status",
      question: "What has been done, and what is open",
    },
    nextSteps: {
      title: "Next steps",
      question: "What must happen, in what order",
    },
  },
  groups: {
    decision: "Decision",
    company: "The company",
    numbers: "Numbers and deal",
    ahead: "Risk and what comes next",
  },
  fields: {
    proposerRationale: "Your rationale",
    investmentCondition: "Condition for an investment",
    mandate: "Mandate requirements",
    thesisText: "The team's thesis",
    criteria: "Score by criterion",
    companyDescription: "What the company does",
    marketSize: "Market size",
    competitorMap: "Competitor map",
    productScores: "Product and technology",
    techBenchmarks: "Technical key figures",
    teamPeople: "The people in the team",
    founderReferences: "Founder references",
    tractionFigures: "Traction figures",
    customerReferences: "Customer references",
    financialStatements: "Annual reports",
    cashRunway: "Cash and runway",
    unitEconomics: "Unit economics",
    fundingHistory: "Earlier rounds",
    capTable: "Ownership",
    roundTerms: "Round terms",
    risks: "Risks",
    counterArgument: "Counter-argument",
    specialistWork: "The specialists' work",
    legalReview: "Legal review",
    managementInterview: "Management interview",
    nextSteps: "Next steps",
  },
  gaps: {
    customerReferences: {
      title: "Customer references",
      purpose: "Whether customers pay, stay and would recommend the product.",
    },
    competitorMap: {
      title: "Competitor map",
      purpose: "What the customer chooses instead, and where the company wins or loses.",
    },
    roundTerms: {
      title: "Round terms",
      purpose: "The round size, the price, the instrument and your ownership.",
    },
    legalReview: {
      title: "Legal review",
      purpose: "Cap table, key contracts and licences have been checked.",
    },
    unitEconomicsInputs: {
      title: "Unit economics inputs",
      purpose:
        "Figures such as MRR, sales and marketing spend and churn, so the economics per customer can be calculated.",
    },
    financialStatements: {
      title: "Annual reports",
      purpose: "Revenue, result and cash from the annual reports.",
    },
    marketSize: {
      title: "Market size",
      purpose: "A market with a source and a year, so the outcome can be judged.",
    },
    teamBackground: {
      title: "Team background",
      purpose: "Who the founders and managers are, and what they have done before.",
    },
    fundingHistory: {
      title: "Earlier rounds",
      purpose: "How much has been raised, when and from whom.",
    },
  },
  belief: {
    holds: "Holds",
    partly: "Holds in part",
    notShown: "Not shown",
    notEstablished: "Not established",
  },
  phases: {
    beforeSigning: "Before we sign",
    diligence: "Confirm in diligence",
    afterClosing: "After closing",
  },
} as const;
