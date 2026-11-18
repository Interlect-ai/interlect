import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/lib/supabase/auth-middleware";
import { requireFundCapability } from "@/lib/auth/access.server";
import { getServiceClient } from "@/lib/supabase/admin.server";
import { serverText } from "@/lib/i18n/server-text";
import { withDemoView } from "@/lib/display/display-names.server";

/**
 * Beskeder på casen (0035). Alle roller må skrive (også Læser); kun forfatteren retter eller
 * sletter sin egen besked. Serveren skriver; klienten kan lytte live på case_messages via
 * Supabase Realtime, hvor RLS afgør, hvem der får beskederne.
 */

const fundIdSchema = z.guid();
const bodySchema = z.string().trim().min(1).max(5000);

export interface CaseMessage {
  id: string;
  kind: "user" | "system";
  body: string | null;
  authorId: string;
  authorName: string | null;
  isMine: boolean;
  editedAt: string | null;
  deleted: boolean;
  createdAt: string;
}

export const listCaseMessages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ fundId: fundIdSchema, caseId: z.guid() }).parse(input))
  .handler(
    withDemoView(async ({ data, context }): Promise<CaseMessage[]> => {
      await requireFundCapability(context.supabase, context.userId, data.fundId, "view_case");
      const { data: rows, error } = await context.supabase
        .from("case_messages")
        .select("id, kind, body, author_id, edited_at, deleted_at, created_at")
        .eq("fund_id", data.fundId)
        .eq("case_id", data.caseId)
        // The newest 500, shown oldest first: on a busy case the oldest fall off, never the newest.
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(500);
      if (error) {
        console.error("[listCaseMessages]", error.message);
        throw new Error(serverText("caseServer.messages.notLoaded"));
      }
      rows?.reverse();
      const authorIds = [...new Set((rows ?? []).map((row) => row["author_id"] as string))];
      const names = new Map<string, string | null>();
      if (authorIds.length) {
        const { data: profiles, error: profilesError } = await context.supabase
          .from("profiles")
          .select("id, full_name, email_normalized")
          .in("id", authorIds);
        // Names are cosmetic: the thread still loads, but the failure is logged.
        if (profilesError) console.error("[listCaseMessages] profiles", profilesError.message);
        for (const profile of profiles ?? []) {
          names.set(
            profile["id"] as string,
            (profile["full_name"] as string | null) ??
              (profile["email_normalized"] as string | null),
          );
        }
      }
      return (rows ?? []).map((row) => {
        const deleted = row["deleted_at"] !== null;
        return {
          id: row["id"] as string,
          kind: row["kind"] as "user" | "system",
          // A deleted message keeps its place in the thread without its text.
          body: deleted ? null : (row["body"] as string),
          authorId: row["author_id"] as string,
          authorName: names.get(row["author_id"] as string) ?? null,
          isMine: row["author_id"] === context.userId,
          editedAt: (row["edited_at"] as string | null) ?? null,
          deleted,
          createdAt: row["created_at"] as string,
        };
      });
    }),
  );

export const postCaseMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ fundId: fundIdSchema, caseId: z.guid(), body: bodySchema }).parse(input),
  )
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    await requireFundCapability(context.supabase, context.userId, data.fundId, "write_messages");
    const { data: row, error } = await getServiceClient()
      .from("case_messages")
      .insert({
        fund_id: data.fundId,
        case_id: data.caseId,
        author_id: context.userId,
        body: data.body,
      })
      .select("id")
      .single();
    if (error || !row) {
      if (error?.code === "23503")
        throw new Error(serverText("caseServer.common.caseNotFoundInFund"));
      console.error("[postCaseMessage]", error?.message);
      throw new Error(serverText("caseServer.messages.notSent"));
    }
    return { id: row["id"] as string };
  });

/** Only the author's own, not deleted, user message (never a system line). */
async function updateOwnMessage(
  service: SupabaseClient,
  input: { fundId: string; messageId: string; userId: string },
  patch: Record<string, unknown>,
): Promise<void> {
  const { data: rows, error } = await service
    .from("case_messages")
    .update(patch)
    .eq("id", input.messageId)
    .eq("fund_id", input.fundId)
    .eq("author_id", input.userId)
    .eq("kind", "user")
    .is("deleted_at", null)
    .select("id");
  if (error) {
    console.error("[case_messages] update", error.message);
    throw new Error(serverText("caseServer.messages.notChanged"));
  }
  if (!rows?.length) throw new Error(serverText("caseServer.messages.ownOnly"));
}

export const editCaseMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ fundId: fundIdSchema, messageId: z.guid(), body: bodySchema }).parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await requireFundCapability(context.supabase, context.userId, data.fundId, "write_messages");
    await updateOwnMessage(
      getServiceClient(),
      { fundId: data.fundId, messageId: data.messageId, userId: context.userId },
      { body: data.body, edited_at: new Date().toISOString() },
    );
    return { ok: true };
  });

export const deleteCaseMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ fundId: fundIdSchema, messageId: z.guid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await requireFundCapability(context.supabase, context.userId, data.fundId, "write_messages");
    await updateOwnMessage(
      getServiceClient(),
      { fundId: data.fundId, messageId: data.messageId, userId: context.userId },
      // The text is removed, not just hidden: members can read the table and Realtime payloads.
      { deleted_at: new Date().toISOString(), body: serverText("caseServer.messages.deleted") },
    );
    return { ok: true };
  });
