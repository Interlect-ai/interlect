import { waitUntil } from "@vercel/functions";
import type { Language } from "@/lib/i18n/language";
import { z } from "zod";
import { loadAccessForFund } from "@/lib/auth/access.server";
import { hasCapability } from "@/lib/domain/workflow";
import { redactorForFund } from "@/lib/ai/redact-dictionary.server";
import { getServiceClient } from "@/lib/supabase/admin.server";
import { userFromAuthorizationHeader } from "@/lib/supabase/auth-middleware";
import { CHAT_QUESTION_MAX, type ChatErrorCode, type ChatStreamEvent } from "../chat-contract";
import { isBrainEnabled } from "../flags";
import { prepareChatTurn, streamChatTurn } from "./engine.server";
import { createSupabaseChatStore } from "./store.server";
import { runWebSearch } from "../web/search.server";
import { createChatTools } from "./tools.server";
import { loadDemoView } from "@/lib/display/display-names.server";
import { createEventAliaser } from "./display-events";

const uuid = z.guid();
const bodySchema = z
  .object({
    fundId: uuid,
    threadId: uuid.nullable(),
    caseId: uuid.nullable(),
    entityIds: z.array(uuid).max(20),
    scope: z.enum(["cases", "thesis"]),
    question: z.string().trim().min(1).max(CHAT_QUESTION_MAX),
    mode: z.enum(["fast", "deep"]),
    webQueries: z.array(z.string().max(300)).max(6).optional(),
  })
  .strict();

const refuse = (status: number, code: ChatErrorCode) => Response.json({ code }, { status });

/**
 * `POST /api/brain/chat` (contract: chat-contract.ts). Refusals before the stream are
 * plain HTTP: 409 Brain off, 401 not signed in, 400 bad body, 403 no `brain_chat` or not the
 * thread's owner, 429 too many questions. Then one NDJSON event per line. If the user leaves
 * (Stop), the turn keeps running in the background just long enough to save what was written
 * and settle the budget.
 */
export async function handleBrainChat(request: Request): Promise<Response> {
  if (!isBrainEnabled()) return refuse(409, "disabled");
  let auth: Awaited<ReturnType<typeof userFromAuthorizationHeader>>;
  try {
    auth = await userFromAuthorizationHeader(request.headers.get("authorization"));
  } catch (cause) {
    console.error("[brain-chat] auth", cause instanceof Error ? cause.message : cause);
    return refuse(500, "failed");
  }
  if (!auth) return refuse(401, "forbidden");

  let body: z.infer<typeof bodySchema>;
  try {
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      // Paths only, never values: a contract mismatch with the UI must be visible in the log.
      console.warn(
        "[brain-chat] bad body",
        parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.code}`),
      );
      return refuse(400, "failed");
    }
    body = parsed.data;
  } catch {
    console.warn("[brain-chat] body is not JSON");
    return refuse(400, "failed");
  }

  let fundName: string;
  let language: Language;
  let service: ReturnType<typeof getServiceClient>;
  try {
    const access = await loadAccessForFund(auth.supabase, auth.userId, body.fundId);
    if (!access || !hasCapability(access.roles, "brain_chat", access.settings)) {
      return refuse(403, "forbidden");
    }
    fundName = access.fundName;
    language = access.language;
    service = getServiceClient();
  } catch (cause) {
    console.error("[brain-chat] access", cause instanceof Error ? cause.message : cause);
    return refuse(500, "failed");
  }

  // Demo view: the team shows invented names, web addresses and register numbers.
  // Fails closed: if they cannot be loaded nothing is answered, rather than an answer with the
  // real ones.
  let view: Awaited<ReturnType<typeof loadDemoView>>;
  try {
    view = await loadDemoView(service, body.fundId);
  } catch (cause) {
    console.error("[brain-chat] demo view", cause instanceof Error ? cause.message : cause);
    return refuse(500, "failed");
  }
  // The user sees aliases, so what they type is turned back into the names the data knows.
  if (view) {
    const back = view;
    body = {
      ...body,
      question: back.reverse(body.question),
      ...(body.webQueries ? { webQueries: body.webQueries.map((q) => back.reverse(q)) } : {}),
    };
  }
  const showAs = createEventAliaser(view);

  const store = createSupabaseChatStore(service);
  let prepared: Awaited<ReturnType<typeof prepareChatTurn>>;
  try {
    prepared = await prepareChatTurn(store, {
      fundId: body.fundId,
      fundName,
      language,
      userId: auth.userId,
      request: body,
    });
  } catch (cause) {
    console.error("[brain-chat] prepare", cause instanceof Error ? cause.message : cause);
    return refuse(500, "failed");
  }
  if (!prepared.ok) return refuse(prepared.status, prepared.code);

  const abort = new AbortController();
  request.signal?.addEventListener("abort", () => abort.abort(), { once: true });
  const encoder = new TextEncoder();
  let open = true;
  let sink: ReadableStreamDefaultController<Uint8Array> | null = null;
  const send = (event: ChatStreamEvent) => {
    if (!open || !sink) return;
    try {
      sink.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
    } catch {
      open = false;
    }
  };

  // The stream exists (and `sink` is set) before the turn can send its first event.
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      sink = controller;
    },
    cancel() {
      open = false;
      abort.abort();
    },
  });
  const response = new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
    },
  });

  const turn = (async () => {
    for await (const event of streamChatTurn(
      {
        store,
        createTools: (ctx) => createChatTools(service, ctx),
        redactor: (fundId) => redactorForFund(fundId, "brain_chat", service),
        webSearch: (queries, signal) =>
          runWebSearch(service, { fundId: body.fundId, userId: auth.userId, queries, signal }),
      },
      prepared.turn,
      abort.signal,
    )) {
      for (const shown of showAs(event)) send(shown);
    }
  })()
    .catch((cause) => {
      console.error("[brain-chat] stream", cause instanceof Error ? cause.message : cause);
      send({ type: "error", code: "failed" });
    })
    .finally(() => {
      if (open && sink) {
        open = false;
        try {
          sink.close();
        } catch {
          // already closed by the client
        }
      }
    });
  // On Vercel the function lives until the answer is saved, even after the client has left.
  try {
    waitUntil(turn);
  } catch {
    // Outside Vercel (local dev) the promise simply runs on.
  }

  return response;
}
