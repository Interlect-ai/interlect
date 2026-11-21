/**
 * Classification of every server function for the e2e paid-call guard (tests/e2e/lib.ts).
 *
 * PAID: starts an AI Gateway / Sonar / embedding run or a queue job that does. Blocked in the
 * browser unless E2E_ALLOW_PAID=1 (or listed in E2E_ALLOW_FUNCTIONS for one named call).
 * SAFE: reviewed, costs nothing. Anything NOT in either list is blocked (fail closed), and
 * server-fn-guard.test.ts fails when a new `createServerFn` export is in neither list, so a new
 * paid function can never slip past unnoticed.
 * Case capture to Brain counts as SAFE (addCaseNote, saveBrainAnswerAsNote, extractPitchDeck,
 * fetchCompanyFinancials, undoCaseTransitions ...): with BRAIN_ENABLED it queues an L0 embedding
 * and an L1 extraction (a small model call), capped by the fund's Brain budget and part of normal
 * case handling. saveHistoricalInvestment's single embedding counts as SAFE for the same reason.
 * Names are bare export names, so the test also fails when two files export the same name
 * (except the reviewed ones in SHARED_NAMES): a new paid function cannot hide behind a safe name.
 */
export const PAID_FUNCTIONS: ReadonlySet<string> = new Set([
  "runInitialScreening",
  "approveAndRunDeepAnalysis",
  "createManualCase",
  "findCompanyCandidates",
  "analyzeFundDocument",
  "proposeResearchStrategy",
  "proposeCriterionDescription",
  "proposeConfigChange",
  "proposeModulePromptOverride",
  "askThesisStep",
  // The Interlect-Assistent in Teamopsætning (gpt-5.4-mini, capped at 0.06 USD per answer).
  "askSetupAssistant",
  // The committee memo's AI draft (gpt-5.4, at most two calls of 0.12 USD).
  "draftMemoWithAi",
  "proposeBrainWebQueries",
  "findFieldWithBrain",
  "approveBrainIngest",
  "retryBrainIngest",
  "submitBrainText",
  "forgetBrainPerson",
  "completeBrainUpload",
  "commitHistoryImport",
  // Reads the fund's website (no AI, but outbound requests) and imports decisions.
  "submitBrainWebsite",
  "confirmWebsitePortfolio",
  // The AI help for the fund's own specialists (draft and check with gpt-5.4, and a trial
  // run that is one paid specialist call).
  "draftCustomSpecialist",
  "checkCustomSpecialist",
  "trialRunCustomSpecialist",
  // The quality check of the fund's whole screening (one gpt-5.4 call).
  "checkScreeningSetup",
  // The trial run of the draft's screening on a screened case (one fund-fit call).
  "trialRunScreening",
]);

/** Export names that exist in more than one file, each reviewed as having the same class. */
export const SHARED_NAMES: ReadonlySet<string> = new Set(["listReasonCodes"]);

export const SAFE_FUNCTIONS: ReadonlySet<string> = new Set([
  // Self-host demo data (0900): whether a fund has it, and deleting it (no AI call).
  "getDemoDataStatus",
  "deleteDemoData",
  // Reads where a person appears (no AI call, no change).
  "previewForgetBrainPerson",
  "getStatus",
  // Whether the internal pages exist here (reads the environment only).
  "getInternalPagesEnabled",
  // The fund's set of specialists in a draft (database only, no AI call).
  "getFundSpecialists",
  "setStandardSpecialist",
  "saveCustomSpecialist",
  "setCustomSpecialistEnabled",
  "deleteCustomSpecialist",
  // The cases a trial run can use (database only).
  "listSpecialistTrialCases",
  // The fund's own screening instruction and extra cards in a draft (database only).
  "saveFundScreeningSetup",
  "acceptInvitationAsExistingUser",
  "acceptInvitationAsNewUser",
  "addCaseNote",
  "addFundSuggestion",
  "answerCaseTask",
  "applyConfigProposal",
  "captureCompanyWebsite",
  "completePasswordReset",
  "createCaseTask",
  "createFund",
  "createFundConfigDraft",
  "createInvitation",
  "createPasswordReset",
  "deleteBrainThread",
  "deleteCaseMessage",
  "deleteCaseTask",
  "deleteFinancialInput",
  "deleteFund",
  "deleteHistoricalInvestment",
  "editCaseMessage",
  "extractPitchDeck",
  "fetchCompanyFinancials",
  "fetchForeignCompanyFinancials",
  "findExistingCases",
  "findScreeningRun",
  "forgetBrainSource",
  // Removes an upload nobody approved (row and file; no AI call, no queue).
  "discardBrainUpload",
  "getBrainCapabilities",
  "getBrainCasePanel",
  "getBrainGraph",
  "getBrainCard",
  "getBrainLearned",
  "getBrainPlaybook",
  "getBrainLessonWhy",
  "reviewBrainLesson",
  "reviewBrainInsight",
  "listBrainPages",
  "getBrainPage",
  "editBrainPageSection",
  "getBrainSourceDownloadUrl",
  "getBrainThread",
  "getWebsitePortfolio",
  "getCaseDetail",
  "getCaseFileUrl",
  "getCaseStatusLine",
  "getCreditMeter",
  "getFundAdminNames",
  "getFundAiSettings",
  "getFundAnalysisLimits",
  "getFundConfigs",
  "getHiddenSections",
  "getIntakeCapabilities",
  "getIntakeMandate",
  "getMyAccess",
  "getOverviewRunning",
  "getOverviewSnapshot",
  "getPublicAppConfig",
  "getSeatUsage",
  "getSecurityPosture",
  "listAuditEvents",
  "listBrainSources",
  "listBrainThreads",
  "listCaseFiles",
  "listCaseMessages",
  "listCaseNotes",
  "listCaseTasks",
  "listCases",
  "listConfigProposals",
  "listFinancialStatements",
  "saveFinancialInput",
  "acceptFieldProposal",
  "dismissFieldProposal",
  "listFundChangeHistory",
  "listFundConfigVersions",
  // Theses in a team; database writes only, no AI call.
  "listTheses",
  "createThesis",
  "renameThesis",
  "setDefaultThesis",
  "archiveThesis",
  "reactivateThesis",
  // The committee memo's stored data; database reads and writes only, no AI call.
  "getCaseMemo",
  "saveMemoInput",
  "answerMemoGap",
  "createMemoDraft",
  "approveMemoVersion",
  "listFundOpenTasks",
  "listFundSuggestions",
  "listHistoricalInvestments",
  "listInvitations",
  "listMemberFunds",
  "listMembers",
  "listPitchDecks",
  "listReasonCodes",
  "listRescreenCandidates",
  "listTaskAssignees",
  "loadStandardModuleText",
  "lookupCvrByName",
  "mergeBrainEntities",
  "postCaseMessage",
  "previewHistoryImport",
  "publishFundConfigDraft",
  "registerCaseFile",
  "registerPitchDeck",
  "rejectConfigProposal",
  "renameBrainThread",
  "requestBrainUpload",
  "resetMemberMfa",
  // An earlier setup version copied into a new draft (database only).
  "restoreFundConfigVersion",
  "resetModulePromptOverride",
  "resetResearchModuleOverride",
  "resolveInvitation",
  "resolvePasswordReset",
  "restoreCaseTask",
  "revokeInvitation",
  "saveBrainAnswerAsNote",
  "saveBrainAnswerToBrain",
  "saveFundConfigDraft",
  "saveHistoricalInvestment",
  "saveModulePromptOverride",
  "saveReasonCode",
  "saveResearchModuleOverrides",
  "searchBrainMentions",
  "setBrainThreadVisibility",
  "setFundLanguage",
  "setFundMemberSettings",
  "setFundSuggestionStatus",
  "setHiddenSections",
  "setIntakeCaseOrigin",
  "setMemberRoles",
  "setMemberStatus",
  "setReasonCodeActive",
  "splitBrainEntity",
  "submitBrainFeedback",
  "transitionCases",
  "undoCaseTransitions",
  "updateCaseTask",
  "updateFundAiSettings",
  "validateFundConfigDraft",
]);

/**
 * API routes (src/routes/api). PAID: answers a signed-in user with a model call; the guard in
 * lib.ts blocks it in the browser unless E2E_ALLOW_PAID=1 (the Brain chat is not a server
 * function, so the server-function guard alone would not see it). OPERATOR: needs CRON_SECRET or
 * is only called by the operator's workflows (/api/health: free, no model call), never from the
 * app in the browser. server-fn-guard.test.ts fails when a route under src/routes/api is in
 * neither list.
 */
export const PAID_API_ROUTES: ReadonlySet<string> = new Set([
  "/api/brain/chat",
  // The setup draft per stage (web research and model calls).
  "/api/fund-setup/draft",
]);

export const OPERATOR_API_ROUTES: ReadonlySet<string> = new Set([
  "/api/brain/backfill",
  "/api/brain/cron",
  "/api/brain/eval",
  "/api/health",
]);
