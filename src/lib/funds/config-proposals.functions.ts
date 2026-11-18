import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireFundCapability, writeAudit, writeAuditWithId } from "@/lib/auth/access.server";
import { hasCapability } from "@/lib/domain/workflow";
import { getServiceClient } from "@/lib/supabase/admin.server";
import { requireSupabaseAuth } from "@/lib/supabase/auth-middleware";
import { diffFundConfigs } from "./config-diff";
import type { LimitViolation } from "./config-limits";
import {
  applyConfigOps,
  configOpSchema,
  draftFingerprint,
  mainDraftChanged,
  opsFromResponse,
  screeningChanged,
  type ConfigOp,
  type DraftFields,
} from "./config-ops";
import { generateConfigProposal, ProposalRejected } from "./config-proposal-ai.server";
import { describeFieldChanges, type FieldChange } from "./proposal-changes";
import { loadDraftFields } from "./config.functions";
import { saveDraftRpcArgs } from "./save-draft-args";
import { fundConfigErrorText } from "./db-errors";
import { requestLanguage, serverText } from "@/lib/i18n/server-text";

/**
 * "Ret med AI" og tese-hjælperen. AI'en foreslår en kort liste af redigeringer; koden
 * anvender dem på en kopi, regner diffen og gemmer forslaget. Intet ændres i kladden, før et
 * menneske vælger "Læg i kladden", og intet påvirker analyser, før kladden er udgivet.
 */
const configIdSchema = z.guid();
const proposalIdSchema = z.guid();
/** Flere åbne forslag end dette betyder, at nogen ikke tager stilling; stop, før der betales mere. */
const MAX_OPEN_PROPOSALS = 10;

export interface ConfigProposalView {
  id: string;
  source: "ai_fix" | "ai_thesis";
  instruction: string;
  summary: string;
  /** What the proposal changes, in words (computed in code, not written by the model). */
  diff: string[];
  status: "open" | "applied" | "rejected" | "stale";
  createdAt: string;
  decidedAt: string | null;
  createdByMe: boolean;
  /** What would still stop a publish if the proposal were laid into the draft. */
  limitViolations: LimitViolation[];
  /** The change field by field (old and new value), for the diff; empty once decided or stale. */
  fieldChanges: FieldChange[];
}

type ProposalRow = {
  id: string;
  fund_id: string;
  config_version_id: string;
  source: "ai_fix" | "ai_thesis";
  instruction: string;
  summary: string;
  changes: unknown;
  diff: unknown;
  base_fingerprint: string;
  status: "open" | "applied" | "rejected" | "stale";
  created_by: string | null;
  decided_at: string | null;
  created_at: string;
};

const PROPOSAL_COLUMNS =
  "id, fund_id, config_version_id, source, instruction, summary, changes, diff, base_fingerprint, status, created_by, decided_at, created_at";

function parseOps(raw: unknown): ConfigOp[] | null {
  const parsed = z.array(configOpSchema).safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** A draft that has changed since the proposal was made makes the proposal out of date. */
function isStale(row: ProposalRow, current: DraftFields): boolean {
  return row.status === "open" && row.base_fingerprint !== draftFingerprint(current);
}

/** M1: the screening instruction is prompt text, so only editors see it in a diff. */
function withoutInstruction(draft: DraftFields): DraftFields {
  const shown = { ...draft };
  delete shown.screeningInstruction;
  return shown;
}

function toView(
  row: ProposalRow,
  current: DraftFields,
  userId: string,
  canConfigure: boolean,
): ConfigProposalView {
  const language = requestLanguage();
  const stale = isStale(row, current);
  const ops = parseOps(row.changes);
  const applied =
    row.status === "open" && !stale && ops ? applyConfigOps(current, ops, language) : null;
  const shown = (draft: DraftFields) => (canConfigure ? draft : withoutInstruction(draft));
  return {
    id: row.id,
    source: row.source,
    instruction: row.instruction,
    summary: row.summary,
    diff: Array.isArray(row.diff) ? (row.diff as string[]) : [],
    status: stale ? "stale" : row.status,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
    createdByMe: row.created_by === userId,
    limitViolations: applied ? applied.limitViolations : [],
    fieldChanges: applied
      ? describeFieldChanges(shown(current), shown(applied.draft), language)
      : [],
  };
}

async function loadDraftConfig(
  supabase: SupabaseClient,
  configId: string,
): Promise<{ fundId: string; fields: DraftFields }> {
  const { data: row } = await supabase
    .from("fund_config_versions")
    .select("fund_id, status")
    .eq("id", configId)
    .maybeSingle();
  if (!row || row["status"] !== "draft")
    throw new Error(serverText("fundServer.common.draftNotFound"));
  return { fundId: row["fund_id"] as string, fields: await loadDraftFields(supabase, configId) };
}

/** The proposals against a draft, newest first, with out-of-date ones marked. Every role may read. */
export const listConfigProposals = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ configId: configIdSchema }).parse(input))
  .handler(
    async ({ data, context }): Promise<{ proposals: ConfigProposalView[]; canDecide: boolean }> => {
      const { fundId, fields } = await loadDraftConfig(context.supabase, data.configId);
      const access = await requireFundCapability(
        context.supabase,
        context.userId,
        fundId,
        "view_case",
      );
      const { data: rows, error } = await context.supabase
        .from("fund_config_proposals")
        .select(PROPOSAL_COLUMNS)
        .eq("config_version_id", data.configId)
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) {
        console.error("[config-proposals] list", error.message);
        throw new Error(serverText("fundServer.common.proposalsNotLoaded"));
      }
      const canDecide = hasCapability(access.roles, "configure_fund", access.settings);
      return {
        proposals: ((rows ?? []) as unknown as ProposalRow[]).map((row) =>
          toView(row, fields, context.userId, canDecide),
        ),
        canDecide,
      };
    },
  );

/**
 * Asks the AI for a proposal ("Ret med AI" with kind "fix", the thesis helper with "thesis", and
 * "Beskriv, hvordan I screener" with "screening").
 * Admin and Lead. Costs a few øre, capped at $0.05 per proposal, and is refused while ten
 * proposals wait for a decision.
 */
export const proposeConfigChange = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        configId: configIdSchema,
        kind: z.enum(["fix", "thesis", "screening"]),
        instruction: z.string().trim().min(3, "Skriv, hvad I vil have rettet.").max(4000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<ConfigProposalView> => {
    const { fundId, fields } = await loadDraftConfig(context.supabase, data.configId);
    await requireFundCapability(context.supabase, context.userId, fundId, "configure_fund");
    const service = getServiceClient();

    // Proposals made against an older draft are out of date for good: mark them, so they do not
    // count towards the limit of open proposals.
    await service
      .from("fund_config_proposals")
      .update({ status: "stale" })
      .eq("config_version_id", data.configId)
      .eq("status", "open")
      .neq("base_fingerprint", draftFingerprint(fields));

    const { count, error: countError } = await service
      .from("fund_config_proposals")
      .select("id", { count: "exact", head: true })
      .eq("config_version_id", data.configId)
      .eq("status", "open");
    if (countError) throw new Error(serverText("fundServer.proposals.notCounted"));
    if ((count ?? 0) >= MAX_OPEN_PROPOSALS) {
      throw new Error(serverText("fundServer.proposals.tooMany"));
    }

    let generated;
    try {
      generated = await generateConfigProposal({
        fundId,
        userId: context.userId,
        kind: data.kind,
        instruction: data.instruction,
        draft: fields,
      });
    } catch (cause) {
      if (cause instanceof ProposalRejected) throw new Error(cause.message);
      throw cause;
    }
    const parsed = opsFromResponse(generated.response);
    if ("error" in parsed) {
      console.error("[config-proposals] refused model edit", parsed.error);
      throw new Error(serverText("fundServer.proposals.notUsable"));
    }
    const applied = applyConfigOps(fields, parsed.ops, requestLanguage());
    if (applied.errors.length > 0) {
      console.error("[config-proposals] edits do not fit the draft", applied.errors);
      throw new Error(serverText("fundServer.proposals.doesNotFit"));
    }
    const diff = diffFundConfigs(fields, applied.draft, requestLanguage());
    if (diff.length === 0) {
      throw new Error(serverText("fundServer.proposals.noChange"));
    }

    // The audit log first: it cannot be written, nothing is saved (writeAudit refuses the action).
    await writeAudit(service, {
      fundId,
      actorType: "user",
      actorId: context.userId,
      action: "fund_config_proposal_created",
      entity: "fund_config_versions",
      entityId: data.configId,
      payload: { kind: data.kind, costUsd: generated.costUsd, edits: parsed.ops.length },
    });
    const { data: row, error } = await service
      .from("fund_config_proposals")
      .insert({
        fund_id: fundId,
        config_version_id: data.configId,
        // A screening description is stored as a fix: 0051 knows two sources.
        source: data.kind === "thesis" ? "ai_thesis" : "ai_fix",
        instruction: data.instruction,
        summary: generated.response.summary,
        changes: parsed.ops,
        diff,
        base_fingerprint: draftFingerprint(fields),
        created_by: context.userId,
      })
      .select(PROPOSAL_COLUMNS)
      .single();
    if (error || !row) {
      console.error("[config-proposals] insert", error?.message);
      throw new Error(serverText("fundServer.common.proposalNotSaved"));
    }
    // Only those who may configure the fund get here (requireFundCapability above).
    return toView(row as unknown as ProposalRow, fields, context.userId, true);
  });

/** The proposal, after the caller's right to decide in its fund is checked (so ids leak nothing). */
async function loadOpenProposal(
  service: ReturnType<typeof getServiceClient>,
  supabase: SupabaseClient,
  userId: string,
  proposalId: string,
): Promise<ProposalRow> {
  const { data: row, error } = await service
    .from("fund_config_proposals")
    .select(PROPOSAL_COLUMNS)
    .eq("id", proposalId)
    .maybeSingle();
  const proposal = row as unknown as ProposalRow | null;
  if (error || !proposal) throw new Error(serverText("fundServer.proposals.notFound"));
  await requireFundCapability(supabase, userId, proposal.fund_id, "configure_fund");
  if (proposal.status !== "open") {
    throw new Error(
      proposal.status === "applied"
        ? serverText("fundServer.proposals.alreadyApplied")
        : serverText("fundServer.proposals.notOpen"),
    );
  }
  return proposal;
}

/** "Læg i kladden": writes the proposal's edits into the draft. Admin and Lead. Nothing is published. */
export const applyConfigProposal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ proposalId: proposalIdSchema }).parse(input))
  .handler(async ({ data, context }) => {
    const service = getServiceClient();
    const proposal = await loadOpenProposal(
      service,
      context.supabase,
      context.userId,
      data.proposalId,
    );
    const { fields } = await loadDraftConfig(context.supabase, proposal.config_version_id);

    const markStale = async () => {
      await service
        .from("fund_config_proposals")
        .update({ status: "stale" })
        .eq("id", proposal.id)
        .eq("status", "open");
    };
    if (isStale(proposal, fields)) {
      await markStale();
      throw new Error(serverText("fundServer.common.draftChanged"));
    }
    const ops = parseOps(proposal.changes);
    if (!ops) throw new Error(serverText("fundServer.proposals.unreadable"));
    const applied = applyConfigOps(fields, ops, requestLanguage());
    if (applied.errors.length > 0) {
      await markStale();
      throw new Error(serverText("fundServer.proposals.noLongerFits"));
    }

    // Claims the proposal first, so two clicks cannot lay the same proposal in twice.
    const { data: claimed, error: claimError } = await service
      .from("fund_config_proposals")
      .update({
        status: "applied",
        decided_by: context.userId,
        decided_at: new Date().toISOString(),
      })
      .eq("id", proposal.id)
      .eq("status", "open")
      .select("id");
    if (claimError || !claimed?.length)
      throw new Error(serverText("fundServer.common.proposalAlreadyHandled"));

    const release = async () => {
      await service
        .from("fund_config_proposals")
        .update({ status: "open", decided_by: null, decided_at: null })
        .eq("id", proposal.id);
    };
    // The audit log first: if it cannot be written, nothing changes (writeAudit refuses the action).
    let auditId: string | null;
    try {
      auditId = await writeAuditWithId(service, {
        fundId: proposal.fund_id,
        actorType: "user",
        actorId: context.userId,
        action: "fund_config_proposal_applied",
        entity: "fund_config_versions",
        entityId: proposal.config_version_id,
        payload: { proposalId: proposal.id, edits: ops.length },
      });
    } catch (cause) {
      await release();
      throw cause;
    }
    // From here on the audit row says "applied": any failure releases the proposal and records
    // that it was not applied after all, so the change history does not show it (harden).
    // Released once only: a proposal marked stale must not be opened again by the catch below.
    let released = false;
    const releaseOnce = async () => {
      if (released) return;
      released = true;
      await release();
    };
    try {
      // A last look right before the write: an autosave in the meantime must not be overwritten.
      const latest = await loadDraftConfig(context.supabase, proposal.config_version_id);
      if (isStale(proposal, latest.fields)) {
        await releaseOnce();
        await markStale();
        throw new Error(serverText("fundServer.common.draftChanged"));
      }
      // The fund's own screening is saved apart (0078). Each part is only written when it
      // changed, and a failed screening write puts the rest of the draft back, so a proposal is
      // laid in whole or not at all (and can then be tried again).
      const mainChanged = mainDraftChanged(latest.fields, applied.draft);
      if (mainChanged) {
        const { error: saveError } = await context.supabase.rpc(
          "save_fund_config_draft",
          saveDraftRpcArgs({ configId: proposal.config_version_id, ...applied.draft }),
        );
        if (saveError) {
          console.error("[config-proposals] apply", saveError.code, saveError.message);
          throw new Error(
            fundConfigErrorText(saveError, serverText("fundServer.common.proposalNotLaid"), {
              language: requestLanguage(),
            }),
          );
        }
      }
      if (screeningChanged(latest.fields, applied.draft)) {
        const { error: screeningError } = await context.supabase.rpc("save_fund_screening_setup", {
          _config_version_id: proposal.config_version_id,
          _instruction: applied.draft.screeningInstruction ?? "",
          _cards: applied.draft.screeningCards ?? [],
        });
        if (screeningError) {
          console.error(
            "[config-proposals] apply screening",
            screeningError.code,
            screeningError.message,
          );
          if (mainChanged) {
            const { error: restoreError } = await context.supabase.rpc(
              "save_fund_config_draft",
              saveDraftRpcArgs({ configId: proposal.config_version_id, ...latest.fields }),
            );
            if (restoreError) {
              console.error(
                "[config-proposals] draft not restored after a failed screening write",
                restoreError.code,
                restoreError.message,
              );
            }
          }
          throw new Error(
            fundConfigErrorText(screeningError, serverText("fundServer.common.proposalNotLaid"), {
              duplicateNames: false,
              language: requestLanguage(),
            }),
          );
        }
      }
    } catch (cause) {
      await releaseOnce();
      try {
        await writeAudit(service, {
          fundId: proposal.fund_id,
          actorType: "user",
          actorId: context.userId,
          action: "fund_config_proposal_not_applied",
          entity: "fund_config_versions",
          entityId: proposal.config_version_id,
          payload: { proposalId: proposal.id, undoes: auditId },
        });
      } catch (auditCause) {
        console.error("[config-proposals] not applied audit", auditCause);
      }
      throw cause instanceof Error
        ? cause
        : new Error(serverText("fundServer.common.proposalNotLaid"));
    }
    return { ok: true as const, limitViolations: applied.limitViolations };
  });

/** "Afvis": the proposal stays as a record, but is never laid into the draft. Admin and Lead. */
export const rejectConfigProposal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ proposalId: proposalIdSchema }).parse(input))
  .handler(async ({ data, context }) => {
    const service = getServiceClient();
    const proposal = await loadOpenProposal(
      service,
      context.supabase,
      context.userId,
      data.proposalId,
    );
    const { data: rejected, error } = await service
      .from("fund_config_proposals")
      .update({
        status: "rejected",
        decided_by: context.userId,
        decided_at: new Date().toISOString(),
      })
      .eq("id", proposal.id)
      .eq("status", "open")
      .select("id");
    if (error || !rejected?.length)
      throw new Error(serverText("fundServer.common.proposalAlreadyHandled"));
    await writeAudit(service, {
      fundId: proposal.fund_id,
      actorType: "user",
      actorId: context.userId,
      action: "fund_config_proposal_rejected",
      entity: "fund_config_versions",
      entityId: proposal.config_version_id,
      payload: { proposalId: proposal.id },
    });
    return { ok: true as const };
  });
