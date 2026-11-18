/**
 * Brain chat, thread side (batch 1): the history list, one thread with its messages,
 * rename, delete, share with the team, and the @-search. The ENGINE (`POST /api/brain/chat`,
 * answers, sources) is session B's; its contract is `chat-contract.ts`.
 *
 * Every function first asks the capability probe (`computeBrainCapabilities`): staging and
 * production share one database where `brain_threads` (0047) may not exist, so nothing here
 * reads or writes a Brain table unless `chat` is true (then it also needs brain_chat).
 * Reads go through the user's own session so RLS decides what is visible (own private threads
 * and the team's); writes use the service client after the rules in `threads.ts` have passed.
 * `fundId` always comes from the verified membership, never from a thread id alone.
 *
 * 0047 is on staging; the queries run for real once `CHAT_ROUTE_READY` is on (batch 2). Unit tests
 * cover the rules.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  requireFundCapability,
  writeAudit,
  writeAuditWithId,
  type Access,
} from "@/lib/auth/access.server";
import { isAdminRole } from "@/lib/auth/is-admin";
import { requireSupabaseAuth } from "@/lib/supabase/auth-middleware";
import type { SupabaseClient } from "@supabase/supabase-js";
import { answerEpisodeDraft } from "./answer-episode";
import { answerNoteBody } from "./answer-note";
import { withFundLanguage } from "@/lib/i18n/language-scope.server";
import {
  parseCitation,
  cleanFeedback,
  FEEDBACK_COMMENT_MAX,
  type BrainFeedbackRating,
  type BrainMessageDto,
  type BrainThreadDetail,
  type BrainThreadSummary,
  type ThreadVisibility,
} from "./chat-contract";
import { loadDemoView } from "@/lib/display/display-names.server";
import { BrainUserError } from "./errors";
import { DEMO_MENU_SCAN, mentionMatch, mentionText } from "./mentions";
import { canDeleteThread, canEditThread, TITLE_MAX } from "./threads";
import { serverText } from "@/lib/i18n/server-text";

/**
 * Demo view: the team's namer for names, web addresses and register numbers, or
 * null when it does not use the demo view.
 */
async function demoNamer(forFund: string) {
  const { getServiceClient } = await import("@/lib/supabase/admin.server");
  return loadDemoView(getServiceClient(), forFund);
}

const fundId = z.guid();
const threadId = z.guid();

/** brain_chat plus a live probe: the one gate every function passes first. */
async function requireChat(
  context: { supabase: SupabaseClient; userId: string },
  forFund: string,
): Promise<Access> {
  const access = await requireFundCapability(
    context.supabase,
    context.userId,
    forFund,
    "brain_chat",
  );
  const { computeBrainCapabilities } = await import("./capabilities.server");
  const caps = await computeBrainCapabilities(forFund, access);
  if (!caps.chat) throw new BrainUserError(serverText("brainServer.common.notAvailable"));
  return access;
}

const serviceClient = async () => (await import("@/lib/supabase/admin.server")).getServiceClient();

/** Refusals meant for the user pass through; anything else is logged and replaced by a short text. */
async function userFacing<T>(action: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (cause) {
    if (cause instanceof BrainUserError) throw cause;
    console.error(`[brain-chat] ${action}`, cause instanceof Error ? cause.message : cause);
    throw new Error(serverText("brainServer.common.failed"));
  }
}

/** A write that matched no row: the thread was deleted in the meantime. */
function requireChanged(rows: unknown[] | null): void {
  if (!rows || rows.length === 0)
    throw new BrainUserError(serverText("brainServer.chat.threadNotFound"));
}

/**
 * The audit row is written first (fail-closed). When the change itself fails afterwards, a
 * counter-row names the one it cancels (`undoes`), so the history never shows a change that
 * did not happen.
 */
async function auditedChange(
  service: SupabaseClient,
  audit: Parameters<typeof writeAudit>[1],
  change: () => Promise<void>,
): Promise<void> {
  const auditId = await writeAuditWithId(service, audit);
  try {
    await change();
  } catch (cause) {
    try {
      await writeAudit(service, {
        ...audit,
        action: `${audit.action}_not_saved`,
        payload: { ...audit.payload, undoes: auditId },
      });
    } catch (auditCause) {
      console.error("[brain-chat] not saved audit", auditCause);
    }
    throw cause;
  }
}

interface ThreadRow {
  id: string;
  title: string | null;
  visibility: ThreadVisibility;
  case_id: string | null;
  user_id: string;
  last_activity_at: string;
}

const THREAD_COLUMNS = "id, title, visibility, case_id, user_id, last_activity_at";

async function summarise(
  supabase: SupabaseClient,
  rows: ThreadRow[],
  me: string,
): Promise<BrainThreadSummary[]> {
  const caseIds = [...new Set(rows.map((row) => row.case_id).filter((id): id is string => !!id))];
  const caseNames = new Map<string, string>();
  if (caseIds.length) {
    const { data, error } = await supabase
      .from("cases")
      .select("id, companies(name)")
      .in("id", caseIds);
    if (error) console.error("[brain-chat] case names", error.message);
    for (const row of (data ?? []) as unknown as {
      id: string;
      companies: { name: string } | { name: string }[] | null;
    }[]) {
      const company = Array.isArray(row.companies) ? row.companies[0] : row.companies;
      if (company?.name) caseNames.set(row.id, company.name);
    }
  }
  const otherOwners = [
    ...new Set(rows.filter((row) => row.user_id !== me).map((row) => row.user_id)),
  ];
  const ownerNames = new Map<string, string>();
  if (otherOwners.length) {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", otherOwners);
    if (error) console.error("[brain-chat] owner names", error.message);
    for (const profile of (data ?? []) as { id: string; full_name: string | null }[]) {
      const first = profile.full_name?.trim().split(/\s+/)[0];
      if (first) ownerNames.set(profile.id, first);
    }
  }
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    visibility: row.visibility,
    caseId: row.case_id,
    caseName: row.case_id ? (caseNames.get(row.case_id) ?? null) : null,
    isMine: row.user_id === me,
    ownerName: row.user_id === me ? null : (ownerNames.get(row.user_id) ?? null),
    lastActivityAt: row.last_activity_at,
  }));
}

export const listBrainThreads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ fundId }).strict().parse(input))
  .handler(async ({ data, context }): Promise<BrainThreadSummary[]> => {
    await requireChat(context, data.fundId);
    return userFacing("list", async () => {
      const { data: rows, error } = await context.supabase
        .from("brain_threads")
        .select(THREAD_COLUMNS)
        .eq("fund_id", data.fundId)
        .order("last_activity_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      const threads = await summarise(
        context.supabase,
        (rows ?? []) as ThreadRow[],
        context.userId,
      );
      const namer = await demoNamer(data.fundId);
      return namer ? namer.applyJson(threads) : threads;
    });
  });

export const getBrainThread = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ fundId, threadId }).strict().parse(input))
  .handler(async ({ data, context }): Promise<BrainThreadDetail> => {
    await requireChat(context, data.fundId);
    return userFacing("get", async () => {
      const { data: row, error } = await context.supabase
        .from("brain_threads")
        .select(THREAD_COLUMNS)
        .eq("fund_id", data.fundId)
        .eq("id", data.threadId)
        .maybeSingle();
      if (error) throw error;
      // RLS hides other people's private threads: "not found" looks the same as "not yours".
      if (!row) throw new BrainUserError(serverText("brainServer.chat.threadNotFound"));
      const { data: messages, error: messagesError } = await context.supabase
        .from("brain_messages")
        .select("id, role, content, citations, used_web, created_at")
        .eq("fund_id", data.fundId)
        .eq("thread_id", data.threadId)
        .order("created_at", { ascending: true })
        .limit(500);
      if (messagesError) throw messagesError;
      const myFeedback = await feedbackByMessage(
        context.supabase,
        data.fundId,
        context.userId,
        (messages ?? []).filter((message) => message.role === "assistant").map((m) => m.id),
      );
      const [thread] = await summarise(context.supabase, [row as ThreadRow], context.userId);
      const list: BrainMessageDto[] = (
        (messages ?? []) as {
          id: string;
          role: "user" | "assistant";
          content: string;
          citations: unknown;
          used_web: boolean;
          created_at: string;
        }[]
      ).map((message) => {
        const stored = Array.isArray(message.citations) ? message.citations : [];
        const citations = stored
          .map((citation) => parseCitation(citation))
          .filter((citation) => citation !== null);
        if (citations.length < stored.length) {
          // A contract drift would otherwise show "Nogle påstande mangler kilde" without a trace.
          console.warn(
            `[brain-chat] message ${message.id}: ${stored.length - citations.length} citation(s) did not parse`,
          );
        }
        return {
          id: message.id,
          role: message.role,
          content: message.content,
          citations,
          usedWeb: message.used_web,
          createdAt: message.created_at,
          myFeedback: myFeedback.get(message.id) ?? null,
        };
      });
      const detail = { thread: thread!, messages: list };
      const namer = await demoNamer(data.fundId);
      return namer ? namer.applyJson(detail) : detail;
    });
  });

const FEEDBACK_CHUNK = 80;

/**
 * My own 👍/👎 on the loaded answers. Decoration only: a failure is logged and the thumbs show
 * unselected (a new click simply replaces the stored rating), the thread still opens.
 */
async function feedbackByMessage(
  supabase: SupabaseClient,
  forFund: string,
  userId: string,
  messageIds: string[],
): Promise<Map<string, BrainFeedbackRating>> {
  const out = new Map<string, BrainFeedbackRating>();
  // In chunks: a long thread's ids in one `in (...)` filter could pass the gateway's URL limit.
  for (let start = 0; start < messageIds.length; start += FEEDBACK_CHUNK) {
    const chunk = messageIds.slice(start, start + FEEDBACK_CHUNK);
    const { data, error } = await supabase
      .from("brain_feedback")
      .select("message_id, rating")
      .eq("fund_id", forFund)
      .eq("user_id", userId)
      .in("message_id", chunk);
    if (error) {
      console.error(
        `[brain-chat] my feedback (fund ${forFund}, ${messageIds.length} answers)`,
        error.code ?? "",
        error.message,
      );
      return new Map();
    }
    for (const row of (data ?? []) as { message_id: string; rating: string }[]) {
      if (row.rating === "useful" || row.rating === "wrong" || row.rating === "incomplete") {
        out.set(row.message_id, row.rating);
      }
    }
  }
  return out;
}

/** One answer the user can see (RLS on the thread decides), with what a note or rating needs. */
async function visibleAnswer(
  context: { supabase: SupabaseClient },
  forFund: string,
  messageId: string,
) {
  const { data: row, error } = await context.supabase
    .from("brain_messages")
    .select("id, thread_id, role, content, citations, created_at")
    .eq("fund_id", forFund)
    .eq("id", messageId)
    .maybeSingle();
  if (error) throw error;
  if (!row || row.role !== "assistant")
    throw new BrainUserError(serverText("brainServer.chat.answerNotFound"));
  return row as {
    id: string;
    thread_id: string;
    content: string;
    citations: unknown;
    created_at: string;
  };
}

/**
 * The stored answer with what a save needs: the question just before it in the thread and its
 * citations (a citation that does not parse is dropped and logged, never trusted).
 */
async function answerToSave(
  context: { supabase: SupabaseClient; userId: string },
  forFund: string,
  messageId: string,
) {
  const answer = await visibleAnswer(context, forFund, messageId);
  const { data: question, error: questionError } = await context.supabase
    .from("brain_messages")
    .select("content")
    .eq("fund_id", forFund)
    .eq("thread_id", answer.thread_id)
    .eq("role", "user")
    .lt("created_at", answer.created_at)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (questionError) throw questionError;
  const stored = Array.isArray(answer.citations) ? answer.citations : [];
  const citations = stored.map((c) => parseCitation(c)).filter((c) => c !== null);
  if (citations.length < stored.length) {
    console.warn(
      `[brain-chat] save from message ${answer.id}: ${stored.length - citations.length} citation(s) did not parse`,
    );
  }
  return {
    answer,
    question: (question as { content: string } | null)?.content ?? null,
    citations,
  };
}

/** Loads one thread row for a write and applies the owner rule; never trusts the client. */
async function ownThread(
  context: { supabase: SupabaseClient; userId: string },
  forFund: string,
  id: string,
) {
  const { data: row, error } = await context.supabase
    .from("brain_threads")
    .select(THREAD_COLUMNS)
    .eq("fund_id", forFund)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!row) throw new BrainUserError(serverText("brainServer.chat.threadNotFound"));
  return row as ThreadRow;
}

export const renameBrainThread = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        fundId,
        threadId,
        title: z
          .string()
          .trim()
          .min(1)
          .max(TITLE_MAX * 2),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ title: string }> => {
    await requireChat(context, data.fundId);
    return userFacing("rename", async () => {
      const row = await ownThread(context, data.fundId, data.threadId);
      if (!canEditThread({ isMine: row.user_id === context.userId })) {
        throw new BrainUserError(serverText("brainServer.chat.onlyOwnerRename"));
      }
      const { data: changed, error } = await (
        await serviceClient()
      )
        .from("brain_threads")
        .update({ title: data.title })
        .eq("id", data.threadId)
        .eq("fund_id", data.fundId)
        .eq("user_id", context.userId)
        .select("id");
      if (error) throw error;
      requireChanged(changed);
      return { title: data.title };
    });
  });

export const setBrainThreadVisibility = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({ fundId, threadId, visibility: z.enum(["private", "team"]) })
      .strict()
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ visibility: ThreadVisibility }> => {
    await requireChat(context, data.fundId);
    return userFacing("visibility", async () => {
      const row = await ownThread(context, data.fundId, data.threadId);
      if (!canEditThread({ isMine: row.user_id === context.userId })) {
        throw new BrainUserError(serverText("brainServer.chat.onlyOwnerShare"));
      }
      const service = await serviceClient();
      await auditedChange(
        service,
        {
          fundId: data.fundId,
          actorType: "user",
          actorId: context.userId,
          action: data.visibility === "team" ? "brain_thread.share" : "brain_thread.unshare",
          entity: "brain_threads",
          entityId: data.threadId,
        },
        async () => {
          const { data: changed, error } = await service
            .from("brain_threads")
            .update({ visibility: data.visibility })
            .eq("id", data.threadId)
            .eq("fund_id", data.fundId)
            .eq("user_id", context.userId)
            .select("id");
          if (error) throw error;
          requireChanged(changed);
        },
      );
      return { visibility: data.visibility };
    });
  });

/**
 * Hard delete (proposal, awaiting the product owner's answer): messages and feedback follow by
 * cascade. The owner may always delete; an Admin may delete someone else's TEAM thread, with an
 * audit event; nobody can delete another person's private thread (RLS hides it).
 */
export const deleteBrainThread = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ fundId, threadId }).strict().parse(input))
  .handler(async ({ data, context }): Promise<{ deleted: true }> => {
    const access = await requireChat(context, data.fundId);
    return userFacing("delete", async () => {
      const row = await ownThread(context, data.fundId, data.threadId);
      const mine = row.user_id === context.userId;
      if (
        !canDeleteThread({ isMine: mine, visibility: row.visibility }, isAdminRole(access.roles))
      ) {
        throw new BrainUserError(serverText("brainServer.chat.cannotDelete"));
      }
      const service = await serviceClient();
      const remove = async () => {
        const { data: removed, error } = await service
          .from("brain_threads")
          .delete()
          .eq("id", data.threadId)
          .eq("fund_id", data.fundId)
          .select("id");
        if (error) throw error;
        requireChanged(removed);
      };
      if (mine) {
        await remove();
      } else {
        await auditedChange(
          service,
          {
            fundId: data.fundId,
            actorType: "user",
            actorId: context.userId,
            action: "brain_thread.moderate_delete",
            entity: "brain_threads",
            entityId: data.threadId,
            payload: { ownerId: row.user_id },
          },
          remove,
        );
      }
      return { deleted: true };
    });
  });

/**
 * 👍 = useful, 👎 = wrong or incomplete (brain_feedback, one row per answer and user; a new
 * click replaces it, details included). Only "wrong" may name wrong sources, and only numbers
 * the answer really cites are kept. Anyone who can see the answer may rate it, also in a
 * colleague's shared thread.
 */
export const submitBrainFeedback = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        fundId,
        messageId: z.guid(),
        rating: z.enum(["useful", "wrong", "incomplete"]),
        wrongCitationNs: z.array(z.number().int().min(1).max(999)).max(40).optional(),
        comment: z.string().max(FEEDBACK_COMMENT_MAX).optional(),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ rating: BrainFeedbackRating }> => {
    await requireChat(context, data.fundId);
    return userFacing("feedback", async () => {
      const answer = await visibleAnswer(context, data.fundId, data.messageId);
      const cited = new Set(
        (Array.isArray(answer.citations) ? (answer.citations as { n?: unknown }[]) : []).map(
          (citation) => citation?.n,
        ),
      );
      const clean = cleanFeedback(data.rating, data.wrongCitationNs, data.comment, cited);
      const { error } = await (await serviceClient()).from("brain_feedback").upsert(
        {
          fund_id: data.fundId,
          message_id: answer.id,
          user_id: context.userId,
          rating: data.rating,
          wrong_citation_ns: clean.wrongCitationNs,
          comment: clean.comment,
          created_at: new Date().toISOString(),
        },
        { onConflict: "message_id,user_id" },
      );
      if (error) throw error;
      return { rating: data.rating };
    });
  });

/**
 * "Gem som note": the STORED answer (never text from the browser) becomes a case note marked
 * "Fra Brain", with the question and the sources by name. The case must be this fund's and
 * visible to the user (RLS); the note is written with the user's own rights, like `addCaseNote`.
 * Brain never saves on its own: this runs only on the user's click.
 */
export const saveBrainAnswerAsNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ fundId, messageId: z.guid(), caseId: z.guid() }).strict().parse(input),
  )
  .handler(async ({ data, context }): Promise<{ caseName: string }> => {
    await requireChat(context, data.fundId);
    await requireFundCapability(context.supabase, context.userId, data.fundId, "write_notes");
    return userFacing("save note", async () => {
      const { answer, question, citations } = await answerToSave(
        context,
        data.fundId,
        data.messageId,
      );
      const { data: caseRow, error: caseError } = await context.supabase
        .from("cases")
        .select("id, companies(name)")
        .eq("fund_id", data.fundId)
        .eq("id", data.caseId)
        .maybeSingle();
      if (caseError) throw caseError;
      if (!caseRow) throw new BrainUserError(serverText("brainServer.common.caseNotFound"));
      const companies = (caseRow as unknown as { companies: { name: string } | { name: string }[] })
        .companies;
      const realName =
        (Array.isArray(companies) ? companies[0]?.name : companies?.name)?.trim() || "casen";
      // Demo view: the confirmation shows the display name. Loaded before anything is
      // written, so a failure stops the save instead of showing the real name.
      const view = await demoNamer(data.fundId);
      const caseName = view ? view.apply(realName) : realName;

      // The note is the team's, so it is written in the team's language, not the page's.
      const body = await withFundLanguage(context.supabase, data.fundId, async () =>
        answerNoteBody({ question, answer: answer.content, citations }),
      );
      // Saving the same answer again (after a reload, or when the first answer got lost on the
      // way back) must not give the case two identical notes. Compared here, not in the query: a
      // body of up to 4000 characters in the URL can pass the gateway's URL limit.
      const { data: existing, error: existingError } = await context.supabase
        .from("case_notes")
        .select("body")
        .eq("fund_id", data.fundId)
        .eq("case_id", data.caseId)
        .eq("author_id", context.userId)
        .gte("created_at", answer.created_at)
        .order("created_at", { ascending: false })
        .limit(200);
      if (existingError) throw existingError;
      if ((existing ?? []).some((note) => (note as { body: string }).body === body)) {
        return { caseName };
      }
      const { error } = await context.supabase.from("case_notes").insert({
        fund_id: data.fundId,
        case_id: data.caseId,
        author_id: context.userId,
        body,
      });
      if (error) throw error;
      const { enqueueBrainCapture } = await import("./queue.server");
      await enqueueBrainCapture(data.fundId, data.caseId);
      return { caseName };
    });
  });

/**
 * "Gem i Brain" (L8): the STORED answer becomes an episode `answer` with trust
 * `user_note`, searchable like any other text. It is never read into facts (extraction is
 * 'skipped': Brain must not learn from its own words) and runs only on the user's click. Saving
 * the same answer twice is a no-op. The vector is made by the case's next capture; an answer
 * from a thread without a case is found by its words until then.
 */
export const saveBrainAnswerToBrain = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ fundId, messageId: z.guid() }).strict().parse(input))
  .handler(async ({ data, context }): Promise<{ saved: boolean }> => {
    await requireChat(context, data.fundId);
    await requireFundCapability(context.supabase, context.userId, data.fundId, "write_notes");
    return userFacing("save to brain", async () => {
      let stored = await answerToSave(context, data.fundId, data.messageId);
      const { data: thread, error: threadError } = await context.supabase
        .from("brain_threads")
        .select("case_id")
        .eq("fund_id", data.fundId)
        .eq("id", stored.answer.thread_id)
        .maybeSingle();
      if (threadError) throw threadError;
      const caseId = (thread as { case_id: string | null } | null)?.case_id ?? null;

      const service = await serviceClient();
      let companyId: string | null = null;
      if (caseId) {
        const { data: caseRow, error: caseError } = await service
          .from("cases")
          .select("company_id")
          .eq("fund_id", data.fundId)
          .eq("id", caseId)
          .maybeSingle();
        if (caseError) throw caseError;
        companyId = (caseRow as { company_id: string | null } | null)?.company_id ?? null;
      }
      const { saveAnswerEpisode } = await import("./answer-episode.server");
      // A "Glem kilde" between reading the answer and saving it changes its citations:
      // the text is built again from the stored answer, so the forgotten source's labels are never
      // saved in its sources line.
      let saved = false;
      for (let attempt = 1; ; attempt += 1) {
        if (attempt > 1) stored = await answerToSave(context, data.fundId, data.messageId);
        const result = await saveAnswerEpisode(service, {
          fundId: data.fundId,
          messageId: stored.answer.id,
          caseId,
          companyId,
          storedCitations: stored.answer.citations,
          // Saved in the team's language, like the note.
          draft: await withFundLanguage(service, data.fundId, async () =>
            answerEpisodeDraft({
              question: stored.question,
              answer: stored.answer.content,
              citations: stored.citations,
            }),
          ),
        });
        if (result !== "sources_changed") {
          saved = result === "saved";
          break;
        }
        if (attempt === 3) throw new Error("answer episode: the answer's sources kept changing");
      }
      if (saved && caseId) {
        const { enqueueBrainCapture } = await import("./queue.server");
        await enqueueBrainCapture(data.fundId, caseId);
      }
      return { saved };
    });
  });

export interface BrainMention {
  kind: "case" | "entity";
  id: string;
  label: string;
  /** Entities: their type (company, person ...). */
  detail: string | null;
}

/**
 * The @ menu: the fund's own cases by company name, plus entities Brain has found (companies
 * and people). Only this fund's rows; RLS applies to the case search. Entities are best-effort:
 * a failure leaves the cases. In the demo view the menu reads the team's rows and matches on the
 * names the screen shows (`mentionMatch`, a).
 */
export const searchBrainMentions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({ fundId, q: z.string().trim().max(80) })
      .strict()
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<BrainMention[]> => {
    await requireChat(context, data.fundId);
    return userFacing("mentions", async () => {
      const namer = await demoNamer(data.fundId);
      const pattern = `%${mentionText(data.q)}%`;
      const shows = mentionMatch(data.q, namer);
      const mentions: BrainMention[] = [];
      let caseQuery = context.supabase
        .from("cases")
        .select("id, companies!inner(name)")
        .eq("fund_id", data.fundId);
      caseQuery = namer
        ? caseQuery.order("id").limit(DEMO_MENU_SCAN)
        : caseQuery.ilike("companies.name", pattern).limit(8);
      const cases = await caseQuery;
      // The cases are the menu's core: a failure must not look like "Ingen fundet".
      if (cases.error) throw cases.error;
      for (const row of (cases.data ?? []) as unknown as {
        id: string;
        companies: { name: string } | { name: string }[] | null;
      }[]) {
        if (mentions.length >= 8) break;
        const company = Array.isArray(row.companies) ? row.companies[0] : row.companies;
        if (company?.name && shows(company.name))
          mentions.push({ kind: "case", id: row.id, label: company.name, detail: null });
      }
      if (data.q.length >= 2) {
        let entityQuery = context.supabase
          .from("brain_entities")
          .select("id, name, type")
          .eq("fund_id", data.fundId)
          .eq("status", "active")
          .in("type", ["company", "person"]);
        entityQuery = namer
          ? entityQuery.order("id").limit(DEMO_MENU_SCAN)
          : entityQuery.ilike("name", pattern).limit(6);
        const entities = await entityQuery;
        if (entities.error) {
          console.error("[brain-chat] mention entities", entities.error.message);
        } else {
          let found = 0;
          for (const row of (entities.data ?? []) as { id: string; name: string; type: string }[]) {
            if (found >= 6) break;
            if (!shows(row.name)) continue;
            mentions.push({ kind: "entity", id: row.id, label: row.name, detail: row.type });
            found += 1;
          }
        }
      }
      return namer ? namer.applyJson(mentions) : mentions;
    });
  });
