/**
 * Danish texts for the specialists group: the specialist cards and their editors, the
 * screening step of the fund setup, and the code's own quality-check messages. Read by
 * `SpecialistCards.tsx`, `SpecialistEditors.tsx`, `ScreeningStep.tsx` and the lib files
 * `specialist-cards.ts`, `specialist-assist.ts`, `screening-setup.ts` and `screening-check.ts`.
 */
export const specialists = {
  /** Research modules (SpecialistEditors.researchModuleLabelIn). */
  research: {
    module: {
      identity_registry: {
        title: "Identitet & selskabsregister",
        hint: "Juridisk enhed, CVR/registrering, jurisdiktion, ejerstruktur",
      },
      filings_financials: {
        title: "Regnskaber & økonomi",
        hint: "Årsrapporter, omsætning, resultat, egenkapital, kapitalbehov",
      },
      founders_team: {
        title: "Founders & team",
        hint: "Baggrund, tidligere selskaber, ledelse, nøglepersonaleændringer",
      },
      funding_ownership: {
        title: "Finansiering & ejerskab",
        hint: "Runder, investorer, gæld, cap table- og ejerskabssignaler",
      },
      product_technology: {
        title: "Produkt & teknologi",
        hint: "Modenhed, arkitektur, IP, teknisk risiko og forsvarbarhed",
      },
      traction_customers_gtm: {
        title: "Traction, kunder & GTM",
        hint: "Kunder, kontrakter, pipeline, vækst, churn",
      },
      market_competition: {
        title: "Marked & konkurrence",
        hint: "ICP, konkurrenter, kategori, markedstiming",
      },
      legal_regulatory_reputation: {
        title: "Jura, regulering & omdømme",
        hint: "Licenser, tvister, GDPR, omdømmesignaler",
      },
      screening_identity_filings: {
        title: "Identitet & regnskaber",
        hint: "Screening: selskab, registrering og økonomiske nøgletal",
      },
      screening_founders_funding: {
        title: "Founders & finansiering",
        hint: "Screening: team og finansieringshistorik",
      },
      screening_product_technology: {
        title: "Produkt & teknologi",
        hint: "Screening: produktmodenhed og teknisk risiko",
      },
      screening_traction_commercial: {
        title: "Traction & kommercielt",
        hint: "Screening: kunder, pipeline og kommerciel status",
      },
      screening_market_mandate: {
        title: "Marked & mandat-fit",
        hint: "Screening: markedsfit mod jeres investeringstese og mandat",
      },
    },
  },
  /** The research strategy editor (SpecialistEditors). */
  editors: {
    title: "Forskningsstrategi (offentlig søgning)",
    customCount: "{count} af 13 moduler bruger spørgsmål skræddersyet til jer.",
    allStandard: "Alle 13 moduler bruger standardspørgsmålene.",
    contextLabel: "Ekstra kontekst til AI'en (valgfrit)",
    contextPlaceholder:
      "F.eks. læg ekstra vægt på verificeret klimapåvirkning frem for selvrapporterede tal.",
    generateHelp:
      "Laver søgespørgsmål til alle 13 research-moduler ud fra jeres opsætning. Intet ændres, før I gemmer.",
    generating: "Genererer",
    generate: "Generér forskningsstrategi",
    viewSaved: "Se og ret de gemte spørgsmål",
    resetAll: "Nulstil alle til standard",
    groupScreening: "Screening ({count} moduler)",
    groupDeep: "Dyb analyse ({count} moduler)",
    cancel: "Annullér",
    saving: "Gemmer",
    saveAll: "Gem alle 13 moduler",
    saveSome: "Gem {count} moduler",
    replacesCustom: "Erstatter tidligere tilpasning",
    replacesStandard: "Erstatter standard",
    questions: "Spørgsmål",
    lineHint: "(én linje pr. punkt)",
    proposalReady: "Forslag klar til alle 13 moduler -- gennemse og ret til, gem derefter.",
    generateFailed: "Forskningsstrategien kunne ikke genereres.",
    savedStatus:
      "Forskningsstrategien er gemt i kladden. Den bruges i nye screeninger og analyser, når kladden er publiceret.",
    saveFailed: "Kunne ikke gemme forskningsstrategien.",
    resetDone: "Alle moduler er nulstillet til standardspørgsmålene.",
    resetFailed: "Kunne ikke nulstille alle moduler.",
    editSaved: "Ret spørgsmålene herunder og gem. Tomme linjer fjernes.",
    issueMin: "Modulet skal have mindst ét spørgsmål.",
    issueMax: "Højst 6 spørgsmål pr. modul.",
    issueLength: "Et spørgsmål må højst være 300 tegn.",
  },
  /** Shared by the lib files and the cards (specialist-cards.ts). */
  cards: {
    and: "og",
    standard: {
      people_team: {
        label: "Team",
        role: "Founders, ledelse og team",
        focus1: "Founder-market fit",
        focus2: "Roller og huller",
        focus3: "Tidligere resultater",
      },
      product_market_gtm: {
        label: "Produkt og marked",
        role: "Problem, PMF og go-to-market",
        focus1: "Betalende kunder",
        focus2: "Markedsstørrelse og timing",
        focus3: "Konkurrenter",
      },
      technology_risk: {
        label: "Teknologi og IP",
        role: "Teknologi, data og tværgående risici",
        focus1: "Teknisk forspring",
        focus2: "Patenter og IP",
        focus3: "Teknisk risiko",
      },
      fund_finance_deal: {
        label: "Tese og deal",
        role: "Tesematch, økonomi og deal",
        focus1: "Match med tesen",
        focus2: "Regnskaber og runway",
        focus3: "Værdiansættelse og vilkår",
      },
    },
    /** Field names in the before/after of an AI revision of the fund's own specialist. */
    diff: {
      name: "Navn",
      purpose: "Formål",
      mandate: "Mandat",
      evidenceTests: "Evidenstests",
      riskAreas: "Risikoområder",
      questions: "Research-spørgsmål",
      deliverables: "Leverancer",
      areas: "Scoreområder",
    },
    /** Field names for a standard specialist's text. */
    module: {
      mandate: "Mandat",
      evidenceTests: "Evidenskrav",
      riskAreas: "Risikoområder",
    },
    problem: {
      module: "{label}: 1-12 punkter, højst {max} tegn hver",
      fix: "{field} skal rettes",
    },
    rule: {
      name: "3-80 tegn",
      purpose: "10-600 tegn",
      mandate: "1-12 punkter, højst 400 tegn hver",
      evidenceTests: "1-12 punkter, højst 400 tegn hver",
      riskAreas: "1-12 punkter, højst 120 tegn hver",
      questions: "højst 6 punkter, højst 300 tegn hver",
      deliverables: "højst 8 punkter, højst 300 tegn hver",
    },
    issue: {
      useSuggestion: "Brug forslaget",
      deletePoint: "Slet punktet",
    },
    change: {
      standardOn: "{name} er slået til igen",
      standardOff: "{name} er slået fra",
      newOwn: "Ny egen specialist: {name}",
      newOwnOff: "Ny egen specialist (slået fra): {name}",
      ownOn: "{name} er slået til",
      ownOff: "{name} er slået fra",
      ownChanged: "{name} er ændret",
      ownRemoved: "Egen specialist fjernet: {name}",
    },
  },
  /** The code's own check of the fund's own specialist (specialist-assist.codeIssues). */
  assist: {
    field: {
      name: "Navn",
      purpose: "Formål",
      mandate: "Mandat",
      evidenceTests: "Evidenstests",
      riskAreas: "Risikoområder",
      questions: "Spørgsmål",
      deliverables: "Leverancer",
      categories: "Scoreområder",
    },
    issue: {
      duplicate: "Punktet står allerede som nr. {number}.",
      duplicateAdvice: "Slet det ene.",
      vague: "Punktet er for løst til, at specialisten kan teste det.",
      vagueAdvice: "Skriv hvad der skal undersøges, og i hvilken kilde det kan ses.",
      overlap: 'Ligner "{match}" hos {title}.',
      overlapAdvice: "Skærp punktet til det, kun denne specialist skal se efter, eller slet det.",
      areaTaken:
        "{area} vurderes af {owner}, så denne specialist scorer ikke kriterierne der (den kan stadig skrive fund om området).",
      anotherSpecialist: "en anden specialist",
      inherits: "Overtager {areas}, fordi standardspecialisten for området er slået fra.",
      noAreas:
        "Specialisten scorer ingen af jeres kriterier i denne opsætning. Den skriver resumé, fund, risici og spørgsmål, som syntesen tager med.",
    },
  },
  /** The extra screening cards (screening-setup.screeningCardIn). */
  setup: {
    card: {
      finance: { label: "Finanser", description: "Nøgletal fra regnskaberne." },
      team: { label: "Team", description: "Founders og nøgleroller." },
      market: { label: "Marked", description: "Markedsstørrelse og konkurrenter." },
      technology: { label: "Teknologi", description: "Patenter og teknisk risiko." },
    },
  },
  /** The code's own check of the fund's screening (screening-check.codeScreeningIssues). */
  check: {
    issue: {
      duplicateCriterion:
        '"{label}" findes to gange. Slå dem sammen, eller giv dem hver sit fokus.',
      vagueCriterion:
        '"{label}" har for lidt tekst til, at screeningen ved, hvad den skal kigge efter.',
      vagueCriterionAdvice:
        "Skriv i en eller to sætninger, hvad der løfter og trækker ned i scoren.",
      overlap:
        '"{first}" og "{second}" beskriver næsten det samme, så det samme tæller to gange i scoren.',
      duplicateGate: 'Mandatreglen "{label}" findes to gange.',
      vagueGate: 'Mandatreglen "{label}" siger ikke tydeligt, hvornår den er brudt.',
      vagueGateAdvice:
        "Skriv reglen som et spørgsmål, der kan besvares ja eller nej ud fra materialet.",
      noInstruction:
        "Der er ingen instruktion, så screeningen følger kun kriterier, vægte og mandatregler.",
      percentInstruction:
        "Instruktionen nævner procenter. Vægtene styres af kriterierne; en vægt i instruktionen kan trække i en anden retning.",
      percentInstructionAdvice:
        "Ret vægten på kriteriet i stedet, og lad instruktionen sige, hvad der skal lægges vægt på.",
      duplicateQuestion: 'Research-spørgsmålet "{question}" står to gange.',
    },
  },
  /** The cards and panels of the specialist step (SpecialistCards). */
  panel: {
    toggleError: "Specialisten kunne ikke ændres.",
    loadError: "Specialisterne kunne ikke hentes.",
    loading: "Henter specialisterne …",
    customized: "Tilpasset",
    ownRole: "Jeres egen specialist",
    toggleLabel: "Specialist: {name}",
    off: "Slået fra. Dens områder vurderes af de andre.",
    assesses: "Vurderer {areas}",
    assessesNone: "Vurderer ingen scoreområder; skriver konklusion, risici og spørgsmål.",
    tailor: "Tilpas",
    seeMore: "Se mere",
    confirmTitle: "Luk uden at gemme?",
    confirmBody:
      "Det, der står i den åbne specialist, er ikke gemt i kladden. Lukker du, forsvinder ændringerne og udkastet.",
    stay: "Bliv",
    confirmClose: "Luk uden at gemme",
    newTitle: "Lav jeres egen specialist",
    newBody:
      "Beskriv eksperten, I mangler. Interlect skriver udkastet og tjekker det, mens I retter det.",
    newButton: "Lav specialist",
    close: "Luk",
    send: "Send",
    beforeAfter: "Før og efter",
    nothingChanged: "Interlect ændrede ikke noget.",
    srNew: "Ny: ",
    srRemoved: "Fjernet: ",
    undo: "Fortryd rettelsen",
    perLine: "ét punkt pr. linje",
    listHint: "{hint}, ét punkt pr. linje",
    hintMandate: "hvad specialisten skal vurdere",
    hintEvidenceTests: "hvad der skal findes og hvor",
    hintRiskAreas: "korte navne",
    hintQuestions: "valgfri, højst 6",
    hintDeliverables: "valgfri, højst 8",
    // Tailor a standard specialist
    tailorTitle: "Tilpas {name}",
    subCustomized:
      "Tilpasset til jeres team. Ændringen gælder nye dybe analyser, når kladden er udgivet.",
    subStandard: "Standardteksten er ens for alle teams, indtil I tilpasser den.",
    askPlaceholder: "Hvad skal {name} gøre anderledes? Fx mere fokus på domæneerfaring",
    rewriting: "Interlect omskriver {name}",
    beforeSaveText: "Før teksten kan gemmes:",
    saveDraft: "Gem i kladden",
    saving: "Gemmer",
    cancel: "Annullér",
    reset: "Sæt tilbage til standard",
    resetting: "Sætter tilbage",
    proposalFailed: "Forslaget kunne ikke laves.",
    savedDraft: "Gemt i kladden",
    textSaveFailed: "Teksten kunne ikke gemmes.",
    textLoading: "Henter instruktionerne …",
    textLoadFailed: "Instruktionerne kunne ikke hentes.",
    textHidden: "Kun en Admin eller en Lead kan se specialistens instruktioner.",
    resetDone: "Sat tilbage til standardteksten",
    resetFailed: "Kunne ikke sætte tilbage.",
    // The fund's own specialist
    steps: "Trin",
    stepDescribe: "Beskriv",
    stepEdit: "Ret udkastet",
    stepActivate: "Aktivér",
    draftFailed: "Udkastet kunne ikke laves.",
    checkFailedFallback: "Kvalitetstjekket kunne ikke køre.",
    savedOff:
      "{name} er gemt i kladden, men slået fra: grænsen for aktive egne specialister er nået",
    savedOwn: "{name} er gemt i kladden",
    ownSaveFailed: "Specialisten kunne ikke gemmes.",
    theSpecialist: "Specialisten",
    removed: "{name} er fjernet fra kladden",
    deleteFailed: "Specialisten kunne ikke slettes.",
    subActive: "Aktiv i kladden. Ændringer gælder nye dybe analyser, når kladden er udgivet.",
    subOff: "Slået fra i kladden.",
    subNew:
      "Interlect skriver udkastet og tjekker det, mens I retter. Aktivér, når I er tilfredse.",
    describeLabel: "Beskriv eksperten, I mangler",
    describePlaceholder:
      "Fx en, der vurderer, om selskabets klimaeffekt er målbar, dokumenteret og vokser med omsætningen.",
    drafting: "Interlect skriver udkastet til specialisten",
    makeDraft: "Lav udkast",
    draftingPending: "Skriver udkast",
    writeOwn: "Skriv selv",
    revisePlaceholder: "Bed Interlect rette specialisten, fx mere fokus på regulering",
    revising: "Interlect retter specialisten",
    areasLegend: "Scoreområder · de kriterier, specialisten scorer",
    areasHelp:
      "Et område, som en aktiv standardspecialist ejer, bliver hos den. Slår I den fra, går området til den første egne specialist, der har valgt det.",
    beforeCheck: "Før specialisten kan tjekkes og gemmes:",
    saveChanges: "Gem ændringerne",
    saveOff: "Gem specialisten (slået fra)",
    activate: "Aktivér specialisten",
    delete: "Slet specialisten",
    limitNote:
      "I har {active} aktive egne specialister, og grænsen er {max}. Den nye gemmes slået fra; slå en anden fra for at bruge den.",
    savedNote:
      "Specialisten gemmes i kladden og bruges i nye dybe analyser, når kladden er udgivet.",
    deleteTitle: "Slet {name}?",
    deleteBody:
      "Specialisten fjernes fra kladden. Udgivne versioner og analyser, der allerede er kørt med den, beholder den.",
    keep: "Behold",
    deleting: "Sletter",
    deleteConfirm: "Slet",
    // The quality check
    checkTitle: "Kvalitetstjek",
    checkFailed: "Kvalitetstjekket kunne ikke køre: {message}",
    lookedAt: "Interlect har set på udkastet",
    fixOne: "Interlect har ét forslag",
    fixMany: "Interlect har {count} forslag",
    assessed: "I en kørsel med kladden vurderer den {areas}.",
    assessedNone:
      "I en kørsel med kladden scorer den ingen kriterier; den skriver konklusion, risici og spørgsmål.",
    aiNoAnswer: " AI-tjekket svarede ikke, så kun de faste tjek er vist.",
    stale: " Tjekket er fra før dine sidste rettelser; det kører igen, når du holder pause.",
    point: " · punkt {number}",
    suggestion: "Forslag:",
    advice: "Råd:",
    used: "Brugt",
  },
  /** The screening step (ScreeningStep). */
  screening: {
    area: {
      criteria: "Kriterier og vægte",
      gates: "Mandatregler",
      risk: "Risikotolerance",
      instruction: "Instruktion",
      cards: "Ekstra kort",
      research: "Research-spørgsmål",
    },
    saved: "Screeningen er gemt i kladden",
    saveFailed: "Screeningen kunne ikke gemmes.",
    draftNotSavedRetry: "Kladden kunne ikke gemmes. Prøv igen.",
    draftNotSaved: "Kladden kunne ikke gemmes.",
    proposalFailed: "Forslaget kunne ikke laves.",
    checkFailedFallback: "Kvalitetstjekket kunne ikke køre.",
    instructionTitle: "Instruktion",
    instructionHelp:
      "Det, screeningen skal lægge vægt på ud over kriterierne. Den ændrer aldrig vægte eller mandatregler.",
    instructionPlaceholder:
      "Fx: Vi screener hårdt på, om grundlæggerne selv har solgt til de første kunder, og vi tæller kun betalende kunder som traction.",
    charsOver: "{count} tegn for meget",
    charsOf: "{count} af {max} tegn",
    save: "Gem screeningen",
    saving: "Gemmer",
    unsaved: "Ændringer er ikke gemt i kladden",
    tailorTitle: "Tilpas med Interlect",
    tailorHelp:
      "Beskriv, hvordan I vil screene. Interlect viser forslaget før og efter, og intet gælder, før I udgiver.",
    askLabel: "Beskriv, hvordan I screener",
    send: "Send",
    writing: "Interlect skriver et forslag til screeningen",
    proposalNote:
      "Nye screeninger bruger ændringen, når kladden er udgivet. Eksisterende screeninger ændres ikke.",
    checkTitle: "Kvalitetstjek",
    checkFailed: "Kvalitetstjekket kunne ikke køre: {message}",
    lookedAt: "Interlect har set på screeningen",
    fixOne: "Interlect har ét forslag",
    fixMany: "Interlect har {count} forslag",
    aiNoAnswer: "AI-tjekket svarede ikke, så kun de faste tjek er vist. ",
    stale: "Tjekket er fra før dine sidste rettelser; det kører igen, når du holder pause.",
    suggestion: "Forslag:",
    advice: "Råd:",
    checkNow: "Tjek screeningen",
    checking: "Tjekker",
    nothingFound: "Interlect fandt intet at rette i screeningen.",
  },
} as const;
