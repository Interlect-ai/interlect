/**
 * A database error from saving, publishing or laying a proposal into a fund setup, as the person
 * should read it. Our own refusals (raised in the SQL functions with code P0001) are written in
 * Danish for people and are shown as they are (those that say "fond" in the dictionary's words), except the guard that keeps published versions
 * unchanged, which names a table; anything else (a constraint, a missing column, a timeout) is
 * logged by the caller and replaced by plain words, never shown raw. Pure file, tested with
 * node --test.
 */
import { translate } from "../i18n/translate.ts";
import type { Language } from "../i18n/language.ts";
import { dbRefusalText } from "../errors/db-refusals.ts";

export interface DbErrorLike {
  code?: string | null;
  message?: string | null;
}

export interface ErrorTextOptions {
  /**
   * A unique-key error means two criteria or rules share a name (saving a draft). Publishing
   * hits other unique keys (one active version, one version number): someone else published.
   */
  duplicateNames?: boolean;
  /** The fund's language for our own texts and the database's refusals. */
  language?: Language;
}

export function fundConfigErrorText(
  error: DbErrorLike | null | undefined,
  fallback: string,
  { duplicateNames = true, language = "da" }: ErrorTextOptions = {},
): string {
  const PUBLISHED_ELSEWHERE = translate(language, "fundSetup.dbErrors.publishedElsewhere");
  const message = error?.message?.trim();
  if (error?.code === "P0001" && message) {
    // 0002/0031: a published version cannot change (the message names the table).
    // i18n-keep: the database's own message, matched to recognise it.
    if (message.startsWith("Publicerede fondsprofilversioner er uforanderlige")) {
      return PUBLISHED_ELSEWHERE;
    }
    // The refusals that say "fond" read in the dictionary's words; others as written.
    return dbRefusalText(message, language) ?? message;
  }
  if (error?.code === "23505") {
    return duplicateNames
      ? translate(language, "fundSetup.dbErrors.duplicateNames")
      : PUBLISHED_ELSEWHERE;
  }
  return fallback;
}

/** One validation issue of a draft save (the shape zod reports), as one Danish sentence. */
export function saveInputIssueText(
  issue: { path: ReadonlyArray<PropertyKey> } | undefined,
  language: Language = "da",
): string {
  const tr = (key: Parameters<typeof translate>[1], vars?: Record<string, string>) =>
    translate(language, key, vars);
  const [field, index, part] = issue?.path ?? [];
  const n = typeof index === "number" ? index + 1 : null;
  switch (field) {
    case "criteria":
    case "gates": {
      const what =
        field === "criteria"
          ? tr("fundSetup.dbErrors.criterionWord")
          : tr("fundSetup.dbErrors.gateWord");
      const which = n ? `${what} ${n}` : what;
      if (part === "weight") return tr("fundSetup.dbErrors.issueWeight", { which });
      if (part === "label") return tr("fundSetup.dbErrors.issueLabel", { which });
      if (part === "description") return tr("fundSetup.dbErrors.issueDescription", { which });
      if (part === "key") return tr("fundSetup.dbErrors.issueKey", { which });
      return tr("fundSetup.dbErrors.issueOther", { which });
    }
    case "fundName":
      return tr("fundSetup.dbErrors.issueFundName");
    case "thesis":
      return tr("fundSetup.dbErrors.issueThesis");
    case "riskPosture":
      return tr("fundSetup.dbErrors.issueRisk");
    case "ticketNote":
      return tr("fundSetup.dbErrors.issueTicketNote");
    case "dealbreakers":
      return tr("fundSetup.dbErrors.issueDealbreaker");
    case "stages":
    case "geographies":
    case "sectors":
      return tr("fundSetup.dbErrors.issueList");
    case "stageExpectations":
      return tr("fundSetup.dbErrors.issueStageExpectation");
    case "fundSizeEur":
    case "ticketMinEur":
    case "ticketMaxEur":
      return tr("fundSetup.dbErrors.issueSizes");
    case "analysisThreshold":
      return tr("fundSetup.dbErrors.issueThreshold");
    default:
      return tr("fundSetup.dbErrors.issueDefault");
  }
}
