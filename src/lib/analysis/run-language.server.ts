/**
 * A queued analysis phase runs in its fund's language: what the worker writes to the
 * person (a run's error, the score's explanation, a case note) follows the fund, as the AI's
 * text does. A run that cannot be read runs in Danish, as before.
 */
import { withFundLanguage, withLanguage } from "@/lib/i18n/language-scope.server";
import { DEFAULT_LANGUAGE } from "@/lib/i18n/language";
import { getServiceClient } from "@/lib/supabase/admin.server";

export async function withRunLanguage<T>(runId: string, work: () => Promise<T>): Promise<T> {
  const service = getServiceClient();
  const { data, error } = await service
    .from("analysis_runs")
    .select("fund_id")
    .eq("id", runId)
    .maybeSingle();
  if (error) console.error("[withRunLanguage]", error.message);
  const fundId = (data as { fund_id?: string } | null)?.fund_id;
  return fundId ? withFundLanguage(service, fundId, work) : withLanguage(DEFAULT_LANGUAGE, work);
}
