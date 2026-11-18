/** Danish texts for the caseView group: the case page's frame and its shared parts. */
export const caseView = {
  /** CaseTop: the phase switcher and the status menu. */
  top: {
    awaitingCommittee: "Afventer komitéens beslutning",
    viewLabel: "Visning",
    historyError: "Historikken kunne ikke hentes lige nu.",
  },
  /** The route (cases.$caseId): toasts, loading and error states. */
  /** A run without a new step for a long time. */
  stalled: {
    screeningTitle: "Screeningen er gået i stå",
    screeningBody:
      "Der er ikke sket noget nyt i over 15 minutter. Start screeningen igen; den gamle kørsel lukkes.",
    screeningWaitBody:
      "Der er ikke sket noget nyt i over 15 minutter. Om et par minutter kan du starte screeningen igen.",
    deepTitle: "Den dybe analyse er gået i stå",
    deepBody:
      "Der er ikke kommet et nyt trin i over 15 minutter. Hent siden igen for at se, om den er kommet videre.",
    deepRetryBody:
      "Der er ikke kommet et nyt trin i over 20 minutter. Start den dybe analyse igen; den gamle kørsel lukkes.",
    retry: "Prøv igen",
    reload: "Hent igen",
  },
  route: {
    askPhase: { screening: "screening", deep: "dyb analyse", komite: "komitérapport" },
    whatDeep: "Den dybe analyse",
    whatScreening: "Screeningen",
    runFailed: "{what} af {name} fejlede",
    runFailedHint: "Se casen for, hvad der gik galt, og prøv igen.",
    runDone: "{what} af {name} er færdig",
    runDoneDeep: "Resultatet er klar til gennemgang.",
    runDoneScreening: "Scoren og begrundelsen er klar.",
    loading: "Henter case ...",
    loadingSlow: "Det tager lidt længere end normalt at hente casen …",
    timeoutTitle: "Casen svarer ikke",
    timeoutBody:
      "Det tog for lang tid at hente casen. Prøv igen; sker det igen, så skriv til Interlect.",
    notInThesisTitle: "Casen findes ikke i den valgte investeringstese",
    notInThesisBody:
      "Casen hører ikke til {fund}, eller du har ikke adgang. Hører den til en anden tese, så skift tese øverst.",
    chosenThesis: "den valgte tese",
    loadError: "Casen kunne ikke hentes",
    notFoundTitle: "Casen blev ikke fundet",
    notFoundBody:
      "Casen findes ikke for den valgte investeringstese, eller den er arkiveret. Gå tilbage til casebasen.",
    fallbackTitle: "Case",
    backToAnalysis: "Tilbage til analysen",
    queueing: "Sætter i kø …",
    retryDeep: "Prøv dyb analyse igen",
    olderSetupTitle: "Screenet mod en ældre version af tesen",
    olderSetupBody:
      "Screeningen er lavet mod {screened}, og tesen er nu {active}. Genscreen casen, så scoren og anbefalingen følger den aktuelle tese. Det bruger af jeres saldo.",
    olderSetupUnknown: "en ældre version",
    rescreen: "Genscreen casen",
    noticeTitle: "Seneste analysekørsel kunne ikke gennemføres",
    errGeneric: "Handlingen kunne ikke gennemføres. Prøv igen.",
    errCredits:
      "AI-tjenesten er midlertidigt begrænset. Prøv igen om lidt, eller skriv til Interlect.",
    errApiKey:
      "AI-tjenesten kunne ikke bruges lige nu. Prøv igen om lidt, eller skriv til Interlect.",
    errResearch:
      "Researchen fandt ikke nok verificerbare kilder til en forsvarlig analyse. Prøv igen, eller tilføj et pitch deck og flere virksomhedsoplysninger.",
  },
  /** CommitteePack: the committee report ("Komitérapport", `?view=komite`). */
  committee: {
    emptyTitle: "Der er ikke en færdig dyb analyse endnu",
    emptyBody: "Komitérapporten bygger på en færdig dyb analyse af {name}.",
    backToCase: "Tilbage til casen",
    print: "Udskriv eller gem som PDF",
    memo: "Investeringsoplæg",
    aiNote: "Skrevet med AI-støtte i Interlect. Et menneske gennemgår den, før der besluttes.",
    profileLine: "{name}, profil {version}",
    updatedOn: ", opdateret {date}",
    reRunTitle: "En ny dyb analyse kører i baggrunden.",
    reRunBody: "Oplægget viser den sidste færdige analyse, til den nye er klar.",
    gateFailedTitle: "Et bindende mandatkrav er ikke opfyldt.",
    gateFailedBody: "Den samlede score dækker ikke over dette. Se mandatkravene nedenfor.",
    criticalTitle: "Casen har mindst én kritisk risiko.",
    criticalBody: "Se risikoafsnittet nedenfor.",
    totalScore: "Samlet score",
    recommendation: "Interlect-anbefaling",
    notAssessed: "Ikke vurderet endnu",
    rec: {
      go_forward: "Gå videre",
      follow: "Følg udviklingen",
      reject: "Fravælg",
      outside_thesis_interesting: "Uden for thesis, usædvanligt interessant",
    },
    threshold: "Tærskel",
    vsScreening: "Ift. screening",
    fundDecision: "Teamets beslutning",
    closedWithoutInvestment: "Afsluttet uden investering",
    assessedAgainst: "Vurderet mod tesen:",
    condition: "Betingelse for en investering",
    counterThesis: "Stærkeste modargument",
    topRisks: "De vigtigste risici",
    riskLevel: {
      low: "Lav",
      medium: "Middel",
      high: "Høj",
      critical: "Kritisk",
    },
    riskCoords: ", sandsynlighed {likelihood}/5, konsekvens {impact}/5",
    riskNoCoords: ", sandsynlighed og konsekvens er ikke registreret",
    gates: "Mandatkrav",
    gateMet: "Opfyldt",
    gateNotMet: "Ikke opfyldt",
    gateUnverified: "Ikke verificeret",
    gateBinding: ", bindende",
    gateAssess: ", til vurdering",
    specialists: "Specialisternes vurdering",
    noAssessment: "Ingen vurdering registreret.",
    criteria: "Kriterier",
    noCriteria: "Ingen kriterier scoret endnu.",
    colCriterion: "Kriterium",
    colScore: "Score",
    colWeight: "Vægt",
    colAssessment: "Vurdering",
    weight: "vægt {value} %",
    noRationale: "Ingen begrundelse registreret for dette kriterium.",
    strengths: "Styrker",
    noStrengths: "Ingen styrker registreret.",
    weaknesses: "Svagheder",
    noWeaknesses: "Ingen svagheder registreret.",
    risks: "Risici",
    noRisks: "Ingen risici registreret.",
    questions: "Åbne spørgsmål til founderne",
    noQuestions: "Ingen åbne spørgsmål registreret.",
    keyFigures: "Nøgletal",
    noCalculations: "Ingen finansielle beregninger endnu.",
    annualReports: "Årsrapporter: {years}.",
    notCalculable: "{count} nøgletal kunne ikke beregnes ({list})",
    missingInputs: ", fordi input mangler: {inputs}",
    footAnalysed: "Analyseret {date}.",
    footEnd:
      "Den fulde begrundelse for hvert kriterium og hver risiko står i analysen i Interlect. Interlect anbefaler et procestrin. Investeringsbeslutningen tages af komitéen.",
    impact: "Konsekvens",
    matrixLabel: "Risikomatrix efter sandsynlighed og konsekvens",
    low: "Lav",
    likelihood: "Sandsynlighed",
    high: "Høj",
    mitigation: "Skal afklares eller reduceres:",
  },
  /** EvidenceChain. */
  evidence: {
    empty: "Ingen evidenspunkter er registreret. Kør en screening eller upload et pitch deck.",
    viewExcerpt: "Se kildeuddrag",
    showFewer: "Vis færre",
    showAll: "Vis alle {count} evidenspunkter",
  },
  /** CalculationList. */
  calculations: {
    title: "Finansielle beregninger",
    empty: "Ingen beregninger er gennemført for denne case.",
    notCalculable: "Kan ikke beregnes",
    missingInput: "Mangler input: {inputs}.",
  },
  /** ScorePathway ("Sådan kom vi frem til scoren"). */
  pathway: {
    criterion: "Kriterium",
    score: "Score",
    contribution: "Bidrag",
    total: "Samlet score",
  },
  /** KeyFindings. */
  findings: {
    up: "Trækker op",
    down: "Trækker ned",
    unknown: "Mangler vi at vide",
    none: "Intet registreret",
  },
  /** Level: the mandate marks. */
  level: {
    noRequirements: "Ingen krav",
    mandateSr: "Mandat: {passed} af {total} krav opfyldt",
    hardBreaches: ", {count} bindende brud",
  },
  /** FundMemoryPanel. */
  memory: {
    similarity: "{percent}% lighed",
    why: "Se hvorfor",
    closedWithoutInvestment: "Afsluttet uden investering",
  },
  /** IdentityCard ("Sådan fandt vi selskabet"). */
  identity: {
    title: "Selskabet",
    noteNoCvr:
      "Interlect fandt ikke et dansk CVR-nummer, der passer til selskabet. Det er normalt for udenlandske og meget nye selskaber.",
    noCvr: "Intet dansk CVR",
  },
  /** useCaseTasks and the task list's groups. */
  tasks: {
    recalcFailed: "Ændringen er gemt, men scoren kunne ikke regnes igen. Prøv at genindlæse siden.",
    answerFailed: "Svaret kunne ikke gemmes. Prøv igen.",
    renameFailed: "Opgaven kunne ikke omdøbes.",
    reassignFailed: "Den ansvarlige kunne ikke ændres.",
    deleteFailed: "Opgaven kunne ikke slettes.",
    restoreFailed: "Opgaven kunne ikke gendannes.",
    createFailed: "Opgaven kunne ikke oprettes.",
    resolveGate: "Afklar: {label}",
    groupOther: "Øvrige",
  },
  /** Files on a case (case-files.ts, useCaseFileUpload). */
  files: {
    badType: "{name} kan ikke tilføjes. Casens filer kan være PDF eller PowerPoint.",
    empty: "{name} er tom.",
    tooLarge: "{name} er større end 50 MB.",
    uploadFailed: "{name} kunne ikke lægges op. Prøv igen.",
  },
} as const;
