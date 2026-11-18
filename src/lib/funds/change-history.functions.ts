import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireFundCapability } from "@/lib/auth/access.server";
import { getServiceClient } from "@/lib/supabase/admin.server";
import { requireSupabaseAuth } from "@/lib/supabase/auth-middleware";
import {
  describeHistoryEvent,
  HISTORY_ACTIONS,
  UNDONE_ACTIONS,
  withoutUndone,
  type HistoryEntry,
} from "./change-history";
import { requestLanguage, serverText } from "@/lib/i18n/server-text";

const HISTORY_LIMIT = 40;
// Room for the "not saved" rows, which are read but never shown.
const READ_LIMIT = HISTORY_LIMIT + 20;

/**
 * "Historik" on the Se page: who changed the setup, in plain Danish. Admin and Lead
 * (configure_fund). The audit log itself is for Admin only (RLS); this reads it with the service
 * role after the capability is checked, shows only the events that belong to the setup, and never
 * passes a payload on as it is.
 */
export const listFundChangeHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ fundId: z.guid() }).parse(input))
  .handler(async ({ data, context }): Promise<HistoryEntry[]> => {
    await requireFundCapability(context.supabase, context.userId, data.fundId, "configure_fund");
    const service = getServiceClient();
    const { data: rows, error } = await service
      .from("audit_events")
      .select("id, action, actor_type, actor_id, entity_id, occurred_at, payload")
      .eq("fund_id", data.fundId)
      .in("action", [...HISTORY_ACTIONS, ...Object.keys(UNDONE_ACTIONS)])
      .order("occurred_at", { ascending: false })
      .limit(READ_LIMIT);
    if (error) {
      console.error("[change-history] list", error.message);
      throw new Error(serverText("fundServer.history.notLoaded"));
    }
    // A change logged first and then refused never happened: leave it out.
    const kept = withoutUndone(
      (rows ?? []).map((row) => ({
        id: row["id"] as string,
        action: row["action"] as string,
        actorId: (row["actor_id"] as string | null) ?? null,
        entityId: (row["entity_id"] as string | null) ?? null,
        payload: (row["payload"] as Record<string, unknown> | null) ?? null,
        occurredAt: row["occurred_at"] as string,
      })),
    );
    const actorIds = [
      ...new Set(kept.map((row) => row.actorId).filter((id): id is string => Boolean(id))),
    ];
    const names = new Map<string, string>();
    if (actorIds.length > 0) {
      const { data: profiles } = await service
        .from("profiles")
        .select("id, full_name")
        .in("id", actorIds);
      for (const profile of profiles ?? []) {
        const name = (profile["full_name"] as string | null)?.trim();
        if (name) names.set(profile["id"] as string, name);
      }
    }
    return kept.slice(0, HISTORY_LIMIT).flatMap((row) => {
      const line = describeHistoryEvent(row.action, row.payload, requestLanguage());
      if (!line) return [];
      return [
        {
          id: row.id,
          text: line,
          actor: row.actorId
            ? (names.get(row.actorId) ?? serverText("fundServer.history.teamMember"))
            : null,
          at: row.occurredAt,
        },
      ];
    });
  });
