/**
 * Hjernekortets data: the whole brain of the fund for the map in one call. The
 * gate is the chat's (brain_chat and a live chat); the payload is built in the database
 * (brain_graph_payload, 0074) through the user's own session, so row security decides what is in
 * it. A new fund gets an empty graph, not an error.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireFundCapability } from "@/lib/auth/access.server";
import { requireSupabaseAuth } from "@/lib/supabase/auth-middleware";
import { inDemoView } from "@/lib/display/display-names.server";
import { BrainUserError } from "./errors";
import { localizeGraphLabels, shapeGraph, type BrainGraph } from "./graph";
import { requestLanguage, serverText } from "@/lib/i18n/server-text";

export const getBrainGraph = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ fundId: z.guid() }).strict().parse(input))
  .handler(async ({ data, context }): Promise<BrainGraph> => {
    const access = await requireFundCapability(
      context.supabase,
      context.userId,
      data.fundId,
      "brain_chat",
    );
    const { computeBrainCapabilities } = await import("./capabilities.server");
    const caps = await computeBrainCapabilities(data.fundId, access);
    if (!caps.chat) throw new BrainUserError(serverText("brainServer.common.notAvailable"));

    const { data: payload, error } = await context.supabase.rpc("brain_graph_payload", {
      _fund_id: data.fundId,
    });
    if (error) {
      console.error("[brain-graph]", error.message);
      throw new Error(serverText("brainServer.graph.notLoaded"));
    }
    // Decisions, dates and stages in the team's language.
    return inDemoView(data.fundId, localizeGraphLabels(shapeGraph(payload), requestLanguage()));
  });
