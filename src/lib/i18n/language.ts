/**
 * The fund's language: one choice per fund, Dansk or English, and then everything
 * is in that language: the interface and everything AI writes. Brain's chat answers in the
 * language the user writes in. Pure, so the server, the pages and the tests agree.
 */

export const LANGUAGES = ["da", "en"] as const;
export type Language = (typeof LANGUAGES)[number];

/** Danish until a fund chooses English (0085: existing funds and the column default). */
export const DEFAULT_LANGUAGE: Language = "da";

/** The names the choice is shown with, each in its own language (as language pickers do). */
export const LANGUAGE_NAMES: Record<Language, string> = { da: "Dansk", en: "English" };

/** BCP 47 tag for `<html lang>`, `Intl` and the AI's `outputLanguage` field. */
export const LANGUAGE_TAGS: Record<Language, string> = { da: "da-DK", en: "en-GB" };

export function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && (LANGUAGES as readonly string[]).includes(value);
}

/** A stored or sent value as a language; anything unknown (or missing) is Danish. */
export function parseLanguage(value: unknown): Language {
  return isLanguage(value) ? value : DEFAULT_LANGUAGE;
}

/** The language of a fund row as Supabase returns an embedded `funds(...)` (object or list). */
export function fundLanguageOf(
  funds: { language?: unknown } | readonly { language?: unknown }[] | null | undefined,
): Language {
  const fund = Array.isArray(funds) ? funds[0] : funds;
  return parseLanguage((fund as { language?: unknown } | undefined)?.language);
}

/**
 * The language a team must be switched to after it was created, or null when it already has it.
 * A new team starts in the installation's language (0085); the guide on `/fond/ny` is shown in the
 * page's language, and the team gets that one. No wish (an older caller) changes nothing.
 */
export function languageToApply(current: Language, wanted: Language | undefined): Language | null {
  return wanted !== undefined && wanted !== current ? wanted : null;
}
