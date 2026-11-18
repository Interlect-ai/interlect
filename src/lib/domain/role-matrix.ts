/**
 * "Hvad hver rolle kan" (Brugere og adgang, prototypen): the matrix is DERIVED from
 * `hasCapability` in workflow.ts, never written out by hand, so the page and the server can
 * never disagree. Each row names the capabilities it stands for; a cell is "yes" only when the
 * role holds all of them.
 *
 * "optin" is Medlem's orange "kan slås til af admin": the capability is off for Medlem now but
 * an Admin can switch it on (`memberOptIn`). With the setting on, the cell turns "yes".
 */
import {
  hasCapability,
  memberOptIn,
  strictFundSettings,
  type Capability,
  type FundSettings,
} from "./workflow.ts";
import type { FundRole } from "./types.ts";
import type { Language } from "../i18n/language.ts";
import { translate, type Dictionary } from "../i18n/translate.ts";

export const matrixRoles = [
  "admin",
  "lead",
  "member",
  "reader",
] as const satisfies readonly FundRole[];

export type MatrixCell = "yes" | "optin" | "no";

/** A row's text key under `users.matrix.row` in the dictionaries. */
export type MatrixRowKey = keyof Dictionary["users"]["matrix"]["row"];

export type MatrixRowDef =
  | { head: true; key: MatrixRowKey }
  | { head?: false; key: MatrixRowKey; capabilities: readonly Capability[] };

/** The prototype's 16 lines (adgang.dc.html, `M`), in order. */
export const matrixRows: readonly MatrixRowDef[] = [
  { head: true, key: "cases" },
  { key: "viewCases", capabilities: ["view_case"] },
  { key: "writeMessages", capabilities: ["write_messages", "write_notes"] },
  { key: "createCases", capabilities: ["create_case", "start_analysis"] },
  { key: "manageTasks", capabilities: ["manage_tasks"] },
  {
    key: "deepAndCommittee",
    capabilities: ["approve_deep_analysis", "move_process_stage"],
  },
  { key: "hold", capabilities: ["move_process_stage"] },
  { key: "decide", capabilities: ["decide_case"] },
  { head: true, key: "fundSetup" },
  // Everyone who may see the fund's cases may read its thesis, weights and method.
  { key: "viewThesis", capabilities: ["view_case"] },
  { key: "propose", capabilities: ["propose_fund_change"] },
  { key: "editDraft", capabilities: ["configure_fund"] },
  { key: "publish", capabilities: ["publish_fund_config"] },
  { head: true, key: "administration" },
  { key: "manageUsers", capabilities: ["manage_users"] },
  { key: "seatsAndUsage", capabilities: ["manage_users"] },
];

export function matrixCell(
  role: FundRole,
  capabilities: readonly Capability[],
  settings: FundSettings = strictFundSettings,
): MatrixCell {
  let result: MatrixCell = "yes";
  for (const capability of capabilities) {
    if (hasCapability([role], capability, settings)) continue;
    // Off for Medlem now, but an Admin can switch it on.
    if (role === "member" && memberOptIn[capability] !== undefined) result = "optin";
    else return "no";
  }
  return result;
}

export interface MatrixRow {
  head: boolean;
  label: string;
  /** One cell per role in `matrixRoles` order; empty for a heading. */
  cells: MatrixCell[];
}

export function roleMatrix(
  settings: FundSettings = strictFundSettings,
  language: Language = "da",
): MatrixRow[] {
  const label = (key: MatrixRowKey) => translate(language, `users.matrix.row.${key}`);
  return matrixRows.map((row) =>
    row.head
      ? { head: true, label: label(row.key), cells: [] }
      : {
          head: false,
          label: label(row.key),
          cells: matrixRoles.map((role) => matrixCell(role, row.capabilities, settings)),
        },
  );
}
