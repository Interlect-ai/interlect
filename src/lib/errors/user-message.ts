/**
 * Only the server's own Danish sentences reach people; everything else (validation JSON,
 * "Unauthorized", network errors, Postgres and schema messages) gets a calm fallback and is
 * logged for us (learning 29 Sep; harden P 30 Sep). An allowlist, not a denylist: a
 * message must read as Danish and carry no technical tokens. No words that English shares
 * (case, cases, i, en, et, for): "Case not found" and "Access denied for case" must not pass
 * (harden F3, SF5).
 * An English fund's page gets the server's own English sentences: only texts from
 * the dictionary's server groups (`fundServer`, `caseServer` …) that are whole sentences, with
 * their `{name}` filled in.
 */
import type { Language } from "../i18n/language.ts";
import { DICTIONARIES, translate } from "../i18n/translate.ts";
import { dbRefusalText } from "./db-refusals.ts";

/** Every English sentence the server writes, as a pattern (a `{name}` matches any text). */
const OWN_ENGLISH: readonly RegExp[] = Object.entries(DICTIONARIES.en)
  .filter(([group]) => group.endsWith("Server"))
  .flatMap(([, texts]) => leaves(texts))
  // Whole sentences only: a short label ("Ask: {question}") would let any text through.
  .filter((text) => /[.?]$/.test(text) && text.length >= 15)
  .map(
    (text) =>
      new RegExp(
        `^${text
          .split(/\{\w+\}/)
          .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
          .join(".+")}$`,
        "s",
      ),
  );

function leaves(node: unknown): string[] {
  if (typeof node === "string") return [node];
  return Object.values(node as Record<string, unknown>).flatMap(leaves);
}

const DANISH =
  /\b(ikke|kan|kunne|er|den|det|denne|dette|og|til|på|med|eller|af|har|skal|blev|uden|intet|ingen|mangler|allerede|ukendt|returnerede|afviste|indeholder|casen|igen|mange|skriv|gyldig|ugyldige?|fra|som|prøv|din|du)\b|[æøå]/i;
const TECHNICAL =
  /[[\]{}<>]|\n|\bat \S+ \(|\b(table|function|schema|relation|column|constraint|violates|null value|permission denied|getaddrinfo|ENOTFOUND|ECONN\w*|ETIMEDOUT|JWT|token|undefined|properties|fetch|network|unauthori[sz]ed|forbidden|internal|error:)\b/i;

export function userMessage(cause: unknown, fallback: string, language: Language = "da"): string {
  const message = cause instanceof Error ? cause.message.trim() : "";
  if (message === "Unauthorized") return translate(language, "system.signedOut");
  // The database's own refusals that say "fond" read in the dictionary's words.
  const refusal = dbRefusalText(message, language);
  if (refusal) return refusal;
  if (language === "en" && message.length <= 300 && OWN_ENGLISH.some((own) => own.test(message))) {
    return message;
  }
  const readable =
    message.length > 0 &&
    message.length <= 300 &&
    /^[A-ZÆØÅ]/.test(message) &&
    DANISH.test(message) &&
    !TECHNICAL.test(message);
  if (!readable) {
    if (cause) console.error("[userMessage]", cause);
    return fallback;
  }
  return message;
}
