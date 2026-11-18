/**
 * Danish texts the server sends to the person in Fondsopsætning and Ny investeringstese
 * Errors and refusals from src/lib/funds. The server picks the language of the page
 * that asked (`serverText`).
 */
export const fundServer = {
  common: {
    setupNotLoaded: "Teamopsætningen kunne ikke hentes.",
    versionNotFound: "Versionen blev ikke fundet.",
    draftOnlyEdit: "Kun en kladde kan ændres. Opret en kladde først.",
    draftNotFound: "Kladden blev ikke fundet.",
    gatewayMissing:
      "AI-tjenesten kunne ikke bruges lige nu. Prøv igen om lidt, eller skriv til Interlect.",
    interrupted: "Forslaget blev afbrudt og er derfor ikke anvendt.",
    aiNoAnswer: "AI'en kunne ikke svare. Prøv igen om lidt.",
    accessCheckFailed: "Adgangen kunne ikke kontrolleres. Prøv igen om lidt.",
    proposalsNotLoaded: "Forslagene kunne ikke hentes.",
    proposalNotSaved: "Forslaget kunne ikke gemmes.",
    proposalAlreadyHandled: "Forslaget er allerede behandlet.",
    proposalNotLaid: "Forslaget kunne ikke lægges i kladden.",
    draftChanged: "Kladden er ændret, siden forslaget blev lavet. Bed om et nyt forslag.",
    caseNotLoaded: "Casen kunne ikke hentes.",
    caseNotFound: "Casen blev ikke fundet.",
    caseCompanyNotFound: "Casens selskab blev ikke fundet.",
    caseScreeningNotLoaded: "Casens screening kunne ikke hentes.",
    caseBasisNotLoaded: "Casens analysegrundlag kunne ikke hentes.",
    caseNoBasis: "Casen har intet analysegrundlag endnu.",
    trialFailed: "Prøvekørslen kunne ikke gennemføres. Prøv igen om lidt.",
    versionNotFoundProfile: "Versionen af opsætningen blev ikke fundet.",
    specialistNotInDraft: "Specialisten blev ikke fundet i kladden.",
    reasonsNotLoaded: "Årsagerne kunne ikke hentes.",
    moduleNotFound: "Modulet findes ikke.",
  },
  aiSettings: {
    runsNotLoaded: "Teamets tidligere kørsler kunne ikke hentes.",
    chooseSetting: "Vælg en indstilling.",
    confirmCap: "Loftet skal bekræftes, før det gemmes.",
    notEnabled: "AI-niveauer er ikke slået til i databasen endnu (migration 0036).",
    notSaved: "Indstillingen kunne ikke gemmes.",
    capRange: "Loftet skal ligge mellem {min} og {max} kr.",
  },
  assist: {
    notStarted: "Hjælpen kunne ikke startes. Prøv igen om lidt.",
    creditsNotReserved: "Kreditterne kunne ikke reserveres. Prøv igen om lidt.",
    tooLong: "Teksten er for lang til AI-hjælpen. Gør beskrivelsen eller specialisten kortere.",
    rateLimited:
      "Teamet har brugt AI-hjælpen {count} gange den seneste time. Vent lidt, før I prøver igen.",
  },
  history: {
    notLoaded: "Historikken kunne ikke hentes.",
    teamMember: "Et teammedlem",
  },
  gateway: {
    cutOff: "Svaret blev afbrudt og er derfor ikke anvendt.",
    overBudget: "Svaret overskred sit omkostningsloft og er ikke anvendt.",
  },
  proposals: {
    aiFailed: "AI'en kunne ikke lave et forslag. Prøv igen om lidt.",
    notCounted: "Forslagene kunne ikke tælles.",
    tooMany: "Der ligger allerede ti forslag. Læg eller afvis nogle af dem først.",
    notUsable: "AI'ens forslag var ikke brugbart. Prøv at formulere ønsket anderledes.",
    doesNotFit: "AI'ens forslag passede ikke til kladden. Prøv at formulere ønsket anderledes.",
    noChange: "Forslaget ændrer ikke noget i kladden.",
    notFound: "Forslaget blev ikke fundet.",
    alreadyApplied: "Forslaget er allerede lagt i kladden.",
    notOpen: "Forslaget er ikke længere åbent.",
    unreadable: "Forslaget kan ikke læses og er ikke anvendt.",
    noLongerFits: "Forslaget passer ikke længere til kladden. Bed om et nyt forslag.",
  },
  config: {
    noSetup: "Det valgte team har endnu ingen opsætning.",
    versionsNotLoaded: "Versionshistorikken kunne ikke hentes.",
    draftNotCreated: "Kladden kunne ikke oprettes. Prøv igen om lidt.",
    draftNotSaved: "Kladden kunne ikke gemmes. Prøv igen om lidt.",
    draftNotPublished: "Kladden kunne ikke udgives. Prøv igen om lidt.",
    versionNotLoaded: "Versionen af opsætningen kunne ikke hentes.",
    investmentsNotLoaded: "Tidligere investeringer kunne ikke hentes.",
    investmentExists: "Denne virksomhed er allerede registreret som en tidligere investering.",
    investmentNotSaved: "Investeringen kunne ikke gemmes.",
    investmentNotRemoved: "Investeringen kunne ikke fjernes.",
  },
  criterion: {
    needKeywords: "Skriv et par stikord om, hvad I kigger efter, før AI'en kan hjælpe.",
    aiFailed: "AI'en kunne ikke uddybe kriteriet. Prøv igen om lidt.",
    overBudget: "Forslaget overskred sit omkostningsloft og er ikke anvendt.",
  },
  document: {
    badPath: "Dokumentets private filsti er ugyldig.",
    notFetched: "Dokumentet kunne ikke hentes sikkert.",
    tooLarge: "PDF'en må højst fylde 25 MB.",
    noText: "PDF'en indeholder ingen læsbar tekst.",
    aiFailed: "AI'en kunne ikke fortolke dokumentet.",
    cutOff: "Dokumentforslaget blev afbrudt og er derfor ikke anvendt.",
    overBudget: "Dokumentimporten overskred sit omkostningsloft og er ikke anvendt.",
  },
  funds: {
    notLoaded: "Dine teams kunne ikke hentes.",
    adminOnly: "Kun en Admin kan oprette en ny investeringstese.",
    fundNotCreated: "Teamet kunne ikke oprettes.",
    membershipNotCreated: "Medlemskabet kunne ikke oprettes.",
    roleNotGranted: "Rollen i teamet kunne ikke tildeles.",
    setupNotCreated: "Teamets opsætning kunne ikke oprettes.",
    mandateNotCreated: "Teamets mandat kunne ikke oprettes.",
    rulesNotCreated: "Mandatreglerne kunne ikke oprettes.",
    scoringNotCreated: "Scoringsmodellen kunne ikke oprettes.",
    nameMismatch: "Teamets navn matcher ikke. Sletningen er ikke gennemført.",
    onlyThesis:
      "Du kan ikke slette din eneste investeringstese. Opret en ny først, så du stadig er Admin et sted.",
    filesNotChecked: "Teamets private filer kunne ikke kontrolleres.",
    notDeleted: "Teamet kunne ikke slettes fra databasen.",
  },
  module: {
    aiFailed: "AI'en kunne ikke omskrive modulteksten.",
    overBudget: "Redigeringen overskred sit omkostningsloft og er ikke anvendt.",
    notSaved: "Modulteksten kunne ikke gemmes.",
    notReset: "Standardteksten kunne ikke gendannes.",
  },
  research: {
    aiFailed: "AI'en kunne ikke generere en forskningsstrategi.",
    overBudget: "Genereringen overskred sit omkostningsloft og er ikke anvendt.",
    notSaved: "Forskningsstrategien kunne ikke gemmes.",
    notReset: "Standardspørgsmålene kunne ikke gendannes.",
  },
  reasons: {
    notSaved: "Årsagen kunne ikke gemmes.",
    notAdded: "Årsagen kunne ikke tilføjes.",
    notChanged: "Årsagen kunne ikke ændres.",
    tooManySimilar: "Der findes for mange årsager med næsten samme tekst.",
  },
  rescreen: {
    versionNotLoaded: "Den aktive version af tesen kunne ikke hentes.",
    casesNotLoaded: "Cases til genscreening kunne ikke hentes.",
  },
  screening: {
    draftOnlyCheck: "Kun en kladde kan tjekkes. Opret en kladde først.",
    questionsNotLoaded: "Screeningens research-spørgsmål kunne ikke hentes.",
    tooLongForCheck:
      "Opsætningen er for lang til AI-tjekket. Gør instruktionen eller teksterne kortere.",
    cardsInvalid:
      "Vælg kun blandt Finanser, Team, Marked og Teknologi, og hvert kort højst én gang.",
    notSaved: "Screeningen kunne ikke gemmes. Prøv igen om lidt.",
    instructionTooLong: "Screeningsinstruktionen må højst være {max} tegn.",
  },
  trial: {
    draftOnly: "Kun en kladde kan prøvekøres. Opret en kladde først.",
    noCriteria: "Kladden har ingen kriterier at screene efter.",
    notScreened: "Casen skal være screenet, før screeningen kan prøves på den.",
    otherCase: "AI-resultatet tilhører en anden case.",
    tooLarge:
      "Opsætningen og casens materiale er for store til én screening. Gør instruktionen eller kriterierne kortere.",
    rateLimited:
      "Teamet har lavet {count} prøvekørsler af screeningen den seneste time. Vent lidt, før I prøver igen.",
  },
  specialists: {
    draftUnusable: "AI'en gav et udkast, der ikke kunne bruges. Prøv igen om lidt.",
    casesNotLoaded: "Casene kunne ikke hentes.",
    notScreened: "Casen skal være screenet, før specialisten kan prøves på den.",
    tooLarge:
      "Specialisten og casens materiale er for store til ét specialistkald. Gør specialisten kortere, eller prøv en anden case.",
    unfinished: "Specialisten nåede ikke at svare færdigt. Prøv igen, eller gør mandatet kortere.",
    failedControl:
      "Specialistens svar holdt ikke kontrollen (dækning eller kilder). Prøv igen, eller ret specialisten.",
    changedElsewhere:
      "Versionen er lige blevet udgivet eller ændret af en anden. Genindlæs siden for at se den aktive version.",
    notEnabled: "Specialisten kunne ikke slås til.",
    oneActive: "Mindst én specialist skal være aktiv i den dybe analyse.",
    notDisabled: "Specialisten kunne ikke slås fra.",
    notSaved: "Specialisten kunne ikke gemmes.",
    notChanged: "Specialisten kunne ikke ændres.",
    notDeleted: "Specialisten kunne ikke slettes.",
    missingNameOrMandate: "Specialisten mangler navn eller mandat.",
    rateLimited:
      "Teamet har lavet {count} prøvekørsler den seneste time. Vent lidt, før I prøver igen.",
    tooManyCustom:
      "Opsætningen har allerede {count} egne specialister. Slet en, før du laver en ny.",
  },
  suggestions: {
    leadOnly: "Kun en Admin eller Lead kan markere et forslag som løst.",
    notUpdated: "Forslaget kunne ikke opdateres.",
  },
  thesisChat: {
    askSomething: "Skriv et spørgsmål.",
  },
} as const;
