/**
 * The language a Brain question is written in, worked out in code, so the answer and its
 * fixed sentences ("Brain doesn't know that yet.") follow the question. Before, the model was told
 * to "answer in the language the user writes in" next to rules quoting Danish sentences, and three
 * of five English questions in the English demo team got Danish answers. A
 * question with no clear signal (a name, a number) gets the team's language.
 */
import type { Language } from "./language.ts";

// i18n-keep: word lists matched against the question, never shown.
const DANISH = new Set(
  "og at det er en den de vi jeg du har hvad hvorfor hvordan hvilke hvilken hvem hvor hvornår ikke med til af på for om som var kan skal vil vores jeres sammenlign venter noget nogen eller men også når fra efter".split(
    " ",
  ),
);
// i18n-keep: word lists matched against the question, never shown.
const ENGLISH = new Set(
  "the and is are was were we you what why how which who where when not with to of on for about as can should will our your compare waiting something anything or but also from after did does do have has right now".split(
    " ",
  ),
);

export function questionLanguage(text: string, fallback: Language): Language {
  const lower = text.toLocaleLowerCase();
  let danish = (lower.match(/[æøå]/g) ?? []).length > 0 ? 2 : 0;
  let english = 0;
  for (const word of lower.match(/\p{L}+/gu) ?? []) {
    if (DANISH.has(word)) danish += 1;
    if (ENGLISH.has(word)) english += 1;
  }
  if (danish === english) return fallback;
  return danish > english ? "da" : "en";
}
