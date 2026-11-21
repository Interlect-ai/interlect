/**
 * The committee memo's server functions (spec):
 * read the memo's stored data, save the proposal, answer a gap, make a draft, approve (freeze).
 *
 * Everyone in the team reads. Admin, Lead and Medlem write (`MEMO_WRITE_CAPABILITY`): checked here
 * first, and again inside the database functions (0132), which run as the signed-in person, so Læser
 * and other teams are refused there too. An approved version is frozen by the database. Mandate
 * requirements are not stored here: they use `answerCaseTask`. The one AI call is the
 * draft of the prose (`draftMemoWithAi`); everything else here is storage.
 */
import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/lib/supabase/auth-middleware";
import { requireFundCapability } from "@/lib/auth/access.server";
import { hasCapability } from "@/lib/domain/workflow";
import { serverText } from "@/lib/i18n/server-text";
import { fromDemoView, inDemoView, withDemoView } from "@/lib/display/display-names.server";
import { loadFundLanguage } from "@/lib/i18n/fund-language.server";
import { getServiceClient } from "@/lib/supabase/admin.server";
import {
  draftModelFrom,
  memoAiDraftSchema,
  withProposerInput,
  type MemoDraftReason,
  type MemoDraftSection,
} from "./draft";
import { draftMemoProse } from "./draft.server";
import {
  MEMO_GAP_COLUMNS,
  MEMO_INPUT_COLUMNS,
  MEMO_VERSION_COLUMNS,
  MEMO_WRITE_CAPABILITY,
  cleanBeliefComments,
  gapReasonOk,
  memoApproveSchema,
  memoCaseSchema,
  memoDraftSchema,
  memoGapAnswerFrom,
  memoGapAnswerSchema,
  memoInputFrom,
  memoInputSchema,
  memoRefusal,
  memoVersionFrom,
  type MemoGapAnswer,
  type MemoInput,
  type MemoVersion,
} from "./memo";

export interface CaseMemoData {
  /** Whether the person may write (Admin, Lead, Medlem); Læser reads only. */
  canWrite: boolean;
  input: MemoInput | null;
  gapAnswers: MemoGapAnswer[];
  /** Newest first. */
  versions: MemoVersion[];
}

/** A database refusal in the person's language; anything else becomes `notSaved`. */
function memoError(error: { message?: string; code?: string } | null) {
  // 23505: two people made a version at the same moment (the unique version number).
  if (error?.code === "23505") return new Error(serverText("memoServer.busy"));
  const refusal = memoRefusal(error?.message);
  if (!refusal) console.error("[memo]", error?.message);
  return new Error(serverText(`memoServer.${refusal ?? "notSaved"}`));
}

/** The case is in the team the person named (RLS: only the person's own teams are visible). */
async function requireTeamCase(supabase: SupabaseClient, fundId: string, caseId: string) {
  const { data, error } = await supabase
    .from("cases")
    .select("id")
    .eq("fund_id", fundId)
    .eq("id", caseId)
    .maybeSingle();
  if (error) {
    console.error("[memo] case", error.message);
    throw new Error(serverText("memoServer.notLoaded"));
  }
  if (!data) throw new Error(serverText("memoServer.notFound"));
}

export const getCaseMemo = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => memoCaseSchema.parse(input))
  .handler(
    withDemoView(async ({ data, context }): Promise<CaseMemoData> => {
      const access = await requireFundCapability(
        context.supabase,
        context.userId,
        data.fundId,
        "view_case",
      );
      await requireTeamCase(context.supabase, data.fundId, data.caseId);
      const [input, gaps, versions] = await Promise.all([
        context.supabase
          .from("case_memo_inputs")
          .select(MEMO_INPUT_COLUMNS)
          .eq("fund_id", data.fundId)
          .eq("case_id", data.caseId)
          .maybeSingle(),
        context.supabase
          .from("case_memo_gap_answers")
          .select(MEMO_GAP_COLUMNS)
          .eq("fund_id", data.fundId)
          .eq("case_id", data.caseId)
          .order("gap_key", { ascending: true }),
        context.supabase
          .from("case_memo_versions")
          .select(MEMO_VERSION_COLUMNS)
          .eq("fund_id", data.fundId)
          .eq("case_id", data.caseId)
          .order("version", { ascending: false }),
      ]);
      const failed = input.error ?? gaps.error ?? versions.error;
      if (failed) {
        console.error("[memo] load", failed.message);
        throw new Error(serverText("memoServer.notLoaded"));
      }
      return {
        canWrite: hasCapability(access.roles, MEMO_WRITE_CAPABILITY, access.settings),
        input: input.data ? memoInputFrom(input.data as Record<string, unknown>) : null,
        gapAnswers: ((gaps.data ?? []) as Record<string, unknown>[]).map(memoGapAnswerFrom),
        versions: ((versions.data ?? []) as Record<string, unknown>[]).map(memoVersionFrom),
      };
    }),
  );

/** "Hvorfor anbefaler du casen?" and the optional comments per belief. */
export const saveMemoInput = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => memoInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    await requireFundCapability(
      context.supabase,
      context.userId,
      data.fundId,
      MEMO_WRITE_CAPABILITY,
    );
    await requireTeamCase(context.supabase, data.fundId, data.caseId);
    const { data: id, error } = await context.supabase.rpc("save_case_memo_input", {
      _case_id: data.caseId,
      _rationale: data.rationale,
      _belief_comments: cleanBeliefComments(data.beliefComments),
    });
    if (error || !id) throw memoError(error);
    return { id: id as string };
  });

/** A gap before the committee: "filled" or "not_needed" (with a reason of at least 10 characters). */
export const answerMemoGap = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => memoGapAnswerSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    await requireFundCapability(
      context.supabase,
      context.userId,
      data.fundId,
      MEMO_WRITE_CAPABILITY,
    );
    if (!gapReasonOk(data.state, data.reason)) {
      throw new Error(serverText("memoServer.reasonTooShort"));
    }
    await requireTeamCase(context.supabase, data.fundId, data.caseId);
    const { data: id, error } = await context.supabase.rpc("answer_case_memo_gap", {
      _case_id: data.caseId,
      _gap_key: data.gapKey,
      _state: data.state,
      _reason: data.reason?.trim() || null,
    });
    if (error || !id) throw memoError(error);
    return { id: id as string };
  });

/**
 * A draft of the memo's prose for a complete deep analysis of the case. A draft for the same
 * analysis is replaced; otherwise it becomes the next version.
 */
export const createMemoDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => memoDraftSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ versionId: string; version: number }> => {
    await requireFundCapability(
      context.supabase,
      context.userId,
      data.fundId,
      MEMO_WRITE_CAPABILITY,
    );
    await requireTeamCase(context.supabase, data.fundId, data.caseId);
    return storeDraft(
      context.supabase,
      data.fundId,
      data.caseId,
      data.analysisRunId,
      data.sections,
    );
  });

/** Stores a draft (a draft for the same analysis is replaced) and returns its id and number. */
async function storeDraft(
  supabase: SupabaseClient,
  fundId: string,
  caseId: string,
  analysisRunId: string,
  sections: Record<string, string>,
): Promise<{ versionId: string; version: number }> {
  const { data: id, error } = await supabase.rpc("create_case_memo_draft", {
    _case_id: caseId,
    _analysis_run_id: analysisRunId,
    _sections: sections,
  });
  if (error || !id) throw memoError(error);
  const { data: row, error: readError } = await supabase
    .from("case_memo_versions")
    .select("version")
    .eq("fund_id", fundId)
    .eq("id", id as string)
    .single();
  if (readError || !row) {
    console.error("[memo] draft read", readError?.message);
    throw new Error(serverText("memoServer.notLoaded"));
  }
  return { versionId: id as string, version: Number(row["version"]) };
}

export interface MemoAiDraft {
  versionId: string;
  version: number;
  /** What the draft holds: the AI's prose, or the proposer's own text for section 1. */
  sections: Partial<Record<MemoDraftSection, string>>;
  /** The sections the AI wrote. */
  written: MemoDraftSection[];
  /**
   * Null when the AI wrote both. "credits": used up (show the credit meter, never prices);
   * "limit": the hourly AI limit is reached; "unavailable": the AI did not answer; "rejected": its
   * text broke the memo's rules twice.
   */
  reason: MemoDraftReason | null;
}

/**
 * The AI's draft of section 1 (the proposer's rationale) and of "Thesis and what must be believed"
 * In the team's language, from the proposer's SAVED rationale and comments (save them
 * first with `saveMemoInput`) and the memo's model, which the sheet builds from the case it shows.
 * Stored as the case's draft for the model's analysis; the proposer approves it with
 * `approveMemoVersion`. Used-up credits or an AI that does not answer never stop it: the draft then
 * holds the proposer's own text, and `reason` says why.
 *
 * Demo view: the AI reads the team's invented names (the model already has them, and the proposer's
 * text is put into the demo view too), the draft is stored with the real ones (`fromDemoView`), and
 * the answer goes back through the demo view, like every other text the memo shows.
 */
export const draftMemoWithAi = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => memoAiDraftSchema.parse(input))
  .handler(
    withDemoView(async ({ data, context }): Promise<MemoAiDraft> => {
      await requireFundCapability(
        context.supabase,
        context.userId,
        data.fundId,
        MEMO_WRITE_CAPABILITY,
      );
      await requireTeamCase(context.supabase, data.fundId, data.caseId);
      const sent = draftModelFrom(data.model);
      if (sent.caseId !== data.caseId) throw new Error(serverText("memoServer.notFound"));
      const { data: row, error } = await context.supabase
        .from("case_memo_inputs")
        .select(MEMO_INPUT_COLUMNS)
        .eq("fund_id", data.fundId)
        .eq("case_id", data.caseId)
        .maybeSingle();
      if (error) {
        console.error("[memo] input", error.message);
        throw new Error(serverText("memoServer.notLoaded"));
      }
      const input = row ? memoInputFrom(row as Record<string, unknown>) : null;
      if (!input?.rationale.trim()) throw new Error(serverText("memoServer.rationaleMissing"));
      // The analysis is checked before the AI is paid for (the database checks it again on store).
      const analysisRunId = sent.analysisId as string;
      const { data: run, error: runError } = await context.supabase
        .from("analysis_runs")
        .select("id, kind, status")
        .eq("fund_id", data.fundId)
        .eq("case_id", data.caseId)
        .eq("id", analysisRunId)
        .maybeSingle();
      if (runError) {
        console.error("[memo] analysis", runError.message);
        throw new Error(serverText("memoServer.notLoaded"));
      }
      if (!run) throw new Error(serverText("memoServer.analysisNotOnCase"));
      if (run["kind"] !== "deep" || run["status"] !== "complete") {
        throw new Error(serverText("memoServer.analysisNotComplete"));
      }
      const shown = await inDemoView(data.fundId, {
        rationale: input.rationale,
        beliefComments: input.beliefComments,
      });
      const model = withProposerInput(sent, { ...input, ...shown });
      const language = await loadFundLanguage(getServiceClient(), data.fundId);
      const prose = await draftMemoProse({
        fundId: data.fundId,
        credits: { userId: context.userId },
        model,
        language,
      });
      const sections: Partial<Record<MemoDraftSection, string>> = {};
      for (const [section, text] of Object.entries(prose.sections) as Array<
        [MemoDraftSection, string]
      >) {
        sections[section] = await fromDemoView(data.fundId, text);
      }
      const saved = await storeDraft(
        context.supabase,
        data.fundId,
        data.caseId,
        analysisRunId,
        sections,
      );
      return { ...saved, sections, written: prose.written, reason: prose.reason };
    }),
  );

/** Approve a draft: the version is frozen from now on. */
export const approveMemoVersion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => memoApproveSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await requireFundCapability(
      context.supabase,
      context.userId,
      data.fundId,
      MEMO_WRITE_CAPABILITY,
    );
    const { data: row, error: readError } = await context.supabase
      .from("case_memo_versions")
      .select("id")
      .eq("fund_id", data.fundId)
      .eq("case_id", data.caseId)
      .eq("id", data.versionId)
      .maybeSingle();
    if (readError) {
      console.error("[memo] version", readError.message);
      throw new Error(serverText("memoServer.notLoaded"));
    }
    if (!row) throw new Error(serverText("memoServer.versionNotFound"));
    const { error } = await context.supabase.rpc("approve_case_memo_version", {
      _version_id: data.versionId,
    });
    if (error) throw memoError(error);
    return { ok: true };
  });
