/**
 * Danish texts the server sends about theses in a team: errors and refusals from
 * src/lib/funds/theses.functions.ts and the thesis lookups. The server picks the page's language.
 */
export const thesisServer = {
  notLoaded: "Teamets teser kunne ikke hentes.",
  notFound: "Tesen blev ikke fundet i teamet.",
  caseThesisMissing: "Casens tese kunne ikke findes.",
  noActiveThesis: "Teamet har ingen udgivet tese endnu. Udgiv en tese først.",
  notSelectable: "Tesen kan ikke vælges. Vælg en udgivet tese.",
  archivedNoAnalysis: "Tesen {name} er arkiveret. Genaktivér tesen for at køre en ny analyse.",
  configureOnly: "Kun en Admin eller Lead kan ændre teser.",
  nameLength: "Tesens navn skal være 2-80 tegn.",
  nameTaken: "Der findes allerede en tese med det navn.",
  lastActive: "Et team skal have mindst én aktiv tese.",
  alreadyArchived: "Tesen er allerede arkiveret.",
  notArchived: "Tesen er ikke arkiveret.",
  renameArchived: "Genaktivér tesen for at omdøbe den.",
  defaultNeedsPublished: "Kun en udgivet tese kan være standard.",
  copyNeedsPublished: "Kun en udgivet tese kan kopieres.",
  notCreated: "Tesen kunne ikke oprettes.",
  notSaved: "Ændringen af tesen kunne ikke gemmes.",
} as const;
