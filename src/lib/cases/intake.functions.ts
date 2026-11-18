/**
 * Opret case, server side of Bekræft and the creation:
 *
 * - `getIntakeCapabilities`: does the database have the case-origin columns (migration 0056)?
 *   Staging and production share ONE database, so the UI must not select or write a column that
 *   may not exist yet: it asks first (probe with the service client, cached briefly).
 * - `getIntakeMandate`: the active thesis' stages, geographies and gate labels, for the
 *   mandate-fit preview (the gates themselves are judged in code, `intake-mandate.ts`).
 * - `findExistingCases`: duplicate check in the same fund (same rules as the RPC in 0007/0014:
 *   the website's domain, else the name) so a duplicate gets a friendly message with a link.
 * - `setIntakeCaseOrigin`: sets "Hvor kommer casen fra" and "Ansvarlig" through the service-only
 *   RPC `set_case_origin` (0056). Capability create_case, fund scoped, the assignee must be an
 *   active member of THAT fund, audited like other case changes.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/lib/supabase/auth-middleware";
import { requireFundCapability, writeAudit } from "@/lib/auth/access.server";
import { getServiceClient } from "@/lib/supabase/admin.server";
import type { MandateSnapshot } from "@/lib/cases/intake-mandate";
import { createCaseOriginProbe, mayEditCaseOrigin } from "@/lib/cases/intake-probe";
import { domainOfWebsite, lookupExistingCase } from "@/lib/cases/intake-duplicate";
import { hasCapability } from "@/lib/domain/workflow";
import { serverText } from "@/lib/i18n/server-text";
import { fromDemoView, inDemoView } from "@/lib/display/display-names.server";

export const CASE_SOURCE_KINDS = [
  "inbound",
  "network",
  "event",
  "outbound",
  "co_investor",
] as const;

const fundIdSchema = z.guid();

export interface IntakeCapabilities {
  /** `cases.source_kind` and `set_case_origin` exist (migration 0056 has run). */
  caseOrigin: boolean;
}

// ---------------------------------------------------------------------------------------
// Capability probe
// ---------------------------------------------------------------------------------------

const probeCaseOrigin = createCaseOriginProbe(
  async () => {
    const { error } = await getServiceClient().from("cases").select("source_kind").limit(0);
    return { error };
  },
  Date.now,
  (message, code) => console.warn("[intake-capabilities] probe failed", code, message),
);

export const getIntakeCapabilities = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ fundId: fundIdSchema }).parse(input))
  .handler(async ({ data, context }): Promise<IntakeCapabilities> => {
    await requireFundCapability(context.supabase, context.userId, data.fundId, "view_case");
    return { caseOrigin: await probeCaseOrigin() };
  });

// ---------------------------------------------------------------------------------------
// Mandate snapshot for the preview
// ---------------------------------------------------------------------------------------

export const getIntakeMandate = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ fundIds: z.array(fundIdSchema).min(1).max(20) }).parse(input),
  )
  .handler(async ({ data, context }): Promise<MandateSnapshot[]> => {
    const snapshots: MandateSnapshot[] = [];
    for (const fundId of data.fundIds) {
      await requireFundCapability(context.supabase, context.userId, fundId, "view_case");
      const { data: config, error } = await context.supabase
        .from("fund_config_versions")
        .select(
          "fund_id, funds(name), fund_mandates(stages, geographies), mandate_gates(gate_key, label, sort_order)",
        )
        .eq("fund_id", fundId)
        .eq("status", "active")
        .maybeSingle();
      if (error) {
        console.error("[getIntakeMandate]", error.message);
        throw new Error(serverText("caseServer.intake.requirementsNotLoaded"));
      }
      if (!config) continue;
      const row = config as unknown as {
        funds: { name: string } | { name: string }[] | null;
        fund_mandates:
          | { stages: string[] | null; geographies: string[] | null }
          | { stages: string[] | null; geographies: string[] | null }[]
          | null;
        mandate_gates: { gate_key: string; label: string; sort_order: number | null }[] | null;
      };
      const fund = Array.isArray(row.funds) ? row.funds[0] : row.funds;
      const mandate = Array.isArray(row.fund_mandates) ? row.fund_mandates[0] : row.fund_mandates;
      snapshots.push({
        fundId,
        fundName: fund?.name ?? "",
        stages: mandate?.stages ?? [],
        geographies: mandate?.geographies ?? [],
        gates: [...(row.mandate_gates ?? [])]
          .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
          .map((gate) => ({ key: gate.gate_key, label: gate.label })),
      });
    }
    return snapshots;
  });

// ---------------------------------------------------------------------------------------
// Duplicate check
// ---------------------------------------------------------------------------------------

export interface ExistingCaseHit {
  fundId: string;
  caseId: string;
  companyName: string;
}

export const findExistingCases = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        fundIds: z.array(fundIdSchema).min(1).max(20),
        companyName: z.string().trim().min(1).max(200),
        website: z.string().max(300).default(""),
        /** The CVR a human chose; a registered company is the same company under any trade name. */
        cvrNumber: z
          .string()
          .regex(/^\d{8}$/)
          .nullish(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<ExistingCaseHit[]> => {
    const domain = domainOfWebsite(data.website);
    const hits: ExistingCaseHit[] = [];
    for (const fundId of data.fundIds) {
      await requireFundCapability(context.supabase, context.userId, fundId, "create_case");
      // RLS-scoped read: the caller's own fund only.
      let existing;
      try {
        existing = await lookupExistingCase(context.supabase, {
          fundId,
          companyName: await fromDemoView(fundId, data.companyName),
          domain,
          cvrNumber: data.cvrNumber ?? null,
        });
      } catch (cause) {
        console.error("[findExistingCases]", cause);
        throw new Error(serverText("caseServer.intake.existingNotChecked"));
      }
      if (existing) hits.push(await inDemoView(fundId, { fundId, ...existing }));
    }
    return hits;
  });

// ---------------------------------------------------------------------------------------
// The screening run of a case (when the response of "start" was lost)
// ---------------------------------------------------------------------------------------

export const findScreeningRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ fundId: fundIdSchema, caseId: z.guid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ runId: string | null }> => {
    await requireFundCapability(context.supabase, context.userId, data.fundId, "view_case");
    const { data: rows, error } = await context.supabase
      .from("analysis_runs")
      .select("id")
      .eq("fund_id", data.fundId)
      .eq("case_id", data.caseId)
      .eq("kind", "screening")
      .in("status", ["queued", "running", "awaiting_approval", "complete"])
      .order("created_at", { ascending: false })
      .limit(1);
    if (error) {
      console.error("[findScreeningRun]", error.message);
      throw new Error(serverText("caseServer.intake.runNotFound"));
    }
    return { runId: (rows?.[0]?.["id"] as string | undefined) ?? null };
  });

// ---------------------------------------------------------------------------------------
// Origin and owner
// ---------------------------------------------------------------------------------------

export const setIntakeCaseOrigin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        fundId: fundIdSchema,
        caseId: z.guid(),
        sourceKind: z.enum(CASE_SOURCE_KINDS).nullable(),
        assignedTo: z.guid().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const access = await requireFundCapability(
      context.supabase,
      context.userId,
      data.fundId,
      "create_case",
    );
    if (!(await probeCaseOrigin())) {
      throw new Error(serverText("caseServer.intake.sourceNotYet"));
    }
    const service = getServiceClient();
    // The case must belong to this fund before anything is written with the service key.
    const { data: caseRow, error: caseError } = await service
      .from("cases")
      .select("id, source_kind, assigned_to, created_by, created_at")
      .eq("id", data.caseId)
      .eq("fund_id", data.fundId)
      .maybeSingle();
    if (caseError) {
      console.error("[setIntakeCaseOrigin] case", caseError.message);
      throw new Error(serverText("caseServer.common.caseNotLookedUp"));
    }
    if (!caseRow) throw new Error(serverText("caseServer.common.caseNotInFund"));
    // Intake may only set origin and owner on a case the caller just created (within two
    // hours); changing them later is for Lead and Admin (configure_fund) in the case itself.
    if (
      !mayEditCaseOrigin({
        isLeadOrAdmin: hasCapability(access.roles, "configure_fund", access.settings),
        callerId: context.userId,
        createdBy: (caseRow["created_by"] as string | null) ?? null,
        createdAt: (caseRow["created_at"] as string | null) ?? null,
        now: Date.now(),
      })
    ) {
      throw new Error(serverText("caseServer.intake.onlyCreator"));
    }
    if (data.assignedTo) {
      const { data: member, error: memberError } = await service
        .from("fund_memberships")
        .select("id")
        .eq("fund_id", data.fundId)
        .eq("user_id", data.assignedTo)
        .eq("status", "active")
        .maybeSingle();
      if (memberError) {
        console.error("[setIntakeCaseOrigin] member", memberError.message);
        throw new Error(serverText("caseServer.intake.ownerNotChecked"));
      }
      if (!member) throw new Error(serverText("caseServer.common.ownerNotMember"));
    }
    const { error } = await service.rpc("set_case_origin", {
      _case_id: data.caseId,
      _source_kind: data.sourceKind,
      _assigned_to: data.assignedTo,
    });
    if (error) {
      console.error("[set_case_origin]", error.code, error.message);
      if (error.code === "IL001") {
        throw new Error(serverText("caseServer.common.ownerNotMember"));
      }
      throw new Error(serverText("caseServer.intake.sourceNotSaved"));
    }
    await writeAudit(service, {
      fundId: data.fundId,
      actorType: "user",
      actorId: context.userId,
      action: "case_origin_set",
      entity: "cases",
      entityId: data.caseId,
      payload: {
        source_kind: data.sourceKind,
        assigned_to: data.assignedTo,
        previous_source_kind: (caseRow["source_kind"] as string | null) ?? null,
        previous_assigned_to: (caseRow["assigned_to"] as string | null) ?? null,
      },
    }).catch((cause) => {
      // The change is made; a missing audit line must not lose the case, but it is logged.
      console.error("[setIntakeCaseOrigin] audit", cause);
    });
    return { ok: true };
  });
