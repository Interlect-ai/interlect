/**
 * `getBrainCapabilities` (batch 0): what Brain can do for this user in this fund RIGHT NOW
 * (probe rules in `capabilities.ts`, queries in `capabilities.server.ts`). No Brain page or menu
 * item may read a Brain table without asking here first.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireFundCapability } from "@/lib/auth/access.server";
import { requireSupabaseAuth } from "@/lib/supabase/auth-middleware";
import type { BrainCapabilities } from "./capabilities";

export const getBrainCapabilities = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ fundId: z.guid() }).parse(input))
  .handler(async ({ data, context }): Promise<BrainCapabilities> => {
    const access = await requireFundCapability(
      context.supabase,
      context.userId,
      data.fundId,
      "view_case",
    );
    const { computeBrainCapabilities } = await import("./capabilities.server");
    return computeBrainCapabilities(data.fundId, access);
  });
