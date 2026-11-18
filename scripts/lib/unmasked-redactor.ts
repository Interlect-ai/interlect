import type { SupabaseClient } from "@supabase/supabase-js";
import { attachCallLog } from "../../src/lib/ai/call-log.ts";
import type { RedactionKind, Redactor } from "../../src/lib/ai/redact.ts";

/**
 * A Redactor that masks nothing, for measuring what the masking costs: the exam's and the
 * screening eval's "without masking" side. Scripts only; the app always masks. The call
 * is still written to the fund's AI log under `flow`, so its price is counted.
 */
export function unmaskedRedactor(fundId: string, flow: string, service: SupabaseClient): Redactor {
  const zero: Record<RedactionKind, number> = {
    person: 0,
    email: 0,
    phone: 0,
    cpr: 0,
    account: 0,
    iban: 0,
    card: 0,
    address: 0,
  };
  return attachCallLog(
    {
      redact: (text) => text,
      redactAll: (texts) => [...texts],
      redactJson: (value) => value,
      restore: (text) => text,
      restoreJson: (value) => value,
      counts: () => ({ ...zero }),
    },
    { fundId, flow, service },
  );
}
