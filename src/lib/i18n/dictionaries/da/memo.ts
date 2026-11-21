/**
 * Danske tekster i komitémemoens datamodel (src/lib/memo/memo-model.ts og memo-gaps.ts):
 * afsnittenes titler og spørgsmål, felterne, manglerne før komiteen og deres formål. Memoen og
 * sheet'et viser dem på teamets sprog.
 */
export const memo = {
  sections: {
    recommendation: {
      title: "Anbefaling",
      question: "Hvorfor vi anbefaler casen, og forslaget",
    },
    thesis: {
      title: "Tese og det, vi skal tro på",
      question: "De antagelser, beslutningen hviler på, og om de holder",
    },
    company: {
      title: "Selskab og kunde",
      question: "Hvad selskabet laver, og for hvem",
    },
    market: {
      title: "Marked og timing",
      question: "Om markedet kan bære et stort udfald",
    },
    competition: {
      title: "Konkurrence",
      question: "Hvad kunden vælger i stedet",
    },
    product: {
      title: "Produkt og teknologi",
      question: "Om det virker, kan skalere og kan forsvares",
    },
    team: {
      title: "Team",
      question: "Hvorfor dette team, og hvad der mangler",
    },
    traction: {
      title: "Traction og referencer",
      question: "Beviserne indtil nu, og hvad kunderne siger",
    },
    economics: {
      title: "Økonomi",
      question: "Omsætning, forbrug og runway",
    },
    deal: {
      title: "Runde, vilkår og afkast",
      question: "Hvad vi ville betale, og hvad vi kan få igen",
    },
    risks: {
      title: "Risici og modargument",
      question: "Hvad der kan gå galt, og argumentet for at investere",
    },
    diligence: {
      title: "Status på undersøgelsen",
      question: "Hvad der er gjort, og hvad der er åbent",
    },
    nextSteps: {
      title: "Næste skridt",
      question: "Hvad der skal ske, og i hvilken rækkefølge",
    },
  },
  groups: {
    decision: "Beslutning",
    company: "Selskabet",
    numbers: "Tal og deal",
    ahead: "Risiko og det, der kommer",
  },
  fields: {
    proposerRationale: "Din begrundelse",
    investmentCondition: "Betingelse for en investering",
    mandate: "Mandatkrav",
    thesisText: "Investeringsteamets tese",
    criteria: "Score pr. kriterium",
    companyDescription: "Hvad selskabet laver",
    marketSize: "Markedets størrelse",
    competitorMap: "Konkurrentoversigt",
    productScores: "Produkt og teknologi",
    techBenchmarks: "Tekniske nøgletal",
    teamPeople: "Personerne i teamet",
    founderReferences: "Referencer på stifterne",
    tractionFigures: "Tal for traction",
    customerReferences: "Kundereferencer",
    financialStatements: "Årsregnskaber",
    cashRunway: "Kasse og runway",
    unitEconomics: "Enhedsøkonomi",
    fundingHistory: "Tidligere runder",
    capTable: "Ejerforhold",
    roundTerms: "Rundens vilkår",
    risks: "Risici",
    counterArgument: "Modargument",
    specialistWork: "Specialisternes arbejde",
    legalReview: "Juridisk gennemgang",
    managementInterview: "Samtale med ledelsen",
    nextSteps: "Næste skridt",
  },
  gaps: {
    customerReferences: {
      title: "Kundereferencer",
      purpose: "Om kunderne betaler, bliver og vil anbefale produktet.",
    },
    competitorMap: {
      title: "Konkurrentoversigt",
      purpose: "Hvad kunden vælger i stedet, og hvor selskabet vinder eller taber.",
    },
    roundTerms: {
      title: "Rundens vilkår",
      purpose: "Rundens størrelse, prisen, instrumentet og jeres ejerandel.",
    },
    legalReview: {
      title: "Juridisk gennemgang",
      purpose: "Ejerbog, vigtige kontrakter og tilladelser er gennemgået.",
    },
    unitEconomicsInputs: {
      title: "Input til enhedsøkonomi",
      purpose: "Tal som MRR, salgsomkostninger og kundeafgang, så økonomien pr. kunde kan regnes.",
    },
    financialStatements: {
      title: "Årsregnskaber",
      purpose: "Omsætning, resultat og kasse fra regnskaberne.",
    },
    marketSize: {
      title: "Markedets størrelse",
      purpose: "Et marked med kilde og år, så udfaldet kan vurderes.",
    },
    teamBackground: {
      title: "Teamets baggrund",
      purpose: "Hvem stifterne og ledelsen er, og hvad de har gjort før.",
    },
    fundingHistory: {
      title: "Tidligere runder",
      purpose: "Hvor meget der er rejst, hvornår og fra hvem.",
    },
  },
  belief: {
    holds: "Holder",
    partly: "Holder delvist",
    notShown: "Ikke vist",
    notEstablished: "Ikke fastslået",
  },
  phases: {
    beforeSigning: "Før vi underskriver",
    diligence: "Bekræftes undervejs",
    afterClosing: "Efter investeringen",
  },
} as const;
