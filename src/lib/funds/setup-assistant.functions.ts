import { createServerFn } from "@tanstack/react-start";
import { requireFundCapability } from "@/lib/auth/access.server";
import { requireSupabaseAuth } from "@/lib/supabase/auth-middleware";
import { assistantRequestSchema, type AssistantReply } from "./setup-assistant";
import { answerSetupAssistant } from "./setup-assistant.server";

/**
 * One answer from the Interlect-Assistent in Teamopsætning. The page sends the session's
 * newest messages and what it shows (the setup as edited, for the stage on screen); the answer is
 * words and at most one proposed change, checked against what the page sent. Nothing is stored:
 * the conversation lives in the browser, and a change is only made by the page after a Ja.
 * Admin and Lead (configure_fund), because the setup is theirs to change.
 */
export const askSetupAssistant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => assistantRequestSchema.parse(input))
  .handler(async ({ data, context }): Promise<AssistantReply> => {
    await requireFundCapability(context.supabase, context.userId, data.fundId, "configure_fund");
    const { answer, change } = await answerSetupAssistant(data, {
      userId: context.userId,
      loop: "fund_setup:assistant",
    });
    return { answer, change };
  });
