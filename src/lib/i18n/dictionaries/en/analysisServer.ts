/** English texts the analysis sends; same keys as `da/analysisServer.ts`. */
export const analysisServer = {
  /** A step stopped by its cost cap: no amount, no internal name. */
  budget: {
    stepStopped: "The step stopped at its limit.",
  },
  common: {
    caseNotFound: "The case was not found.",
    profileNotLoaded: "The active setup could not be loaded.",
    noMandate: "The setup has no mandate.",
    noSpecialists: "Your setup has no active specialists. Turn at least one on.",
    jobNotRegistered: "The analysis job could not be registered.",
    jobNotRegisteredSafely: "The analysis job could not be registered safely.",
    deepOverBudget: "The deep analysis's model call exceeds the configured cost cap.",
    basisNotReloaded: "The analysis basis could not be reloaded after public research.",
    specialistFailed: "A specialist analysis failed.",
    otherCase: "The AI result belongs to another case.",
    noAssessment: "No assessment.",
    deepScoresNotSaved: "The deep analysis's criterion scores could not be saved.",
    deepRisksNotSaved: "The deep analysis's risks could not be saved.",
    financeNotSaved: "The financial calculations could not be saved.",
    deepRecommendationNotSaved: "The deep analysis's recommendation could not be saved.",
    gatewayMissing:
      "The AI service could not be used just now. Try again shortly, or write to Interlect.",
    gatewayInvalid: "The AI service did not return a usable answer. Try again shortly.",
    stoppedByDataRules: "Stopped by the data rules.",
    screeningResearchNotSaved: "The screening's research could not be saved.",
    noBasis: "The screening did not find a sufficiently documented analysis basis.",
    caseDecidedScreen: "The case has been decided. Reopen it before screening it again.",
  },
  deep: {
    riskNumber: "Risk {n}",
    runDataNotLoaded: "The deep analysis's run data could not be loaded.",
    notCompleted: "The deep analysis could not be marked as finished.",
    released: "The run stalled on the way and has been released for a new deep analysis.",
    lockedProfileMissing: "The deep analysis's locked setup is missing.",
    caseNotReloaded: "The deep analysis's case could not be reloaded.",
    screeningNotReloaded: "The locked screening could not be reloaded.",
    stepsNotLoaded: "The deep analysis's steps could not be loaded.",
    researchNotSaved: "The deep analysis's research could not be saved.",
    endedBeforeSynthesis: "The deep analysis ended before the synthesis could start.",
    storedResearchInvalid: "The stored public research is invalid.",
    needsScreening: "The case needs a completed screening before it can be sent to deep analysis.",
    earlierNotChecked: "Earlier deep analyses could not be checked.",
    alreadySent: "This screening has already been sent to deep analysis.",
    caseDecided: "The case has been decided. Reopen it before starting a deep analysis.",
    notStarted: "The thorough analysis could not be started.",
    stepsNotRegistered: "The analysis steps could not be registered.",
    notMoved: "The case could not be moved to Deep analysis.",
    notQueued: "The analysis job could not be sent to the background queue.",
    gatewayUnreachable: "The AI service could not be reached. Try again shortly.",
    financeOnly: "Only the finance specialist may extract financial inputs.",
    synthesisChangedFinance:
      "The IC synthesis added or changed a financial input from the specialist analysis.",
    unknownEvidence: "The deep analysis refers to evidence that was not part of the run.",
    scoreWithoutEvidence: "The deep analysis contains a score without evidence.",
    claimWithoutEvidence: "The deep analysis contains a factual claim without evidence.",
    contraryShort: "The counter-reading is very short.",
    noOpenQuestions: "The analysis contains no open questions.",
    financeNoPeriod: "At least one financial input lacks a period and should be read with caution.",
    queuedManually: "Deep analysis queued manually after screening.",
    researchReused: "Research reused from an earlier run; the CVR was checked then.",
    stepNotLocked: "The analysis step {step} could not be locked.",
    stepFailed: "The analysis step {step} failed. Start the deep analysis again.",
    stepRetried:
      "The analysis step {step} has been tried {count} times without finishing. The run is stopped so it is not paid for again.",
    specialistUnfinished: "The specialist analysis {name} is not finished.",
    contrary: "Strongest counter-reading: {text}",
    approvedSummary: "Partner-approved thorough analysis as {name}, profile version {version}.",
    timeout: "{label} took longer than the {seconds} seconds allowed.",
    cutOff: "{label} was cut off before the structured answer was finished.",
    specialistOtherTask: "The specialist result from {name} belongs to another task or case.",
    specialistCoverage:
      "The specialist result from {name} has incomplete or wrong analysis coverage.",
    specialistUnknownEvidence:
      "The specialist result from {name} refers to evidence outside the case's analysis basis.",
    specialistScoreNoEvidence:
      "The specialist result from {name} contains a score without evidence.",
    specialistClaimNoEvidence:
      "The specialist result from {name} contains a factual claim without evidence.",
    missingAreas: "Missing analysis areas (marked as unknown): {areas}.",
    riskShort:
      "{name} has too short a rationale ({count} sentences). The risk assessment must be thorough and company-specific.",
    riskBelowTarget:
      "{name} has a shorter rationale than the target ({count} sentences, the target is at least {target}).",
    riskNoBoth: "{name} does not explicitly justify both likelihood and impact.",
    riskNoPlan: "{name} lacks a sufficiently concrete plan for clarification or risk reduction.",
  },
  evidence: {
    notLoaded: "The evidence sheet could not be loaded.",
    notSaved: "The evidence sheet could not be saved.",
    none: "No evidence sheet ({reason}); the specialists get the full research.",
  },
  method: {
    profileNotFound: "The active setup was not found.",
    noMembership: "You do not have an active membership in the selected team.",
    adminOnly: "Only an Admin can see the prompt texts.",
  },
  rescore: {
    failed: "The score could not be recalculated.",
    screeningNotRead: "The latest screening could not be read, so the score was not recalculated.",
    notSaved: "The new score could not be saved.",
    answersNotLoaded: "The team's answers could not be loaded.",
    verdictNotLoaded: "The requirement's current assessment could not be loaded.",
  },
  plan: {
    notInTime: "The plan was not finished in time.",
    noCriteriaOrGates: "The setup has neither criteria nor gates.",
    tooLong: "Your setup and the case's material were too long for the plan.",
    failed: "The plan could not be made: {reason}",
  },
  runPlan: {
    fundNotFound: "The team was not found.",
    runNotFound: "The run was not found.",
  },
  screening: {
    evidenceNotLoaded: "The screening's evidence could not be loaded.",
    stoppedTwice:
      "The screening's analysis stopped twice along the way and will not be started again.",
    profileNotLoaded: "The setup the screening started with could not be loaded.",
    researchNotFound: "The screening's research was not found.",
    scoresNotSaved: "The screening's criterion scores could not be saved.",
    risksNotSaved: "The screening's risks could not be saved.",
    explanationsNotSaved: "The screening's explanations could not be saved.",
    recommendationNotSaved: "The screening's recommendation could not be saved.",
    resultNotSaved: "The screening's result could not be saved.",
    earlierNotChecked: "Earlier screenings could not be checked.",
    released: "The run was interrupted and has been released for a new screening.",
    evidenceNotFetched: "The evidence could not be loaded.",
    notStarted: "The screening could not be started.",
    notMarked: "The screening could not be marked as started.",
    basisNotSaved: "The screening's analysis basis could not be saved.",
    vercelGatewayMissing:
      "The AI service could not be used just now. Try again shortly, or write to Interlect.",
    timeout: "The screening's assessment took longer than the {seconds} seconds allowed.",
    cutOff: "The screening answer was cut off before the structured analysis was finished.",
    noTotal: "The total score could not be calculated on the available basis.",
    unknownEvidence: "The AI result refers to evidence that was not part of the run.",
    scoreWithoutEvidence: "The AI result contains a score without evidence.",
    criteriaCoverage: "The AI result did not cover each screening criterion exactly once.",
    gatesCoverage: "The AI result did not cover each mandate gate exactly once.",
    notRun: "The screening's analysis phase was not run ({result}).",
    summary: "Screening as {name} with profile version {version}.",
    scoreLine:
      "The thesis-fit score is {score} out of 100, {relation} the threshold of {threshold}.",
    pointsAbove: "{points} points above",
    pointsBelow: "{points} points below",
    carriedBy:
      "The score rests mainly on {strong} ({strongScore}), while {weak} ({weakScore}) is the clearest limitation.",
    priorCount:
      "{count} of {total} criteria use a cautious stage-adjusted base value, because the evidence could not yet support a score of its own.",
  },
  search: {
    noThesis: "The setup has neither an investment thesis nor criteria.",
  },
  specialists: {
    notLoaded: "Your specialists could not be loaded. Try again shortly.",
    overridesNotLoaded: "Your customised specialist instructions could not be loaded.",
  },
  followup: {
    failed: "The reflection could not be made: {reason}",
  },
  /** The key figures from the annual reports: name, formula and note per year (financial-metrics.ts). */
  metrics: {
    defs: {
      revenue: {
        label: "Net revenue",
        formula: "Net revenue as reported",
      },
      gross_profit: {
        label: "Gross profit",
        formula:
          "Gross profit as reported (Danish Financial Statements Act § 32: may include other external expenses)",
      },
      ebit: {
        label: "EBIT (operating result)",
        formula: "Operating result as reported",
      },
      ebitda: {
        label: "EBITDA",
        formula: "Operating result + depreciation and impairment",
      },
      net_result: {
        label: "Net result for the year",
        formula: "Net result for the year as reported",
      },
      gross_margin: {
        label: "Gross margin",
        formula: "Gross profit / net revenue × 100",
      },
      ebitda_margin: {
        label: "EBITDA margin",
        formula: "EBITDA / net revenue × 100 (or / gross profit when revenue is missing)",
      },
      ebit_margin: {
        label: "EBIT margin",
        formula: "Operating result / net revenue × 100",
      },
      personnel_share: {
        label: "Staff costs as share of gross profit",
        formula: "Staff costs / gross profit × 100",
      },
      interest_coverage: {
        label: "Interest coverage",
        formula: "Operating result / financial expenses",
      },
      revenue_growth: {
        label: "Revenue growth",
        formula: "(Revenue this year / revenue the year before − 1) × 100",
      },
      gross_profit_growth: {
        label: "Gross profit growth",
        formula: "(Gross profit this year / the year before − 1) × 100",
      },
      gross_profit_cagr_3y: {
        label: "Annual gross profit growth over 3 years (CAGR)",
        formula: "(Gross profit this year / 3 years ago)^(1/number of years) − 1, × 100",
      },
      equity: {
        label: "Equity",
        formula: "Equity as reported",
      },
      equity_ratio: {
        label: "Equity ratio",
        formula: "Equity / total assets × 100",
      },
      debt_to_equity: {
        label: "Debt to equity",
        formula: "Total liabilities / equity",
      },
      return_on_equity: {
        label: "Return on equity (ROE)",
        formula: "Net result for the year / average equity × 100",
      },
      capital_loss: {
        label: "Capital loss (equity below half of the share capital)",
        formula:
          "Equity / contributed capital; below 0.5 is a capital loss (Danish Companies Act § 119)",
      },
      balance_check: {
        label: "Balance check",
        formula: "Total assets − total equity and liabilities (should be 0)",
      },
      cash: {
        label: "Cash and cash equivalents",
        formula: "Cash and cash equivalents as reported",
      },
      current_ratio: {
        label: "Current ratio",
        formula: "Current assets / short-term liabilities",
      },
      cash_flow_operating: {
        label: "Cash flow from operations",
        formula: "Cash flow from operating activities as reported (classes C and D only)",
      },
      cash_conversion: {
        label: "Cash conversion",
        formula: "Cash flow from operations / EBITDA × 100",
      },
      operating_burn: {
        label: "Operating burn per month",
        formula:
          "−(net result for the year + depreciation and impairment) / months in the financial year, only when the figure is positive",
      },
      runway_at_balance_date: {
        label: "Runway at the balance sheet date",
        formula: "Cash and cash equivalents / operating burn per month",
      },
      runway_today: {
        label: "Runway today",
        formula: "Runway at the balance sheet date − months since the balance sheet date",
      },
      capital_injection: {
        label: "Derived capital injection",
        formula:
          "Equity this year − equity the year before − net result for the year (+ proposed dividend)",
      },
      retained_earnings: {
        label: "Retained earnings (accumulated)",
        formula: "Retained earnings as reported; negative means an accumulated deficit",
      },
      nibd_to_ebitda: {
        label: "Net interest-bearing debt / EBITDA",
        formula: "(Interest-bearing debt − cash) / EBITDA",
      },
      employees: {
        label: "Average number of employees",
        formula: "Average number of employees as reported",
      },
      gross_profit_per_employee: {
        label: "Gross profit per employee",
        formula: "Gross profit / average number of employees",
      },
      result_per_employee: {
        label: "Result per employee",
        formula: "Net result for the year / average number of employees",
      },
      dso: {
        label: "Days sales outstanding (DSO)",
        formula: "Trade receivables / net revenue × days in the financial year",
      },
      filing_count: {
        label: "Number of financial years",
        formula: "Number of financial years loaded for the company number",
      },
      latest_filing_age: {
        label: "Age of the latest annual report",
        formula: "Months from the latest balance sheet date to today",
      },
    },
    notes: {
      inputMissing: "A required figure is missing from the annual report.",
      notReported: "{names} is not reported for the year.",
      and: " and ",
      denominatorZero: "{label} is 0, so the ratio cannot be calculated.",
      denominatorNegative: "{label} is negative, so the ratio is not meaningful.",
      needsPriorYear: "Requires the annual report for the year before.",
      missingOneYear: "{label} is missing for one of the two years.",
      notFullYear:
        "One of the financial years is not 12 months (e.g. a changed financial year), so growth is not compared.",
      priorNotPositive:
        "{label} was 0 or negative the year before, so growth in % is not meaningful.",
      depreciationMissing: "Depreciation and impairment are missing and counted as 0.",
      runwayCapped: "Over 10 years: in practice the company can finance its own operations.",
      revenueHidden:
        "Net revenue is not reported (class B may omit it), so gross margin cannot be calculated.",
      noPositiveBase: "Neither a positive revenue nor a positive gross profit is reported.",
      measuredAgainstGrossProfit: "Measured against gross profit, because revenue is not reported.",
      noFinanceExpenses: "No financial expenses, so interest coverage is not relevant.",
      needsFourYears: "Requires four consecutive financial years.",
      cagrNotFullYear: "The first or last year is not 12 months, so CAGR is not compared.",
      cagrMissing: "Gross profit is missing for the first or last year.",
      cagrNotPositive: "CAGR requires a positive gross profit in both years.",
      roeNeeds:
        "Requires the net result for the year and equity for this year and the year before.",
      averageEquityNotPositive: "Average equity is 0 or negative.",
      balanceDiffers:
        "The balance sheet does not add up; the figures should be checked in the annual report.",
      noOperatingCashFlow: "Cash flow from operations is not reported (typically class B).",
      ebitdaNotPositive: "EBITDA is 0 or negative.",
      noBurn:
        "The company is not burning cash on operations (result before depreciation is positive).",
      burnEstimate: "Estimate from the income statement, not cash flows.",
      runwayEstimate: "Estimate: burn derived from the income statement.",
      runwayNotRelevant: "The company is not burning cash, so runway is not relevant.",
      latestOnly: "Calculated for the latest annual report only.",
      runwayRunOut:
        "Estimate: at the same burn the money would have run out {ago} months ago, unless capital has been raised since the balance sheet date {elapsed} months ago.",
      runwayToday:
        "Estimate: {elapsed} months have passed since the balance sheet date without newer figures. Capital raised since then is not included.",
      injectionNeeds: "Requires equity for two years and the net result for the year.",
      injectionPositive:
        "Estimate: the change in equity that the net result for the year does not explain, typically new contributions from the owners.",
      injectionNegative:
        "Estimate: equity fell more than the net result for the year explains, typically dividends, a capital reduction or a buyback of own shares.",
      debtNotSplit:
        "The annual report does not split liabilities into interest-bearing and non-interest-bearing debt, so net debt cannot be calculated reliably.",
    },
  },
  /** Fetching and storing annual reports, and the panel's simple ratios (financial-statements.ts). */
  statements: {
    indexStatus:
      "The Danish Business Authority's annual report index answered with status {status}.",
    fileStatus: "The annual report file could not be fetched (status {status}).",
    fileTooLarge: "The annual report file is larger than expected and was not read.",
    ratios: {
      equityRatio: "Equity ratio (equity/assets)",
      solvencyRatio: "Debt to equity (liabilities/equity)",
      negativeEquity: "Negative equity -- the ratio is not meaningful.",
      equityGrowth: "Change in equity from the previous year",
      onePeriod: "Only one period loaded -- no comparison possible.",
      resultPerEmployee: "Result per employee",
      noEmployees: "The number of employees is not reported in this annual report.",
      grossMargin: "Gross margin",
      grossMarginCombined:
        "The company combines revenue and cost of sales into gross profit (§32) -- gross margin cannot be derived from the annual report alone.",
      noGrossProfit: "Gross profit is not reported in this annual report.",
    },
    noneForCvr: "No published annual reports were found for this CVR number.",
    latestNotFetched:
      "The latest annual report could not be fetched ({reason}). Please try again later.",
    latestNoFigures: "The latest annual report contains none of the figures we recognise.",
    noRecognisedFigures: "no recognised figures",
    periodSkipped:
      "The annual report for the period ending {periodEnd} could not be read and is left out.",
    sourceNotLookedUp: "The annual report source could not be looked up.",
    sourceNotRegistered: "The annual report source could not be registered.",
    storedNotRead: "The stored annual reports could not be read.",
    duplicatesNotRemoved: "Duplicate financial years could not be cleaned up.",
    statementNotSaved: "The annual report could not be saved.",
    linesNotReplaced: "The old annual report lines could not be replaced.",
    linesNotSaved: "The annual report lines could not be saved.",
    evidenceNotSaved:
      "The annual report is saved, but the figures could not be saved as evidence. The analysis therefore cannot cite them.",
    dataPointsNotSaved:
      "The annual report is saved, but revenue and cash could not be saved as figures on the case.",
    noYearsSaved: "No financial years could be saved.",
    foreignNotAvailable:
      "Annual report not available in {registry} for {numberLabel} {number}. {warnings}The analysis uses the figures from the web search.",
    oldNotRemoved: "The old annual reports could not be removed ({reason}).",
    oldSourcesNotMarked: "The old annual report sources could not be marked ({reason}).",
  },
  /** The rationale of the finance gates calculated in code (financial-gates.ts). */
  gates: {
    registrySource: "the registry's annual report",
    cvrSource: "CVR annual report",
    loadError: "The financial data could not be read (technical error). Run the analysis again.",
    noReports:
      "No public annual reports for the company yet, so the requirement cannot be assessed. It is unknown, not a breach.",
    registryMatchUnsure:
      "The match in the registry is not certain enough for the annual report to decide the requirement. Unknown until the identity is certain.",
    cvrMatchUnsure:
      "The CVR match is not certain enough for the annual report to decide the requirement. Unknown until the identity is certain.",
    equityNotReported: "Equity is not reported in the latest annual report.",
    equityPositive: "Equity was {amount} at {date} ({source}).",
    equityNegative:
      "Equity was {amount} at {date} ({source}). Negative equity is a breach of the requirement.",
    noBurn:
      "The company is not burning cash on operations in the latest annual report (result before depreciation is positive). Estimate.",
    runwayUnknown: "Runway cannot be calculated from the annual report.",
    overTenYears: "over 10 years",
    aboutMonths: "about {months} months",
    runwayToday:
      "Runway today is {runway} (estimate from the latest annual report; capital raised since the balance sheet date is not included).",
    filings: "{count} approved financial years are loaded (requirement: {required}).",
    ageUnknown: "The age of the annual report cannot be calculated.",
    age: "The latest annual report has a balance sheet date {months} months ago (requirement: at most 18).",
    goingConcernRegistryUnknown:
      "The registry does not state whether the annual report has a note on uncertainty about continued operations (going concern). Unknown, not a breach.",
    goingConcernNotRead:
      'It is not known whether the latest annual report has a going concern note (the report was fetched before the note was read). It is fetched again at the next screening or with "Fetch latest again" under "Fetch or change annual report". Unknown, not a breach.',
    goingConcernNote:
      "The latest annual report has a note on material uncertainty about continued operations (going concern). Requires a human assessment.",
    goingConcernNone:
      "The latest annual report has no note on uncertainty about continued operations (CVR annual report).",
    debtNotSplit:
      "The annual report does not split liabilities into interest-bearing and non-interest-bearing debt, so net debt cannot be calculated reliably. Unknown, not a breach.",
  },
  /** Units and warnings of the deck-based finance calculations (finance.ts). */
  finance: {
    unknownCurrency: "unknown currency",
    unknownScale: "unknown scale {currency}",
    mixedCurrencies:
      "The amounts are given in different currencies or units ({bases}). Interlect does not convert, so the amount calculations are not made.",
    perMonth: "/month",
    perYear: "/year",
    months: "months",
    perCustomer: "/customer",
    perCustomerMonth: "/customer/month",
    noPositiveBurn: "The company has no positive net burn in the given period.",
    runwayNotMeaningful: "Runway is not meaningful at zero or negative net burn.",
    registryEstimate:
      "Based on the register's annual report: operating costs are an estimate from revenue, the year's result and depreciation, not a figure stated in the report.",
    registryStated: "Based on figures from the register's annual report.",
    selfReported:
      "Based on figures the company reported itself (pitch deck or website) or that a web search found, not on the register.",
    growthNeedsTwoYears:
      "Growth needs two full financial years of revenue, about a year apart, with positive revenue in the first.",
  },
  // Why a finance specialist input was removed.
  financeCheck: {
    registry_unit:
      "A financial input ({metric}, {period}) was removed: its unit ({unit}) does not state a clear currency and scale, so it could not be compared with the register's annual report.",
    registryUnreadable:
      "The register's annual reports could not be read, so the financial inputs were only checked against the evidence.",
    evidence_missing:
      "A financial input ({metric}, {period}) was removed: the cited evidence could not be read, so the figure could not be checked.",
    not_in_evidence:
      "A financial input ({metric}: {value} {unit}, {period}) was removed: the figure is not in the evidence it cites.",
    registry_mismatch:
      "A financial input ({metric}: {value} {unit}, {period}) was removed: it differs by more than 5% from the register's annual report ({registry}).",
  },
  /** The code score for financial strength (financial-score.ts). */
  financeScore: {
    labels: {
      growth: "Growth",
      ebitda_margin: "EBITDA margin",
      equity_ratio: "Equity ratio",
      runway: "Runway",
      current_ratio: "Current ratio",
    },
    fromCvr: "{components} (CVR annual report) gives {score}.",
    fromRegistry: "{components} (registry's annual report) gives {score}.",
    adjusted: "{base} {rationale}",
  },
  /** The screening score's refusals (scoring.ts). */
  scoring: {
    wrongProfile: "The AI result does not belong to the active setup and version.",
    weightsSum: "Active criterion weights must add up to 100, but add up to {total}.",
  },
  /** Problems and warnings for the fund's specialist set (specialist-set.ts). */
  specialistSet: {
    manyAreas:
      "{title} assesses {count} of the nine areas alone. Spread them over more specialists, so the answer does not get too long for one call.",
    tooManyCustom: "At most {max} own specialists can be active (the setup has {count}).",
    noneActive: "At least one specialist must be active in the deep analysis.",
  },
  /** One line per AI level (ai-settings.functions.ts). */
  tiers: {
    light: "Fast and low-cost. Suited to a large deal flow and first sorting.",
    medium: "Thorough and balanced. The default, and the level Interlect has been tested on most.",
    heavy: "The most thorough. Most nuanced on difficult cases, but uses the most credits.",
  },
  /** Length checks of the deep analysis's texts (deep-text-rules.ts). */
  deepText: {
    criterionTooShort:
      "The reasoning for the criterion {criterion} is too short ({length} characters).",
    criterionShort:
      "The reasoning for the criterion {criterion} is shorter than required ({length} characters).",
    overallTooShort: "The overall assessment is too short ({length} characters).",
    overallShort: "The overall assessment is shorter than required ({length} characters).",
  },
  /** The findings code adds when the model skipped an area (finding-categories.ts). */
  findings: {
    categories: {
      fund_thesis_fit: "the investment thesis and mandate",
      founder_market_fit: "founder-market fit",
      team_market_fit: "the team's fit with the market",
      product_market_fit: "product-market fit",
      product_technology: "product technology",
      market_timing: "market timing",
      traction_gtm: "traction and go-to-market",
      financial_strength: "financial strength",
      evidence_quality: "evidence quality",
    },
    unknown:
      "No data found for {label}. The analysis could not assess the area from the available material; it is unknown, not a negative result. The area needs to be clarified with further documentation.",
    copied:
      "The synthesis delivered no finding for {categories}. The specialists' own findings are included.",
    added:
      'There was no finding for {categories}. The area is marked as unknown ("No data found"), not as a breach.',
  },
  /** The team's answer to a gate (gate-answers.ts). */
  gateAnswers: {
    teamAnswer: "The team's answer: {answer}",
    met: "Met",
    notMet: "Not met",
  },
  /** The CVR lookup at Datafordeleren (cvr-lookup.ts). */
  cvr: {
    status: "Datafordeleren answered with status {status}.",
    rejected: "Datafordeleren rejected the lookup.",
    nameLookupNotConfigured: "CVR name lookup is not configured.",
    lookupNotConfigured: "CVR lookup is not configured.",
  },
  /** Fetching the CVR master data (cvr-profile.ts). */
  cvrProfile: {
    parts: {
      branche: "industry",
      virksomhedsform: "legal form",
      adresse: "address",
    },
    and: " and ",
    unknown: "unknown",
    sourceNotLookedUp: "the source could not be looked up ({reason})",
    sourceNotReconfirmed: "the source could not be confirmed again ({reason})",
    refreshFailed: "The CVR master data could not be updated this time; the stored data is used.",
    sourceNotSaved: "the source could not be saved ({reason})",
    evidenceNotSaved: "the master data could not be saved as evidence ({reason})",
    fetchedWithout: "The CVR master data was fetched without {parts}.",
    notFetched:
      "The CVR master data (industry, legal form, start date) could not be fetched this time.",
    notUpdated:
      "The CVR master data was not updated ({parts} could not be fetched); the stored data is used.",
    existingNotRead: "the existing master data could not be read ({reason})",
    newNotSaved: "the new master data could not be saved ({reason})",
    updated: "The CVR master data is updated (something has changed since last time).",
  },
  /** Reading the deck's image pages (deck-ocr*.ts, deck-pdf-subset.ts). */
  deck: {
    imagePagesMarker: "pages are images",
    imagePagesNotRead: "The deck's image pages were not read: {reason}",
    unknownReason: "unknown reason",
    deckUnreadable: "The pitch deck could not be read.",
    noDeck: "The case has no pitch deck.",
    pdfOnly: "Only PDF decks with a known page count can be read as images.",
    textUnreadable: "The deck's text could not be read.",
    allPagesHaveText: "All pages have text.",
    readEarlier: "The image pages were read in an earlier screening.",
    failedRepeatedly:
      "{pages} pages are images, but reading them has failed {count} times for this deck.",
    tooLarge: "{pages} pages are images, but the deck is over 20 MB.",
    noBudget: "{pages} pages are images, but there is not enough left of the step's cap.",
    timeout: "time limit",
    pdfNotFetched: "The PDF could not be fetched.",
    subsetFailed:
      "{pages} pages are images, but the pages could not be extracted ({reason}), and the whole deck ({total} pages) is too large for the step's cap.",
    textNotSaved: "The text from the images could not be saved.",
    blockedByDataRules: "Stopped by the data rules before sending: {message}",
    pages: {
      mismatch: "The page numbers in the answer did not match the deck.",
    },
    subset: {
      noPages: "No pages to extract.",
      notOpened: "The PDF could not be opened ({reason}).",
      unknownError: "unknown error",
      countDiffers: "The PDF libraries see {count} and {expected} pages.",
      missingPages: "The requested pages are not in the PDF.",
      notCopied: "The pages could not be copied ({reason}).",
    },
  },
  /** The founder check (founder-verification.ts). */
  founders: {
    caseNotRead: "the case could not be read",
    sourceNotCreated: "source not created",
    checkFailed: "The founder check could not be completed this time.",
  },
  /** Finding and checking the company's identity (identity-*.ts). */
  identity: {
    noAnchor:
      "The case has no website, CVR/registry number or domains in the material: the research searched with the fixed questions only (no extra questions from the plan and no follow-up), and the sources are marked as a suggested match, so namesakes are not multiplied.",
    materialNotRead: "The case's material could not be read.",
    tooLittleText: "Too little text in the deck and website to extract the identity.",
    tooLarge: "The material was too large for the step's cap.",
    blockedByDataRules: "Stopped by the data rules before sending: {message}",
    discarded: {
      legalName: 'legal name "{value}"',
      name: 'name "{value}"',
      domain: 'domain "{value}"',
      cvr: 'CVR "{value}"',
      founder: 'founder "{value}"',
    },
    resolve: {
      nameExactCompany: "The name in CVR ({name}) is exactly the company's name",
      nameLikeCompany: "The name in CVR ({name}) resembles the company's",
      cvrEntered: "CVR {cvr} is the one you entered",
      cvrOtherCompany:
        "CVR {cvr} on {host} belongs to {name}, not the company searched for, and is not used.",
      theWebsite: "the website",
      cvrOnWebsite: "CVR {cvr} is on the company's website",
      nameExactEntered: "The name in CVR ({name}) is exactly what you entered",
      nameLikeEntered: "The name in CVR ({name}) resembles what you entered",
      domainMatches: "The domain {host} matches the name {name}",
      inactive: 'CVR status is "{status}"',
      checkDigit: "CVR {cvr} fails the check digit and is not used.",
    },
  },
  /** The foreign registries: status, errors and warnings (registries/*). */
  registries: {
    match: {
      inMaterial: "{number} is in the case's own material",
      nameExact: "The name in {registry} ({name}) is exactly the company's name",
      nameLike: "The name in {registry} ({name}) resembles the company's",
      website: "The website in {registry} is the company's domain {host}",
      status: "Status in {registry}: {status}",
    },
    common: {
      status: "{registry} answered with status {status}.",
      tooLarge: "The answer from {registry} was larger than expected.",
      notUseful: "{registry} did not give a usable answer.",
      unreachable: "{registry} could not be reached.",
      noFigures:
        "The annual report for {date} has none of the figures we recognise and is left out.",
      otherCurrency:
        "The annual report for {date} is in {currency}, not {latest} like the latest, and is left out.",
      unknownError: "unknown error",
    },
    status: {
      active: "active",
      activeWith: "active (the registry's status: {status})",
      ceased: "ceased",
      ceasedWith: "ceased ({reason})",
      ceasedOn: "ceased {date}",
      notActiveCode: "not active (the registry's status code {code})",
      dissolved: "dissolved",
      deleted: "deleted from the registry",
      reorganised: "removed in a reorganisation",
      liquidated: "liquidated",
      inLiquidation: "in liquidation",
      bankruptcy: "bankruptcy",
      dissolvedOrDeleted: "dissolved or deleted from the registry",
      underBankruptcy: "in bankruptcy proceedings",
      bankrupt: "bankrupt",
      underLiquidation: "in liquidation",
      liquidationStarted: "liquidation started",
      notReregistered: "not re-registered",
      liquidationAfterBankruptcy: "in liquidation after bankruptcy",
      notTrading: "not trading",
    },
    estonia: {
      agreementNeeded:
        "e-Äriregister's financial figures require a free agreement with RIK, which has not been made yet.",
    },
    gleif: {
      freeOnly: "{missing} D19: free official sources only.",
      missing: {
        de: "German annual reports exist only as documents in the Unternehmensregister, without a free API.",
        es: "Spanish annual reports exist only as paid documents from the Registro Mercantil, without a free API.",
        it: "Italian annual reports (XBRL) are only available for a fee from the Registro Imprese (InfoCamere).",
      },
    },
    poland: {
      latestFiled: "The latest annual report in KRS covers {period}.",
      latestFiledOn: "The latest annual report in KRS covers {period} (filed {date}).",
      noApi:
        "The annual reports are in the Repozytorium Dokumentów Finansowych, which has no open API.",
    },
    finland: {
      tooManyCalls: "PRH answered that too many calls have been sent (429).",
      noDigital:
        "PRH only has annual reports the company itself filed digitally (about 5 % of all, until the requirement arrives in 2027–2028); this company has none.",
      notFetched: "The annual report for {date} could not be fetched: {reason}",
      otherCompany: "The annual report for {date} belongs to {id} and is left out.",
    },
    france: {
      sameFigures:
        "The annual reports for {older} and {newer} have exactly the same figures in INPI's data, so it is unclear which year they belong to; both are left out.",
      confidential:
        "The company has declared the income statement for {date} confidential; only the net result for the year is public.",
      noFigures:
        "INPI has no public financial figures for the company (e.g. because the annual report is declared confidential or not filed yet).",
    },
    lithuania: {
      liabilitiesIncomplete:
        "The annual report for {date}: the registry's liabilities do not cover the whole liabilities side (grants, provisions or accruals are missing), so total liabilities is left out.",
      litas: "The annual report for {date} is in litas (before the euro) and is left out.",
      conflictingFigures:
        'The annual report for {date} has different figures for "{line}" and the item is left out.',
    },
    netherlands: {
      yearUnreadable:
        'KVK\'s financial year "{year}" cannot be read, so the annual report is left out.',
      notCalendarYear:
        "KVK's annual report for {year} was adopted on {date}, so the financial year does not follow the calendar year and is left out.",
      noFigures: "KVK's annual report for {year} has none of the figures we recognise.",
      unbalanced:
        "KVK's balance sheet for {year} does not add up (assets ≠ liabilities), so the annual report is left out.",
      rateLimited: "{registry} allows one lookup per minute and asked us to wait.",
      noXbrl: "KVK has no annual report filed as XBRL for the company.",
    },
    sweden: {
      notSetUp: "Bolagsverket is not set up (D21).",
      loginStatus: "Bolagsverket's login answered with status {status}.",
      noToken: "Bolagsverket's login gave no key.",
      companyUnreadable: "Bolagsverket's answer about the company could not be read.",
      documentsUnreadable: "Bolagsverket's list of documents could not be read.",
      notFetched: "The årsredovisning for {date} could not be fetched and is left out.",
      notRead: "The årsredovisning for {date} could not be read and is left out.",
      noFigures: "The årsredovisning for {date} contains none of the figures we recognise.",
      noneReadable: "Bolagsverket has {count} årsredovisningar, but none could be read.",
    },
    lookup: {
      notSetUp:
        "{registry} is not set up yet, so the annual report is not available. The analysis uses the figures from the web search.",
      numberNotFound: "{number} in the material does not exist in {registry}.",
      numberOtherCompany:
        "{number} in the material belongs to {owner}, not {name}, and is not used.",
      ambiguous: '{count} possible companies in {registry} for "{name}"; none is chosen.',
      failed:
        "The lookup in {registry} failed ({reason}). It is tried again at the next screening.",
      approvedGone:
        "{numberLabel} {number}, which a person approved, no longer exists in {registry}.",
      humanDecided:
        "A person has decided the identity, and no {numberLabel} is stored, so {registry} was not looked up.",
      noNameMatch: 'No company in {registry} matches "{name}".',
      notSureEnough:
        "No {numberLabel} in the material, and the web search did not find the company reliably enough for a name lookup in {registry}.",
      noMatchingNumber:
        "No {numberLabel} in the case's material matches the company, and {registry} cannot search by name. The analysis uses the figures from the web search.",
      noNumber:
        "No {numberLabel} in the case's material, and {registry} cannot search by name. The analysis uses the figures from the web search.",
      numberChanged:
        "The registry number changed from {from} to {to}; the old annual reports are removed.",
      oldNotRemoved:
        "The old annual reports could not be removed after the registry number changed.",
      notSaved: "The registry number and the identity assessment could not be saved.",
      fetched: "{label} and annual reports for {count} years fetched.",
      foundNoStatements: "{label} found. {detail}",
      foundNotFetched:
        "{label} found, but the annual reports could not be fetched ({reason}). It is tried again at the next screening.",
    },
  },
  /** The public research and the CVR step (public-research.ts). */
  research: {
    noMatch: 'No CVR match for "{name}".',
    customQuestionsNotLoaded:
      "Your custom research questions could not be loaded. Please try again shortly.",
    deckNotReadForCvr: "The deck's text could not be read for CVR numbers.",
    websiteNotReadForCvr: "The website's text could not be read for CVR numbers.",
    reused: "Reused from the case's latest screening.",
    unknownError: "Unknown research error",
    tracksSucceeded: "Only {done} of {total} research tracks succeeded.",
    claimsDropped: "{count} claim(s) were left out because the source was not fetched.",
    rejectedNoSource: "Rejected: no claim had a fetched source",
    notValidated: "The answer could not be validated",
    tracksValidated: "Only {done} of {total} research tracks gave validated evidence.",
    legalIdentityManual: "The legal identity needs manual confirmation: {detail}",
    existingSourcesNotRead: "Existing public sources could not be read.",
    sourceNotSaved: "A public research source could not be saved.",
    evidenceNotChecked: "Existing evidence could not be checked.",
    evidenceNotSaved: "The public research could not be saved as evidence.",
    noGatewayAccess:
      "The AI service could not be used just now. Try again shortly, or write to Interlect.",
    noAnswer: "The public AI research returned no answer.",
    moduleNoResults: "The research module {module} returned claims without search results.",
    moduleNoExactUrl:
      "The research module {module} returned claims without an exact, fetched source URL.",
    moduleClaimsDropped:
      "Research module {module}: {count} claim(s) were left out because the source was not fetched (the topic is uncertain, not absent): {claims}",
    caseNotRead: "The case could not be read, so the CVR lookup was skipped.",
    noCompany: "The case has no company linked yet.",
    markedWrong: "A person has marked the company as wrong, so no registry data is fetched.",
    domainMatches: "The domain {host} matches the name",
    researchConfident: "The web search found the company in several sources",
    markedNotDanish: "A person has marked the company as not Danish, so no CVR data is fetched.",
    cvrInMaterialOther:
      "CVR {cvr} in the material belongs to {owner}, not {name}, and is not used.",
    cvrOnHostOther: "CVR {cvr} on {host} belongs to {owner}, not {name}, and is not used.",
    noName: "No company name to look up in CVR.",
    ambiguous:
      '{count} possible CVR matches for "{name}". Choose the right one under Annual accounts.',
    lookupFailed: "The CVR lookup failed ({reason}). It can be tried again under Annual accounts.",
    cvrInMaterial: "CVR {cvr} is in the case's own material",
    cvrOnDomain: "CVR {cvr} is on the company's domain {host}",
    cvrInPublicOne: "CVR {cvr} is in {count} public source",
    cvrInPublicMany: "CVR {cvr} is in {count} public sources",
    cvrInactive: 'CVR status is "{status}"',
    cvrChanged: "The CVR number changed from {from} to {to}; the old annual reports are removed.",
    oldNotRemoved: "The old annual reports could not be removed after the CVR change.",
    identityNotSaved: "The identity assessment could not be saved.",
    noCvr: "No CVR number matching the company was found.",
    existingNotChecked: "Could not check existing annual reports.",
    upToDate: "The annual reports are up to date ({count} financial years).",
    keptOlder:
      "The annual reports from {count} years are kept; a newer annual report could not be read ({reason}).",
    fetched: "CVR {cvr} and public annual reports fetched.",
    foundNotFetched:
      "CVR {cvr} found, but the annual reports could not be fetched ({reason}). It can be tried again under Annual accounts.",
    unsupportedFormat: "The official source returned an unsupported file format.",
    noReadableText: "The official source contained no readable text.",
  },
} as const;
