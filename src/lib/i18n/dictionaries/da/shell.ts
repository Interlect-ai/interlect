/** Danish texts for the shell group: the menu, shared states, dialogs and bars. */
export const shell = {
  root: {
    notFoundTitle: "Siden findes ikke",
    notFoundBody: "Siden du leder efter findes ikke, eller den er blevet flyttet.",
    goToOverview: "Gå til Overblik",
    errorTitle: "Siden kunne ikke indlæses",
    errorBody:
      "Der gik noget galt i vores ende. Prøv at genindlæse, eller gå tilbage til Overblik.",
  },
  rail: {
    label: "Primær navigation",
    pages: "Sider",
    homeLink: "Interlect, til Overblik",
    collapse: "Fold menuen sammen",
    expand: "Fold menuen ud",
    userMenu: "Brugermenu for {name}",
    you: "dig",
    signedIn: "Logget ind",
    lightTheme: "Lyst tema",
    darkTheme: "Mørkt tema",
    signOut: "Log ud",
    signOutFailed: "Du blev ikke logget ud. Prøv igen.",
  },
  roles: {
    admin: "Admin",
    lead: "Lead",
    member: "Medlem",
    reader: "Læser",
  },
  fund: {
    loadFailed: "Teserne kunne ikke hentes",
    reload: "Genindlæs siden",
    none: "Ingen investeringstese endnu",
    askAdmin: "Bed en Admin om en invitation",
    choose: "Vælg investeringstese",
    noSetup: "Ingen opsætning endnu",
    thesisVersion: "Tese v{version}",
    draftVersion: "Kladde v{version}",
    demo: "{version}, demotese",
    switchLabel: "Aktiv investeringstese: {name}. Skift tese",
    create: "Opret investeringstese",
  },
  mobile: {
    openMenu: "Åbn menuen",
    menu: "Menu",
    closeMenu: "Luk menuen",
  },
  session: {
    unconfigured: "Adgangen til Interlect er ikke konfigureret i dette miljø. Kontakt en Admin.",
    checking: "Kontrollerer adgang …",
  },
  states: {
    errorTitle: "Noget gik galt",
    errorBody: "Vi kunne ikke hente det lige nu. Prøv igen om lidt.",
    noAccessTitle: "Kun for admins",
    noAccessBody:
      "Din rolle giver ikke adgang til denne side. Kontakt en admin, hvis du skal bruge den.",
  },
  blocks: {
    loading: "Indlæser …",
    errorBody: "Data kunne ikke hentes. Prøv igen.",
    noAccessTitle: "Ingen adgang",
    noAccessBody: "Din rolle giver ikke adgang til dette område. Kontakt en Admin.",
    notWiredTitle: "{area} er ikke koblet til data endnu",
    notWiredBody:
      "Denne flade er struktureret, men viser først indhold når databasen og analysepipelinen er implementeret. Der vises bevidst ingen opdigtede tal.",
  },
  dialog: {
    reasonDescription: "Årsagen gemmes i casens historik og bruges af Brain.",
    cancel: "Annullér",
    maxReasons: "Højst {count} årsager",
    fewerReasons: "Færre årsager",
    moreReasons: "Flere årsager",
    note: "Note",
  },
  bulk: {
    selected: "{count} valgt",
    clear: "Fravælg",
  },
  split: {
    allActions: "Alle handlinger",
    idle: "Ingen handling i {days} dage",
  },
  menu: {
    recommended: "Anbefalet",
    current: "Nu",
  },
  toast: {
    undo: "Fortryd",
  },
  credit: {
    stoppedTitle: "Saldoen er brugt",
    title: "AI-kreditter",
    loadFailed: "Kreditterne kunne ikke hentes. Prøv igen om lidt.",
    noticeLow:
      "Der er under {pct} % tilbage. Brain holder pause med baggrundsarbejdet, til der er fyldt op. Analyser og Spørg kører som normalt.",
    noticeEmpty:
      "Fyld op for at køre flere analyser. Analyser, der allerede kører, bliver færdige.",
    noticeNotEnforced: "Kreditter er ikke slået til endnu, så intet stoppes.",
    askAdmin: "Bed en Admin om at fylde op.",
    balance: "Saldo",
    remaining: "tilbage",
    remainingLabel: "Kreditter tilbage",
    remainingPct: "{pct} % tilbage",
    pool: "af {amount} i månedens pulje. Brain holder pause ved {pct} % tilbage.",
    noCredits: "Der er ikke kreditter at bruge af endnu.",
    usedThisMonth: "Brugt denne måned",
    nothingUsed: "Intet brugt endnu.",
    scopes: {
      analysis: "Analyse",
      chat: "Spørg",
      brain: "Brain",
    },
    topUp: "Fyld op",
    requestDescription: "Send en anmodning, så lægger Interlect kreditter ind.",
    paymentNotSetUp: "Betaling er ikke sat op for jeres installation endnu.",
    sendRequest: "Send anmodning",
    mailBody:
      "Din mailapp åbner med en færdig besked, som du kun skal tilføje beløbet i og sende. Kørsler, der allerede er i gang, bliver altid færdige.",
    writeToUs:
      "Skriv til Interlect, så lægger vi kreditter ind. Kørsler, der allerede er i gang, bliver altid færdige.",
  },
} as const;
