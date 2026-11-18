/**
 * Keeps the fund's memory in step with the cases' decisions (harden B/N1). Runs in the
 * background after the Fortryd window: every touched case is read again and its entry is
 * written, kept or removed from its state then (the rules and the reconcile itself live in
 * decision-memory.ts, where they are tested). Never throws: memory must never block or undo
 * a decision.
 */
import { getServiceClient } from "@/lib/supabase/admin.server";
import { isFundMemoryEnabled } from "@/lib/analysis/gateway-security";
import { MEMORY_RECONCILE_DELAY_MS, reconcileMemoryWith } from "./decision-memory";

export async function scheduleMemoryReconcile(fundId: string, caseIds: string[]): Promise<void> {
  if (caseIds.length === 0) return;
  try {
    const { waitUntil } = await import("@vercel/functions");
    waitUntil(
      new Promise<void>((resolve) => setTimeout(resolve, MEMORY_RECONCILE_DELAY_MS)).then(() =>
        reconcileDecisionMemory(fundId, [...new Set(caseIds)]),
      ),
    );
  } catch (cause) {
    console.error(`[decision-memory] not scheduled (fund ${fundId})`, cause);
  }
}

export async function reconcileDecisionMemory(fundId: string, caseIds: string[]): Promise<void> {
  try {
    const service = getServiceClient();
    const memoryEnabled = isFundMemoryEnabled();
    // The writer pulls in the embedding model; only load it when entries can be written. If it
    // can't be loaded, removals still run and nothing is written (harden SF12).
    const memory = memoryEnabled
      ? await import("@/lib/analysis/memory").catch((cause: unknown) => {
          console.error(
            `[decision-memory] writer not loaded (fund ${fundId})`,
            cause instanceof Error ? cause.message : String(cause),
          );
          return null;
        })
      : null;
    await reconcileMemoryWith(
      {
        service,
        memoryEnabled: memory !== null,
        summaryOf: (entry) => memory?.caseMemorySummary(entry) ?? "",
        write: async (id, entry) => {
          await memory?.writeCaseMemoryEntry({ service, fundId: id, ...entry });
        },
      },
      fundId,
      caseIds,
    );
  } catch (cause) {
    console.error(
      `[decision-memory] not reconciled (fund ${fundId})`,
      cause instanceof Error ? cause.message : String(cause),
    );
  }
}
