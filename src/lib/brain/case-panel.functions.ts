/**
 * "Brain om denne case": one read for the panel on the case page. The gate is the
 * same as the chat's (brain_chat plus a live probe) and the case must be visible to the user
 * (RLS); the data is read with the service client, scoped to the fund.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireFundCapability } from "@/lib/auth/access.server";
import { requireSupabaseAuth } from "@/lib/supabase/auth-middleware";
import type { BrainCasePanel } from "./case-panel";
import { inDemoView } from "@/lib/display/display-names.server";
import { BrainUserError } from "./errors";
import { serverText } from "@/lib/i18n/server-text";

export const getBrainCasePanel = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ fundId: z.guid(), caseId: z.guid() }).strict().parse(input),
  )
  .handler(async ({ data, context }): Promise<BrainCasePanel> => {
    const access = await requireFundCapability(
      context.supabase,
      context.userId,
      data.fundId,
      "brain_chat",
    );
    const { computeBrainCapabilities } = await import("./capabilities.server");
    const caps = await computeBrainCapabilities(data.fundId, access);
    if (!caps.chat) throw new BrainUserError(serverText("brainServer.common.notAvailable"));

    const { data: visible, error } = await context.supabase
      .from("cases")
      .select("id")
      .eq("fund_id", data.fundId)
      .eq("id", data.caseId)
      .maybeSingle();
    if (error) throw new Error(serverText("brainServer.common.caseNotLoaded"));
    if (!visible) throw new BrainUserError(serverText("brainServer.common.caseNotFound"));

    try {
      const { getServiceClient } = await import("@/lib/supabase/admin.server");
      const { buildCasePanel } = await import("./case-panel.server");
      // Demo view: the panel shows the team's invented names.
      return await inDemoView(
        data.fundId,
        await buildCasePanel(getServiceClient(), data.fundId, data.caseId),
      );
    } catch (cause) {
      console.error("[brain-panel]", cause instanceof Error ? cause.message : cause);
      throw new Error(serverText("brainServer.casePanel.notLoaded"));
    }
  });
