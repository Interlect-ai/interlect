/**
 * (TS-6): the core of "Få hjælp af Interlect" in Ny investeringstese, shared by the server
 * function (`askThesisStep`) and the paid proof (`scripts/thesis-suggest-eval.ts`), so the proof
 * runs exactly the product's code.
 *
 * 1. The grounding is checked first (`assessGrounding`): too little to build on gives "not found"
 *    without a model call, never a guess or an empty template.
 * 2. The answer is checked (`checkSuggestion`): a placeholder, or a figure or currency the user has
 *    not written, is rejected; the model gets one more try with the reason, then "not found".
 * The team's text is cleaned like all other team text and stays data in the user message.
 *
 * (TS-7): an address in the question is read with the SSRF-safe fetching (the address and at
 * most five subpages on the same site, `readLinkedSite`). The site's text is untrusted input: it is
 * cleaned like team text, stands as data ("website") in the user message, is never stored, and its
 * figures count as written only because the site states them. With a site the call uses a stronger
 * model than the cheap one, capped at `THESIS_LINK_BUDGET_USD` per call. The answer says what was
 * read (`read`), so the page can show "Læste: adresse og undersider".
 */
import { cleanTeamText } from "@/lib/analysis/team-text";
import { loadFundLanguage } from "@/lib/i18n/fund-language.server";
import { serverText } from "@/lib/i18n/server-text";
import { getServiceClient } from "@/lib/supabase/admin.server";
import type { PricedModel } from "@/lib/analysis/budgets";
import { callCheapGateway } from "./cheap-gateway.server";
import { readLinkedSite, type LinkedSite } from "./thesis-link.server";
import { amountSentences, findLink, siteHasText, withoutLink } from "./thesis-link";
import {
  assessGrounding,
  checkSuggestion,
  clipContext,
  retryNote,
  thesisStepSystemPrompt,
  type SuggestionBasis,
  type SuggestionProblem,
  type ThesisStep,
} from "./thesis-steps";
import { isPresetQuestion } from "./thesis-wizard";

/**
 * Each model call may cost at most this (about 0.15 kr); a rejected answer gets one more try, so
 * one answer costs at most twice this.
 */
export const THESIS_CHAT_BUDGET_USD = 0.03;

/**
 * With the team's website the call uses a stronger model, capped
 * at 0.22 USD per attempt; a rejected answer gets one more try, so one answer costs at most
 * 0.44 USD (about 2.85 kr., under the 3 kr. per call he set).
 */
export const THESIS_LINK_MODEL: PricedModel = "openai/gpt-5.4";
export const THESIS_LINK_BUDGET_USD = 0.22;

export interface ThesisStepAnswer {
  answer: string;
  /** "not_found": too little to build on, or the answer kept inventing figures. */
  status: "ok" | "not_found";
  /** Why "not_found": nothing to build on, or the model could not answer without guessing. */
  reason?: "no_grounding" | "rejected";
  /** What the answer builds on, for the line "Bygger på: …". */
  basis: SuggestionBasis[];
  /**
   * The address in the question and the pages read on it ("Læste: adresse og undersider").
   * Absent when the question has no address. "refused"/"failed": the site was not read, and the
   * answer builds only on what the user wrote.
   */
  read?: { url: string; status: LinkedSite["status"]; pages: string[] };
}

/** For the proof: what happened on the way (never shown to the person). */
export interface ThesisStepTrace {
  modelCalls: number;
  costUsd: number;
  rejected: SuggestionProblem[];
  /** The pages read and how much text each gave. */
  pages?: Array<{ url: string; chars: number }>;
}

export async function suggestForStep(input: {
  fundId: string;
  credits: { userId: string; loop: string } | "reserved_by_caller";
  step: ThesisStep;
  question: string;
  context: Record<string, string>;
  trace?: ThesisStepTrace;
  /** For tests and the proof: reads the site instead of `readLinkedSite`. */
  readSite?: (address: string) => Promise<LinkedSite>;
}): Promise<ThesisStepAnswer> {
  const presetQuestion = isPresetQuestion(input.question);
  const question = cleanTeamText(input.question);
  // The address the user wrote is read; the address alone is no grounding.
  const link = presetQuestion ? null : findLink(question);
  const site = link ? await (input.readSite ?? readLinkedSite)(link) : null;
  const pages = (site?.pages ?? []).map((page) => ({
    url: page.url,
    title: cleanTeamText(page.title),
    text: cleanTeamText(page.text),
  }));
  const website = site?.status === "read" && siteHasText(pages);
  if (input.trace && site) {
    input.trace.pages = pages.map((page) => ({ url: page.url, chars: page.text.length }));
  }
  // A site with almost no text (a cookie wall) counts as not read, so the page and the prompt agree.
  const read = site
    ? {
        url: site.url,
        status: site.status === "read" && !website ? ("failed" as const) : site.status,
        pages: website ? pages.map((page) => page.url) : [],
      }
    : undefined;
  // The step's own field first, so a long earlier step can never clip it away.
  const ordered = Object.entries(input.context).sort(
    ([a], [b]) => Number(b === input.step) - Number(a === input.step),
  );
  const filledInSoFar = Object.fromEntries(
    Object.entries(clipContext(Object.fromEntries(ordered))).map(([key, value]) => [
      key,
      cleanTeamText(value),
    ]),
  );
  const grounding = assessGrounding({
    step: input.step,
    question: withoutLink(question),
    presetQuestion,
    context: filledInSoFar,
    website,
  });
  const notFound = (reason: "no_grounding" | "rejected"): ThesisStepAnswer => ({
    answer: serverText(
      reason === "rejected"
        ? "fundServer.thesisChat.notFoundRejected"
        : "fundServer.thesisChat.notFound",
    ),
    status: "not_found",
    reason,
    basis: grounding.basis,
    ...(read ? { read } : {}),
  });
  // Too little to build on: no model call, no cost.
  if (!grounding.enough) return notFound("no_grounding");

  // The answer is written in the team's language (callCheapGateway adds the same rule).
  const language = await loadFundLanguage(getServiceClient(), input.fundId);
  // The site's own words count as written: a ticket size the site states may be named.
  // Only the site's sentences with an amount or a share count, never its phone or CVR numbers.
  const source = [
    withoutLink(question),
    ...Object.values(filledInSoFar),
    ...(website ? pages.map((page) => amountSentences(page.text)) : []),
  ].join("\n");
  let rejected: string | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { content, costUsd } = await callCheapGateway({
      fundId: input.fundId,
      credits: input.credits,
      system: thesisStepSystemPrompt(input.step, language, {
        website,
        websiteNotRead: !!site && !website,
      }),
      user: JSON.stringify({
        userQuestion: question,
        filledInSoFar,
        ...(website ? { website: { address: site!.url, pages } } : {}),
        ...(site && !website ? { websiteNotRead: site.url } : {}),
        ...(rejected ? { previousAnswerRejected: rejected } : {}),
      }),
      maxOutputTokens: website ? 1_200 : 900,
      budgetUsd: website ? THESIS_LINK_BUDGET_USD : THESIS_CHAT_BUDGET_USD,
      ...(website ? { model: THESIS_LINK_MODEL } : {}),
      // i18n-keep: the call's name in logs and the AI log, not shown to the person.
      label: "Hjælp til tesen",
      timeoutMs: 45_000,
    });
    if (input.trace) {
      input.trace.modelCalls += 1;
      input.trace.costUsd += costUsd ?? 0;
    }
    const answer = content.trim();
    if (!answer) throw new Error(serverText("fundServer.common.aiNoAnswer"));
    const problem = checkSuggestion(answer, source, input.step);
    if (!problem)
      return { answer, status: "ok", basis: grounding.basis, ...(read ? { read } : {}) };
    input.trace?.rejected.push(problem);
    // Only the kind: the found text is the model's, and may repeat the team's words.
    console.warn(`[thesis-suggest] answer rejected (${problem.kind}), attempt ${attempt + 1}`);
    rejected = retryNote(problem, language, website);
  }
  // Still a placeholder or an invented figure after one more try: say so, never show it.
  return notFound("rejected");
}
