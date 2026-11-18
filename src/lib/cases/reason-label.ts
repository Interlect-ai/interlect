/**
 * The reasons a case is moved with (brain_reason_codes) are seeded in Danish (0033). A
 * seeded reason that still carries its Danish seed text is shown in the team's language, as Brain
 * tells it; a text the team wrote or changed itself is shown as stored.
 */
import type { Language } from "../i18n/language.ts";
import { translate, type MessageKey } from "../i18n/translate.ts";

export function reasonLabel(code: string, storedLabel: string, language: Language): string {
  const key = `brainServer.chat.reason.${code}` as MessageKey;
  const seedText = translate("da", key);
  // No seed text for the code (a code the team added), or the team changed it.
  if (seedText === key || seedText !== storedLabel) return storedLabel;
  return translate(language, key);
}
