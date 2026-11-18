import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getCaseDetail, listCaseNotes } from "@/lib/cases/cases.functions";
import { listCaseFiles } from "@/lib/cases/files.functions";
import { listFinancialStatements } from "@/lib/cases/financials.functions";
import { listCaseMessages } from "@/lib/cases/messages.functions";
import { listCaseTasks } from "@/lib/cases/tasks.functions";
import { getCaseStatusLine } from "@/lib/cases/transitions.functions";
import { useSession } from "@/lib/auth/useSession";
import { withTimeout } from "@/lib/cases/case-load";
import type { Language } from "@/lib/i18n/language";
import { CASE_PANEL_STALE_MS, filesKey, messagesKey, notesKey } from "./screening/case-tab-data";
import { caseTasksKey } from "./screening/useCaseTasks";

/**
 * The case page asked for its data in a chain (team → case → tasks, notes, files, figures,
 * status line), so it stood empty for many seconds. This asks for all of it at once, as soon as
 * the team is known (or likely: the one chosen last time), under the same query keys the page's
 * parts use, so they find the answer waiting. Nothing is shown from here; the server checks access
 * on every call, and a failed fetch ahead is simply asked again by the part that needs it.
 */
export function useCasePrefetch(caseId: string, fundId: string | null, language: Language) {
  const queryClient = useQueryClient();
  const { status } = useSession();
  useEffect(() => {
    if (status !== "signed_in" || !fundId) return;
    const data = { caseId, fundId };
    // Retries as the parts themselves would (a part that appears meanwhile joins this fetch):
    // the case is not retried (its own query has retry: false), the rest as React Query's default.
    const ahead = (
      queryKey: readonly unknown[],
      queryFn: () => Promise<unknown>,
      retry: false | number = 3,
    ) =>
      void queryClient.prefetchQuery({ queryKey, queryFn, staleTime: CASE_PANEL_STALE_MS, retry });
    // The page joins this fetch, so it carries the page's own time limit.
    ahead(["case", caseId, fundId], () => withTimeout(getCaseDetail({ data })), false);
    ahead(caseTasksKey(caseId, fundId), () => listCaseTasks({ data }));
    ahead(notesKey(caseId), () => listCaseNotes({ data }));
    ahead(messagesKey(caseId, fundId), () => listCaseMessages({ data }));
    ahead(filesKey(caseId, fundId), () => listCaseFiles({ data }));
    ahead(["financial-statements", caseId, language], () => listFinancialStatements({ data }));
    ahead(["case-status-line", caseId, fundId], () => getCaseStatusLine({ data }));
  }, [caseId, fundId, language, status, queryClient]);
}
