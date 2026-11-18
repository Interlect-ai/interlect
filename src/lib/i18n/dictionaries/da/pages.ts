/**
 * Danish page titles and descriptions for `head()`. The server renders them in Danish
 * (it does not know the fund yet); `PageHeadSync` shows them in the fund's language in the browser.
 */
export const pages = {
  root: {
    description:
      "Evidensdrevet AI-venture-analytiker konfigureret til én investeringstese ad gangen.",
  },
  overview: { title: "Overblik - Interlect" },
  cases: { title: "Cases - Interlect" },
  case: { title: "Case - Interlect" },
  brain: { title: "Brain — Interlect" },
  createCase: {
    title: "Opret case — Interlect",
    description:
      "Skriv selskabets navn eller CVR, tilføj det I har, og lad Interlect finde det rigtige selskab og screene det mod tesen.",
  },
  fundSetup: {
    title: "Teamopsætning — Interlect",
    description: "Vælg og gennemgå det mandat, Interlect bruger til screening og dyb analyse.",
  },
  newThesis: {
    title: "Ny investeringstese — Interlect",
    description: "Sæt jeres investeringstese op i syv trin med hjælp fra Interlect.",
  },
  users: {
    title: "Brugere og adgang — Interlect",
    description:
      "Inviterede brugere og roller: Admin, Lead, Medlem og Læser. Ingen offentlig registrering.",
  },
  security: {
    title: "Sikkerhed og data — Interlect",
    description: "Hvor jeres data ligger, hvem kan se dem, og hvad der sendes til AI.",
  },
  status: { title: "Status — Interlect" },
  login: {
    title: "Log ind — Interlect",
    description: "Adgang til Interlect kræver invitation. Der findes ingen offentlig registrering.",
  },
  mfa: {
    title: "To-trins-login — Interlect",
    description: "Bekræft din adgang til Interlect med en kode fra din godkendelsesapp.",
  },
  passwordReset: {
    title: "Ny adgangskode — Interlect",
    description: "Vælg en ny adgangskode til Interlect med et engangslink fra din admin.",
  },
  invitation: {
    title: "Accepter invitation — Interlect",
    description:
      "Accepter en invitation til Interlect og opret adgangskode. Invitationslinks er engangs og udløber.",
  },
} as const;
