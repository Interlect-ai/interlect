import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/lib/supabase/auth-middleware";
import { requireFundCapability, writeAudit } from "@/lib/auth/access.server";
import { getServiceClient } from "@/lib/supabase/admin.server";
import { hasCapability } from "@/lib/domain/workflow";
import { serverText } from "@/lib/i18n/server-text";

/**
 * P3: forslag til ændringer i fondsopsætningen. Alle kald bruger brugerens egen klient,
 * så databasens regler (migration 0024) afgør, hvem der må læse, foreslå og løse.
 */
export interface FundSuggestion {
  id: string;
  body: string;
  status: "open" | "resolved";
  createdAt: string;
  resolvedAt: string | null;
  isMine: boolean;
}

const fundIdSchema = z.guid();

export const listFundSuggestions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ fundId: fundIdSchema }).parse(input))
  .handler(
    async ({
      data,
      context,
    }): Promise<{ suggestions: FundSuggestion[]; canSuggest: boolean; canResolve: boolean }> => {
      const access = await requireFundCapability(
        context.supabase,
        context.userId,
        data.fundId,
        "view_case",
      );
      const { data: rows, error } = await context.supabase
        .from("fund_config_suggestions")
        .select("id, body, status, created_at, resolved_at, author_id")
        .eq("fund_id", data.fundId)
        .order("status", { ascending: true })
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) {
        console.error(`[suggestions] list failed (fund ${data.fundId})`, error.message);
        throw new Error(serverText("fundServer.common.proposalsNotLoaded"));
      }
      return {
        suggestions: (rows ?? []).map((row) => ({
          id: row["id"] as string,
          body: row["body"] as string,
          status: row["status"] as "open" | "resolved",
          createdAt: row["created_at"] as string,
          resolvedAt: (row["resolved_at"] as string | null) ?? null,
          isMine: row["author_id"] === context.userId,
        })),
        canSuggest: hasCapability(access.roles, "propose_fund_change", access.settings),
        // Samme regel som databasen (0021/0024): den, der må redigere opsætningen, løser forslag.
        canResolve: hasCapability(access.roles, "configure_fund", access.settings),
      };
    },
  );

export const addFundSuggestion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ fundId: fundIdSchema, body: z.string().trim().min(3).max(2000) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireFundCapability(
      context.supabase,
      context.userId,
      data.fundId,
      "propose_fund_change",
    );
    const { error } = await context.supabase.from("fund_config_suggestions").insert({
      fund_id: data.fundId,
      author_id: context.userId,
      body: data.body,
    });
    if (error) {
      console.error(`[suggestions] insert failed (fund ${data.fundId})`, error.message);
      throw new Error(serverText("fundServer.common.proposalNotSaved"));
    }
    return { ok: true };
  });

export const setFundSuggestionStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        fundId: fundIdSchema,
        id: z.guid(),
        status: z.enum(["open", "resolved"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const access = await requireFundCapability(
      context.supabase,
      context.userId,
      data.fundId,
      "view_case",
    );
    if (!hasCapability(access.roles, "configure_fund", access.settings)) {
      throw new Error(serverText("fundServer.suggestions.leadOnly"));
    }
    // Hvem og hvornår stemples af databasen (trigger i migration 0024).
    const { data: updated, error } = await context.supabase
      .from("fund_config_suggestions")
      .update({ status: data.status })
      .eq("id", data.id)
      .eq("fund_id", data.fundId)
      .select("id");
    if (error || !updated?.length) {
      console.error(`[suggestions] update failed (fund ${data.fundId})`, error?.message);
      throw new Error(serverText("fundServer.suggestions.notUpdated"));
    }
    // Løsning og genåbning skrives i revisionsloggen (tidsstemplerne på rækken kan nulstilles).
    await writeAudit(getServiceClient(), {
      fundId: data.fundId,
      actorType: "user",
      actorId: context.userId,
      action: data.status === "resolved" ? "fund_suggestion_resolved" : "fund_suggestion_reopened",
      entity: "fund_config_suggestion",
      entityId: data.id,
    });
    return { ok: true };
  });
