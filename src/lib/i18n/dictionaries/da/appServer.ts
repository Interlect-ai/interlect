/**
 * Danish texts the server sends to the person about access, invitations, credits, the AI data
 * rules, Overblik and display choices: the rest of src/lib outside funds, cases,
 * analysis and brain. The process rules and the top-up mail are also built in the browser.
 */
export const appServer = {
  access: {
    membersNotLoaded: "Medlemslisten kunne ikke hentes. Prøv igen om lidt.",
    invitationsNotLoaded: "Invitationerne kunne ikke hentes.",
    auditNotLoaded: "Revisionsloggen kunne ikke hentes.",
    ownRoles: "Du kan ikke ændre dine egne roller.",
    roleNotChanged: "Rollen kunne ikke ændres. Prøv igen om lidt.",
    ownAccess: "Du kan ikke ændre din egen adgang.",
    accessNotChanged: "Adgangen kunne ikke ændres. Prøv igen om lidt.",
    lastAdmin: "Teamet skal have mindst én aktiv admin.",
    lastAdminRollback: "Ændringen blev rullet tilbage: teamet skal have mindst én Admin.",
    seatsNotCounted: "Pladserne kunne ikke tælles. Prøv igen om lidt.",
    adminsNotLoaded: "Adminerne kunne ikke hentes.",
    settingNotSaved: "Indstillingen kunne ikke gemmes.",
    accessNotChecked: "Adgangen kunne ikke kontrolleres. Prøv igen om lidt.",
    noMembership: "Du har ikke et aktivt medlemskab i det valgte team.",
    forbidden: "Du har ikke rettigheder til denne handling.",
    auditNotWritten: "Handlingen blev afvist: revisionshændelsen kunne ikke skrives.",
    roleHalfChanged: "Rollen blev kun delvist ændret. Kontrollér personens rolle, og prøv igen.",
    roleRequired: "Et medlemskab skal have mindst én rolle.",
    ownMfa: "Du kan ikke nulstille dit eget to-trins-login her.",
    mfaOtherTeam:
      "Personen har også adgang til et team, du ikke er admin i. En admin dér skal nulstille to-trins-login.",
    mfaNotReset: "To-trins-login kunne ikke nulstilles. Prøv igen om lidt.",
    ownPasswordReset: "Du kan ikke lave et adgangskodelink til dig selv her.",
    passwordResetOtherTeam:
      "Personen har også adgang til et team, du ikke er admin i. En admin dér skal lave linket.",
    passwordResetNotCreated: "Linket kunne ikke laves. Prøv igen om lidt.",
    passwordResetDeactivated: "Personen er deaktiveret. Aktivér personen først.",
    passwordResetNotSet: "Adgangskoden kunne ikke gemmes, og linket er ikke brugt. Prøv igen.",
    unknownMembership: "Ukendt medlemskab.",
  },
  invitations: {
    notCreated: "Invitationen kunne ikke oprettes.",
    tooManyPending:
      "Der er for mange afventende invitationer. Tilbagekald nogle, før du sender flere.",
    deactivated:
      "Denne person har allerede en deaktiveret adgang til investeringstesen. Genaktivér dem direkte under Brugere i stedet for at sende en ny invitation.",
    alreadyActive: "Denne person har allerede aktiv adgang til investeringstesen.",
    seatsFull: "Alle pladser er brugt. Deaktivér et medlem eller invitér som læser.",
    seatsFullCount: "Alle {limit} pladser er brugt. Deaktivér et medlem eller invitér som læser.",
    readersFullCount: "Alle {limit} læserpladser er brugt.",
    unknown: "Ukendt invitation.",
    alreadyUsed: "Invitationen er allerede brugt.",
    notRevoked: "Invitationen kunne ikke tilbagekaldes.",
    profileNotCreated: "Profilen kunne ikke oprettes.",
    membershipNotCreated: "Medlemskabet kunne ikke oprettes.",
    rolesNotGranted: "Rollerne kunne ikke tildeles.",
  },
  workflow: {
    forbiddenActor:
      "Kun en autoriseret person kan flytte investeringsprocessen. PAP må aldrig gøre det.",
    forbiddenRole: "Din rolle kan ikke flytte casen til et nyt procestrin.",
    invalidTransition: "Overgangen er ikke tilladt fra det nuværende procestrin.",
    reasonRequired: "Der skal angives en skriftlig begrundelse.",
  },
  credits: {
    exhausted: "Fyld op for at køre flere analyser.",
    helperExhausted: "Saldoen er brugt. Fyld op for at bruge AI-hjælpen.",
    notReserved: "Kreditterne kunne ikke reserveres. Prøv igen om lidt.",
    ledgerTooLong: "Kreditbogen er for lang til at kunne summeres.",
    meterNotLoaded: "Kreditterne kunne ikke hentes. Prøv igen om lidt.",
    mailSubject: "[Interlect · Fyld op] {fund}",
    mailGreeting: "Hej Interlect,",
    mailRequest: "Vi vil gerne fylde AI-kreditter op.",
    mailFund: "Team: {fund}",
    mailBalance: "Saldo nu: {balance}",
    mailAmount: "Beløb, vi vil fylde op med: [skriv beløb]",
  },
  aiLimits: {
    user: "Du har nået grænsen på {count} {what} i timen. Prøv igen om lidt.",
    team: "Teamet har nået grænsen på {count} {what} i timen. Prøv igen om lidt.",
    screening: "screeninger",
    deepAnalysis: "dybe analyser",
    helper: "kald til AI-hjælpen",
    notChecked: "AI-forbruget kunne ikke tjekkes lige nu. Prøv igen om lidt.",
  },
  ai: {
    policyBlocked:
      "Stoppet af Interlects regler for datasikkerhed: AI-modellen opfylder ikke kravet om nul datalagring (ZDR). Intet blev sendt. Giv Interlect besked, så vi kan rette det.",
    unknownModel:
      "AI-modellen er ikke godkendt til Interlects datasikkerhed (ZDR-tabellen). Kaldet er stoppet.",
    trainingNotExcluded:
      "AI-modellen kan ikke garantere, at data ikke bruges til træning. Kaldet er stoppet.",
    searchModelRequired:
      "Kun søgemodeller må kaldes uden nul datalagring (ZDR); modellen er ikke en søgemodel. Kaldet er stoppet.",
    confidentialToSearch:
      "Fortroligt indhold må ikke sendes til søgemodellen, som ikke har nul datalagring (ZDR). Kaldet er stoppet.",
    zdrUnavailable:
      "AI-modellen kan ikke køres med nul datalagring (ZDR), så fortroligt indhold sendes ikke. Kaldet er stoppet.",
    maskingNotReady:
      "Maskeringen af personoplysninger kunne ikke forberedes, så intet blev sendt til AI-modellen. Prøv igen om lidt.",
    filesNotMasked:
      "Filer (billeder, PDF) kan ikke maskeres for personoplysninger og sendes ikke til AI-modellen. Send den udtrukne tekst i stedet.",
    unknownPart: 'Maskeringen kender ikke beskeddelen "{kind}". Kaldet er stoppet.',
    noDataRules: "AI-kaldet mangler Interlects dataregler (aiGatewayOptions). Kaldet er stoppet.",
    noZdr: "AI-kaldet mangler nul datalagring (ZDR), som er slået til. Kaldet er stoppet.",
    notMasked:
      "AI-kaldet går uden om maskeringen af personoplysninger (brug maskedModel). Kaldet er stoppet.",
    fieldNotMasked: "Feltet {field} kan ikke maskeres.",
    streamNotRestored: "Et streamet svar kan ikke oversættes tilbage.",
    messageFieldNotMasked: "Beskedfeltet {field} kan ikke maskeres.",
    messageNotReadable: "Beskeden til AI-modellen kan ikke læses af maskeringen.",
  },
  overview: {
    notLoaded: "Overblikket kunne ikke hentes.",
    runsNotLoaded: "Kørslerne kunne ikke hentes.",
    tasksNotLoaded: "Tasks kunne ikke hentes.",
  },
  preferences: {
    notLoaded: "Dine visningsvalg kunne ikke hentes.",
    notSaved: "Dit visningsvalg kunne ikke gemmes.",
  },
  /** The database's own refusals (raised with P0001), in words without "fond". */
  dbRefusals: {
    activeSetupNotFound: "Den aktive opsætning blev ikke fundet.",
    adminEditsSetup: "Kun en administrator kan redigere teamopsætningen.",
    adminOrPartnerEditsSetup: "Kun en administrator eller partner kan redigere teamopsætningen.",
    adminOrLeadEditsSetup: "Kun en Admin eller Lead kan redigere teamopsætningen.",
    teamNameMissing: "Teamets navn mangler.",
    caseNotInTeam: "Casen blev ikke fundet i det valgte team.",
    publishedUnchangeable: "En udgivet version af opsætningen kan ikke ændres.",
    teamNotFound: "Teamet blev ikke fundet.",
    unknownSetupVersion: "Ukendt version af opsætningen.",
    capitalPositive: "Investeringskapitalen skal være et tal større end 0.",
    setupNoMandate: "Opsætningen mangler mandat.",
    lastAdmin: "Teamet skal altid have mindst én aktiv administrator.",
    ticketAboveCapital: "En ticket kan ikke være større end investeringskapitalen.",
    adminPublishes: "Kun en administrator kan udgive opsætningen.",
    adminActivates: "Kun en administrator kan aktivere opsætningen.",
    activeReplacedByVersion: "En aktiv opsætning kan kun afløses af en ny version.",
    setupUnavailable: "Den valgte opsætning er ikke tilgængelig.",
    teamUnavailable: "Det valgte team er ikke tilgængeligt.",
  },
  system: {
    technical:
      "Der opstod en teknisk fejl på serveren. Prøv igen om lidt, eller kontakt support hvis det fortsætter.",
  },
};
