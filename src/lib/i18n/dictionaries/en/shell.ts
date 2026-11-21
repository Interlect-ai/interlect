import type { Dictionary } from "../../translate";

/** English texts for the shell group: the same keys as `../da/shell.ts`. */
export const shell: Dictionary["shell"] = {
  root: {
    notFoundTitle: "Page not found",
    notFoundBody: "The page you are looking for does not exist, or it has been moved.",
    goToOverview: "Go to Overview",
    errorTitle: "The page could not be loaded",
    errorBody: "Something went wrong on our side. Try reloading, or go back to Overview.",
  },
  rail: {
    label: "Main navigation",
    pages: "Pages",
    homeLink: "Interlect, to Overview",
    collapse: "Collapse the menu",
    expand: "Expand the menu",
    userMenu: "User menu for {name}",
    you: "you",
    signedIn: "Signed in",
    lightTheme: "Light theme",
    darkTheme: "Dark theme",
    signOut: "Sign out",
    signOutFailed: "You were not signed out. Please try again.",
  },
  roles: {
    admin: "Admin",
    lead: "Lead",
    member: "Member",
    reader: "Reader",
  },
  fund: {
    loadFailed: "The theses could not be loaded",
    reload: "Reload the page",
    none: "No investment thesis yet",
    askAdmin: "Ask an Admin for an invitation",
    choose: "Choose investment thesis",
    noSetup: "Not set up yet",
    thesisVersion: "Thesis v{version}",
    draftVersion: "Draft v{version}",
    demo: "{version}, demo thesis",
    switchLabel: "Active investment thesis: {name}. Switch thesis",
    create: "New investment thesis",
  },
  mobile: {
    openMenu: "Open the menu",
    menu: "Menu",
    closeMenu: "Close the menu",
  },
  session: {
    unconfigured: "Access to Interlect is not configured in this environment. Contact an Admin.",
    checking: "Checking access …",
  },
  states: {
    errorTitle: "Something went wrong",
    errorBody: "We could not load this right now. Please try again shortly.",
    noAccessTitle: "Admins only",
    noAccessBody: "Your role does not give access to this page. Contact an admin if you need it.",
  },
  blocks: {
    loading: "Loading …",
    errorBody: "The data could not be loaded. Please try again.",
    noAccessTitle: "No access",
    noAccessBody: "Your role does not give access to this area. Contact an Admin.",
    notWiredTitle: "{area} is not connected to data yet",
    notWiredBody:
      "This surface is structured, but only shows content once the database and the analysis pipeline are in place. No made-up figures are shown on purpose.",
  },
  dialog: {
    reasonDescription: "The reason is saved in the case's history and used by Brain.",
    cancel: "Cancel",
    maxReasons: "At most {count} reasons",
    fewerReasons: "Fewer reasons",
    moreReasons: "More reasons",
    note: "Note",
  },
  bulk: {
    selected: "{count} selected",
    clear: "Clear selection",
  },
  split: {
    allActions: "All actions",
    idle: "No action in {days} days",
  },
  menu: {
    recommended: "Recommended",
    current: "Current",
  },
  toast: {
    undo: "Undo",
  },
  credit: {
    stoppedTitle: "The balance is used up",
    title: "AI credits",
    loadFailed: "The credits could not be loaded. Please try again shortly.",
    noticeLow:
      "Less than {pct} % is left. Brain pauses its background work until credits are topped up. Analyses and Ask run as normal.",
    noticeEmpty: "Top up to run more analyses. Analyses already running will finish.",
    noticeNotEnforced: "Credits are not switched on yet, so nothing is stopped.",
    askAdmin: "Ask an Admin to top up.",
    balance: "Balance",
    remaining: "left",
    remainingLabel: "Credits left",
    remainingPct: "{pct} % left",
    pool: "of {amount} in this month's pool. Brain pauses at {pct} % left.",
    noCredits: "There are no credits to use yet.",
    usedThisMonth: "Used this month",
    nothingUsed: "Nothing used yet.",
    scopes: {
      analysis: "Analysis",
      chat: "Ask",
      brain: "Brain",
    },
    scopeHints: {
      analysis: "Screenings and deep analyses",
      chat: "Questions to Interlect and help with the setup",
      brain: "In the background: reads files, learns from decisions",
    },
    topUp: "Top up",
    requestDescription: "Send a request and Interlect will add credits.",
    paymentNotSetUp: "Payment is not set up for your installation yet.",
    sendRequest: "Send request",
    mailBody:
      "Your mail app opens with a ready message; you only need to add the amount and send it. Runs already in progress always finish.",
    writeToUs:
      "Write to Interlect and we will add credits. Runs already in progress always finish.",
  },
};
