import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireFundCapability, writeAudit, writeAuditWithId } from "@/lib/auth/access.server";
import { hasCapability } from "@/lib/domain/workflow";
import { getServiceClient } from "@/lib/supabase/admin.server";
import { requireSupabaseAuth } from "@/lib/supabase/auth-middleware";
import { reasonCodeFieldsSchema, uniqueReasonCode, type ReasonGroup } from "./reason-code-rules";
import { requestLanguage, serverText } from "@/lib/i18n/server-text";

/**
 * Fondens årsager til beslutninger (brain_reason_codes). Alle i fonden læser; kun
 * Admin og Lead (configure_fund) tilføjer, retter og deaktiverer. En årsag slettes aldrig:
 * en deaktiveret kan ikke vælges mere, men gamle rækker beholder den. Selve koden ændres aldrig.
 */
export interface ReasonCodeView {
  id: string;
  code: string;
  label: string;
  groupKey: ReasonGroup;
  appliesTo: string[];
  revisit: boolean;
  isActive: boolean;
  sortOrder: number;
}

const fundIdSchema = z.guid();
const COLUMNS = "id, code, label, group_key, applies_to, revisit, is_active, sort_order";

function toView(row: Record<string, unknown>): ReasonCodeView {
  return {
    id: row["id"] as string,
    code: row["code"] as string,
    label: row["label"] as string,
    groupKey: row["group_key"] as ReasonGroup,
    appliesTo: row["applies_to"] as string[],
    revisit: row["revisit"] === true,
    isActive: row["is_active"] !== false,
    sortOrder: Number(row["sort_order"] ?? 0),
  };
}

export const listReasonCodes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ fundId: fundIdSchema }).parse(input))
  .handler(async ({ data, context }): Promise<{ codes: ReasonCodeView[]; canEdit: boolean }> => {
    const access = await requireFundCapability(
      context.supabase,
      context.userId,
      data.fundId,
      "view_case",
    );
    const { data: rows, error } = await context.supabase
      .from("brain_reason_codes")
      .select(COLUMNS)
      .eq("fund_id", data.fundId)
      .order("sort_order", { ascending: true })
      .order("label", { ascending: true });
    if (error) {
      console.error("[reason-codes] list", error.message);
      throw new Error(serverText("fundServer.common.reasonsNotLoaded"));
    }
    return {
      codes: (rows ?? []).map((row) => toView(row as Record<string, unknown>)),
      canEdit: hasCapability(access.roles, "configure_fund", access.settings),
    };
  });

/** Adds a reason (without `id`) or edits one's text, group, use, revisit flag and order (with `id`). */
export const saveReasonCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({ fundId: fundIdSchema, id: z.guid().optional() })
      .and(reasonCodeFieldsSchema)
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<ReasonCodeView> => {
    await requireFundCapability(context.supabase, context.userId, data.fundId, "configure_fund");
    const service = getServiceClient();
    const fields = {
      label: data.label,
      group_key: data.groupKey,
      applies_to: data.appliesTo,
      revisit: data.revisit,
      sort_order: data.sortOrder,
    };

    if (data.id) {
      const auditId = await writeAuditWithId(service, {
        fundId: data.fundId,
        actorType: "user",
        actorId: context.userId,
        action: "reason_code_changed",
        entity: "brain_reason_codes",
        entityId: data.id,
        payload: { after: fields },
      });
      const { data: row, error } = await service
        .from("brain_reason_codes")
        .update(fields)
        .eq("id", data.id)
        .eq("fund_id", data.fundId)
        .select(COLUMNS)
        .maybeSingle();
      if (error || !row) {
        console.error("[reason-codes] update", error?.message);
        await auditNotSaved(
          service,
          data.fundId,
          context.userId,
          data.id,
          "reason_code_changed",
          auditId,
        );
        throw new Error(serverText("fundServer.reasons.notSaved"));
      }
      return toView(row as Record<string, unknown>);
    }

    const { data: existing, error: existingError } = await service
      .from("brain_reason_codes")
      .select("code")
      .eq("fund_id", data.fundId);
    if (existingError) throw new Error(serverText("fundServer.common.reasonsNotLoaded"));
    const code = uniqueReasonCode(
      data.label,
      new Set((existing ?? []).map((row) => row["code"] as string)),
      requestLanguage(),
    );
    const auditId = await writeAuditWithId(service, {
      fundId: data.fundId,
      actorType: "user",
      actorId: context.userId,
      action: "reason_code_added",
      entity: "brain_reason_codes",
      entityId: null,
      payload: { code, after: fields },
    });
    const { data: row, error } = await service
      .from("brain_reason_codes")
      .insert({ fund_id: data.fundId, code, ...fields })
      .select(COLUMNS)
      .single();
    if (error || !row) {
      console.error("[reason-codes] insert", error?.message);
      await auditNotSaved(service, data.fundId, context.userId, null, "reason_code_added", auditId);
      throw new Error(serverText("fundServer.reasons.notAdded"));
    }
    return toView(row as Record<string, unknown>);
  });

/**
 * The audit row for a change is written before the change (if it cannot be written, nothing
 * changes). When the change then fails, this records that it never happened, so the change
 * history (change-history.ts) does not show it. Best effort: a failure here is only logged.
 */
async function auditNotSaved(
  service: ReturnType<typeof getServiceClient>,
  fundId: string,
  actorId: string,
  entityId: string | null,
  action: string,
  undoes: string | null,
) {
  try {
    await writeAudit(service, {
      fundId,
      actorType: "user",
      actorId,
      action: "reason_code_not_saved",
      entity: "brain_reason_codes",
      entityId,
      payload: { action, undoes },
    });
  } catch (cause) {
    console.error("[reason-codes] not-saved audit", cause);
  }
}

/** Deactivates or reactivates a reason. It is never deleted: older rows keep it. */
export const setReasonCodeActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ fundId: fundIdSchema, id: z.guid(), active: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<ReasonCodeView> => {
    await requireFundCapability(context.supabase, context.userId, data.fundId, "configure_fund");
    const service = getServiceClient();
    const auditId = await writeAuditWithId(service, {
      fundId: data.fundId,
      actorType: "user",
      actorId: context.userId,
      action: data.active ? "reason_code_activated" : "reason_code_deactivated",
      entity: "brain_reason_codes",
      entityId: data.id,
      payload: {},
    });
    const { data: row, error } = await service
      .from("brain_reason_codes")
      .update({ is_active: data.active })
      .eq("id", data.id)
      .eq("fund_id", data.fundId)
      .select(COLUMNS)
      .maybeSingle();
    if (error || !row) {
      console.error("[reason-codes] set active", error?.message);
      await auditNotSaved(
        service,
        data.fundId,
        context.userId,
        data.id,
        data.active ? "reason_code_activated" : "reason_code_deactivated",
        auditId,
      );
      throw new Error(serverText("fundServer.reasons.notChanged"));
    }
    return toView(row as Record<string, unknown>);
  });
