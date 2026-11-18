/**
 * What the AI is told about the fund's language. The prompts stay as they are
 * (screening and deep analysis are written in Danish, Brain's in English); only the language the
 * answer must be written in follows the fund. A Danish fund gets exactly the prompts it got
 * before this ticket, so its runs and eval baselines are unchanged.
 */
import { LANGUAGE_TAGS, type Language } from "./language.ts";

/** Words for a prompt written in Danish ("skriv på dansk", "en kort, professionel dansk titel"). */
export interface DanishPromptWords {
  /** "dansk" | "engelsk" */
  name: string;
  /** The other language: "engelsk" | "dansk". */
  other: string;
  /** Plural adjective of the other language, for "engelske kilder" / "danske kilder". */
  otherPlural: string;
}

export function danishPromptWords(language: Language): DanishPromptWords {
  return language === "en"
    ? { name: "engelsk", other: "dansk", otherPlural: "danske" }
    : { name: "dansk", other: "engelsk", otherPlural: "engelske" };
}

/**
 * The models write "fonden"/"the fund" on their own (common venture language), also when
 * the prompt never does, so the prompts say it outright. The only place the word stands in a
 * prompt; the guard test in team-words.test.ts leaves these two out.
 */
// i18n-keep: a rule in the Danish analysis prompts, never shown to the person.
export const TEAM_WORD_RULE_DA =
  'Kald aldrig kunden "fonden" eller "fondens" i teksten: skriv "investeringsteamet", "investeringsteamets" eller "investeringstesen" (fx "uden for investeringstesens stadier", "investeringsteamets mandat"); selskabets eget team er "founderteamet". "Fund" i betydningen fundne ting er fint.';
export const TEAM_WORD_RULE_EN =
  'Never call the customer "the fund" (in Danish "fonden"/"fondens"): write "the team", "the team\'s" or "the investment thesis" (in Danish "investeringsteamet", "investeringsteamets", "investeringstesen"; the company\'s own team is "founderteamet").';

/** The language's name in an English prompt ("Write in Danish" / "Write in English"). */
export function englishPromptLanguageName(language: Language): "Danish" | "English" {
  return language === "en" ? "English" : "Danish";
}

/** The `outputLanguage` field the analysis prompts send with their JSON input. */
export function outputLanguageTag(language: Language): string {
  return LANGUAGE_TAGS[language];
}

/**
 * The closing rule for a fund that writes in English. Empty for Danish, so the Danish prompts are
 * unchanged. Stated last and in English, because the instructions above it are partly Danish and
 * name fixed Danish phrases ("Ikke oplyst i materialet.") that must follow the language too.
 */
export function outputLanguageDirective(language: Language): string {
  if (language !== "en") return "";
  return `

OUTPUT LANGUAGE: ENGLISH. The team works in English. Write every piece of user-facing free text in your answer in clear, professional British English, even though some of the instructions above are written in Danish: verdicts, rationales, findings, risks and their titles, mitigations, strengths, weaknesses, unknowns, questions, next steps, summaries and assessments. Where the instructions above name a fixed Danish phrase, write its English meaning instead (for example "Ikke oplyst i materialet." becomes "Not stated in the material."). Translate the meaning of Danish or other non-English sources into English without changing it. ${TEAM_WORD_RULE_EN} Keep JSON keys, enum values, evidence ids, criterion and gate keys, numbers, currencies and proper names exactly as given.`;
}
