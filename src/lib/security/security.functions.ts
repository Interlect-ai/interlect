import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/lib/supabase/auth-middleware";
import { requireFundCapability } from "@/lib/auth/access.server";
import { shouldEnforceZdr, shouldEnforceEuRegion } from "@/lib/analysis/gateway-security";

/** Sikkerhedsstatus for den aktive investeringstese. Kun administratorer. */

export interface SecurityPosture {
  zdrEnforced: boolean;
  euRegionEnforced: boolean;
}

export const getSecurityPosture = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ fundId: z.guid() }).parse(input))
  .handler(async ({ data, context }): Promise<SecurityPosture> => {
    await requireFundCapability(context.supabase, context.userId, data.fundId, "manage_users");
    return { zdrEnforced: shouldEnforceZdr(), euRegionEnforced: shouldEnforceEuRegion() };
  });
