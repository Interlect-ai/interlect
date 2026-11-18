import { z } from "zod";
import { writeAudit } from "@/lib/auth/access.server";
import { getServiceClient } from "@/lib/supabase/admin.server";
import { BACKFILL_LEVELS } from "./backfill";
import {
  estimateFundBackfill,
  fundBackfillProgress,
  startFundBackfill,
  stopFundBackfill,
} from "./backfill.server";
import { isAuthorizedCron } from "./cron";
import { BrainUserError } from "./errors";
import { isBrainEnabled } from "./flags";

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("estimate"), fundId: z.guid() }).strict(),
  z
    .object({
      action: z.literal("start"),
      fundId: z.guid(),
      level: z.enum(BACKFILL_LEVELS),
    })
    .strict(),
  z
    .object({
      action: z.enum(["stop", "status"]),
      fundId: z.guid(),
      level: z.enum(BACKFILL_LEVELS),
      runId: z.string().regex(/^\d{8}T\d{6}Z$/),
    })
    .strict(),
]);

/**
 * Operator access to the backfill (onboarding a fund, the live test before the Brain UI exists):
 * POST /api/brain/backfill with "Authorization: Bearer <CRON_SECRET>", the same secret as the
 * nightly cron. Users start it from Brain · Kilder through backfill.functions.ts instead.
 */
export async function handleBrainBackfill(request: Request): Promise<Response> {
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

  const service = getServiceClient();
  const { data: fund, error } = await service
    .from("funds")
    .select("id")
    .eq("id", body.fundId)
    .maybeSingle();
  if (error) {
    console.error("[brain-backfill] fund lookup", error.code, error.message);
    return Response.json({ error: "fund lookup failed" }, { status: 500 });
  }
  if (!fund) return Response.json({ error: "unknown fund" }, { status: 404 });

  try {
    switch (body.action) {
      case "estimate":
        return Response.json(await estimateFundBackfill(service, body.fundId));
      case "start": {
        const started = await startFundBackfill(service, body.fundId, body.level, (start) =>
          writeAudit(service, {
            fundId: body.fundId,
            actorType: "system",
            actorId: null,
            action: "brain_backfill_started",
            entity: "brain_backfill",
            entityId: null,
            payload: {
              level: start.level,
              runId: start.runId,
              estimate: start.estimate,
              via: "operator",
            },
          }),
        );
        return Response.json(started);
      }
      case "stop":
        await writeAudit(service, {
          fundId: body.fundId,
          actorType: "system",
          actorId: null,
          action: "brain_backfill_stopped",
          entity: "brain_backfill",
          entityId: null,
          payload: { level: body.level, runId: body.runId, via: "operator" },
        });
        await stopFundBackfill(service, body.fundId, body.level, body.runId);
        return Response.json({ ok: true });
      case "status":
        return Response.json(
          await fundBackfillProgress(service, body.fundId, body.level, body.runId),
        );
    }
  } catch (cause) {
    if (cause instanceof BrainUserError)
      return Response.json({ error: cause.message }, { status: 409 });
    console.error("[brain-backfill]", body.action, cause instanceof Error ? cause.message : cause);
    return Response.json({ error: "backfill failed" }, { status: 500 });
  }
}
