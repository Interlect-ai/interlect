/**
 * The change history of a fund's setup: who laid an AI proposal into the draft, rejected one,
 * changed a reason, published a version, or changed the AI level. It is read from the audit log, which
 * is append-only; only the events that belong to the setup are shown, in plain Danish, and the
 * payload is never passed on as it is. Pure file (no database), tested with node --test.
 */
import { translate, type MessageKey } from "../i18n/translate.ts";
import { type Language } from "../i18n/language.ts";

export const HISTORY_ACTIONS = [
  "fund_config_draft_created",
  "fund_config_activated",
  "fund_config_proposal_created",
  "fund_config_proposal_applied",
  "fund_config_proposal_rejected",
  "fund_document_interpreted",
  "reason_code_added",
  "reason_code_changed",
  "reason_code_activated",
  "reason_code_deactivated",
  "fund_ai_settings_changed",
] as const;
export type HistoryAction = (typeof HISTORY_ACTIONS)[number];

export function isHistoryAction(action: string): action is HistoryAction {
  return (HISTORY_ACTIONS as readonly string[]).includes(action);
}

type Payload = Record<string, unknown>;

/**
 * Audit actions written when a change that was logged first did not happen after all (the audit
 * row is written before the change, so a refused audit stops it). Each one names the row it
 * cancels (`undoes` in the payload); older rows without it cancel the nearest earlier row of the
 * named action by the same person. Reason codes name their action in the payload.
 */
export const UNDONE_ACTIONS: Readonly<Record<string, HistoryAction | null>> = {
  fund_config_proposal_not_applied: "fund_config_proposal_applied",
  fund_ai_settings_not_saved: "fund_ai_settings_changed",
  reason_code_not_saved: null,
};

export interface AuditRow {
  id: string;
  action: string;
  actorId: string | null;
  entityId: string | null;
  payload: Payload | null;
  occurredAt: string;
}

/**
 * The rows without the changes that never happened (and without the "not saved" rows themselves).
 * `rows` is newest first, as the history reads it (ordered by time in the query); the order is kept.
 */
export function withoutUndone(rows: readonly AuditRow[]): AuditRow[] {
  const dropped = new Set<string>();
  const ids = new Set(rows.map((row) => row.id));
  // Oldest first, so each "not saved" row looks back for the change right before it.
  const ordered = [...rows].reverse();
  ordered.forEach((row, index) => {
    if (!(row.action in UNDONE_ACTIONS)) return;
    dropped.add(row.id);
    const undoes = text(row.payload?.["undoes"]);
    if (undoes) {
      // The exact row (two tabs or a double click must not cancel the one that succeeded).
      if (ids.has(undoes)) dropped.add(undoes);
      return;
    }
    const target = UNDONE_ACTIONS[row.action] ?? text(row.payload?.["action"]);
    if (!target) return;
    for (let i = index - 1; i >= 0; i -= 1) {
      const candidate = ordered[i]!;
      if (dropped.has(candidate.id)) continue;
      if (
        candidate.action === target &&
        candidate.actorId === row.actorId &&
        (row.entityId === null || candidate.entityId === row.entityId)
      ) {
        dropped.add(candidate.id);
        break;
      }
    }
  });
  return rows.filter((row) => !dropped.has(row.id));
}

const TIER_LABEL_KEY: Record<string, MessageKey> = {
  light: "fundSetup.history.tierLight",
  medium: "fundSetup.history.tierMedium",
  heavy: "fundSetup.history.tierHeavy",
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function tierLabel(value: unknown, language: Language): string {
  const key = text(value);
  if (!key) return translate(language, "fundSetup.history.tierMedium");
  const labelKey = TIER_LABEL_KEY[key];
  return labelKey ? translate(language, labelKey) : key;
}

/** What changed in the AI level, from the before and after the audit row holds (no kroner). */
function aiSettingsText(payload: Payload, language: Language): string {
  const before = (payload["before"] ?? {}) as Payload;
  const after = (payload["after"] ?? {}) as Payload;
  const parts: string[] = [];
  for (const [label, tierKey] of [
    [translate(language, "fundSetup.history.screening"), "screeningTier"],
    [translate(language, "fundSetup.history.deepAnalysis"), "deepTier"],
  ] as const) {
    if (before[tierKey] !== after[tierKey]) {
      parts.push(
        `${label}: ${tierLabel(before[tierKey], language)} → ${tierLabel(after[tierKey], language)}`,
      );
    }
  }
  return parts.length
    ? translate(language, "fundSetup.history.aiChanged", { parts: parts.join("; ") })
    : translate(language, "fundSetup.history.aiSaved");
}

/** One line for an audit event, or null when the event is not part of the history. */
export function describeHistoryEvent(
  action: string,
  payload: Payload | null,
  language: Language = "da",
): string | null {
  const data = payload ?? {};
  switch (action) {
    case "fund_config_draft_created": {
      const version = typeof data["version"] === "number" ? data["version"] : null;
      return version
        ? translate(language, "fundSetup.history.draftCreatedVersion", { version })
        : translate(language, "fundSetup.history.draftCreated");
    }
    case "fund_config_activated": {
      const version = typeof data["version"] === "number" ? data["version"] : null;
      return version
        ? translate(language, "fundSetup.history.activatedVersion", { version })
        : translate(language, "fundSetup.history.activated");
    }
    case "fund_config_proposal_created":
      return translate(language, "fundSetup.history.proposalCreated");
    case "fund_config_proposal_applied":
      return translate(language, "fundSetup.history.proposalApplied");
    case "fund_config_proposal_rejected":
      return translate(language, "fundSetup.history.proposalRejected");
    case "fund_document_interpreted":
      // The proposal only fills the editor's fields; it reaches the draft when the draft is saved.
      return translate(language, "fundSetup.history.documentInterpreted");
    case "reason_code_added":
      return translate(language, "fundSetup.history.reasonAdded");
    case "reason_code_changed":
      return translate(language, "fundSetup.history.reasonChanged");
    case "reason_code_activated":
      return translate(language, "fundSetup.history.reasonActivated");
    case "reason_code_deactivated":
      return translate(language, "fundSetup.history.reasonDeactivated");
    case "fund_ai_settings_changed":
      return aiSettingsText(data, language);
    default:
      return null;
  }
}

export interface HistoryEntry {
  id: string;
  text: string;
  /** Name of the person, or null for the system. */
  actor: string | null;
  at: string;
}
