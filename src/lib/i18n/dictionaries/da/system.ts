/** Danish texts for Systemstatus and the shared "logged out" message. */
export const system = {
  status: {
    subtitle: "Serverstatus, opdateret ved sideindlæsning.",
    login: "Login og session",
    database: "Database (cases, teams, analyser)",
    ai: "AI-analyse",
    cvr: "Automatisk CVR-opslag",
    optionalNotSet: "(valgfri, ikke sat)",
    criticalDown:
      "En eller flere kritiske dele af serveren er ikke konfigureret korrekt. Kontakt en Admin.",
  },
  signedOut: "Du er blevet logget ud. Log ind igen.",
  actionFailed: "Handlingen kunne ikke gennemføres. Prøv igen.",
} as const;
