import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireFundCapability } from "@/lib/auth/access.server";
import { requireSupabaseAuth } from "@/lib/supabase/auth-middleware";
import { one, type Row } from "./mappers";
import { fetchAllRows } from "./paginate";
import type { CaseView } from "./snapshot";
import { buildFundTasks, mapTaskCase } from "./task-build";
import { serverText } from "@/lib/i18n/server-text";
import { withDemoView } from "@/lib/display/display-names.server";

/**
 * Overblik's Tasks sub-page (rules): the open tasks across the fund's open
 * cases, read-only. Nothing here changes a task: a task is answered on its case, where the
 * answer is saved as evidence and the score is recalculated in code (decision 6), so the page
 * only links there. Every fund member may read every task (row-level security allows it), so
 * "Mine" and "Alle" are a view choice made in the page, not a permission.
 */

export interface FundTask {
  id: string;
  caseId: string;
  caseName: string;
  /** Which of the case's views to open ("deep" once there is a deep analysis past screening). */
  caseView: CaseView;
  title: string;
  description: string | null;
  why: string | null;
  kind: "task" | "question" | "verification" | "document" | "research" | "meeting";
  assigneeId: string | null;
  assigneeName: string | null;
  /** Assigned to the signed-in user. */
  mine: boolean;
  /** "YYYY-MM-DD" or null. */
  dueOn: string | null;
  linkedKind: "gate" | "criterion" | null;
  linkedKey: string | null;
  createdAt: string;
}

/** `in (...)` lists are chunked so the request line stays short. */
const CHUNK = 100;
const chunks = <T>(list: readonly T[]): T[][] =>
  Array.from({ length: Math.ceil(list.length / CHUNK) }, (_, i) =>
    list.slice(i * CHUNK, (i + 1) * CHUNK),
  );

export const listFundOpenTasks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ fundId: z.guid() }).parse(input))
  .handler(
    withDemoView(async ({ data, context }): Promise<FundTask[]> => {
      await requireFundCapability(context.supabase, context.userId, data.fundId, "view_case");
      let taskRows: Row[];
      const caseRows: Row[] = [];
      const deepRows: Row[] = [];
      try {
        taskRows = await fetchAllRows<Row>((from, to) =>
          context.supabase
            .from("case_tasks")
            .select(
              "id, case_id, kind, title, description, why, assignee_id, due_on, linked_kind, linked_key, created_at",
              { count: "exact" },
            )
            .eq("fund_id", data.fundId)
            .eq("status", "open")
            .is("deleted_at", null)
            .order("id")
            .range(from, to),
        );
        // Only the cases the open tasks sit on (not the whole fund's case and run history).
        const caseIds = [...new Set(taskRows.map((row) => row["case_id"] as string))];
        for (const ids of chunks(caseIds)) {
          const [cases, deep] = await Promise.all([
            fetchAllRows<Row>((from, to) =>
              context.supabase
                .from("cases")
                .select("id, phase, companies(name)", { count: "exact" })
                .eq("fund_id", data.fundId)
                .in("id", ids)
                .order("id")
                .range(from, to),
            ),
            // A finished deep analysis in any setup version decides the link; the case page
            // shows the same task list in both views, so a wrong guess only picks the other tab.
            fetchAllRows<Row>((from, to) =>
              context.supabase
                .from("analysis_runs")
                .select("id, case_id", { count: "exact" })
                .eq("fund_id", data.fundId)
                .eq("kind", "deep")
                .eq("status", "complete")
                .in("case_id", ids)
                .order("id")
                .range(from, to),
            ),
          ]);
          caseRows.push(...cases);
          deepRows.push(...deep);
        }
      } catch (cause) {
        console.error(
          `[overview] tasks (fund ${data.fundId})`,
          cause instanceof Error ? cause.message : cause,
        );
        throw new Error(serverText("appServer.overview.tasksNotLoaded"));
      }
      const assigneeIds = [
        ...new Set(taskRows.map((row) => row["assignee_id"] as string | null).filter(Boolean)),
      ] as string[];
      const names = new Map<string, string>();
      for (const ids of chunks(assigneeIds)) {
        const { data: profiles, error } = await context.supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", ids);
        // Names are a convenience; the list still works without them.
        if (error) console.warn("[overview] assignee names not loaded", error.message);
        for (const profile of profiles ?? []) {
          const row = one<Row>(profile) as Row | null;
          if (row?.["full_name"]) names.set(row["id"] as string, row["full_name"] as string);
        }
      }
      return buildFundTasks({
        taskRows,
        cases: new Map(caseRows.map((row) => mapTaskCase(row))),
        casesWithDeep: new Set(deepRows.map((row) => row["case_id"] as string)),
        assigneeNames: names,
        userId: context.userId,
      });
    }),
  );
