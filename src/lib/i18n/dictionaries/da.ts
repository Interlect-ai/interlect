/**
 * The Danish dictionary: the source of every interface text. Keys are grouped per page
 * or shared area; `{name}` is filled by `t()`. moves the pages' texts in here one page at
 * a time (`npm run i18n:extract` lists what is left), and `en.ts` must have the same keys
 * (checked by the type and by `dictionaries.test.ts`).
 */
import { basis } from "./da/basis.ts";
import { cases } from "./da/cases.ts";
import { overview } from "./da/overview.ts";
import { shell } from "./da/shell.ts";
import { caseView } from "./da/caseView.ts";
import { screening } from "./da/screening.ts";
import { deep } from "./da/deep.ts";
import { finance } from "./da/finance.ts";
import { intake } from "./da/intake.ts";
import { fundSetup } from "./da/fundSetup.ts";
import { fundEditor } from "./da/fundEditor.ts";
import { specialists } from "./da/specialists.ts";
import { thesis } from "./da/thesis.ts";
import { brainChat } from "./da/brainChat.ts";
import { brainKnowledge } from "./da/brainKnowledge.ts";
import { users } from "./da/users.ts";
import { security } from "./da/security.ts";
import { auth } from "./da/auth.ts";
import { system } from "./da/system.ts";
import { tasks } from "./da/tasks.ts";
import { shared } from "./da/shared.ts";
import { charts } from "./da/charts.ts";
import { pages } from "./da/pages.ts";
import { fundServer } from "./da/fundServer.ts";
import { caseServer } from "./da/caseServer.ts";
import { analysisServer } from "./da/analysisServer.ts";
import { brainServer } from "./da/brainServer.ts";
import { appServer } from "./da/appServer.ts";
import { demoData } from "./da/demoData.ts";
import { thesisServer } from "./da/thesisServer.ts";
import { memoServer } from "./da/memoServer.ts";
import { memo } from "./da/memo.ts";

export const da = {
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
  demoData,
  thesisServer,
  memoServer,
  memo,
  common: {
    save: "Gem",
    cancel: "Annuller",
    close: "Luk",
    retry: "Prøv igen",
    loading: "Henter …",
    saving: "Gemmer …",
    saved: "Gemt",
    edit: "Ret",
    back: "Tilbage",
    next: "Næste",
    search: "Søg",
  },
  nav: {
    overview: "Overblik",
    cases: "Cases",
    brain: "Brain",
    createCase: "Opret case",
    fundSetup: "Teamopsætning",
    users: "Brugere og adgang",
    security: "Sikkerhed og data",
    status: "Systemstatus",
  },
  language: {
    label: "Sprog",
    help: "Gælder hele teamet og alt, Interlect skriver. Brain svarer på jeres sprog.",
    changed:
      "Sproget er nu {language}. Nye kørsler skrives på {language}; tidligere tekster står, som de blev skrevet.",
    notSaved: "Sproget kunne ikke gemmes. Prøv igen om lidt.",
    readOnly: "Gælder hele teamet. Kun Admin og Lead kan ændre sproget.",
  },
} as const;
