import type { Dictionary } from "../../translate";

/** English texts for the self-host demo data: the same keys as `../da/demoData.ts`. */
export const demoData: Dictionary["demoData"] = {
  banner: {
    title: "Demo data",
    bodyOne:
      "{count} fictional case is shown so every screen has content. No company or person in it is real.",
    bodyMany:
      "{count} fictional cases are shown so every screen has content. No company or person in them is real.",
    bodyLeftover:
      "The fictional cases are deleted, but one last step is missing. Delete demo data again.",
    delete: "Delete demo data",
    confirmTitle: "Delete demo data?",
    confirmBody:
      "The fictional cases and everything on them (analyses, notes, tasks and decisions) are deleted for the whole team. Your own cases are not touched. This cannot be undone.",
    confirm: "Delete demo data",
    deleting: "Deleting",
    deleted: "Demo data deleted",
    failed: "The demo data could not be deleted. Try again.",
  },
  firstCase: {
    title: "Your first case in five steps",
    body: "Interlect screens every case against your investment thesis. To get started:",
    setupTitle: "Finish the investment thesis",
    setupBody: "Review criteria, requirements and threshold in Team setup, and publish the thesis.",
    teamTitle: "Invite your team",
    teamBody: "Give colleagues access under Users and access.",
    createTitle: "Create a case",
    createBody: "A pitch deck, a website or just a name is enough.",
    screenTitle: "Let Interlect screen it",
    screenBody:
      "The screening scores the case against the thesis and shows what needs to be clarified.",
    decideTitle: "Decide the next step",
    decideBody: "Start a deep analysis, put the case on hold or close it.",
    start: "Create case",
  },
  server: {
    statusNotRead: "Could not check whether the team has demo data.",
    notDeleted: "The demo data could not be deleted. Try again.",
  },
};
