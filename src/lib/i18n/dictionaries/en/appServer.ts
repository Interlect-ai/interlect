/** English texts the server sends about access, credits, the AI data rules and more; same keys as `da/appServer.ts`. */
export const appServer = {
  access: {
    membersNotLoaded: "The member list could not be loaded. Please try again shortly.",
    invitationsNotLoaded: "The invitations could not be loaded.",
    auditNotLoaded: "The audit log could not be loaded.",
    ownRoles: "You cannot change your own roles.",
    roleNotChanged: "The role could not be changed. Please try again shortly.",
    ownAccess: "You cannot change your own access.",
    accessNotChanged: "The access could not be changed. Please try again shortly.",
    lastAdmin: "The team must have at least one active admin.",
    lastAdminRollback: "The change was rolled back: the team must have at least one Admin.",
    seatsNotCounted: "The seats could not be counted. Please try again shortly.",
    adminsNotLoaded: "The admins could not be loaded.",
    settingNotSaved: "The setting could not be saved.",
    accessNotChecked: "Your access could not be checked. Please try again shortly.",
    noMembership: "You do not have an active membership in the selected team.",
    forbidden: "You do not have permission for this action.",
    auditNotWritten: "The action was refused: the audit event could not be written.",
    roleHalfChanged: "The role was only partly changed. Check the person's role and try again.",
    roleRequired: "A membership must have at least one role.",
    ownMfa: "You cannot reset your own two-step sign-in here.",
    mfaOtherTeam:
      "This person also has access to a team you are not an admin of. An admin there must reset the two-step sign-in.",
    mfaNotReset: "Two-step sign-in could not be reset. Please try again shortly.",
    ownPasswordReset: "You cannot make a password link for yourself here.",
    passwordResetOtherTeam:
      "The person also has access to a team you are not an admin of. An admin there must make the link.",
    passwordResetNotCreated: "The link could not be made. Please try again shortly.",
    passwordResetDeactivated: "The person is deactivated. Activate them first.",
    passwordResetNotSet:
      "The password could not be saved, and the link is not used. Please try again.",
    unknownMembership: "Unknown membership.",
  },
  invitations: {
    notCreated: "The invitation could not be created.",
    tooManyPending: "There are too many pending invitations. Revoke some before you send more.",
    deactivated:
      "This person already has deactivated access to the investment thesis. Reactivate them under Users instead of sending a new invitation.",
    alreadyActive: "This person already has active access to the investment thesis.",
    seatsFull: "All seats are in use. Deactivate a member or invite them as a reader.",
    seatsFullCount: "All {limit} seats are in use. Deactivate a member or invite them as a reader.",
    readersFullCount: "All {limit} reader seats are in use.",
    unknown: "Unknown invitation.",
    alreadyUsed: "The invitation has already been used.",
    notRevoked: "The invitation could not be revoked.",
    profileNotCreated: "The profile could not be created.",
    membershipNotCreated: "The membership could not be created.",
    rolesNotGranted: "The roles could not be assigned.",
  },
  workflow: {
    forbiddenActor:
      "Only an authorised person can move the investment process. PAP must never do it.",
    forbiddenRole: "Your role cannot move the case to a new process stage.",
    invalidTransition: "The move is not allowed from the current process stage.",
    reasonRequired: "A written reason is required.",
  },
  credits: {
    exhausted: "Top up to run more analyses.",
    monthlyLimit:
      "Your team's monthly limit for analyses has been reached. An Admin or Lead can raise it under Analysis limits.",
    helperExhausted: "The balance is used up. Top up to use the AI help.",
    notReserved: "The credits could not be reserved. Try again shortly.",
    monthNotRead: "The team's monthly usage could not be read. Try again shortly.",
    ledgerTooLong: "The credit ledger is too long to add up.",
    meterNotLoaded: "The credits could not be loaded. Please try again shortly.",
    mailSubject: "[Interlect · Top up] {fund}",
    mailGreeting: "Hi Interlect,",
    mailRequest: "We would like to top up our AI credits.",
    mailFund: "Team: {fund}",
    mailBalance: "Balance now: {balance}",
    mailAmount: "Amount we want to top up with: [enter amount]",
  },
  aiLimits: {
    user: "You have reached the limit of {count} {what} an hour. Try again shortly.",
    team: "The team has reached the limit of {count} {what} an hour. Try again shortly.",
    screening: "screenings",
    deepAnalysis: "deep analyses",
    helper: "AI help calls",
    notChecked: "The AI use could not be checked right now. Try again shortly.",
  },
  ai: {
    policyBlocked:
      "Stopped by Interlect's data security rules: the AI model does not meet the zero data retention (ZDR) requirement. Nothing was sent. Let Interlect know so we can fix it.",
    unknownModel:
      "The AI model is not approved for Interlect's data security (the ZDR table). The call was stopped.",
    trainingNotExcluded:
      "The AI model cannot guarantee that data is not used for training. The call was stopped.",
    searchModelRequired:
      "Only search models may be called without zero data retention (ZDR); the model is not a search model. The call was stopped.",
    confidentialToSearch:
      "Confidential content must not be sent to the search model, which does not have zero data retention (ZDR). The call was stopped.",
    zdrUnavailable:
      "The AI model cannot run with zero data retention (ZDR), so confidential content is not sent. The call was stopped.",
    maskingNotReady:
      "The masking of personal data could not be prepared, so nothing was sent to the AI model. Please try again shortly.",
    filesNotMasked:
      "Files (images, PDF) cannot be masked for personal data and are not sent to the AI model. Send the extracted text instead.",
    unknownPart: 'The masking does not know the message part "{kind}". The call was stopped.',
    noDataRules:
      "The AI call lacks Interlect's data rules (aiGatewayOptions). The call was stopped.",
    noZdr:
      "The AI call lacks zero data retention (ZDR), which is switched on. The call was stopped.",
    notMasked:
      "The AI call goes around the masking of personal data (use maskedModel). The call was stopped.",
    fieldNotMasked: "The field {field} cannot be masked.",
    streamNotRestored: "A streamed answer cannot be translated back.",
    messageFieldNotMasked: "The message field {field} cannot be masked.",
    messageNotReadable: "The message to the AI model cannot be read by the masking.",
  },
  overview: {
    notLoaded: "The overview could not be loaded.",
    runsNotLoaded: "The runs could not be loaded.",
    tasksNotLoaded: "The tasks could not be loaded.",
  },
  preferences: {
    notLoaded: "Your display choices could not be loaded.",
    notSaved: "Your display choice could not be saved.",
  },
  dbRefusals: {
    activeSetupNotFound: "The active setup was not found.",
    adminEditsSetup: "Only an administrator can edit the team setup.",
    adminOrPartnerEditsSetup: "Only an administrator or partner can edit the team setup.",
    adminOrLeadEditsSetup: "Only an Admin or Lead can edit the team setup.",
    roleCannotPublishSetup: "Your role cannot publish the team setup.",
    teamNameMissing: "The team's name is missing.",
    caseNotInTeam: "The case was not found in the selected team.",
    publishedUnchangeable: "A published version of the setup cannot be changed.",
    teamNotFound: "The team was not found.",
    unknownSetupVersion: "Unknown version of the setup.",
    capitalPositive: "The investable capital must be a number greater than 0.",
    setupNoMandate: "The setup has no mandate.",
    lastAdmin: "The team must always have at least one active administrator.",
    ticketAboveCapital: "A ticket cannot be larger than the investable capital.",
    adminPublishes: "Only an administrator can publish the setup.",
    adminActivates: "Only an administrator can activate the setup.",
    activeReplacedByVersion: "An active setup can only be replaced by a new version.",
    setupUnavailable: "The selected setup is not available.",
    teamUnavailable: "The selected team is not available.",
  },
  system: {
    technical:
      "A technical error occurred on the server. Please try again shortly, or contact support if it continues.",
  },
};
