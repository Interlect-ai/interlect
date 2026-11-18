/**
 * Danish texts for the brainChat group: the Brain page and its conversation, the
 * thread list, Spørg Interlect (the corner panel), "Brain om denne case", the source panel and
 * the feedback dialog. Brain's own answers, pages and lessons are not here (they are written in
 * the fund's language by the model).
 */
export const brainChat = {
  /** BrainPage: the states around the conversation, and the toasts for thread actions. */
  page: {
    loading: "Henter Brain …",
    loadFailedTitle: "Brain kunne ikke hentes",
    loadFailedBody: "Vi kunne ikke se, om Brain er slået til for jer. Prøv igen om lidt.",
    disabledTitle: "Brain er ikke slået til for jer endnu",
    disabledBody:
      "Når Brain er klar, kan I stille spørgsmål til jeres egne cases, noter og beslutninger her.",
    noRoleTitle: "Brain er ikke åben for din rolle",
    noRoleBody:
      "Admin, Lead og Medlem kan stille spørgsmål til Brain. Spørg en Admin, hvis du har brug for adgang.",
    renameFailed: "Samtalen kunne ikke omdøbes",
    sharedToast: "Samtalen er delt med teamet",
    privateToast: "Samtalen er privat igen",
    shareFailed: "Delingen kunne ikke ændres",
    deletedToast: "Samtalen er slettet",
    deleteFailed: "Samtalen kunne ikke slettes",
    loadingMap: "Henter hjernekortet …",
    loadingThread: "Henter samtalen …",
    threadOpenFailedTitle: "Samtalen kunne ikke åbnes",
    threadOpenFailedBody: "Den findes ikke længere, eller du har ikke adgang til den.",
    newThread: "Ny samtale",
    threadLoadFailedTitle: "Samtalen kunne ikke hentes",
    threadLoadFailedBody: "Prøv igen om lidt.",
  },
  /** The composer's "+" and microphone on the Brain page. */
  attach: {
    listLabel: "Filer til Brain",
    uploading: "Lægges op …",
    ready: "Klar. Læsningen bruger af jeres saldo.",
    readyPages: "Klar. Brain læser de første {pages} sider; læsningen bruger af jeres saldo.",
    read: "Læs ind i Brain",
    starting: "Starter …",
    reading: "Brain læser filen ind. Svarene kan bruge den, når den er læst.",
    dismiss: "Fjern {name}",
    micFailed: "Dikteringen stoppede. Prøv igen.",
    micDenied: "Mikrofonen er ikke tilladt i browseren.",
  },
  /** BrainChatPane: header, composer, toasts, notes under an answer. */
  pane: {
    creditsStop: "Saldoen er brugt. Fyld op for at stille flere spørgsmål til Brain.",
    title: "Interlect Brain",
    brainMap: "Hjernen",
    newThread: "Ny samtale",
    composerLabel: "Spørg Brain",
    composerPlaceholder: "Spørg Brain om jeres cases, tesen eller beslutninger",
    disclaimer:
      "Du taler med en AI. Den svarer ud fra jeres egne cases og kan tage fejl. Tjek kilderne.",
    sharedBy: "{name} har delt samtalen med teamet. Kun {name} kan spørge videre i den.",
    sharedByUnknown:
      "Samtalen er delt med teamet. Kun den, der startede den, kan spørge videre i den.",
    stopped: "Stoppet, før svaret var færdigt.",
    webNoQueries: "Fandt ingen søgeord, der er sikre at sende. Svarer uden nettet.",
    webFailedWith: "{message} Svarer uden nettet.",
    webFailed: "Nettet kunne ikke bruges. Svarer uden nettet.",
    ratingFailed: "Din vurdering kunne ikke gemmes",
    noteSaved: "Gemt som note på {name}",
    savedOn: "Gemt på {name}",
    savedToBrain: "Gemt i Brain",
    brainSaved: "Gemt i Brain. Svaret er nu en del af teamets hukommelse",
    brainAlready: "Svaret lå allerede i Brain",
    brainSaveFailed: "Svaret kunne ikke gemmes i Brain",
    noteFailed: "Noten kunne ikke gemmes",
    noteFailedWith: "Noten kunne ikke gemmes. {message}",
    refusalNoCase: "Casen findes ikke.",
    refusalNoAnswer: "Svaret findes ikke.",
    refusalNoBrain: "Brain er ikke tilgængelig endnu.",
    refusalForbidden: "Du har ikke rettigheder til denne handling.",
    unsourced: "Nogle påstande mangler kilde.",
    unknownYet: "Det ved Brain ikke endnu: {missing}",
  },
  /** The @ context chip. */
  context: {
    allCases: "Alle cases",
    thesis: "Tesen",
    label: "Kontekst: {context}",
    searchPlaceholder: "Søg i cases og personer",
    searchFailed: "Søgningen kunne ikke gennemføres.",
    noneFound: "Ingen fundet.",
  },
  /** Hurtig / Grundig. */
  mode: {
    fast: "Hurtig",
    fastHint: "Til de fleste spørgsmål. Svarer på få sekunder.",
    deep: "Grundig",
    deepHint: "Slår mere op og tænker længere. Tager længere tid.",
    label: "Svartype: {mode}",
  },
  web: {
    chip: "Søg på nettet",
  },
  /** The four fixed suggestion cards on the Brain page. */
  suggestions: {
    "1": { title: "Hvorfor sagde vi nej til de seneste cases?", hint: "Beslutninger og noter" },
    "2": {
      title: "Hvad har vi lært af de cases, vi gik videre med?",
      hint: "Mønstre i jeres beslutninger",
    },
    "3": {
      title: "Hvilke åbne spørgsmål går igen på tværs af cases?",
      hint: "Det, der mangler i jeres evidens",
    },
    "4": { title: "Hvordan passer vores pipeline til tesen?", hint: "Cases mod jeres tese" },
  },
  /** How far a cited source can be trusted. */
  /** Errors shown in the thread (fixed texts; the server's own message is never shown). */
  errors: {
    budget_reached:
      "Teamets månedlige grænse for Brain er nået. Spørg igen, når en ny måned begynder, eller bed en Admin om at hæve grænsen.",
    disabled: "Brain er ikke slået til for jer endnu.",
    forbidden: "Din rolle må ikke stille spørgsmål til Brain.",
    signed_out: "Du er blevet logget ud. Genindlæs siden, og log ind igen.",
    rate_limited: "Der er mange spørgsmål lige nu. Prøv igen om lidt.",
    busy: "Brain svarer allerede. Vent, til svaret er færdigt.",
    failed: "Svaret kunne ikke gives. Prøv igen om lidt.",
    blocked_by_policy:
      "Spørgsmålet blev ikke sendt, fordi AI-modellen ikke opfylder Interlects regler for datasikkerhed. Intet har forladt Interlect. Giv Interlect besked, så vi kan rette det.",
  },
  /** ThreadList. */
  threads: {
    newThread: "Ny samtale",
    navLabel: "Samtaler",
    loading: "Henter samtaler …",
    loadFailed: "Samtalerne kunne ikke hentes.",
    today: "I dag",
    earlier: "Tidligere",
    team: "Delt i team",
    sources: "Kilder",
    deleteTitle: "Slet samtalen?",
    deleteBody: "Spørgsmål, svar og feedback i samtalen slettes for altid.",
    cancel: "Annullér",
    deleteConfirm: "Slet samtalen",
    sharedByColleague: "(delt af en kollega)",
    sharedWithTeam: "Delt med teamet",
    actionsFor: "Handlinger for {title}",
    rename: "Omdøb",
    makePrivate: "Gør privat",
    shareWithTeam: "Del med teamet",
    delete: "Slet",
    renameLabel: "Nyt navn til samtalen",
  },
  /** Spørg Interlect (the corner panel and its pill). */
  ask: {
    title: "Spørg Interlect",
    hide: "Skjul Spørg Interlect",
    hideShort: "Skjul",
    show: "Vis Spørg Interlect",
    minimize: "Minimér",
    loadingThread: "Henter samtalen",
    knowsAll: "Kender alle jeres cases",
    knowsCase: "Kender {name}",
    knowsCasePhase: "Kender {name}, {phase}",
    headingCase: "Hvad vil du vide om {name}?",
    headingAll: "Hvad vil du vide om jeres cases?",
    introCase:
      "Jeg svarer ud fra casens analyse, teamets noter og jeres tidligere beslutninger, og jeg viser kilderne.",
    introAll: "Jeg svarer ud fra jeres cases, noter og beslutninger, og jeg viser kilderne.",
    placeholderCase: "Spørg om casen",
    placeholderAll: "Spørg om jeres cases",
    caseSuggestion1: "Hvad er de største risici?",
    caseSuggestion2: "Hvad skal vi spørge founderne om?",
    caseSuggestion3: "Hvordan passer casen til tesen?",
    caseSuggestion4: "Ligner den cases, vi har set før?",
    allSuggestion1: "Hvorfor sagde vi nej sidst?",
    allSuggestion2: "Hvad går igen i vores fravalg?",
    allSuggestion3: "Hvilke spørgsmål går igen?",
    allSuggestion4: "Passer pipelinen til tesen?",
  },
  /** "Brain om denne case" (the sheet on the case page). */
  casePanel: {
    button: "Brain",
    title: "Brain om denne case",
    subtitle: "Hvad jeres egen historik siger",
    askAbout: "Spørg Brain om casen",
    loading: "Henter",
    loadFailed: "Brain-panelet kunne ikke hentes. Prøv igen om lidt.",
    previouslySeen: "Tidligere set",
    firstTime: "Første gang I ser dette selskab.",
    caseFrom: "Case fra {date}",
    similar: "Lignende cases",
    noProfile: "Brain har ikke en profil af casen endnu. Den laves, når screeningen er færdig.",
    tooFew: "Brain har for få cases endnu.",
    contradictions: "Modsigelser",
    new: "Ny",
    noDecision: "Ingen beslutning endnu",
    decision: {
      reject: "Fravalgt",
      decline_ic: "Nej i komitéen",
      invest: "Investeret",
    },
  },
  /** The source panel and the source dialog. */
  sources: {
    title: "Kilder",
    show: "Vis kilder",
    fold: "Fold kilder ind",
    foldShort: "Fold ind",
    sourceLabel: "Kilde {n}: {label}",
    deleted: "[kilde slettet]",
    who: "Hvem var det nu lige?",
    noQuote: "Kilden har ikke noget citat at vise.",
    openSource: "Åbn kilden",
    openWebsite: "Åbn websiden",
  },
  /** FeedbackDialog (what a thumbs-down may add). */
  feedback: {
    title: "Hvad var der galt med svaret?",
    description: "Din vurdering er gemt. Fortæl gerne mere, så Brain kan blive bedre.",
    kindLabel: "Hvad var galt",
    wrong: "Forkert",
    incomplete: "Mangler noget",
    wrongSources: "Hvilke kilder var forkerte?",
    commentLabel: "Kommentar (valgfri)",
    placeholderWrong: "Hvad er forkert? (valgfrit)",
    placeholderIncomplete: "Hvad mangler der? (valgfrit)",
  },
} as const;
