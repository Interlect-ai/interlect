import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/lib/supabase/auth-middleware";
import { serverText } from "@/lib/i18n/server-text";

/**
 * Self-host demo data (0900, `npm run seed:demo`): whether the fund has fictional demo cases, and
 * "Delete demo data" for admins. The deletion runs in one database transaction
 * (`delete_demo_data`) that removes exactly the rows the seed marked and writes the audit row;
 * the demo analyst's user is then removed through the auth API.
 */

export interface DemoDataStatus {
  /** Fictional demo cases still in the fund. */
  cases: number;
  /** Demo analysts whose user could not be removed yet (a deletion retries them). */
  leftover: number;
}

const fundInput = z.object({ fundId: z.guid() });

export const getDemoDataStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => fundInput.parse(input))
  .handler(async ({ data, context }): Promise<DemoDataStatus> => {
    // RLS: only the fund's members see its markers.
    const { data: rows, error } = await context.supabase
      .from("demo_data_rows")
      .select("entity")
      .eq("fund_id", data.fundId)
      .in("entity", ["case", "user"]);
    if (error) {
      // An installation without 0900 (the private edition) has no demo data: no banner.
      if (error.code === "42P01" || error.code === "PGRST205") return { cases: 0, leftover: 0 };
      console.error("[demo-data] status", error.code, error.message);
      throw new Error(serverText("demoData.server.statusNotRead"));
    }
    const cases = (rows ?? []).filter((row) => row["entity"] === "case").length;
    // The demo analyst's marker only matters once the cases are gone (a failed user removal).
    const leftover = cases ? 0 : (rows ?? []).length;
    return { cases, leftover };
  });

export interface DeleteDemoDataResult {
  cases: number;
  /** Demo analysts whose user could not be removed; the banner stays so it can be retried. */
  usersRemaining: number;
}

export const deleteDemoData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => fundInput.parse(input))
  .handler(async ({ data, context }): Promise<DeleteDemoDataResult> => {
    const { requireFundCapability } = await import("@/lib/auth/access.server");
    const { getServiceClient } = await import("@/lib/supabase/admin.server");
    // Admins only: the same capability as managing the fund's people.
    await requireFundCapability(context.supabase, context.userId, data.fundId, "manage_users");
    const service = getServiceClient();
    const { data: result, error } = await service.rpc("delete_demo_data", {
      _fund_id: data.fundId,
      _actor_id: context.userId,
    });
    if (error) {
      console.error("[demo-data] delete", error.code, error.message);
      throw new Error(serverText("demoData.server.notDeleted"));
    }
    const summary = (result ?? {}) as { cases?: number; users?: string[] };
    // The demo analyst authored the demo rows and is in no team (banned, no password). Its marker
    // stays until the user is gone: the banner then stays too, so the admin can retry.
    let usersRemaining = 0;
    for (const userId of summary.users ?? []) {
      const { error: userError } = await service.auth.admin.deleteUser(userId);
      if (userError && userError.status !== 404) {
        console.error("[demo-data] demo analyst not removed", userId, userError.message);
        usersRemaining += 1;
        continue;
      }
      const { error: markerError } = await service
        .from("demo_data_rows")
        .delete()
        .eq("fund_id", data.fundId)
        .eq("entity", "user")
        .eq("entity_id", userId);
      if (markerError) {
        console.error("[demo-data] demo analyst marker", userId, markerError.message);
        usersRemaining += 1;
      }
    }
    return { cases: summary.cases ?? 0, usersRemaining };
  });
