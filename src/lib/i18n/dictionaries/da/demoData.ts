/** Demodata i selvhosting-udgaven (0900, `npm run seed:demo`): banneret, sletningen og første case. */
export const demoData = {
  banner: {
    title: "Demodata",
    bodyOne:
      "{count} opdigtet case vises, så alle skærme har indhold. Ingen selskaber eller personer i den er virkelige.",
    bodyMany:
      "{count} opdigtede cases vises, så alle skærme har indhold. Ingen selskaber eller personer i dem er virkelige.",
    bodyLeftover: "De opdigtede cases er slettet, men et sidste trin mangler. Slet demodata igen.",
    delete: "Slet demodata",
    confirmTitle: "Slet demodata?",
    confirmBody:
      "De opdigtede cases og alt på dem (analyser, noter, opgaver og beslutninger) slettes for hele teamet. Jeres egne cases røres ikke. Det kan ikke fortrydes.",
    confirm: "Slet demodata",
    deleting: "Sletter",
    deleted: "Demodata er slettet",
    failed: "Demodata kunne ikke slettes. Prøv igen.",
  },
  firstCase: {
    title: "Din første case i fem trin",
    body: "Interlect screener hver case mod jeres investeringstese. Sådan kommer I i gang:",
    setupTitle: "Gør investeringstesen færdig",
    setupBody: "Gennemgå kriterier, krav og tærskel i Teamopsætning, og udgiv tesen.",
    teamTitle: "Invitér teamet",
    teamBody: "Giv kollegerne adgang under Brugere og adgang.",
    createTitle: "Opret en case",
    createBody: "Et pitch deck, en hjemmeside eller blot et navn er nok.",
    screenTitle: "Lad Interlect screene den",
    screenBody: "Screeningen vurderer casen mod tesen og viser, hvad der skal afklares.",
    decideTitle: "Beslut næste skridt",
    decideBody: "Start en dyb analyse, sæt casen på hold eller luk den.",
    start: "Opret case",
  },
  server: {
    statusNotRead: "Det kunne ikke læses, om teamet har demodata.",
    notDeleted: "Demodata kunne ikke slettes. Prøv igen.",
  },
};
