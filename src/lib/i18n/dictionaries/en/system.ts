import type { Dictionary } from "../../translate";

/** English texts for System status: the same keys as `../da/system.ts`. */
export const system: Dictionary["system"] = {
  status: {
    subtitle: "Server status, updated on page load.",
    login: "Sign-in and session",
    database: "Database (cases, teams, analyses)",
    ai: "AI analysis",
    cvr: "Automatic CVR lookup",
    optionalNotSet: "(optional, not set)",
    criticalDown:
      "One or more critical parts of the server are not configured correctly. Contact an Admin.",
  },
  signedOut: "You have been signed out. Please sign in again.",
  actionFailed: "The action could not be completed. Try again.",
};
