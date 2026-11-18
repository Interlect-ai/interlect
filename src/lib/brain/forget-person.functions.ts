import { inDemoView } from "@/lib/display/display-names.server";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireFundCapability, writeAudit } from "@/lib/auth/access.server";
import { getServiceClient } from "@/lib/supabase/admin.server";
import { requireSupabaseAuth } from "@/lib/supabase/auth-middleware";
import { redactorForFund } from "@/lib/ai/redact-dictionary.server";
import { embedWithGateway } from "./embeddings.server";
import { BrainUserError } from "./errors";
import {
  forgetPerson,
  previewForgetPerson,
  type ForgetPersonPreview,
  type ForgetPersonResult,
} from "./forget-person.server";
import { serverText } from "@/lib/i18n/server-text";
import { storageSourceReader } from "./forget-person-files.server";

/**
 * "Glem denne person". Admin only (brain_forget): the capability is checked
 * again on the server on every call. Either the raw person or the Brain entity is given. The
 * preview shows the name and the files that name the person before anything changes; `removeFiles`
 * deletes those files from Storage too (their text stays, masked).
 */
const target = {
  fundId: z.guid(),
  personId: z.guid().optional(),
  entityId: z.guid().optional(),
};
const hasTarget = (value: { personId?: string | undefined; entityId?: string | undefined }) =>
  value.personId !== undefined || value.entityId !== undefined;
// i18n-keep: a validation message; it never reaches people (userMessage shows the fallback).
const targetMessage = { error: "En person eller en Brain-entitet skal angives." };
const input = z
  .object({ ...target, removeFiles: z.boolean().default(false) })
  .strict()
  .refine(hasTarget, targetMessage);
const previewInput = z.object(target).strict().refine(hasTarget, targetMessage);

export const previewForgetBrainPerson = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => previewInput.parse(data))
  .handler(async ({ data, context }): Promise<ForgetPersonPreview> => {
    await requireFundCapability(context.supabase, context.userId, data.fundId, "brain_forget");
    try {
      const service = getServiceClient();
      return await inDemoView(
        data.fundId,
        await previewForgetPerson(
          service,
          data.fundId,
          { personId: data.personId, entityId: data.entityId },
          storageSourceReader(service),
        ),
      );
    } catch (cause) {
      if (cause instanceof BrainUserError) throw cause;
      console.error(
        `[brain-forget-person] preview fund=${data.fundId}`,
        cause instanceof Error ? cause.message : cause,
      );
      throw new Error(serverText("brainServer.forget.personNotForgotten"));
    }
  });

export const forgetBrainPerson = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => input.parse(data))
  .handler(async ({ data, context }): Promise<ForgetPersonResult> => {
    await requireFundCapability(context.supabase, context.userId, data.fundId, "brain_forget");
    const service = getServiceClient();
    try {
      return await forgetPerson(
        {
          service,
          embed: embedWithGateway,
          redactor: (fundId) => redactorForFund(fundId, "brain_forget", service),
          audit: (event) =>
            writeAudit(service, {
              fundId: data.fundId,
              actorType: "user",
              actorId: context.userId,
              action: event.action,
              entity: "people",
              entityId: data.personId ?? data.entityId ?? null,
              payload: event.payload,
            }),
          removeFiles: async (bucket, paths) => {
            const { error } = await service.storage.from(bucket).remove(paths);
            if (error) throw new Error(`storage remove: ${error.message}`);
          },
          readSource: storageSourceReader(service),
        },
        data.fundId,
        { personId: data.personId, entityId: data.entityId },
        { removeFiles: data.removeFiles },
      );
    } catch (cause) {
      if (cause instanceof BrainUserError) throw cause;
      console.error(
        `[brain-forget-person] fund=${data.fundId}`,
        cause instanceof Error ? cause.message : cause,
      );
      throw new Error(serverText("brainServer.forget.personNotForgotten"));
    }
  });
