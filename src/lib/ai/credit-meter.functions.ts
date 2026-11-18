/**
 * Kreditmåleren: one read of the installation's credit balance and this fund's usage this
 * month. Money is shown to Admin and Lead only (the same rule as the spend on Overblik,
 * `configure_fund`); everyone else is refused. Read only, no model, 0 kr. The payment link comes
 * from the environment (`AI_TOPUP_URL`, https only); without one, "Fyld op" mails a request to `AI_SUPPORT_EMAIL`. Both are returned to Admin only.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireFundCapability } from "@/lib/auth/access.server";
import { requireSupabaseAuth } from "@/lib/supabase/auth-middleware";
import { hasCapability } from "@/lib/domain/workflow";
import {
  meterState,
  monthPool,
  parseAllowance,
  remainingPct,
  safeCurrency,
  safeEmail,
  safeRate,
  safeTopUpUrl,
  sumUsage,
  withAllowance,
  type CreditMeter,
  creditMeterHidden,
} from "./credit-meter";
import { serverText } from "@/lib/i18n/server-text";

const PAGE = 1000;
const MAX_PAGES = 50;

export const getCreditMeter = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ fundId: z.guid() }).strict().parse(input))
  .handler(async ({ data, context }): Promise<CreditMeter> => {
    const access = await requireFundCapability(
      context.supabase,
      context.userId,
      data.fundId,
      "configure_fund",
    );
    const canTopUp = hasCapability(access.roles, "manage_users", access.settings);
    try {
      const { getServiceClient } = await import("@/lib/supabase/admin.server");
      const service = getServiceClient();

      const readSettings = (columns: string) =>
        service.from("ai_settings").select(columns).eq("id", true).maybeSingle();
      let settingsRead = await readSettings(
        "credits_enforced, brain_pause_at_remaining_pct, display_currency, dkk_per_display_unit",
      );
      // Between the deploy and migration 0076 the currency columns do not exist yet: show kroner.
      if (
        settingsRead.error &&
        (settingsRead.error.code === "42703" ||
          /display_currency|dkk_per_display_unit/.test(settingsRead.error.message))
      )
        settingsRead = await readSettings("credits_enforced, brain_pause_at_remaining_pct");
      const settingsError = settingsRead.error;
      const settings = settingsRead.data as {
        credits_enforced?: boolean;
        brain_pause_at_remaining_pct?: unknown;
        display_currency?: unknown;
        dkk_per_display_unit?: unknown;
      } | null;
      if (settingsError) throw settingsError;
      const enforced = settings?.credits_enforced === true;
      const pausePct = Number(settings?.brain_pause_at_remaining_pct ?? 15);
      const currency = safeCurrency(settings?.display_currency);
      const dkkPerUnit = safeRate(settings?.dkk_per_display_unit, currency);

      // Finished runs are settled first: else a run counts at its full reservation
      // until someone starts something new. Before the migration (PGRST202) it is read as it is;
      // a failed settlement still shows the meter.
      const settled = await service.rpc("ai_settle_now");
      if (settled.error && settled.error.code !== "PGRST202") {
        console.error("[credit-meter] ai_settle_now", settled.error.message);
      }

      const { data: balance, error: balanceError } = await service.rpc("ai_credit_balance_dkk");
      if (balanceError) throw balanceError;
      const balanceDkk = Number(balance ?? 0);

      // The month starts at 00:00 UTC, like `ai_reserve` and Brain's pool (0071); a Danish
      // customer sees the month turn at 01:00 or 02:00 local time.
      const now = new Date();
      const monthStart = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
      ).toISOString();

      // Read in pages: PostgREST cuts a plain select at 1000 rows, and a cut sum is a wrong sum.
      const readAll = async (
        build: (
          from: number,
          to: number,
        ) => PromiseLike<{
          data: { scope?: unknown; amount_dkk: unknown }[] | null;
          error: { message: string } | null;
        }>,
      ) => {
        const rows: { scope?: unknown; amount_dkk: unknown }[] = [];
        for (let page = 0; page < MAX_PAGES; page++) {
          const { data: chunk, error } = await build(page * PAGE, page * PAGE + PAGE - 1);
          if (error) throw new Error(error.message);
          rows.push(...(chunk ?? []));
          if ((chunk ?? []).length < PAGE) return rows;
        }
        throw new Error(serverText("appServer.credits.ledgerTooLong"));
      };

      // The pool Brain's pause is measured against (0071): the balance the month opened with
      // (never below 0) plus what was credited since. Every fund counts: the balance is shared.
      const added = await readAll((from, to) =>
        service
          .from("ai_credit_ledger")
          .select("amount_dkk")
          .in("kind", ["gift", "purchase"])
          .gte("created_at", monthStart)
          .order("id", { ascending: true })
          .range(from, to),
      );
      const addedThisMonthDkk = added.reduce((sum, row) => sum + Number(row.amount_dkk), 0);
      const usedAll = await readAll((from, to) =>
        service
          .from("ai_credit_ledger")
          .select("amount_dkk")
          .eq("kind", "usage")
          .neq("scope", "eval")
          .in("status", ["reserved", "final"])
          .gte("created_at", monthStart)
          .order("id", { ascending: true })
          .range(from, to),
      );
      const usageThisMonthDkk = usedAll.reduce((sum, row) => sum + Number(row.amount_dkk), 0);
      const creditedDkk = monthPool({ balanceDkk, addedThisMonthDkk, usageThisMonthDkk });

      // A team with its own allowance (the demo team) sees that instead. Between the
      // deploy and the migration the function does not exist yet (PGRST202): no allowance.
      const allowanceRead = await service.rpc("fund_credit_allowance", { _fund_id: data.fundId });
      if (allowanceRead.error && allowanceRead.error.code !== "PGRST202") throw allowanceRead.error;
      const shown = withAllowance(
        { enforced, balanceDkk, creditedDkk },
        allowanceRead.error ? null : parseAllowance(allowanceRead.data),
      );

      // This fund's usage this month, the three paid scopes. Reserved rows count at their
      // ceiling until the run is settled, like in the balance. Rows without a fund (a deleted
      // fund) are in the balance but in no fund's list.
      const usageRows = await readAll((from, to) =>
        service
          .from("ai_credit_ledger")
          .select("scope, amount_dkk")
          .eq("kind", "usage")
          .eq("fund_id", data.fundId)
          .in("scope", ["analysis", "chat", "brain"])
          .in("status", ["reserved", "final"])
          .gte("created_at", monthStart)
          .order("id", { ascending: true })
          .range(from, to),
      );

      return {
        currency,
        dkkPerUnit,
        enforced: shown.enforced,
        balanceDkk: shown.balanceDkk,
        creditedDkk: shown.creditedDkk,
        remainingPct: remainingPct(shown.balanceDkk, shown.creditedDkk),
        state: meterState({ ...shown, pausePct }),
        pausePct,
        usage: sumUsage(usageRows as { scope: unknown; amount_dkk: unknown }[]),
        canTopUp,
        topUpUrl: canTopUp ? safeTopUpUrl(process.env["AI_TOPUP_URL"]) : null,
        supportEmail: canTopUp ? safeEmail(process.env["AI_SUPPORT_EMAIL"]) : null,
        fundName: access.fundName,
        hidden: creditMeterHidden(process.env, shown.enforced),
      };
    } catch (cause) {
      console.error("[credit-meter]", cause instanceof Error ? cause.message : cause);
      throw new Error(serverText("appServer.credits.meterNotLoaded"));
    }
  });
