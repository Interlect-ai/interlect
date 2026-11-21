/** English texts the server sends about the committee memo; same keys as `da/memoServer.ts`. */
export const memoServer = {
  notLoaded: "The committee memo could not be loaded.",
  notSaved: "The committee memo could not be saved.",
  busy: "Someone else saved the committee memo at the same moment. Try again.",
  notFound: "The case was not found in the team.",
  writeOnly: "Only an Admin, Lead or Member can write in the committee memo.",
  rationaleTooLong: "The rationale is too long (at most 8,000 characters).",
  beliefCommentsInvalid:
    "The comments on the thesis could not be saved. Each comment can be at most 2,000 characters.",
  gapKeyInvalid: "The gap was not recognised.",
  gapStateInvalid: "Choose Fill in or Not needed.",
  reasonTooShort: "Write a reason of at least 10 characters.",
  gapReasonTooLong: "The reason is too long (at most 2,000 characters).",
  analysisNotOnCase: "The analysis does not belong to the case.",
  analysisNotComplete: "The memo can be made once the deep analysis is complete.",
  sectionsInvalid: "The memo's sections could not be saved.",
  versionNotFound: "The memo version was not found.",
  alreadyApproved: "The memo has already been approved.",
  frozen: "An approved memo cannot be changed.",
  rationaleMissing: "Write why you recommend the case before the memo is made.",
} as const;
