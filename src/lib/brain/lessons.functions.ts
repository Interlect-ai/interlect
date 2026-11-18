/**
 * Brain · Lært og Playbook (for): reads of the insights that ask for a decision, the
 * reflections over decisions and the lessons, and the user's own review of a lesson (approve,
 * reject, edit, retire, add). Reads go through the user's own session (row security: members of
 * the fund only). The review goes through `brain_lesson_review` (0081) with the service client
 * after the capability `configure_fund` is checked; every change is logged as the user's.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireFundCapability } from "@/lib/auth/access.server";
import { requireSupabaseAuth } from "@/lib/supabase/auth-middleware";
import { BrainUserError } from "./errors";
import {
  LESSON_SECTIONS,
  MAX_INSIGHTS,
  MAX_LESSONS,
  MAX_REFLECTIONS,
  checkLessonText,
  shapeEvent,
  shapeInsight,
  shapeLesson,
  shapeReflection,
  type InsightView,
  type LessonEvent,
  type LessonView,
  type ReflectionView,
} from "./lessons";
import { serverText } from "@/lib/i18n/server-text";
import type { MessageKey } from "@/lib/i18n/translate";
import { inDemoView } from "@/lib/display/display-names.server";

const fund = z.object({ fundId: z.guid() });
const SECTION_KEYS = LESSON_SECTIONS.map((section) => section.key) as [string, ...string[]];

const LESSON_COLUMNS =
  "id, short_id, section, text, helpful, harmful, status, origin, scope, evidence";

async function readAccess(
  context: { supabase: Parameters<typeof requireFundCapability>[0]; userId: string },
  fundId: string,
) {
  const access = await requireFundCapability(
    context.supabase,
    context.userId,
    fundId,
    "brain_chat",
  );
  const { computeBrainCapabilities } = await import("./capabilities.server");
  const caps = await computeBrainCapabilities(fundId, access);
  if (!caps.chat) throw new BrainUserError(serverText("brainServer.common.notAvailable"));
  const { hasCapability } = await import("@/lib/domain/workflow");
  return { canReview: hasCapability(access.roles, "configure_fund", access.settings) };
}

export interface LearnedFeed {
  insights: InsightView[];
  reflections: ReflectionView[];
  /** New insights that need an action: the number on the tab ("Lært (3)"). */
  needsAction: number;
  canReview: boolean;
}

const failRead = (what: string, error: { message: string } | null) => {
  console.error(`[brain-lessons] ${what}`, error?.message);
  throw new Error(serverText("brainServer.common.notLoaded"));
};

export const getBrainLearned = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => fund.strict().parse(input))
  .handler(async ({ data, context }): Promise<LearnedFeed> => {
    const { canReview } = await readAccess(context, data.fundId);
    const [insights, reflections] = await Promise.all([
      context.supabase
        .from("brain_insights")
        .select("id, kind, title, body_md, refs, priority, status, created_at")
        .eq("fund_id", data.fundId)
        .in("status", ["new", "seen"])
        .order("priority", { ascending: true })
        .order("created_at", { ascending: false })
        .limit(MAX_INSIGHTS),
      context.supabase
        .from("brain_log")
        .select("object_id, after, created_at")
        .eq("fund_id", data.fundId)
        .eq("object_kind", "reflection")
        .order("created_at", { ascending: false })
        .limit(MAX_REFLECTIONS),
    ]);
    if (insights.error) failRead("insights", insights.error);
    if (reflections.error) failRead("reflections", reflections.error);
    const rows = (insights.data ?? []) as unknown as Array<Record<string, unknown>>;
    const bulletIds = rows
      .filter((row) => row["kind"] === "lesson_candidate")
      .flatMap((row) =>
        ((row["refs"] as Array<{ kind?: string; id?: string }> | null) ?? [])
          .filter((ref) => ref.kind === "bullet" && typeof ref.id === "string")
          .map((ref) => ref.id as string),
      );
    const lessons = new Map<string, LessonView>();
    if (bulletIds.length > 0) {
      const { data: bullets, error } = await context.supabase
        .from("brain_playbook_bullets")
        .select(LESSON_COLUMNS)
        .eq("fund_id", data.fundId)
        .in("id", [...new Set(bulletIds)]);
      if (error) failRead("bullets", error);
      for (const bullet of (bullets ?? []) as unknown as Array<Record<string, unknown>>) {
        const lesson = shapeLesson(bullet);
        if (lesson) lessons.set(lesson.id, lesson);
      }
    }
    const shaped = rows
      .map((row) => shapeInsight(row, lessons))
      // A lesson insight whose lesson is already decided (or gone) needs nothing more.
      .filter((item): item is InsightView =>
        Boolean(item && (item.kind !== "lesson_candidate" || item.lesson?.status === "candidate")),
      );
    return inDemoView(data.fundId, {
      insights: shaped,
      reflections: ((reflections.data ?? []) as unknown as Array<Record<string, unknown>>)
        .map(shapeReflection)
        .filter((item): item is ReflectionView => item !== null),
      needsAction: shaped.filter((item) => item.kind === "lesson_candidate").length,
      canReview,
    });
  });

export interface Playbook {
  lessons: LessonView[];
  truncated: boolean;
  canReview: boolean;
}

export const getBrainPlaybook = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => fund.strict().parse(input))
  .handler(async ({ data, context }): Promise<Playbook> => {
    const { canReview } = await readAccess(context, data.fundId);
    const { data: rows, error } = await context.supabase
      .from("brain_playbook_bullets")
      .select(LESSON_COLUMNS)
      .eq("fund_id", data.fundId)
      .in("status", ["candidate", "active", "retired"])
      .order("created_at", { ascending: false })
      .limit(MAX_LESSONS + 1);
    if (error) failRead("playbook", error);
    const all = ((rows ?? []) as unknown as Array<Record<string, unknown>>)
      .map(shapeLesson)
      .filter((item): item is LessonView => item !== null);
    return inDemoView(data.fundId, {
      lessons: all.slice(0, MAX_LESSONS),
      truncated: all.length > MAX_LESSONS,
      canReview,
    });
  });

export interface LessonWhy {
  /** What the lesson rests on: kinds only (decision, case ...), the counts say the rest. */
  evidence: Array<{ kind: string; label: string | null }>;
  events: LessonEvent[];
}

export const getBrainLessonWhy = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => fund.extend({ bulletId: z.guid() }).strict().parse(input))
  .handler(async ({ data, context }): Promise<LessonWhy> => {
    await readAccess(context, data.fundId);
    const [bullet, events] = await Promise.all([
      context.supabase
        .from("brain_playbook_bullets")
        .select("evidence")
        .eq("fund_id", data.fundId)
        .eq("id", data.bulletId)
        .maybeSingle(),
      context.supabase
        .from("brain_bullet_events")
        .select("source_kind, reason, delta_helpful, delta_harmful, created_at")
        .eq("fund_id", data.fundId)
        .eq("bullet_id", data.bulletId)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);
    if (bullet.error) failRead("why", bullet.error);
    if (events.error) failRead("events", events.error);
    if (!bullet.data) throw new BrainUserError(serverText("brainServer.lessons.gone"));
    const evidence = Array.isArray(bullet.data.evidence) ? bullet.data.evidence : [];
    return inDemoView(data.fundId, {
      evidence: evidence
        .filter((ref): ref is Record<string, unknown> => Boolean(ref) && typeof ref === "object")
        .slice(0, 20)
        .map((ref) => ({
          kind: typeof ref["kind"] === "string" ? ref["kind"] : "kilde",
          label: typeof ref["label"] === "string" ? ref["label"].slice(0, 200) : null,
        })),
      events: ((events.data ?? []) as unknown as Array<Record<string, unknown>>)
        .map(shapeEvent)
        .filter((item): item is LessonEvent => item !== null),
    });
  });

const SKIPPED: Record<string, MessageKey> = {
  gone: "brainServer.lessons.gone",
  not_candidate: "brainServer.lessons.notCandidate",
  not_open: "brainServer.lessons.notOpen",
  not_active: "brainServer.lessons.notActive",
};

export const reviewBrainLesson = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    fund
      .extend({
        action: z.enum(["approve", "reject", "edit", "retire", "add"]),
        bulletId: z.guid().optional(),
        text: z.string().max(2000).optional(),
        section: z.enum(SECTION_KEYS).optional(),
      })
      .strict()
      .refine((value) => value.action === "add" || value.bulletId !== undefined, {
        error: serverText("brainServer.lessons.missing"),
      })
      .refine((value) => value.action !== "add" || (value.text && value.section), {
        error: serverText("brainServer.lessons.writeAndChoose"),
      })
      .parse(input),
  )
  .handler(
    async ({
      data,
      context,
    }): Promise<{ id: string | null; status: string | null; unchanged: boolean }> => {
      await requireFundCapability(context.supabase, context.userId, data.fundId, "configure_fund");
      let text: string | null = null;
      if (data.action === "add" || data.action === "edit") {
        const check = checkLessonText(data.text ?? "");
        if (!check.ok) throw new BrainUserError(check.message);
        text = check.text;
      }
      const { getServiceClient } = await import("@/lib/supabase/admin.server");
      const { data: result, error } = await getServiceClient().rpc("brain_lesson_review", {
        _fund_id: data.fundId,
        _user_id: context.userId,
        _action: data.action,
        _bullet_id: data.bulletId ?? null,
        _text: text,
        _section: data.section ?? null,
      });
      if (error) {
        console.error("[brain-lesson-review]", error.message);
        throw new Error(serverText("brainServer.lessons.notSaved"));
      }
      const outcome = (result ?? {}) as { skipped?: string; id?: string; status?: string };
      if (outcome.skipped === "unchanged") return { id: null, status: null, unchanged: true };
      if (outcome.skipped) {
        throw new BrainUserError(
          serverText(SKIPPED[outcome.skipped] ?? "brainServer.lessons.notStored"),
        );
      }
      return { id: outcome.id ?? null, status: outcome.status ?? null, unchanged: false };
    },
  );

const INSIGHT_SKIPPED: Record<string, MessageKey> = {
  gone: "brainServer.lessons.insightGone",
  lesson: "brainServer.lessons.insightLesson",
  decided: "brainServer.lessons.insightDecided",
};

/**
 * Mark an insight in Lært as seen or dismiss it (`brain_insight_review`, 0096). An insight
 * about a lesson is decided on the lesson itself (`reviewBrainLesson`).
 */
export const reviewBrainInsight = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    fund
      .extend({ insightId: z.guid(), action: z.enum(["seen", "dismiss"]) })
      .strict()
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ id: string; status: string }> => {
    await requireFundCapability(context.supabase, context.userId, data.fundId, "configure_fund");
    const { getServiceClient } = await import("@/lib/supabase/admin.server");
    const { data: result, error } = await getServiceClient().rpc("brain_insight_review", {
      _fund_id: data.fundId,
      _user_id: context.userId,
      _insight_id: data.insightId,
      _action: data.action,
    });
    if (error) {
      console.error("[brain-insight-review]", error.message);
      throw new Error(serverText("brainServer.lessons.notSaved"));
    }
    const outcome = (result ?? {}) as { skipped?: string; id?: string; status?: string };
    if (outcome.skipped || !outcome.id || !outcome.status) {
      throw new BrainUserError(
        serverText(INSIGHT_SKIPPED[outcome.skipped ?? ""] ?? "brainServer.lessons.notStored"),
      );
    }
    return { id: outcome.id, status: outcome.status };
  });
