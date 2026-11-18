/**
 * Builds the Tasks sub-page's rows from the raw reads (pure, tested). A task on a case that is
 * decided, or whose case cannot be found, is left out: there is no work left on it.
 */
import { DEFAULT_LANGUAGE, type Language } from "../i18n/language.ts";
import { translate } from "../i18n/translate.ts";
import type { CaseView } from "./snapshot.ts";
import { one, type Row } from "./mappers.ts";
import type { FundTask } from "./tasks.functions.ts";

export interface TaskCase {
  phase: string;
  name: string;
}

export function mapTaskCase(
  row: Row,
  language: Language = DEFAULT_LANGUAGE,
): readonly [string, TaskCase] {
  const company = one<{ name: string }>(row["companies"]);
  return [
    row["id"] as string,
    {
      phase: row["phase"] as string,
      name: company?.name ?? translate(language, "overview.shared.unidentified"),
    },
  ] as const;
}

/** "deep" once the case has a finished deep analysis and is past screening. */
export function caseViewFor(phase: string, hasDeep: boolean): CaseView {
  return hasDeep && phase !== "screening" ? "deep" : "screening";
}

export function buildFundTasks(input: {
  taskRows: readonly Row[];
  cases: ReadonlyMap<string, TaskCase>;
  casesWithDeep: ReadonlySet<string>;
  assigneeNames: ReadonlyMap<string, string>;
  userId: string;
}): FundTask[] {
  const tasks: FundTask[] = [];
  for (const row of input.taskRows) {
    const caseId = row["case_id"] as string;
    const item = input.cases.get(caseId);
    if (!item || item.phase === "decided") continue;
    const assigneeId = (row["assignee_id"] as string | null) ?? null;
    tasks.push({
      id: row["id"] as string,
      caseId,
      caseName: item.name,
      caseView: caseViewFor(item.phase, input.casesWithDeep.has(caseId)),
      title: row["title"] as string,
      description: (row["description"] as string | null) ?? null,
      why: (row["why"] as string | null) ?? null,
      kind: row["kind"] as FundTask["kind"],
      assigneeId,
      assigneeName: assigneeId ? (input.assigneeNames.get(assigneeId) ?? null) : null,
      mine: assigneeId === input.userId,
      dueOn: (row["due_on"] as string | null)?.slice(0, 10) ?? null,
      linkedKind: (row["linked_kind"] as FundTask["linkedKind"]) ?? null,
      linkedKey: (row["linked_key"] as string | null) ?? null,
      createdAt: row["created_at"] as string,
    });
  }
  return tasks;
}
