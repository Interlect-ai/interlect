import { waitUntil } from "@vercel/functions";
import { loadAccessForFund, writeAudit } from "@/lib/auth/access.server";
import { hasCapability } from "@/lib/domain/workflow";
import { CreditsExhaustedError, MonthlyLimitError } from "@/lib/ai/credits.server";
import { AiUseLimitError } from "@/lib/ai/usage-limits.server";
import type { Language } from "@/lib/i18n/language";
import { getServiceClient } from "@/lib/supabase/admin.server";
import { userFromAuthorizationHeader } from "@/lib/supabase/auth-middleware";
import { SETUP_DRAFT_MODEL, draftStages, setupDraftRequestSchema } from "./setup-draft";
import {
  runSetupDraft,
  type PreviousInvestment,
  type SetupDraftEvent,
  type SetupDraftTrace,
} from "./setup-draft.server";

/** Why a draft was refused before it started; the page has the words. */
export type SetupDraftRefusal =
  "forbidden" | "bad_request" | "no_stage" | "draft_not_found" | "credits" | "limit" | "failed";

const refuse = (status: number, code: SetupDraftRefusal) => Response.json({ code }, { status });

/** The stream's last line when something unexpected broke it after it began. */
export type SetupDraftStreamEvent = SetupDraftEvent | { type: "error"; code: "failed" };

/**
 * `POST /api/fund-setup/draft`: the setup draft for every chosen stage, as an NDJSON
 * stream of SetupDraftStreamEvent (one per line), so the waiting screen shows what the AI does
 * while it does it. Refusals before the stream are plain HTTP: 401 not signed in, 400 bad body or
 * no stage, 403 no `configure_fund`, 404 the version is not a draft of the team, 402 too few
 * credits, 429 the hourly limit, 500 anything else. If the user leaves, the calls not yet sent
 * are not sent, and the reservation is still settled.
 */
export async function handleSetupDraft(request: Request): Promise<Response> {
  let auth: Awaited<ReturnType<typeof userFromAuthorizationHeader>>;
  try {
    auth = await userFromAuthorizationHeader(request.headers.get("authorization"));
  } catch (cause) {
    console.error("[setup-draft] auth", cause instanceof Error ? cause.message : cause);
    return refuse(500, "failed");
  }
  if (!auth) return refuse(401, "forbidden");

  let body: ReturnType<typeof setupDraftRequestSchema.parse>;
  try {
    const parsed = setupDraftRequestSchema.safeParse(await request.json());
    if (!parsed.success) {
      // Paths only, never values (the thesis is the team's own text).
      console.warn(
        "[setup-draft] bad body",
        parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.code}`),
      );
      return refuse(400, "bad_request");
    }
    body = parsed.data;
  } catch {
    return refuse(400, "bad_request");
  }
  if (!draftStages(body.frame).length) return refuse(400, "no_stage");

  const service = getServiceClient();
  let teamName: string;
  let language: Language;
  let previousInvestments: PreviousInvestment[];
  try {
    const access = await loadAccessForFund(auth.supabase, auth.userId, body.fundId);
    if (!access || !hasCapability(access.roles, "configure_fund", access.settings)) {
      return refuse(403, "forbidden");
    }
    teamName = access.fundName;
    language = access.language;
    const { data: config, error: configError } = await service
      .from("fund_config_versions")
      .select("id")
      .eq("id", body.configId)
      .eq("fund_id", body.fundId)
      .eq("status", "draft")
      .maybeSingle();
    if (configError) throw new Error(`config: ${configError.message}`);
    if (!config) return refuse(404, "draft_not_found");
    const { data: rows, error: rowsError } = await service
      .from("historical_investments")
      .select("company_name, stage, sector, geography, invested_at, note")
      .eq("fund_id", body.fundId)
      .order("invested_at", { ascending: false, nullsFirst: false })
      .limit(40);
    if (rowsError) throw new Error(`historical_investments: ${rowsError.message}`);
    previousInvestments = (rows ?? []).map((row) => ({
      companyName: String(row["company_name"] ?? ""),
      stage: (row["stage"] as string | null) ?? null,
      sector: (row["sector"] as string | null) ?? null,
      geography: (row["geography"] as string | null) ?? null,
      investedAt: (row["invested_at"] as string | null) ?? null,
      note: (row["note"] as string | null) ?? null,
    }));
  } catch (cause) {
    console.error("[setup-draft] access", cause instanceof Error ? cause.message : cause);
    return refuse(500, "failed");
  }

  const abort = new AbortController();
  request.signal?.addEventListener("abort", () => abort.abort(), { once: true });
  const encoder = new TextEncoder();
  let open = true;
  let sink: ReadableStreamDefaultController<Uint8Array> | null = null;
  const send = (event: SetupDraftStreamEvent) => {
    if (!open || !sink) return;
    try {
      sink.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
    } catch {
      open = false;
    }
  };
  const close = () => {
    if (!open || !sink) return;
    open = false;
    try {
      sink.close();
    } catch {
      // already closed by the client
    }
  };
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      sink = controller;
    },
    cancel() {
      open = false;
      abort.abort();
    },
  });

  // The credits are reserved before the first event: until then a refusal is a plain HTTP answer.
  let started!: (outcome: { ok: true } | { ok: false; cause: unknown }) => void;
  const first = new Promise<{ ok: true } | { ok: false; cause: unknown }>((resolve) => {
    started = resolve;
  });
  const trace: SetupDraftTrace = {
    costUsd: 0,
    calls: 0,
    searches: 0,
    searchResults: 0,
    sitePages: 0,
    problems: [],
  };
  const userId = auth.userId;
  const run = runSetupDraft({
    service,
    fundId: body.fundId,
    userId,
    teamName,
    frame: body.frame,
    previousInvestments,
    language,
    signal: abort.signal,
    trace,
    emit: (event) => {
      started({ ok: true });
      send(event);
    },
  })
    .then(async (result) => {
      await writeAudit(service, {
        fundId: body.fundId,
        actorType: "user",
        actorId: userId,
        action: "fund_setup_drafted",
        entity: "fund_config_versions",
        entityId: body.configId,
        payload: {
          stages: result.drafts.map((draft) => draft.stage),
          stopped: result.stopped,
          model: SETUP_DRAFT_MODEL,
          costUsd: Math.round(result.costUsd * 10_000) / 10_000,
          calls: trace.calls,
          searches: trace.searches,
          sitePages: trace.sitePages,
          previousInvestments: previousInvestments.length,
        },
      }).catch((cause: unknown) => {
        console.error("[setup-draft] audit", cause instanceof Error ? cause.message : cause);
      });
    })
    .catch((cause: unknown) => {
      started({ ok: false, cause });
      console.error("[setup-draft] run", cause instanceof Error ? cause.message : cause);
      send({ type: "error", code: "failed" });
    })
    .finally(() => {
      // A run that ended without an event (the user left while the credits were reserved) must
      // still let the handler answer; a no-op when it already did.
      started({ ok: true });
      close();
    });
  // On Vercel the function lives until the reservation is settled, even after the client left.
  try {
    waitUntil(run);
  } catch {
    // Outside Vercel (local dev) the promise simply runs on.
  }

  const outcome = await first;
  if (!outcome.ok) {
    open = false;
    const { cause } = outcome;
    if (cause instanceof CreditsExhaustedError) return refuse(402, "credits");
    if (cause instanceof AiUseLimitError || cause instanceof MonthlyLimitError)
      return refuse(429, "limit");
    return refuse(500, "failed");
  }
  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
    },
  });
}
