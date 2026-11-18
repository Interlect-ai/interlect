import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireFundCapability, writeAudit } from "@/lib/auth/access.server";
import { getServiceClient } from "@/lib/supabase/admin.server";
import { requireSupabaseAuth } from "@/lib/supabase/auth-middleware";
import { BrainUserError } from "./errors";
import { forgetSource, type ForgetSourceResult } from "./forget.server";
import { serverText } from "@/lib/i18n/server-text";

/**
 * "Glem denne kilde". Admin only (brain_forget): the capability is checked
 * again on the server on every call. It works with Brain switched off.
 */
const input = z.object({ fundId: z.guid(), sourceId: z.guid() }).strict();

export const forgetBrainSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => input.parse(data))
  .handler(async ({ data, context }): Promise<ForgetSourceResult> => {
    await requireFundCapability(context.supabase, context.userId, data.fundId, "brain_forget");
    // No BRAIN_ENABLED check: forgetting must work also when Brain is switched off, and
    // it reads and writes only through the service client, never through a model or the queue.
    const service = getServiceClient();
    try {
      return await forgetSource(
        {
          service,
          audit: (event) =>
            writeAudit(service, {
              fundId: data.fundId,
              actorType: "user",
              actorId: context.userId,
              action: event.action,
              entity: "brain_sources",
              entityId: event.sourceId,
              payload: event.payload,
            }),
        },
        data.fundId,
        data.sourceId,
      );
    } catch (cause) {
      if (cause instanceof BrainUserError) throw cause;
      console.error(
        `[brain-forget] fund=${data.fundId} source=${data.sourceId}`,
        cause instanceof Error ? cause.message : cause,
      );
      throw new Error(serverText("brainServer.forget.sourceNotForgotten"));
    }
  });
