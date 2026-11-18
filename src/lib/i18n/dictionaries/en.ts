import type { Dictionary } from "../translate";
import { basis } from "./en/basis.ts";
import { cases } from "./en/cases.ts";
import { overview } from "./en/overview.ts";
import { shell } from "./en/shell.ts";
import { caseView } from "./en/caseView.ts";
import { screening } from "./en/screening.ts";
import { deep } from "./en/deep.ts";
import { finance } from "./en/finance.ts";
import { intake } from "./en/intake.ts";
import { fundSetup } from "./en/fundSetup.ts";
import { fundEditor } from "./en/fundEditor.ts";
import { specialists } from "./en/specialists.ts";
import { thesis } from "./en/thesis.ts";
import { brainChat } from "./en/brainChat.ts";
import { brainKnowledge } from "./en/brainKnowledge.ts";
import { users } from "./en/users.ts";
import { security } from "./en/security.ts";
import { auth } from "./en/auth.ts";
import { system } from "./en/system.ts";
import { tasks } from "./en/tasks.ts";
import { shared } from "./en/shared.ts";
import { charts } from "./en/charts.ts";
import { pages } from "./en/pages.ts";
import { fundServer } from "./en/fundServer.ts";
import { caseServer } from "./en/caseServer.ts";
import { analysisServer } from "./en/analysisServer.ts";
import { brainServer } from "./en/brainServer.ts";
import { appServer } from "./en/appServer.ts";

/**
 * The English dictionary: the same keys as `da.ts`, translated (AI-assisted, reviewed page by page;
 * no translation service sees the screen's content).
 */
export const en: Dictionary = {
  shell,
  overview,
  cases,
  basis,
  caseView,
  screening,
  deep,
  finance,
  intake,
  fundSetup,
  fundEditor,
  specialists,
  thesis,
  brainChat,
  brainKnowledge,
  users,
  security,
  auth,
  system,
  tasks,
  shared,
  charts,
  pages,
  fundServer,
  caseServer,
  analysisServer,
  brainServer,
  appServer,
  common: {
    save: "Save",
    cancel: "Cancel",
    close: "Close",
    retry: "Try again",
    loading: "Loading …",
    saving: "Saving …",
    saved: "Saved",
    edit: "Edit",
    back: "Back",
    next: "Next",
    search: "Search",
  },
  nav: {
    overview: "Overview",
    cases: "Cases",
    brain: "Brain",
    createCase: "New case",
    fundSetup: "Team setup",
    users: "Users and access",
    security: "Security and data",
    status: "System status",
  },
  language: {
    label: "Language",
    help: "Applies to the whole team and everything Interlect writes. Brain answers in your language.",
    changed:
      "The language is now {language}. New runs are written in {language}; earlier texts stay as they were written.",
    notSaved: "The language could not be saved. Please try again shortly.",
    readOnly: "Applies to the whole team. Only Admin and Lead can change the language.",
  },
};
