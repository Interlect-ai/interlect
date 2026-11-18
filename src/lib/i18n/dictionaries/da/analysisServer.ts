/**
 * Danish texts the analysis sends to the person: errors and refusals from the
 * screening, the deep analysis and their workers, and texts stored with a run (the score's
 * explanation, the run's summary). The worker runs in the fund's language (`withRunLanguage`).
 */
export const analysisServer = {
  /** A step stopped by its cost cap: no amount, no internal name. */
  budget: {
    stepStopped: "Trinnet stoppede ved sit loft.",
  },
  common: {
    caseNotFound: "Casen blev ikke fundet.",
    profileNotLoaded: "Den aktive opsætning kunne ikke hentes.",
    noMandate: "Opsætningen mangler mandat.",
    noSpecialists: "Jeres opsætning har ingen aktive specialister. Slå mindst én til.",
    jobNotRegistered: "Analysejobbet kunne ikke registreres.",
    jobNotRegisteredSafely: "Analysejobbet kunne ikke registreres sikkert.",
    deepOverBudget: "Dybdeanalysens modelkald overstiger det konfigurerede omkostningsloft.",
    basisNotReloaded: "Analysegrundlaget kunne ikke genindlæses efter offentlig research.",
    specialistFailed: "En specialistanalyse fejlede.",
    otherCase: "AI-resultatet tilhører en anden case.",
    noAssessment: "Ingen vurdering.",
    deepScoresNotSaved: "Dybdeanalysens kriteriescorer kunne ikke gemmes.",
    deepRisksNotSaved: "Dybdeanalysens risici kunne ikke gemmes.",
    financeNotSaved: "Finansberegningerne kunne ikke gemmes.",
    deepRecommendationNotSaved: "Dybdeanalysens anbefaling kunne ikke gemmes.",
    gatewayMissing:
      "AI-tjenesten kunne ikke bruges lige nu. Prøv igen om lidt, eller skriv til Interlect.",
    gatewayInvalid: "AI-tjenesten gav ikke et brugbart svar. Prøv igen om lidt.",
    stoppedByDataRules: "Stoppet af datareglerne.",
    screeningResearchNotSaved: "Screeningens research kunne ikke gemmes.",
    noBasis: "Screeningen fandt ikke et tilstrækkeligt dokumenteret analysegrundlag.",
    caseDecidedScreen: "Casen er besluttet. Genåbn den, før den screenes igen.",
  },
  deep: {
    riskNumber: "Risiko {n}",
    runDataNotLoaded: "Dybdeanalysens kørselsdata kunne ikke hentes.",
    notCompleted: "Den dybe analyse kunne ikke markeres som færdig.",
    released: "Kørslen gik i stå undervejs og er frigivet til en ny dyb analyse.",
    lockedProfileMissing: "Dybdeanalysens låste opsætning mangler.",
    caseNotReloaded: "Dybdeanalysens case kunne ikke genindlæses.",
    screeningNotReloaded: "Den låste screening kunne ikke genindlæses.",
    stepsNotLoaded: "Dybdeanalysens trin kunne ikke hentes.",
    researchNotSaved: "Dybdeanalysens research kunne ikke gemmes.",
    endedBeforeSynthesis: "Dybdeanalysen blev afsluttet, før syntesen kunne starte.",
    storedResearchInvalid: "Den gemte offentlige research er ugyldig.",
    needsScreening: "Casen skal have en afsluttet screening, før den kan sendes til dyb analyse.",
    earlierNotChecked: "Tidligere dybdeanalyser kunne ikke kontrolleres.",
    alreadySent: "Denne screening er allerede sendt til dyb analyse.",
    caseDecided: "Casen er besluttet. Genåbn den, før en dyb analyse startes.",
    notStarted: "Den grundige analyse kunne ikke startes.",
    stepsNotRegistered: "Analysetrinnene kunne ikke registreres.",
    notMoved: "Casen kunne ikke flyttes til Dyb analyse.",
    notQueued: "Analysejobbet kunne ikke sendes til baggrundskøen.",
    gatewayUnreachable: "AI-tjenesten kunne ikke nås. Prøv igen om lidt.",
    financeOnly: "Kun finansspecialisten må udtrække finansielle input.",
    synthesisChangedFinance:
      "IC-syntesen har tilføjet eller ændret et finansielt input fra specialistanalysen.",
    unknownEvidence: "Dybdeanalysen henviser til evidens, der ikke indgik i kørslen.",
    scoreWithoutEvidence: "Dybdeanalysen indeholder en score uden evidens.",
    claimWithoutEvidence: "Dybdeanalysen indeholder en faktuel påstand uden evidens.",
    contraryShort: "Modfortolkningen er meget kort.",
    noOpenQuestions: "Analysen indeholder ingen åbne spørgsmål.",
    financeNoPeriod: "Mindst ét finansielt input mangler periode og skal læses med forsigtighed.",
    queuedManually: "Dyb analyse sat i kø manuelt efter screening.",
    researchReused: "Research genbrugt fra en tidligere kørsel; CVR blev tjekket dengang.",
    stepNotLocked: "Analysetrinnet {step} kunne ikke låses.",
    stepFailed: "Analysetrinnet {step} fejlede. Start den dybe analyse igen.",
    stepRetried:
      "Analysetrinnet {step} er forsøgt {count} gange uden at blive færdigt. Kørslen stoppes, så der ikke betales igen.",
    specialistUnfinished: "Specialistanalysen {name} er ikke afsluttet.",
    contrary: "Stærkeste modfortolkning: {text}",
    approvedSummary: "Partnergodkendt grundig analyse som {name}, profilversion {version}.",
    timeout: "{label} tog længere tid end de {seconds} sekunder, der er afsat.",
    cutOff: "{label} blev afbrudt, før det strukturerede svar var færdigt.",
    specialistOtherTask: "Specialistresultatet fra {name} tilhører en anden opgave eller case.",
    specialistCoverage:
      "Specialistresultatet fra {name} har ufuldstændig eller forkert analysedækning.",
    specialistUnknownEvidence:
      "Specialistresultatet fra {name} henviser til evidens uden for casens analysegrundlag.",
    specialistScoreNoEvidence: "Specialistresultatet fra {name} indeholder en score uden evidens.",
    specialistClaimNoEvidence:
      "Specialistresultatet fra {name} indeholder en faktuel påstand uden evidens.",
    missingAreas: "Manglende analyseområder (markeret som ukendt): {areas}.",
    riskShort:
      "{name} har en for kort begrundelse ({count} sætninger). Risikovurderingen skal være udførlig og company-specific.",
    riskBelowTarget:
      "{name} har en kortere begrundelse end målet ({count} sætninger, målet er mindst {target}).",
    riskNoBoth: "{name} begrunder ikke både sandsynlighed og konsekvens eksplicit.",
    riskNoPlan: "{name} mangler en tilstrækkelig konkret plan for afklaring eller risikoreduktion.",
  },
  evidence: {
    notLoaded: "Bevisarket kunne ikke hentes.",
    notSaved: "Bevisarket kunne ikke gemmes.",
    none: "Intet bevisark ({reason}); specialisterne får den samlede research.",
  },
  method: {
    profileNotFound: "Den aktive opsætning blev ikke fundet.",
    noMembership: "Du har ikke et aktivt medlemskab i det valgte team.",
    adminOnly: "Kun en Admin kan se prompt-teksterne.",
  },
  rescore: {
    failed: "Scoren kunne ikke regnes igen.",
    screeningNotRead: "Den seneste screening kunne ikke læses, så scoren blev ikke regnet igen.",
    notSaved: "Den nye score kunne ikke gemmes.",
    answersNotLoaded: "Teamets svar kunne ikke hentes.",
    verdictNotLoaded: "Kravets nuværende vurdering kunne ikke hentes.",
  },
  plan: {
    notInTime: "Planen blev ikke færdig i tide.",
    noCriteriaOrGates: "Opsætningen har hverken kriterier eller gates.",
    tooLong: "Jeres opsætning og casens materiale var for lange til planen.",
    failed: "Planen kunne ikke laves: {reason}",
  },
  runPlan: {
    fundNotFound: "Teamet blev ikke fundet.",
    runNotFound: "Kørslen blev ikke fundet.",
  },
  screening: {
    evidenceNotLoaded: "Screeningens evidens kunne ikke hentes.",
    stoppedTwice: "Screeningens analyse stoppede to gange undervejs og startes ikke igen.",
    profileNotLoaded: "Den opsætning, screeningen startede med, kunne ikke hentes.",
    researchNotFound: "Screeningens research blev ikke fundet.",
    scoresNotSaved: "Screeningens kriteriescorer kunne ikke gemmes.",
    risksNotSaved: "Screeningens risici kunne ikke gemmes.",
    explanationsNotSaved: "Screeningens forklaringer kunne ikke gemmes.",
    recommendationNotSaved: "Screeningens anbefaling kunne ikke gemmes.",
    resultNotSaved: "Screeningens resultat kunne ikke gemmes.",
    earlierNotChecked: "Tidligere screeninger kunne ikke kontrolleres.",
    released: "Kørslen blev afbrudt undervejs og er frigivet til en ny screening.",
    evidenceNotFetched: "Evidensen kunne ikke hentes.",
    notStarted: "Screeningen kunne ikke startes.",
    notMarked: "Screeningen kunne ikke markeres som startet.",
    basisNotSaved: "Screeningens analysegrundlag kunne ikke gemmes.",
    vercelGatewayMissing:
      "AI-tjenesten kunne ikke bruges lige nu. Prøv igen om lidt, eller skriv til Interlect.",
    timeout: "Screeningens vurdering tog længere tid end de {seconds} sekunder, der er afsat.",
    cutOff: "Screeningssvaret blev afbrudt, før den strukturerede analyse var færdig.",
    noTotal: "Den samlede score kunne ikke beregnes på det foreliggende grundlag.",
    unknownEvidence: "AI-resultatet henviser til evidens, som ikke indgik i kørslen.",
    scoreWithoutEvidence: "AI-resultatet indeholder en score uden evidens.",
    criteriaCoverage: "AI-resultatet dækkede ikke hvert screeningskriterium præcis én gang.",
    gatesCoverage: "AI-resultatet dækkede ikke hver mandatgate præcis én gang.",
    notRun: "Screeningens analysefase blev ikke kørt ({result}).",
    summary: "Screening som {name} med profilversion {version}.",
    scoreLine: "Tesefit-scoren er {score} af 100, {relation} tærsklen på {threshold}.",
    pointsAbove: "{points} point over",
    pointsBelow: "{points} point under",
    carriedBy:
      "Scoren bæres især af {strong} ({strongScore}), mens {weak} ({weakScore}) er den tydeligste begrænsning.",
    priorCount:
      "{count} af {total} kriterier bruger en forsigtig stadiejusteret basisværdi, fordi evidensen endnu ikke kunne bære en selvstændig score.",
  },
  search: {
    noThesis: "Opsætningen har hverken investeringstese eller kriterier.",
  },
  specialists: {
    notLoaded: "Jeres specialister kunne ikke hentes. Prøv igen om lidt.",
    overridesNotLoaded: "Jeres tilpassede specialistinstruktioner kunne ikke hentes.",
  },
  followup: {
    failed: "Refleksionen kunne ikke laves: {reason}",
  },
  /** The key figures from the annual reports: name, formula and note per year (financial-metrics.ts). */
  metrics: {
    defs: {
      revenue: {
        label: "Nettoomsætning",
        formula: "Nettoomsætning som indberettet",
      },
      gross_profit: {
        label: "Bruttofortjeneste",
        formula:
          "Bruttofortjeneste som indberettet (ÅRL § 32: kan indeholde andre eksterne omkostninger)",
      },
      ebit: {
        label: "EBIT (resultat af primær drift)",
        formula: "Resultat af primær drift som indberettet",
      },
      ebitda: {
        label: "EBITDA",
        formula: "Resultat af primær drift + af- og nedskrivninger",
      },
      net_result: {
        label: "Årets resultat",
        formula: "Årets resultat som indberettet",
      },
      gross_margin: {
        label: "Bruttomargin",
        formula: "Bruttofortjeneste / nettoomsætning × 100",
      },
      ebitda_margin: {
        label: "EBITDA-margin",
        formula: "EBITDA / nettoomsætning × 100 (eller / bruttofortjeneste, når omsætning mangler)",
      },
      ebit_margin: {
        label: "EBIT-margin",
        formula: "Resultat af primær drift / nettoomsætning × 100",
      },
      personnel_share: {
        label: "Lønandel af bruttofortjeneste",
        formula: "Personaleomkostninger / bruttofortjeneste × 100",
      },
      interest_coverage: {
        label: "Rentedækning",
        formula: "Resultat af primær drift / finansielle omkostninger",
      },
      revenue_growth: {
        label: "Omsætningsvækst",
        formula: "(Omsætning i år / omsætning året før − 1) × 100",
      },
      gross_profit_growth: {
        label: "Vækst i bruttofortjeneste",
        formula: "(Bruttofortjeneste i år / året før − 1) × 100",
      },
      gross_profit_cagr_3y: {
        label: "Årlig vækst i bruttofortjeneste over 3 år (CAGR)",
        formula: "(Bruttofortjeneste i år / for 3 år siden)^(1/antal år) − 1, × 100",
      },
      equity: {
        label: "Egenkapital",
        formula: "Egenkapital som indberettet",
      },
      equity_ratio: {
        label: "Soliditetsgrad",
        formula: "Egenkapital / aktiver i alt × 100",
      },
      debt_to_equity: {
        label: "Gældsgrad",
        formula: "Gæld i alt / egenkapital",
      },
      return_on_equity: {
        label: "Egenkapitalforrentning (ROE)",
        formula: "Årets resultat / gennemsnitlig egenkapital × 100",
      },
      capital_loss: {
        label: "Kapitaltab (egenkapital under halvdelen af selskabskapitalen)",
        formula: "Egenkapital / indskudt kapital; under 0,5 er kapitaltab (selskabsloven § 119)",
      },
      balance_check: {
        label: "Balancekontrol",
        formula: "Aktiver i alt − passiver i alt (skal være 0)",
      },
      cash: {
        label: "Likvide beholdninger",
        formula: "Likvide beholdninger som indberettet",
      },
      current_ratio: {
        label: "Likviditetsgrad",
        formula: "Omsætningsaktiver / kortfristet gæld",
      },
      cash_flow_operating: {
        label: "Pengestrøm fra drift",
        formula: "Pengestrøm fra driftsaktivitet som indberettet (kun klasse C og D)",
      },
      cash_conversion: {
        label: "Cash conversion",
        formula: "Pengestrøm fra drift / EBITDA × 100",
      },
      operating_burn: {
        label: "Driftsnært burn pr. måned",
        formula:
          "−(årets resultat + af- og nedskrivninger) / regnskabsårets måneder, kun når tallet er positivt",
      },
      runway_at_balance_date: {
        label: "Runway ved balancedagen",
        formula: "Likvide beholdninger / driftsnært burn pr. måned",
      },
      runway_today: {
        label: "Runway i dag",
        formula: "Runway ved balancedagen − måneder siden balancedagen",
      },
      capital_injection: {
        label: "Afledt kapitaltilførsel",
        formula: "Egenkapital i år − egenkapital året før − årets resultat (+ foreslået udbytte)",
      },
      retained_earnings: {
        label: "Overført resultat (akkumuleret)",
        formula: "Overført resultat som indberettet; negativ betyder akkumuleret underskud",
      },
      nibd_to_ebitda: {
        label: "Nettorentebærende gæld / EBITDA",
        formula: "(Rentebærende gæld − likvider) / EBITDA",
      },
      employees: {
        label: "Gennemsnitligt antal ansatte",
        formula: "Gennemsnitligt antal ansatte som indberettet",
      },
      gross_profit_per_employee: {
        label: "Bruttofortjeneste pr. ansat",
        formula: "Bruttofortjeneste / gennemsnitligt antal ansatte",
      },
      result_per_employee: {
        label: "Resultat pr. ansat",
        formula: "Årets resultat / gennemsnitligt antal ansatte",
      },
      dso: {
        label: "Kredittid for kunder (DSO)",
        formula: "Tilgodehavender fra salg / nettoomsætning × regnskabsårets dage",
      },
      filing_count: {
        label: "Antal regnskabsår",
        formula: "Antal indlæste regnskabsår for CVR-nummeret",
      },
      latest_filing_age: {
        label: "Alder på seneste regnskab",
        formula: "Måneder fra seneste balancedag til i dag",
      },
    },
    notes: {
      inputMissing: "Et nødvendigt tal mangler i regnskabet.",
      notReported: "{names} er ikke indberettet for året.",
      and: " og ",
      denominatorZero: "{label} er 0, så forholdet kan ikke beregnes.",
      denominatorNegative: "{label} er negativ, så forholdet er ikke meningsfuldt.",
      needsPriorYear: "Kræver regnskabet for året før.",
      missingOneYear: "{label} mangler for et af de to år.",
      notFullYear:
        "Et af regnskabsårene er ikke 12 måneder (fx omlagt regnskabsår), så væksten sammenlignes ikke.",
      priorNotPositive: "{label} var 0 eller negativ året før, så vækst i % er ikke meningsfuld.",
      depreciationMissing: "Af- og nedskrivninger mangler og regnes som 0.",
      runwayCapped: "Over 10 år: selskabet kan i praksis finansiere sin drift selv.",
      revenueHidden:
        "Nettoomsætning er ikke indberettet (klasse B må skjule den), så bruttomargin kan ikke beregnes.",
      noPositiveBase: "Hverken en positiv omsætning eller bruttofortjeneste er indberettet.",
      measuredAgainstGrossProfit:
        "Målt mod bruttofortjeneste, fordi omsætningen ikke er indberettet.",
      noFinanceExpenses: "Ingen finansielle omkostninger, så rentedækning er ikke relevant.",
      needsFourYears: "Kræver fire regnskabsår i træk.",
      cagrNotFullYear: "Start- eller slutåret er ikke 12 måneder, så CAGR sammenlignes ikke.",
      cagrMissing: "Bruttofortjeneste mangler for start- eller slutåret.",
      cagrNotPositive: "CAGR kræver positiv bruttofortjeneste i begge år.",
      roeNeeds: "Kræver årets resultat og egenkapital for i år og året før.",
      averageEquityNotPositive: "Gennemsnitlig egenkapital er 0 eller negativ.",
      balanceDiffers: "Balancen stemmer ikke; tallene bør kontrolleres i regnskabet.",
      noOperatingCashFlow: "Pengestrøm fra drift er ikke indberettet (typisk klasse B).",
      ebitdaNotPositive: "EBITDA er 0 eller negativ.",
      noBurn:
        "Selskabet brænder ikke penge af på driften (resultat før afskrivninger er positivt).",
      burnEstimate: "Estimat fra resultatopgørelsen, ikke pengestrømme.",
      runwayEstimate: "Estimat: burn udledt af resultatopgørelsen.",
      runwayNotRelevant: "Selskabet brænder ikke penge af, så runway er ikke relevant.",
      latestOnly: "Beregnes kun for det seneste regnskab.",
      runwayRunOut:
        "Estimat: pengene ville være brugt op for {ago} måneder siden med samme burn, medmindre der er rejst kapital siden balancedagen for {elapsed} måneder siden.",
      runwayToday:
        "Estimat: {elapsed} måneder er gået siden balancedagen uden nyere tal. Kapital rejst siden da er ikke med.",
      injectionNeeds: "Kræver egenkapital for to år og årets resultat.",
      injectionPositive:
        "Estimat: forskellen i egenkapital, som årets resultat ikke forklarer, typisk nye indskud fra ejerne.",
      injectionNegative:
        "Estimat: egenkapitalen faldt mere end årets resultat forklarer, typisk udbytte, kapitalnedsættelse eller køb af egne andele.",
      debtNotSplit:
        "Regnskabet deler ikke gælden op i rentebærende og ikke-rentebærende gæld, så nettogælden kan ikke beregnes sikkert.",
    },
  },
  /** Fetching and storing annual reports, and the panel's simple ratios (financial-statements.ts). */
  statements: {
    indexStatus: "Erhvervsstyrelsens regnskabsindeks svarede med status {status}.",
    fileStatus: "Regnskabsfilen kunne ikke hentes (status {status}).",
    fileTooLarge: "Regnskabsfilen er større end forventet og blev ikke læst.",
    ratios: {
      equityRatio: "Soliditetsgrad (egenkapital/aktiver)",
      solvencyRatio: "Gældsgrad (gæld/egenkapital)",
      negativeEquity: "Negativ egenkapital -- forholdet er ikke meningsfuldt.",
      equityGrowth: "Ændring i egenkapital ift. foregående år",
      onePeriod: "Kun én periode indlæst -- ingen sammenligning muligt.",
      resultPerEmployee: "Resultat pr. medarbejder",
      noEmployees: "Antal medarbejdere er ikke indberettet i dette regnskab.",
      grossMargin: "Bruttomargin",
      grossMarginCombined:
        "Selskabet sammenlægger omsætning og vareforbrug til bruttofortjeneste (§32) -- bruttomargin kan ikke udledes af regnskabet alene.",
      noGrossProfit: "Bruttofortjeneste er ikke indberettet i dette regnskab.",
    },
    noneForCvr: "Der blev ikke fundet nogen offentliggjorte regnskaber for dette CVR-nummer.",
    latestNotFetched: "Det seneste regnskab kunne ikke hentes ({reason}). Prøv igen senere.",
    latestNoFigures: "Det seneste regnskab indeholder ingen af de talstørrelser, vi genkender.",
    noRecognisedFigures: "ingen genkendte tal",
    periodSkipped: "Regnskabet for perioden til {periodEnd} kunne ikke læses og er udeladt.",
    sourceNotLookedUp: "Regnskabskilden kunne ikke slås op.",
    sourceNotRegistered: "Regnskabskilden kunne ikke registreres.",
    storedNotRead: "De gemte regnskaber kunne ikke læses.",
    duplicatesNotRemoved: "Dubletter af regnskabsår kunne ikke ryddes op.",
    statementNotSaved: "Regnskabet kunne ikke gemmes.",
    linesNotReplaced: "De gamle regnskabslinjer kunne ikke erstattes.",
    linesNotSaved: "Regnskabslinjerne kunne ikke gemmes.",
    evidenceNotSaved:
      "Regnskabet er gemt, men tallene kunne ikke gemmes som evidens. Analysen kan derfor ikke citere dem.",
    dataPointsNotSaved:
      "Regnskabet er gemt, men omsætning og likvider kunne ikke gemmes som tal på casen.",
    noYearsSaved: "Ingen regnskabsår kunne gemmes.",
    foreignNotAvailable:
      "Regnskab ikke tilgængeligt i {registry} for {numberLabel} {number}. {warnings}Analysen bruger websøgningens tal.",
    oldNotRemoved: "De gamle regnskaber kunne ikke fjernes ({reason}).",
    oldSourcesNotMarked: "De gamle regnskabskilder kunne ikke markeres ({reason}).",
  },
  /** The rationale of the finance gates calculated in code (financial-gates.ts). */
  gates: {
    registrySource: "registrets regnskab",
    cvrSource: "CVR-regnskab",
    loadError: "Regnskabsdata kunne ikke læses (teknisk fejl). Kør analysen igen.",
    noReports:
      "Ingen offentlige årsregnskaber for selskabet endnu, så kravet kan ikke vurderes. Det er ukendt, ikke et brud.",
    registryMatchUnsure:
      "Matchet i registret er ikke sikkert nok til, at regnskabet må afgøre kravet. Ukendt, indtil identiteten er sikker.",
    cvrMatchUnsure:
      "CVR-matchet er ikke sikkert nok til, at regnskabet må afgøre kravet. Ukendt, indtil identiteten er sikker.",
    equityNotReported: "Egenkapitalen er ikke indberettet i seneste regnskab.",
    equityPositive: "Egenkapitalen var {amount} pr. {date} ({source}).",
    equityNegative:
      "Egenkapitalen var {amount} pr. {date} ({source}). Negativ egenkapital er et brud på kravet.",
    noBurn:
      "Selskabet brænder ikke penge af på driften i seneste regnskab (resultat før afskrivninger er positivt). Estimat.",
    runwayUnknown: "Runway kan ikke beregnes ud fra regnskabet.",
    overTenYears: "over 10 år",
    aboutMonths: "ca. {months} måneder",
    runwayToday:
      "Runway i dag er {runway} (estimat fra seneste regnskab; kapital rejst siden balancedagen er ikke med).",
    filings: "{count} godkendte regnskabsår er indlæst (krav: {required}).",
    ageUnknown: "Regnskabets alder kan ikke beregnes.",
    age: "Seneste regnskab har balancedag for {months} måneder siden (krav: højst 18).",
    goingConcernRegistryUnknown:
      "Registret oplyser ikke, om årsrapporten har en note om usikkerhed om fortsat drift (going concern). Ukendt, ikke et brud.",
    goingConcernNotRead:
      'Det vides ikke, om seneste årsrapport har en going concern-note (regnskabet er hentet, før noten blev læst). Det hentes igen ved næste screening eller med "Hent seneste igen" under "Hent eller skift regnskab". Ukendt, ikke et brud.',
    goingConcernNote:
      "Seneste årsrapport har en note om væsentlig usikkerhed om fortsat drift (going concern). Kræver en menneskelig vurdering.",
    goingConcernNone:
      "Seneste årsrapport har ingen note om usikkerhed om fortsat drift (CVR-regnskab).",
    debtNotSplit:
      "Regnskabet deler ikke gælden op i rentebærende og ikke-rentebærende gæld, så nettogælden kan ikke beregnes sikkert. Ukendt, ikke et brud.",
  },
  /** Units and warnings of the deck-based finance calculations (finance.ts). */
  finance: {
    unknownCurrency: "ukendt valuta",
    unknownScale: "ukendt skala {currency}",
    mixedCurrencies:
      "Beløbene er opgivet i forskellige valutaer eller enheder ({bases}). Interlect omregner ikke, så beløbsberegningerne er ikke lavet.",
    perMonth: "/måned",
    perYear: "/år",
    months: "måneder",
    perCustomer: "/kunde",
    perCustomerMonth: "/kunde/måned",
    noPositiveBurn: "Virksomheden har ikke positivt net burn i den angivne periode.",
    runwayNotMeaningful: "Runway er ikke meningsfuld ved nul eller negativt net burn.",
    registryEstimate:
      "Bygger på registrets regnskab: driftsomkostningerne er et estimat af omsætning, årets resultat og afskrivninger, ikke et tal fra regnskabet.",
    registryStated: "Bygger på tal fra registrets regnskab.",
    selfReported:
      "Bygger på tal, virksomheden selv har oplyst (pitch deck eller hjemmeside) eller fundet ved websøgning, ikke på registret.",
    growthNeedsTwoYears:
      "Vækst kræver to hele regnskabsår med omsætning, ca. et år fra hinanden, og positiv omsætning i det første.",
  },
  // Why a finance specialist input was removed.
  financeCheck: {
    registry_unit:
      "Et finansielt input ({metric}, {period}) er fjernet: enheden ({unit}) angiver ikke tydeligt valuta og skala, så tallet kunne ikke sammenlignes med årsregnskabet i registret.",
    registryUnreadable:
      "Årsregnskaberne fra registret kunne ikke læses, så de finansielle input er kun kontrolleret mod evidensen.",
    evidence_missing:
      "Et finansielt input ({metric}, {period}) er fjernet: den citerede evidens kunne ikke læses, så tallet kunne ikke kontrolleres.",
    not_in_evidence:
      "Et finansielt input ({metric}: {value} {unit}, {period}) er fjernet: tallet står ikke i den evidens, det henviser til.",
    registry_mismatch:
      "Et finansielt input ({metric}: {value} {unit}, {period}) er fjernet: det afviger mere end 5 % fra årsregnskabet i registret ({registry}).",
  },
  /** The code score for financial strength (financial-score.ts). */
  financeScore: {
    labels: {
      growth: "Vækst",
      ebitda_margin: "EBITDA-margin",
      equity_ratio: "Soliditet",
      runway: "Runway",
      current_ratio: "Likviditetsgrad",
    },
    fromCvr: "{components} (CVR-regnskabet) giver {score}.",
    fromRegistry: "{components} (registrets regnskab) giver {score}.",
    adjusted: "{base} {rationale}",
  },
  /** The screening score's refusals (scoring.ts). */
  scoring: {
    wrongProfile: "AI-resultatet tilhører ikke den aktive opsætning og version.",
    weightsSum: "Aktive kriterievægte skal summere til 100, men summerer til {total}.",
  },
  /** Problems and warnings for the fund's specialist set (specialist-set.ts). */
  specialistSet: {
    manyAreas:
      "{title} vurderer {count} af de ni områder alene. Fordel dem på flere specialister, så svaret ikke bliver for langt til ét kald.",
    tooManyCustom: "Højst {max} egne specialister kan være aktive (opsætningen har {count}).",
    noneActive: "Mindst én specialist skal være aktiv i den dybe analyse.",
  },
  /** One line per AI level (ai-settings.functions.ts). */
  tiers: {
    light: "Hurtig og billig. Egnet til stor dealflow og første sortering.",
    medium: "Grundig og afbalanceret. Standard, og det niveau Interlect er afprøvet mest på.",
    heavy: "Mest grundig. Mest nuanceret på svære cases, men bruger flest kreditter.",
  },
  /** Length checks of the deep analysis's texts (deep-text-rules.ts). */
  deepText: {
    criterionTooShort: "Begrundelsen for kriteriet {criterion} er for kort ({length} tegn).",
    criterionShort: "Begrundelsen for kriteriet {criterion} er kortere end kravet ({length} tegn).",
    overallTooShort: "Den samlede vurdering er for kort ({length} tegn).",
    overallShort: "Den samlede vurdering er kortere end kravet ({length} tegn).",
  },
  /** The findings code adds when the model skipped an area (finding-categories.ts). */
  findings: {
    categories: {
      fund_thesis_fit: "investeringstesen og mandatet",
      founder_market_fit: "founder-market fit",
      team_market_fit: "teamets match med markedet",
      product_market_fit: "produkt-market fit",
      product_technology: "produktteknologi",
      market_timing: "markedets timing",
      traction_gtm: "traction og go-to-market",
      financial_strength: "finansiel styrke",
      evidence_quality: "evidenskvalitet",
    },
    unknown:
      "Ingen data fundet for {label}. Analysen kunne ikke vurdere området ud fra det tilgængelige materiale; det er ukendt og ikke et negativt resultat. Området skal afklares med yderligere dokumentation.",
    copied:
      "Syntesen leverede ingen finding for {categories}. Specialisternes egne fund er taget med.",
    added:
      'Der kom intet fund for {categories}. Området er markeret som ukendt ("Ingen data fundet"), ikke som et brud.',
  },
  /** The team's answer to a gate (gate-answers.ts). */
  gateAnswers: {
    teamAnswer: "Teamets svar: {answer}",
    met: "Opfyldt",
    notMet: "Ikke opfyldt",
  },
  /** The CVR lookup at Datafordeleren (cvr-lookup.ts). */
  cvr: {
    status: "Datafordeleren svarede med status {status}.",
    rejected: "Datafordeleren afviste opslaget.",
    nameLookupNotConfigured: "CVR-navneopslag er ikke konfigureret.",
    lookupNotConfigured: "CVR-opslag er ikke konfigureret.",
  },
  /** Fetching the CVR master data (cvr-profile.ts). */
  cvrProfile: {
    parts: {
      branche: "branche",
      virksomhedsform: "virksomhedsform",
      adresse: "adresse",
    },
    and: " og ",
    unknown: "ukendt",
    sourceNotLookedUp: "kilden kunne ikke slås op ({reason})",
    sourceNotReconfirmed: "kilden kunne ikke genbekræftes ({reason})",
    refreshFailed: "CVR-stamdata kunne ikke opdateres denne gang; de gemte bruges.",
    sourceNotSaved: "kilden kunne ikke gemmes ({reason})",
    evidenceNotSaved: "stamdata kunne ikke gemmes som evidens ({reason})",
    fetchedWithout: "CVR-stamdata er hentet uden {parts}.",
    notFetched: "CVR-stamdata (branche, form, startdato) kunne ikke hentes denne gang.",
    notUpdated: "CVR-stamdata blev ikke opdateret ({parts} kunne ikke hentes); de gemte bruges.",
    existingNotRead: "eksisterende stamdata kunne ikke læses ({reason})",
    newNotSaved: "nye stamdata kunne ikke gemmes ({reason})",
    updated: "CVR-stamdata er opdateret (noget er ændret siden sidst).",
  },
  /** Reading the deck's image pages (deck-ocr*.ts, deck-pdf-subset.ts). */
  deck: {
    imagePagesMarker: "sider er billeder",
    imagePagesNotRead: "Deckets billedsider blev ikke læst: {reason}",
    unknownReason: "ukendt årsag",
    deckUnreadable: "Pitch decket kunne ikke læses.",
    noDeck: "Casen har intet pitch deck.",
    pdfOnly: "Kun PDF-decks med kendt sidetal kan læses som billeder.",
    textUnreadable: "Deckets tekst kunne ikke læses.",
    allPagesHaveText: "Alle sider har tekst.",
    readEarlier: "Billedsiderne er læst ved en tidligere screening.",
    failedRepeatedly:
      "{pages} sider er billeder, men læsningen er fejlet {count} gange for dette deck.",
    tooLarge: "{pages} sider er billeder, men decket er over 20 MB.",
    noBudget: "{pages} sider er billeder, men der er ikke nok tilbage af trinnets loft.",
    timeout: "tidsgrænse",
    pdfNotFetched: "PDF'en kunne ikke hentes.",
    subsetFailed:
      "{pages} sider er billeder, men siderne kunne ikke udtrækkes ({reason}), og hele decket ({total} sider) er for stort til trinnets loft.",
    textNotSaved: "Teksten fra billederne kunne ikke gemmes.",
    blockedByDataRules: "Stoppet af datareglerne før afsendelse: {message}",
    pages: {
      mismatch: "Sidenumrene i svaret passede ikke til decket.",
    },
    subset: {
      noPages: "Ingen sider at udtrække.",
      notOpened: "PDF'en kunne ikke åbnes ({reason}).",
      unknownError: "ukendt fejl",
      countDiffers: "PDF-bibliotekerne ser {count} og {expected} sider.",
      missingPages: "De ønskede sider findes ikke i PDF'en.",
      notCopied: "Siderne kunne ikke kopieres ({reason}).",
    },
  },
  /** The founder check (founder-verification.ts). */
  founders: {
    caseNotRead: "casen kunne ikke læses",
    sourceNotCreated: "kilde ikke oprettet",
    checkFailed: "Founder-kontrollen kunne ikke gennemføres denne gang.",
  },
  /** Finding and checking the company's identity (identity-*.ts). */
  identity: {
    noAnchor:
      "Casen har hverken hjemmeside, CVR/registernummer eller domæner i materialet: researchen søgte kun med de faste spørgsmål (ingen ekstra spørgsmål fra planen og ingen opfølgning), og kilderne er markeret som foreslået match, så navnefæller ikke ganges op.",
    materialNotRead: "Casens materiale kunne ikke læses.",
    tooLittleText: "For lidt tekst i deck og website til at udtrække identiteten.",
    tooLarge: "Materialet var for stort til trinnets loft.",
    blockedByDataRules: "Stoppet af datareglerne før afsendelse: {message}",
    discarded: {
      legalName: 'juridisk navn "{value}"',
      name: 'navn "{value}"',
      domain: 'domæne "{value}"',
      cvr: 'CVR "{value}"',
      founder: 'founder "{value}"',
    },
    resolve: {
      nameExactCompany: "Navnet i CVR ({name}) er præcis selskabets navn",
      nameLikeCompany: "Navnet i CVR ({name}) ligner selskabets",
      cvrEntered: "CVR {cvr} er det, I skrev",
      cvrOtherCompany:
        "CVR {cvr} på {host} tilhører {name}, ikke det søgte selskab, og er ikke brugt.",
      theWebsite: "hjemmesiden",
      cvrOnWebsite: "CVR {cvr} står på selskabets hjemmeside",
      nameExactEntered: "Navnet i CVR ({name}) er præcis det, I skrev",
      nameLikeEntered: "Navnet i CVR ({name}) ligner det, I skrev",
      domainMatches: "Domænet {host} passer til navnet {name}",
      inactive: 'CVR-status er "{status}"',
      checkDigit: "CVR {cvr} består ikke kontrolcifferet og er ikke brugt.",
    },
  },
  /** The foreign registries: status, errors and warnings (registries/*). */
  registries: {
    match: {
      inMaterial: "{number} står i casens eget materiale",
      nameExact: "Navnet i {registry} ({name}) er præcis selskabets navn",
      nameLike: "Navnet i {registry} ({name}) ligner selskabets",
      website: "Hjemmesiden i {registry} er selskabets domæne {host}",
      status: "Status i {registry}: {status}",
    },
    common: {
      status: "{registry} svarede med status {status}.",
      tooLarge: "Svaret fra {registry} var større end forventet.",
      notUseful: "{registry} gav ikke et brugbart svar.",
      unreachable: "{registry} kunne ikke nås.",
      noFigures: "Regnskabet til {date} har ingen af de tal, vi genkender, og er udeladt.",
      otherCurrency:
        "Regnskabet til {date} er i {currency}, ikke {latest} som det seneste, og er udeladt.",
      unknownError: "ukendt fejl",
    },
    status: {
      active: "aktiv",
      activeWith: "aktiv (registrets status: {status})",
      ceased: "ophørt",
      ceasedWith: "ophørt ({reason})",
      ceasedOn: "ophørt {date}",
      notActiveCode: "ikke aktiv (registrets statuskode {code})",
      dissolved: "opløst",
      deleted: "slettet fra registret",
      reorganised: "udgået ved reorganisering",
      liquidated: "likvideret",
      inLiquidation: "i likvidation",
      bankruptcy: "konkurs",
      dissolvedOrDeleted: "opløst eller slettet fra registret",
      underBankruptcy: "under konkurs",
      bankrupt: "gået konkurs",
      underLiquidation: "under likvidation",
      liquidationStarted: "likvidation indledt",
      notReregistered: "ikke omregistreret",
      liquidationAfterBankruptcy: "under likvidation efter konkurs",
      notTrading: "ikke verksam",
    },
    estonia: {
      agreementNeeded:
        "e-Äriregistrets regnskabstal kræver en gratis aftale med RIK, som endnu ikke er indgået.",
    },
    gleif: {
      freeOnly: "{missing} D19: kun gratis officielle kilder.",
      missing: {
        de: "Tyske regnskaber findes kun som dokumenter i Unternehmensregister, uden et gratis API.",
        es: "Spanske regnskaber findes kun som betalte dokumenter fra Registro Mercantil, uden et gratis API.",
        it: "Italienske regnskaber (XBRL) findes kun mod betaling hos Registro Imprese (InfoCamere).",
      },
    },
    poland: {
      latestFiled: "Seneste årsregnskab i KRS gælder {period}.",
      latestFiledOn: "Seneste årsregnskab i KRS gælder {period} (indsendt {date}).",
      noApi:
        "Regnskaberne ligger i Repozytorium Dokumentów Finansowych, som ikke har et åbent API.",
    },
    finland: {
      tooManyCalls: "PRH svarede, at der er sendt for mange kald (429).",
      noDigital:
        "PRH har kun regnskaber, som selskabet selv har indsendt digitalt (ca. 5 % af alle, indtil kravet kommer i 2027–2028); dette selskab har ingen.",
      notFetched: "Regnskabet til {date} kunne ikke hentes: {reason}",
      otherCompany: "Regnskabet til {date} tilhører {id} og er udeladt.",
    },
    france: {
      sameFigures:
        "Regnskaberne til {older} og {newer} har præcis de samme tal i INPI's data, så det er uklart, hvilket år de hører til; begge er udeladt.",
      confidential:
        "Selskabet har erklæret resultatopgørelsen for {date} fortrolig; kun årets resultat er offentligt.",
      noFigures:
        "INPI har ingen offentlige regnskabstal for selskabet (fx fordi regnskabet er erklæret fortroligt eller ikke indsendt endnu).",
    },
    lithuania: {
      liabilitiesIncomplete:
        "Regnskabet til {date}: registrets gæld dækker ikke hele passivsiden (tilskud, hensættelser eller periodeafgrænsning mangler), så gæld i alt er udeladt.",
      litas: "Regnskabet til {date} er i litas (før euroen) og er udeladt.",
      conflictingFigures:
        'Regnskabet til {date} har forskellige tal for "{line}" og posten er udeladt.',
    },
    netherlands: {
      yearUnreadable: 'KVK\'s regnskabsår "{year}" kan ikke læses, så regnskabet er udeladt.',
      notCalendarYear:
        "KVK's regnskab for {year} blev fastlagt {date}, så regnskabsåret følger ikke kalenderåret og er udeladt.",
      noFigures: "KVK's regnskab for {year} har ingen af de tal, vi genkender.",
      unbalanced:
        "KVK's balance for {year} går ikke op (aktiver ≠ passiver), så regnskabet er udeladt.",
      rateLimited: "{registry} tillader ét opslag i minuttet og bad os vente.",
      noXbrl: "KVK har intet regnskab indsendt som XBRL for selskabet.",
    },
    sweden: {
      notSetUp: "Bolagsverket er ikke sat op (D21).",
      loginStatus: "Bolagsverkets login svarede med status {status}.",
      noToken: "Bolagsverkets login gav ingen nøgle.",
      companyUnreadable: "Bolagsverkets svar om selskabet kunne ikke læses.",
      documentsUnreadable: "Bolagsverkets dokumentliste kunne ikke læses.",
      notFetched: "Årsredovisningen til {date} kunne ikke hentes og er udeladt.",
      notRead: "Årsredovisningen til {date} kunne ikke læses og er udeladt.",
      noFigures: "Årsredovisningen til {date} indeholder ingen af de tal, vi genkender.",
      noneReadable: "Bolagsverket har {count} årsredovisningar, men ingen kunne læses.",
    },
    lookup: {
      notSetUp:
        "{registry} er ikke sat op endnu, så regnskabet er ikke tilgængeligt. Analysen bruger websøgningens tal.",
      numberNotFound: "{number} i materialet findes ikke i {registry}.",
      numberOtherCompany: "{number} i materialet tilhører {owner}, ikke {name}, og er ikke brugt.",
      ambiguous: '{count} mulige selskaber i {registry} for "{name}"; intet er valgt.',
      failed: "Opslaget i {registry} fejlede ({reason}). Det prøves igen ved næste screening.",
      approvedGone:
        "{numberLabel} {number}, som et menneske har godkendt, findes ikke længere i {registry}.",
      humanDecided:
        "Et menneske har afgjort identiteten, og intet {numberLabel} er gemt, så {registry} er ikke slået op.",
      noNameMatch: 'Intet selskab i {registry} passer til "{name}".',
      notSureEnough:
        "Intet {numberLabel} i materialet, og websøgningen fandt ikke selskabet sikkert nok til et navneopslag i {registry}.",
      noMatchingNumber:
        "Intet {numberLabel} i casens materiale passer til selskabet, og {registry} kan ikke søge på navn. Analysen bruger websøgningens tal.",
      noNumber:
        "Intet {numberLabel} i casens materiale, og {registry} kan ikke søge på navn. Analysen bruger websøgningens tal.",
      numberChanged:
        "Registernummeret er skiftet fra {from} til {to}; de gamle regnskaber er fjernet.",
      oldNotRemoved: "De gamle regnskaber kunne ikke fjernes efter skift af registernummer.",
      notSaved: "Registernummeret og identitetsvurderingen kunne ikke gemmes.",
      fetched: "{label} og regnskaber for {count} år hentet.",
      foundNoStatements: "{label} fundet. {detail}",
      foundNotFetched:
        "{label} fundet, men regnskaberne kunne ikke hentes ({reason}). Det prøves igen ved næste screening.",
    },
  },
  /** The public research and the CVR step (public-research.ts). */
  research: {
    noMatch: 'Intet CVR-match for "{name}".',
    customQuestionsNotLoaded:
      "Jeres tilpassede research-spørgsmål kunne ikke hentes. Prøv igen om lidt.",
    deckNotReadForCvr: "Deckets tekst kunne ikke læses for CVR-numre.",
    websiteNotReadForCvr: "Websitets tekst kunne ikke læses for CVR-numre.",
    reused: "Genbrugt fra casens seneste screening.",
    unknownError: "Ukendt researchfejl",
    tracksSucceeded: "Kun {done} af {total} researchspor lykkedes.",
    claimsDropped: "{count} påstand(e) blev udeladt, fordi kilden ikke var hentet.",
    rejectedNoSource: "Afvist: ingen påstand havde en hentet kilde",
    notValidated: "Svaret kunne ikke valideres",
    tracksValidated: "Kun {done} af {total} researchspor gav valideret evidens.",
    legalIdentityManual: "Juridisk identitet kræver manuel bekræftelse: {detail}",
    existingSourcesNotRead: "Eksisterende offentlige kilder kunne ikke læses.",
    sourceNotSaved: "En offentlig researchkilde kunne ikke gemmes.",
    evidenceNotChecked: "Eksisterende evidens kunne ikke kontrolleres.",
    evidenceNotSaved: "Den offentlige research kunne ikke gemmes som evidens.",
    noGatewayAccess:
      "AI-tjenesten kunne ikke bruges lige nu. Prøv igen om lidt, eller skriv til Interlect.",
    noAnswer: "Den offentlige AI-research returnerede ikke et svar.",
    moduleNoResults: "Researchmodulet {module} returnerede påstande uden søgeresultater.",
    moduleNoExactUrl:
      "Researchmodulet {module} returnerede påstande uden en eksakt, hentet kilde-URL.",
    moduleClaimsDropped:
      "Researchmodulet {module}: {count} påstand(e) blev udeladt, fordi kilden ikke var hentet (emnet er usikkert, ikke fraværende): {claims}",
    caseNotRead: "Casen kunne ikke læses, så CVR-opslaget blev sprunget over.",
    noCompany: "Casen har intet selskab tilknyttet endnu.",
    markedWrong: "Et menneske har markeret selskabet som forkert, så der hentes ikke registerdata.",
    domainMatches: "Domænet {host} passer til navnet",
    researchConfident: "Websøgningen fandt selskabet i flere kilder",
    markedNotDanish:
      "Et menneske har markeret selskabet som ikke dansk, så der hentes ikke CVR-data.",
    cvrInMaterialOther: "CVR {cvr} i materialet tilhører {owner}, ikke {name}, og er ikke brugt.",
    cvrOnHostOther: "CVR {cvr} på {host} tilhører {owner}, ikke {name}, og er ikke brugt.",
    noName: "Intet selskabsnavn at slå op i CVR.",
    ambiguous: '{count} mulige CVR-match for "{name}". Vælg det rigtige under Regnskaber.',
    lookupFailed: "CVR-opslaget fejlede ({reason}). Det kan prøves igen under Regnskaber.",
    cvrInMaterial: "CVR {cvr} står i casens eget materiale",
    cvrOnDomain: "CVR {cvr} står på selskabets domæne {host}",
    cvrInPublicOne: "CVR {cvr} står i {count} offentlige kilde",
    cvrInPublicMany: "CVR {cvr} står i {count} offentlige kilder",
    cvrInactive: 'CVR-status er "{status}"',
    cvrChanged: "CVR er skiftet fra {from} til {to}; de gamle regnskaber er fjernet.",
    oldNotRemoved: "De gamle regnskaber kunne ikke fjernes efter CVR-skift.",
    identityNotSaved: "Identitetsvurderingen kunne ikke gemmes.",
    noCvr: "Intet CVR-nummer, der passer til selskabet, blev fundet.",
    existingNotChecked: "Kunne ikke tjekke eksisterende regnskaber.",
    upToDate: "Regnskaberne er opdaterede ({count} regnskabsår).",
    keptOlder:
      "Regnskaberne fra {count} år er bevaret; et nyere regnskab kunne ikke læses ({reason}).",
    fetched: "CVR {cvr} og offentlige regnskaber hentet.",
    foundNotFetched:
      "CVR {cvr} fundet, men regnskaberne kunne ikke hentes ({reason}). Det kan prøves igen under Regnskaber.",
    unsupportedFormat: "Den officielle kilde returnerede et ikke-understottet filformat.",
    noReadableText: "Den officielle kilde indeholdt ikke læsbar tekst.",
  },
} as const;
