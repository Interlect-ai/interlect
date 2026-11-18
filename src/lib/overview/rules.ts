/**
 * Small pure rules the Overblik server functions share, so each is tested without a database.
 */
import { DEFAULT_LANGUAGE, type Language } from "../i18n/language.ts";
import { translate } from "../i18n/translate.ts";
import { copenhagenDate, shiftDate } from "./dates.ts";

/** A run's status in words, for the activity list. Every status the table allows has a word. */
export function runStatusText(status: string, language: Language = DEFAULT_LANGUAGE): string {
  switch (status) {
    case "queued":
      return translate(language, "overview.runStatus.queued");
    case "running":
      return translate(language, "overview.runStatus.running");
    case "complete":
      return translate(language, "overview.runStatus.complete");
    case "failed":
      return translate(language, "overview.runStatus.failed");
    case "awaiting_approval":
      return translate(language, "overview.runStatus.awaitingApproval");
    case "cancelled":
      return translate(language, "overview.runStatus.cancelled");
    default:
      return translate(language, "overview.runStatus.unknown");
  }
}

/** How far back the run read must reach: the 14 activity days (+1 day of margin for the time zone). */
export function runsSince(now: Date): string {
  return `${shiftDate(copenhagenDate(now), -15)}T00:00:00.000Z`;
}
