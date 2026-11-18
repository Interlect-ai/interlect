import type { SupabaseClient } from "@supabase/supabase-js";
import { writeAudit } from "@/lib/auth/access.server";
import { loadOpenTaskTitles as loadTitles, writeAiTasksWith } from "./ai-task-writer";
import type { AiTaskSource } from "./tasks";

/**
 * Writes the questions and gaps of a finished screening or deep analysis as AI tasks, and tidies
 * the case's earlier AI tasks. The rules and the writes live in `ai-task-writer.ts`.
 * Never throws; returns the number of tasks written.
 */
export function writeAiTasks(
  service: SupabaseClient,
  input: {
    fundId: string;
    caseId: string;
    runId: string;
    runKind: "screening" | "deep";
    /** The person who started the run; AI tasks are recorded as created on their behalf. */
    createdBy: string;
    source: AiTaskSource;
  },
): Promise<number> {
  return writeAiTasksWith(service, writeAudit, input);
}

/** The titles of the case's open tasks, for the synthesis prompt (see `loadOpenTaskTitles`). */
export function loadOpenTaskTitles(
  service: SupabaseClient,
  fundId: string,
  caseId: string,
  limit: number,
  runKind: "screening" | "deep",
): Promise<string[]> {
  return loadTitles(service, fundId, caseId, limit, runKind);
}
