import type { SupabaseClient } from "@supabase/supabase-js";
import type { Language } from "../i18n/language.ts";
import {
  checkFinancialInputs,
  financialInputCheckWarnings,
  type CheckedFinancialInput,
  type EvidenceText,
} from "./financial-input-check.ts";
import { loadRegistryAnchors } from "./financial-statements.ts";

/**
 * Checks the finance specialist's numbers in a synthesised deep analysis against the
 * evidence they cite and the register, before they are saved and calculated on. Returns the
 * inputs to keep and one warning per dropped input (for the run's quality audit). When the
 * register cannot be read the evidence check still runs and the warning says so, so a missing
 * register check is never silent.
 */
export async function checkDeepFinancialInputs<T extends CheckedFinancialInput>(
  service: SupabaseClient,
  args: {
    fundId: string;
    caseId: string;
    inputs: readonly T[];
    evidenceRows: ReadonlyArray<Record<string, unknown>>;
    language: Language;
    registryUnreadableWarning: string;
  },
): Promise<{ kept: T[]; warnings: string[] }> {
  if (!args.inputs.length) return { kept: [], warnings: [] };
  const evidence = new Map<string, EvidenceText>(
    args.evidenceRows.map((row) => [
      row["id"] as string,
      {
        claim: typeof row["claim"] === "string" ? row["claim"] : null,
        excerpt: typeof row["excerpt"] === "string" ? row["excerpt"] : null,
      },
    ]),
  );
  const { anchors, loadError } = await loadRegistryAnchors(service, args.fundId, args.caseId);
  const check = checkFinancialInputs(args.inputs, evidence, anchors);
  const warnings = financialInputCheckWarnings(check.dropped, args.language);
  if (loadError) warnings.push(args.registryUnreadableWarning);
  return { kept: check.kept, warnings };
}
