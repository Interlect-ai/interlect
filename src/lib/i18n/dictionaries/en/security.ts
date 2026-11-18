import type { Dictionary } from "../../translate";

/** English texts for Security and data: the same keys as `../da/security.ts`, name-free. */
export const security: Dictionary["security"] = {
  page: {
    title: "Security and data",
    description: "Transparent, not just secure: how your data is handled today",
    loadingAccess: "Loading access …",
    noAccess: "You do not have access to an investment thesis yet. Contact an Admin.",
    adminOnly: "Only an Admin can see the security and data overview.",
  },
  built: {
    title: "How it is built today",
    rls: "Data is separated per investment thesis by database rules (RLS): no one can see another investment thesis's cases, even on shared infrastructure.",
    storage: "Pitch decks are kept in private storage, never publicly accessible.",
    encryption:
      "Data is encrypted at rest and in transit, and access requires an invitation from an Admin. There is no public sign-up.",
    audit: "Every administrative change is written to an audit log that cannot be altered.",
    region:
      "The database is in the EU. All your structured data, documents and logins are stored within the EU.",
    noAutoDelete:
      'Nothing fetched or written in Interlect is deleted automatically. Knowledge is only removed when you choose "Forget source" or "Forget person" in Brain.',
    forgetPerson:
      'An Admin can forget a person (the data subject\'s right): open the person in Brain and choose "Forget person". Their facts and page are deleted, the name is removed everywhere in your data, and files that name the person can be deleted too. The audit log records it without the name.',
  },
  ai: {
    title: "What is sent to AI",
    intro:
      "Interlect distinguishes between two kinds of AI calls. Neither is used to train AI: every call forbids it.",
    confidentialTitle: "Confidential material",
    confidentialBody:
      "Decks, notes, memos, decisions, financial statements and your investment thesis are only sent to AI with zero data retention: nothing is kept once the answer is given. Personal data that is not needed is first replaced by placeholders (masking), and the answer is translated back on our side.",
    zdrOn: "Enforced for every call.",
    zdrOff: "Not switched on yet in your installation; until then the calls run without this lock.",
    publicTitle: "Public web searches",
    publicBody:
      "Research and web search use a search engine without zero data retention. So only public search terms are sent: the company's name, domain, registration number and founders, plus short public claims. Your investment thesis, weights, thresholds, risk profile and internal notes are never sent. The result is stored with you as a source.",
    regionTitle: "Region",
    regionBody:
      "Where possible, the AI calls are locked to the EU. Where not, we would rather have zero data retention than the EU without it.",
    euOn: "EU locking is switched on where possible.",
    euOff: "EU locking is not switched on today.",
  },
  processors: {
    title: "Who sees your data",
    body: "Interlect runs on a few subprocessors for database, hosting and AI. They are listed in the data processing agreement, and none of them gets access to data from investment theses other than your own.",
  },
  retention: {
    title: "How long it is kept",
    aiLog:
      "The AI log (what was sent to AI) is kept for 90 days. After that the text is deleted and only figures and the time remain.",
    searchLog: "Brain's search log is kept for 180 days.",
    chats:
      "Conversations in Brain are deleted after 24 months of inactivity. Everything else is kept until you delete it.",
  },
  forget: {
    title: "Right to be forgotten",
    body: "At any time you can have a source, a person, a case, a company or an entire investment thesis permanently deleted, not just hidden. Contact your Admin or Interlect directly; we confirm the deletion in writing.",
  },
};
