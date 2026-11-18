/**
 * The history line in the case's status menu (CaseStatus: "Sat på hold i dag af Maja Holm:
 * Venter på data"). Pure, so the wording is unit-tested.
 */
import type { CaseStatusLine } from "./transitions.functions";
import { translate, type MessageKey } from "../i18n/translate.ts";
import { LANGUAGE_TAGS, type Language } from "../i18n/language.ts";

export function whenText(iso: string, now = new Date(), language: Language = "da"): string {
  const date = new Date(iso);
  const day = (value: Date) =>
    new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const diff = Math.round((day(now) - day(date)) / 86_400_000);
  if (diff === 0) return translate(language, "cases.history.today");
  if (diff === 1) return translate(language, "cases.history.yesterday");
  // "18. sep." → "18. sep" (Intl ends abbreviated months with a period).
  return date
    .toLocaleDateString(LANGUAGE_TAGS[language], { day: "numeric", month: "short" })
    .replace(/\.$/, "");
}

/** The verb for the latest move: the status verb only when the move changed the status. */
function moveVerb(last: NonNullable<CaseStatusLine["last"]>): MessageKey {
  // SQL logs field "status" when both change; a move to a new phase while becoming active
  // (e.g. Send til komité from På hold) is named by the phase (harden N4). Leaving Besluttet
  // is always Genåbn, whichever phase the case returns to (harden F1).
  const phaseMoved =
    last.fromPhase !== null &&
    last.toPhase !== null &&
    last.fromPhase !== last.toPhase &&
    last.fromPhase !== "decided";
  if (last.field === "status" && !(last.toStatus === "active" && phaseMoved)) {
    switch (last.toStatus) {
      case "on_hold":
        return "cases.history.onHold";
      case "closed":
        return "cases.history.closed";
      case "invested":
        return "cases.history.invested";
      default:
        return last.fromStatus === "on_hold" ? "cases.history.resumed" : "cases.history.reopened";
    }
  }
  if (last.toPhase === "committee") return "cases.history.toCommittee";
  if (last.toPhase === "deep_analysis") return "cases.history.toDeep";
  return "cases.history.toScreening";
}

/** "Sat på hold i dag af Maja Holm: Venter på data" (CaseStatus history line). */
export function historyText(
  line: CaseStatusLine | undefined,
  language: Language = "da",
): string | null {
  if (!line) return null;
  const t = (key: MessageKey, vars?: Record<string, string>) => translate(language, key, vars);
  const when = (iso: string) => whenText(iso, new Date(), language);
  const last = line.last;
  if (!last) {
    return line.createdByName
      ? t("cases.history.createdBy", { when: when(line.createdAt), name: line.createdByName })
      : t("cases.history.created", { when: when(line.createdAt) });
  }
  const who =
    last.actorName ?? (last.actorType === "user" ? t("cases.history.teamMember") : "Interlect");
  if (last.undone) return t("cases.history.undone", { when: when(last.occurredAt), who });
  const why = [...last.reasons, last.note?.trim()].filter(Boolean).join(", ");
  const vars = { verb: t(moveVerb(last)), when: when(last.occurredAt), who };
  return why ? t("cases.history.movedWhy", { ...vars, why }) : t("cases.history.moved", vars);
}
