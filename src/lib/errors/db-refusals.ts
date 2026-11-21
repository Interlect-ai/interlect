/**
 * The database's own refusals (raised in the SQL functions with code P0001) that name "fond"
 * . Not every customer is a fund, and an English team should not read Danish, so
 * the person reads the dictionary's words in the page's language instead. The database is not
 * changed: the functions are large and proven, and the message is only matched here. A `%` is the
 * place where the database fills in a value (as in `raise exception '… (%)', x`).
 * db-refusals.test.ts fails when a migration raises a new message with "fond" that is not here.
 */
import type { Language } from "../i18n/language.ts";
import { translate, type MessageKey } from "../i18n/translate.ts";

// i18n-keep: the database's own messages, matched to recognise them; never shown.
export const DB_REFUSALS: ReadonlyArray<readonly [message: string, key: MessageKey]> = [
  ["Den aktive fondsprofil blev ikke fundet.", "appServer.dbRefusals.activeSetupNotFound"],
  ["Kun en administrator kan redigere fondsopsætningen.", "appServer.dbRefusals.adminEditsSetup"],
  [
    "Kun en administrator eller partner kan redigere fondsopsætningen.",
    "appServer.dbRefusals.adminOrPartnerEditsSetup",
  ],
  [
    "Kun en Admin eller Lead kan redigere fondsopsætningen.",
    "appServer.dbRefusals.adminOrLeadEditsSetup",
  ],
  ["Din rolle kan ikke udgive fondsopsætningen.", "appServer.dbRefusals.roleCannotPublishSetup"],
  ["Fondsnavn mangler.", "appServer.dbRefusals.teamNameMissing"],
  ["Casen blev ikke fundet i den valgte fond.", "appServer.dbRefusals.caseNotInTeam"],
  [
    "Publicerede fondsprofilversioner er uforanderlige (%).",
    "appServer.dbRefusals.publishedUnchangeable",
  ],
  [
    "Publicerede fondsprofilversioner er uforanderlige.",
    "appServer.dbRefusals.publishedUnchangeable",
  ],
  ["Fonden blev ikke fundet.", "appServer.dbRefusals.teamNotFound"],
  ["Ukendt fondsprofilversion.", "appServer.dbRefusals.unknownSetupVersion"],
  ["Fondsstørrelsen skal være et tal større end 0.", "appServer.dbRefusals.capitalPositive"],
  ["Fondsprofilen mangler mandat.", "appServer.dbRefusals.setupNoMandate"],
  ["Fonden skal altid have mindst én aktiv administrator.", "appServer.dbRefusals.lastAdmin"],
  ["En ticket kan ikke være større end fonden.", "appServer.dbRefusals.ticketAboveCapital"],
  ["Kun en administrator kan publicere en fondsprofil.", "appServer.dbRefusals.adminPublishes"],
  ["Kun en administrator kan aktivere en fondsprofil.", "appServer.dbRefusals.adminActivates"],
  [
    "En aktiv fondsprofil kan kun afløses af en ny version.",
    "appServer.dbRefusals.activeReplacedByVersion",
  ],
  ["Den valgte fondsprofil er ikke tilgængelig.", "appServer.dbRefusals.setupUnavailable"],
  ["Den valgte fond er ikke tilgængelig.", "appServer.dbRefusals.teamUnavailable"],
];

const MATCHERS = DB_REFUSALS.map(
  ([message, key]) =>
    [
      new RegExp(
        `^${message
          .split("%")
          .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
          .join(".+")}$`,
        "s",
      ),
      key,
    ] as const,
);

/** The dictionary's words for one of the database's refusals, or null when it is not one. */
export function dbRefusalText(
  message: string | null | undefined,
  language: Language,
): string | null {
  const text = message?.trim();
  if (!text) return null;
  const match = MATCHERS.find(([pattern]) => pattern.test(text));
  return match ? translate(language, match[1]) : null;
}
