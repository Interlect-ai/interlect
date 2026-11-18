import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireFundCapability } from "@/lib/auth/access.server";
import { getServiceClient } from "@/lib/supabase/admin.server";
import { requireSupabaseAuth } from "@/lib/supabase/auth-middleware";
import { BrainUserError } from "./errors";
import { isBrainEnabled } from "./flags";
import { mergeRefusalText } from "./merge";
import { serverText } from "@/lib/i18n/server-text";

/**
 * "Slå sammen" og "Adskil". Admin and Lead (configure_fund): the right is
 * checked again here on every call, and the change is written to brain_log under the user's id
 * (0055), which is what "Adskil" reads back.
 */
const reason = z.string().trim().max(2000).optional();
const mergeInput = z
  .object({
    fundId: z.guid(),
    winnerId: z.guid(),
    loserId: z.guid(),
    reason,
  })
  .strict();
const splitInput = z.object({ fundId: z.guid(), entityId: z.guid(), reason }).strict();

export interface MergeResult {
  movedFacts: number;
  movedSources: number;
  addedAliases: number;
}
export interface SplitResult {
  winner: string;
  movedBackFacts: number;
  movedBackSources: number;
}

async function call<T>(
  name: "brain_merge_entities" | "brain_split_entities",
  args: Record<string, unknown>,
  context: string,
): Promise<T> {
  const { data, error } = await getServiceClient().rpc(name, args);
  if (error) {
    const text =
      error.code === "23505"
        ? serverText("brainServer.merge.sameFact")
        : mergeRefusalText(error.message);
    if (text) throw new BrainUserError(text);
    console.error(`[brain-merge] ${context}`, error.code, error.message);
    throw new Error(serverText("brainServer.merge.failed"));
  }
  return data as T;
}

export const mergeBrainEntities = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => mergeInput.parse(data))
  .handler(async ({ data, context }): Promise<MergeResult> => {
    await requireFundCapability(context.supabase, context.userId, data.fundId, "configure_fund");
    if (!isBrainEnabled()) throw new BrainUserError(serverText("brainServer.common.notEnabled"));
    return call<MergeResult>(
      "brain_merge_entities",
      {
        _fund_id: data.fundId,
        _winner: data.winnerId,
        _loser: data.loserId,
        _actor: `user:${context.userId}`,
        _reason: data.reason ?? null,
      },
      `fund=${data.fundId} winner=${data.winnerId} loser=${data.loserId}`,
    );
  });

export const splitBrainEntity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => splitInput.parse(data))
  .handler(async ({ data, context }): Promise<SplitResult> => {
    await requireFundCapability(context.supabase, context.userId, data.fundId, "configure_fund");
    if (!isBrainEnabled()) throw new BrainUserError(serverText("brainServer.common.notEnabled"));
    return call<SplitResult>(
      "brain_split_entities",
      {
        _fund_id: data.fundId,
        _loser: data.entityId,
        _actor: `user:${context.userId}`,
        _reason: data.reason ?? null,
      },
      `fund=${data.fundId} entity=${data.entityId}`,
    );
  });
