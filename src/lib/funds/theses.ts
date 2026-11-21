/**
 * Theses in a team (spec, §2.4).
 * Pure rules, no I/O, so they are tested on their own and shared by every server lookup.
 */

export type ThesisStatus = "draft" | "active" | "archived";

export interface ThesisRow {
  id: string;
  name: string;
  status: ThesisStatus;
  isDefault: boolean;
  createdAt: string;
  archivedAt: string | null;
}

export function thesisRowFrom(row: Record<string, unknown>): ThesisRow {
  const status = row["status"];
  return {
    id: row["id"] as string,
    name: (row["name"] as string | null) ?? "",
    status: status === "active" || status === "archived" ? status : "draft",
    isDefault: row["is_default"] === true,
    createdAt: (row["created_at"] as string | null) ?? "",
    archivedAt: (row["archived_at"] as string | null | undefined) ?? null,
  };
}

function byAge(a: ThesisRow, b: ThesisRow): number {
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

/**
 * The thesis a team-wide lookup uses when no thesis is named (the setup page without a choice,
 * Brain, the AI level, the side rail): the default thesis, else the oldest active one, else the
 * oldest not archived (a new team whose first thesis is still a draft). The same order as the
 * database's `private.team_thesis_for_insert` (0127). Null when the team has none.
 */
export function pickDefaultThesis(rows: readonly ThesisRow[]): ThesisRow | null {
  const open = rows.filter((row) => row.status !== "archived").sort(byAge);
  return (
    open.find((row) => row.isDefault) ??
    open.find((row) => row.status === "active") ??
    open[0] ??
    null
  );
}

/** The active theses, the default first, then by age: the order every thesis menu uses. */
export function activeTheses(rows: readonly ThesisRow[]): ThesisRow[] {
  return rows
    .filter((row) => row.status === "active")
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || byAge(a, b));
}

/**
 * A new analysis (screening, deep analysis, re-screening) needs an active thesis (§3): a case under
 * an archived thesis can be read, noted and moved, but not analysed again until it is reactivated.
 */
export function thesisAllowsNewAnalysis(status: ThesisStatus): boolean {
  return status !== "archived";
}

/**
 * The person's message for a refusal from the thesis functions in the database (0127, 0128),
 * which raise Danish text; null for anything else (the caller then shows its general message).
 */
export type ThesisRefusal =
  | "configureOnly"
  | "nameLength"
  | "nameTaken"
  | "lastActive"
  | "alreadyArchived"
  | "notArchived"
  | "renameArchived"
  | "defaultNeedsPublished"
  | "copyNeedsPublished"
  | "notFound";

// i18n-keep: the database's own Danish refusals (0127, 0128), matched to a key, never shown as is.
const REFUSALS: ReadonlyArray<[string, ThesisRefusal]> = [
  ["Kun en Admin eller Lead", "configureOnly"],
  ["navn skal være 2-80 tegn", "nameLength"],
  ["allerede en tese med det navn", "nameTaken"],
  ["mindst én aktiv tese", "lastActive"],
  ["allerede arkiveret", "alreadyArchived"],
  ["ikke arkiveret", "notArchived"],
  ["for at omdøbe", "renameArchived"],
  ["udgivet tese kan være standard", "defaultNeedsPublished"],
  ["aktiv tese kan kopieres", "copyNeedsPublished"],
  ["ingen udgivet version at kopiere", "copyNeedsPublished"],
  ["Tesen blev ikke fundet", "notFound"],
];

export function thesisRefusal(message: string | null | undefined): ThesisRefusal | null {
  if (!message) return null;
  return REFUSALS.find(([needle]) => message.includes(needle))?.[1] ?? null;
}
