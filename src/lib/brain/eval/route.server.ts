import { z } from "zod";
import { getServiceClient } from "@/lib/supabase/admin.server";
import { isAuthorizedCron } from "../cron";
import { BrainUserError } from "../errors";
import { isBrainEnabled } from "../flags";
import { runDemoEval } from "./run.server";

const bodySchema = z.object({ fundId: z.guid() }).strict();

/**
 * Operator access to the demo test set, until L7 runs it on a schedule:
 * POST /api/brain/eval {"fundId"} with "Authorization: Bearer <CRON_SECRET>".
 */
export async function handleBrainEval(request: Request): Promise<Response> {
  if (!isAuthorizedCron(request.headers.get("authorization"), process.env["CRON_SECRET"])) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (!isBrainEnabled()) return Response.json({ error: "disabled" }, { status: 409 });
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return Response.json({ error: "invalid body" }, { status: 400 });
  }
  try {
    return Response.json(await runDemoEval(getServiceClient(), body.fundId));
  } catch (cause) {
    if (cause instanceof BrainUserError)
      return Response.json({ error: cause.message }, { status: 409 });
    console.error("[brain-eval]", cause instanceof Error ? cause.message : cause);
    return Response.json({ error: "eval failed" }, { status: 500 });
  }
}
