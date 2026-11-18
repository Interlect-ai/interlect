import { translate, type MessageKey } from "../i18n/translate.ts";
import type { Language } from "../i18n/language.ts";

/**
 * "Slå sammen" og "Adskil": the database functions of 0055 refuse a merge or a split
 * with an English message; this turns each into the text a person can act on (Danish by default).
 * Anything unknown is not shown (the caller logs it and shows a generic text).
 */
const REFUSALS: ReadonlyArray<[RegExp, MessageKey]> = [
  [/itself/, "brainKnowledge.merge.itself"],
  [/different types/, "brainKnowledge.merge.differentTypes"],
  [/both entities must be active/, "brainKnowledge.merge.bothActive"],
  [/projected from the database/, "brainKnowledge.merge.projected"],
  [/a fact links the two/, "brainKnowledge.merge.factLinks"],
  [/unknown entity/, "brainKnowledge.merge.unknown"],
  [/not merged/, "brainKnowledge.merge.notMerged"],
  [/no merge in the log/, "brainKnowledge.merge.noMerge"],
  [/masked/, "brainKnowledge.merge.masked"],
  [/merged into another one/, "brainKnowledge.merge.mergedAway"],
  [/undo that first/, "brainKnowledge.merge.undoFirst"],
];

export function mergeRefusalText(message: string, language: Language = "da"): string | null {
  for (const [pattern, key] of REFUSALS) if (pattern.test(message)) return translate(language, key);
  return null;
}
