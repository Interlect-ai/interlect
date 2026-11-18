/**
 * Is this error one of the server's own refusals? The server writes its sentences in the team's
 * language, so the UI recognises them in both languages by dictionary key instead of matching a
 * Danish word. Never shown as such: the page shows its own state for the refusal.
 */
import { LANGUAGES } from "../i18n/language.ts";
import { translate, type MessageKey } from "../i18n/translate.ts";

export function isServerRefusal(cause: unknown, ...keys: MessageKey[]): boolean {
  const message = cause instanceof Error ? cause.message.trim() : "";
  if (!message) return false;
  return keys.some((key) => LANGUAGES.some((language) => translate(language, key) === message));
}
