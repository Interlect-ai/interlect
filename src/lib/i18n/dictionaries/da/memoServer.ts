/**
 * Danske tekster, serveren sender om komitémemoen: fejl og afvisninger fra
 * src/lib/memo/memo.functions.ts og databasens memo-funktioner (0132). Serveren vælger sidens sprog.
 */
export const memoServer = {
  notLoaded: "Komitémemoen kunne ikke hentes.",
  notSaved: "Komitémemoen kunne ikke gemmes.",
  busy: "En anden gemte komitémemoen samtidig. Prøv igen.",
  notFound: "Casen blev ikke fundet i investeringsteamet.",
  writeOnly: "Kun Admin, Lead og Medlem kan skrive i komitémemoen.",
  rationaleTooLong: "Begrundelsen er for lang (højst 8.000 tegn).",
  beliefCommentsInvalid:
    "Kommentarerne til teserne kunne ikke gemmes. Hver kommentar må højst være 2.000 tegn.",
  gapKeyInvalid: "Manglen blev ikke genkendt.",
  gapStateInvalid: "Vælg Udfyld eller Ikke nødvendigt.",
  reasonTooShort: "Skriv en begrundelse på mindst 10 tegn.",
  gapReasonTooLong: "Begrundelsen er for lang (højst 2.000 tegn).",
  analysisNotOnCase: "Analysen hører ikke til casen.",
  analysisNotComplete: "Memoen kan først laves, når den dybe analyse er færdig.",
  sectionsInvalid: "Memoens afsnit kunne ikke gemmes.",
  versionNotFound: "Memoens version blev ikke fundet.",
  alreadyApproved: "Memoen er allerede godkendt.",
  frozen: "En godkendt memo kan ikke ændres.",
  rationaleMissing: "Skriv, hvorfor du anbefaler casen, før memoen laves.",
} as const;
