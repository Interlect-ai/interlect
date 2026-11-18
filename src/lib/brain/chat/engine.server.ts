import {
  asSchema,
  isStepCount,
  jsonSchema,
  Output,
  type LanguageModel,
  type ModelMessage,
  type ToolSet,
} from "ai";
import { ZodError, type z } from "zod";
import {
  estimateRequestMaximumUsd,
  tokenCostUsd,
  type PricedModel,
} from "../../analysis/budgets.ts";
import { DEFAULT_LANGUAGE, type Language } from "../../i18n/language.ts";
import { questionLanguage } from "../../i18n/question-language.ts";
import { extractGatewayCostUsd } from "../../analysis/gateway-response.ts";
import { AiDataPolicyError, aiGatewayOptions } from "../../ai/gateway-options.ts";
import {
  generateText,
  isPermanentPolicyStop,
  maskedModel,
  streamText,
} from "../../ai/model-call.ts";
import type { Redactor } from "../../ai/redact.ts";
import type {
  ChatConfidence,
  ChatErrorCode,
  ChatMode,
  ChatRequest,
  ChatStreamEvent,
} from "../chat-contract.ts";
import {
  AFTER_CALL_MAX_OUTPUT_TOKENS,
  AFTER_CALL_MODEL,
  AFTER_CALL_RESERVE_USD,
  AFTER_CALL_SCHEMA,
  afterCallPrompt,
  buildSystemPrompt,
  capUsd,
  CHAT_MODES,
  HISTORY_MESSAGES,
  historyForModel,
  MAX_CHAT_STEPS,
  MAX_STEP_EVENTS,
  QUESTIONS_PER_MINUTE,
  threadTitleFromQuestion,
  toolStepText,
  webQueryStepText,
  writingStepText,
} from "./prompt.ts";
import { BrainBudgetReachedError } from "../errors.ts";
import {
  commandAnswerPrefix,
  commandProblem,
  commandPromptSection,
  commandQuestion,
  parseCommand,
} from "./commands.ts";
import { sanitizeWebQueries } from "../web/queries.ts";
import type { WebResult } from "../web/search.server.ts";
import { createLeakFilter } from "./leak-filter.ts";
import { checkCitations, citationsFor, createSourceRegistry } from "./sources.ts";
import type { ChatStore, ChatThreadRow } from "./store.server.ts";
import type { ChatToolContext } from "./tools.server.ts";
import { translate } from "../../i18n/translate.ts";

/**
 * Brain's chat engine, behind `POST /api/brain/chat` and the contract in
 * chat-contract.ts. One question is one turn:
 *
 * 1. prepareChatTurn (before the stream): the thread is the user's own, the case and the
 *    @-entities belong to the fund, and the user is under the per-minute limit.
 * 2. streamChatTurn: reserves the question's cap (1 kr fast, 4 kr deep) in the fund's monthly
 *    chat budget, saves the question, runs the model with read-only tools for at most six
 *    steps (the last one must answer), books every step's price, and forces a final answer or
 *    stops before a step could pass the cap. After the stream the code checks every [n]
 *    against the rows the tools returned, a small after-call rates confidence and lists missing
 *    material, the answer is saved with its citations, and the searches are marked as cited.
 *
 * The model never sees or chooses the fund, never writes, and never decides (system prompt).
 * Errors become fixed codes; raw texts are only logged. A stopped answer (the user's Stop) is
 * saved as far as it got.
 */

export type ChatTurn = {
  fundId: string;
  fundName: string;
  /** The fund's language; the answer follows the user's own language first. */
  language?: Language;
  userId: string;
  request: ChatRequest;
  thread: ChatThreadRow | null;
  focusCase: { id: string; name: string } | null;
  entities: Array<{ id: string; name: string; type: string }>;
};

export type PrepareResult =
  { ok: true; turn: ChatTurn } | { ok: false; status: 400 | 403 | 429; code: ChatErrorCode };

export async function prepareChatTurn(
  store: ChatStore,
  input: {
    fundId: string;
    fundName: string;
    language?: Language;
    userId: string;
    request: ChatRequest;
    now?: Date;
  },
): Promise<PrepareResult> {
  const { fundId, userId, request } = input;
  if (!request.question.trim()) return { ok: false, status: 400, code: "failed" };
  let thread: ChatThreadRow | null = null;
  if (request.threadId) {
    thread = await store.loadThread(fundId, request.threadId);
    // Another fund's thread looks the same as someone else's: only the owner may write.
    if (!thread || thread.userId !== userId) return { ok: false, status: 403, code: "forbidden" };
  }
  const caseId = request.caseId ?? thread?.caseId ?? null;
  let focusCase: ChatTurn["focusCase"] = null;
  if (caseId) {
    const name = await store.caseName(fundId, caseId);
    if (name === null) return { ok: false, status: 403, code: "forbidden" };
    focusCase = { id: caseId, name };
  }
  const entities = await store.entities(fundId, [...new Set(request.entityIds)].slice(0, 10));
  const since = new Date((input.now ?? new Date()).getTime() - 60_000);
  if ((await store.recentQuestions(fundId, userId, since)) >= QUESTIONS_PER_MINUTE) {
    return { ok: false, status: 429, code: "rate_limited" };
  }
  return {
    ok: true,
    turn: {
      fundId,
      fundName: input.fundName,
      ...(input.language ? { language: input.language } : {}),
      userId,
      request,
      thread,
      focusCase,
      entities,
    },
  };
}

export type AfterCallResult = {
  confidence: ChatConfidence | null;
  missing: string[];
  costUsd: number;
};
export type AfterCaller = (input: {
  question: string;
  answer: string;
  sourceCount: number;
  /** The answer's language, so the missing-material lines match it. */
  language: Language;
  /** The turn's masking, so the after-call sees the same placeholders. */
  redactor: Redactor;
}) => Promise<AfterCallResult>;

export type ChatEngineDeps = {
  store: ChatStore;
  createTools: (ctx: ChatToolContext) => ToolSet;
  /** Test seam; the default is the Gateway model of the mode. */
  model?: (mode: ChatMode) => LanguageModel;
  /**
   * The fund's masking: one redactor per turn, so a person keeps one placeholder across
   * the history, the tool results and every step.
   */
  redactor: (fundId: string) => Promise<Redactor>;
  afterCall?: AfterCaller;
  /** Runs the approved web queries; absent = the chat has no web search. */
  webSearch?: (
    queries: readonly string[],
    signal: AbortSignal,
  ) => Promise<{ results: WebResult[]; costUsd: number; failed: number }>;
  newId?: () => string;
  now?: () => Date;
  log?: (message: string, detail?: unknown) => void;
};

/** Tool definitions are sent with every step; their schemas are counted as this many tokens. */
const TOOL_SCHEMA_TOKENS = 1_800;
/** A final answer needs at least this many output tokens to be worth a step. */
const MIN_FINAL_TOKENS = 600;
const ANSWER_MAX_CHARS = 100_000;

/** What the model gets from a tool that failed; the raw error is only logged. */
export const TOOL_FAILED =
  "The tool failed for a technical reason. Do not guess and do not say that material is missing; say that Brain could not look this up right now.";
/**
 * What the model gets when its input does not fit the tool, e.g. a name or a shortened
 * id where a uuid belongs. The model's mistake, not a technical failure: it may try again.
 */
export function toolInputInvalid(problems: readonly string[]): string {
  const what = problems.length > 0 ? `: ${problems.join("; ")}` : " (see its schema)";
  return `The input does not fit this tool${what}. Correct the input and call the tool again, or answer from the results you have.`;
}
/** Added to an answer that was cut off, so it is never read as a whole answer. */
export const INCOMPLETE_NOTE = translate("da", "brainServer.chat.incomplete");
/** The last step may not look anything up; without this the model writes its call as text. */
const FINAL_STEP_NOTE =
  "No more lookups are possible. Write the final answer now as plain text, in the language the user writes in, from the tool results above. Never write JSON, tool names or tool calls.";
export const STOPPED_NOTE = translate("da", "brainServer.chat.stopped");
/** The two notes in the fund's language (Danish unchanged). */
export function incompleteNote(language: Language | undefined): string {
  return translate(language ?? "da", "brainServer.chat.incomplete");
}
export function stoppedNote(language: Language | undefined): string {
  return translate(language ?? "da", "brainServer.chat.stopped");
}

/** What the closing step adds to the request: the earlier steps' tool results and calls. */
const CLOSING_CONTEXT_TOKENS = 30_000;

const CLIENT_ABORT = "client";
const BUDGET_ABORT = "budget";
const TIMEOUT_ABORT = "timeout";

export type StepPlan =
  { kind: "normal" } | { kind: "final"; maxOutputTokens: number } | { kind: "stop" };

/**
 * Before each step (pure): continue, answer now without tools (the last step, or the cap is
 * near), or stop because not even a short answer fits under the cap.
 */
export function planStep(input: {
  stepNumber: number;
  spentUsd: number;
  capUsd: number;
  inputUsd: number;
  outputUsdPerToken: number;
  maxOutputTokens: number;
}): StepPlan {
  const available = input.capUsd - AFTER_CALL_RESERVE_USD - input.spentUsd;
  const full = input.inputUsd + input.maxOutputTokens * input.outputUsdPerToken;
  const last = input.stepNumber >= MAX_CHAT_STEPS - 1;
  if (full <= available) {
    return last ? { kind: "final", maxOutputTokens: input.maxOutputTokens } : { kind: "normal" };
  }
  const tokens = Math.floor((available - input.inputUsd) / input.outputUsdPerToken);
  if (tokens < MIN_FINAL_TOKENS) return { kind: "stop" };
  return { kind: "final", maxOutputTokens: Math.min(tokens, input.maxOutputTokens) };
}

export async function* streamChatTurn(
  deps: ChatEngineDeps,
  turn: ChatTurn,
  signal: AbortSignal,
): AsyncGenerator<ChatStreamEvent> {
  const { store } = deps;
  const log = deps.log ?? ((message, detail) => console.error(`[brain-chat] ${message}`, detail));
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const now = deps.now ?? (() => new Date());
  const { fundId, userId, request } = turn;
  const mode = CHAT_MODES[request.mode];
  // Web search: the queries the user approved, filtered again; a question with web search
  // may cost 1 kr more. Only when the route gave the engine a search to run.
  const webQueries = deps.webSearch ? sanitizeWebQueries(request.webQueries ?? []).queries : [];
  const cap = capUsd(request.mode, webQueries.length > 0);
  const question = request.question.trim();
  const messageId = newId();
  /** Every log line carries the fund and the answer, so it can be found again. */
  const note = (message: string, detail: Record<string, unknown> = {}) =>
    log(message, { fundId, messageId, ...detail });

  // The data rules first: a model they stop never reserves, saves or sends anything.
  let gatewayOptions: ReturnType<typeof aiGatewayOptions>;
  try {
    gatewayOptions = aiGatewayOptions({ model: mode.model, data: "confidential" });
  } catch (cause) {
    note("blocked by the data rules", { error: errorText(cause) });
    yield {
      type: "error",
      code: cause instanceof AiDataPolicyError ? "blocked_by_policy" : "failed",
    };
    return;
  }

  let redactor: Redactor;
  try {
    redactor = await deps.redactor(fundId);
  } catch (cause) {
    note("masking dictionary unavailable", { error: errorText(cause) });
    yield { type: "error", code: "failed" };
    return;
  }

  let usageId: string | null;
  try {
    usageId = await store.reserve({
      fundId,
      userId,
      usd: cap,
      model: mode.model,
      refId: messageId,
    });
  } catch (cause) {
    note("reserve failed", { error: errorText(cause) });
    yield { type: "error", code: "failed" };
    return;
  }
  if (usageId === null) {
    yield { type: "error", code: "budget_reached" };
    return;
  }

  // usd: model calls booked on this reservation. toolUsd: embeddings the tools booked on their
  // own ledger rows; counted against the cap and in the answer's price, never booked twice.
  const spend = { usd: 0, toolUsd: 0, inputTokens: 0, outputTokens: 0, requests: 0 };
  const settle = async () => {
    const usd = Number(spend.usd.toFixed(6));
    const once = () =>
      spend.usd > 0 || spend.requests > 0
        ? store.finalize({
            fundId,
            usageId,
            usd,
            inputTokens: spend.inputTokens,
            outputTokens: spend.outputTokens,
            requests: Math.max(1, spend.requests),
          })
        : store.release(fundId, usageId);
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const found = await once();
        if (!found) note("settle: reservation not found", { usageId, usd });
        return;
      } catch (cause) {
        // Nothing releases a stale reservation later: after two failures the question's whole
        // cap stays counted for the month, so the log must let someone find the row.
        note(`settle failed (attempt ${attempt})`, {
          usageId,
          usd,
          requests: spend.requests,
          error: errorText(cause),
        });
      }
    }
  };

  const controller = new AbortController();
  const onClientAbort = () => controller.abort(CLIENT_ABORT);
  signal.addEventListener("abort", onClientAbort, { once: true });
  if (signal.aborted) controller.abort(CLIENT_ABORT);
  const timer = setTimeout(() => controller.abort(TIMEOUT_ABORT), mode.timeoutMs);

  try {
    let threadId = turn.thread?.id ?? null;
    const [history, thesis] = await Promise.all([
      threadId ? store.history(fundId, threadId, HISTORY_MESSAGES) : Promise.resolve([]),
      store.thesis(fundId, request.scope === "thesis"),
    ]);
    if (!threadId) {
      const title = threadTitleFromQuestion(question);
      threadId = await store.createThread({
        fundId,
        userId,
        caseId: turn.focusCase?.id ?? null,
        title,
      });
      yield { type: "thread", threadId, title };
    }
    await store.insertMessage({ id: newId(), fundId, threadId, role: "user", content: question });

    // The approved web searches run before the model, so the model can only read their results
    // (web_search takes no arguments) and never shapes a query (B8). A failed search is
    // left out: the answer is written from the fund's own material.
    let webResults: WebResult[] = [];
    let webSteps = 0;
    // Every approved search failed, so the answer says it was written without the web.
    let webUnavailable = false;
    if (webQueries.length > 0 && deps.webSearch) {
      // One step per search: they run side by side, so each shows what is being looked up.
      for (const query of webQueries.slice(0, MAX_STEP_EVENTS - 1)) {
        yield { type: "step", index: webSteps, text: webQueryStepText(turn.language, query) };
        webSteps += 1;
      }
      try {
        const web = await deps.webSearch(webQueries, controller.signal);
        webResults = web.results;
        spend.toolUsd += web.costUsd;
        if (web.failed > 0)
          note("web searches failed", { failed: web.failed, of: webQueries.length });
        webUnavailable = webResults.length === 0 && web.failed > 0;
      } catch (cause) {
        note("web search failed", { error: errorText(cause) });
        webUnavailable = true;
      }
      // Stopped while searching: the running searches were cut off, so the model is never
      // asked. Each search booked its own row; the question's reservation is released.
      if (controller.signal.aborted) {
        const abortReason = String(controller.signal.reason);
        note("stopped during web search", { abortReason });
        if (abortReason !== CLIENT_ABORT) {
          yield { type: "error", code: "failed" };
          return;
        }
        // The answer is saved as stopped, so a reload shows it as stopped too.
        try {
          await store.insertMessage({
            id: messageId,
            fundId,
            threadId,
            role: "assistant",
            content: stoppedNote(turn.language),
            model: mode.model,
            costUsd: 0,
          });
        } catch (cause) {
          note("saving the stopped answer failed", { error: errorText(cause) });
        }
        return;
      }
    }
    // A message that starts with /forbered-møde, /sammenlign or /hvorfor.
    const command = parseCommand(question);
    // The case's own company chosen with @ is the same subject, not a second one.
    const focusName = turn.focusCase?.name.trim().toLowerCase() ?? null;
    const subjects = {
      hasCase: turn.focusCase !== null,
      entityCount: turn.entities.filter((entity) => entity.name.trim().toLowerCase() !== focusName)
        .length,
    };
    // A command that cannot run is answered by the engine in the team's language, with
    // no model call (before: a paid call asked to repeat a Danish sentence).
    const problem = command ? commandProblem(command.command, subjects, turn.language) : null;
    if (problem) {
      yield { type: "delta", text: problem };
      try {
        await store.insertMessage({
          id: messageId,
          fundId,
          threadId,
          role: "assistant",
          content: problem,
          citations: [],
          toolCalls: [],
          model: mode.model,
          costUsd: Number(spend.toolUsd.toFixed(6)),
        });
      } catch (cause) {
        note("saving the answer failed", { error: errorText(cause) });
        yield { type: "error", code: "failed" };
        return;
      }
      yield { type: "sources", citations: [] };
      yield { type: "done", messageId, confidence: null, missing: [], unsourcedClaims: false };
      return;
    }
    // The answer follows the question's language, the team's only when it is unclear.
    // The after-call's lines use the same language.
    const answerLanguage = questionLanguage(question, turn.language ?? DEFAULT_LANGUAGE);
    const system = buildSystemPrompt({
      commandSection: command ? commandPromptSection(command) : null,
      web: webResults.length > 0,
      fundName: turn.fundName,
      ...(turn.language ? { language: turn.language } : {}),
      answerLanguage,
      thesis,
      scope: request.scope,
      focusCase: turn.focusCase,
      entities: turn.entities,
      today: now().toISOString().slice(0, 10),
    });
    const registry = createSourceRegistry();
    const toolFailures: Array<{ tool: string; budget: boolean; policy: boolean }> = [];
    let toolResults = 0;
    // Lookups whose input did not fit the tool: they return a hint, not a finding.
    let invalidInputs = 0;
    const tools = guardTools(
      deps.createTools({
        fundId,
        caseId: turn.focusCase?.id ?? null,
        entityIds: turn.entities.map((entity) => entity.id),
        messageId,
        registry,
        ...(turn.language ? { language: turn.language } : {}),
        ...(webResults.length > 0 ? { webResults } : {}),
        addCost: (usd) => {
          spend.toolUsd += usd;
        },
      }),
      (tool, cause) => {
        toolFailures.push({
          tool,
          budget: cause instanceof BrainBudgetReachedError,
          policy: isPermanentPolicyStop(cause),
        });
        note(`tool ${tool} failed`, { error: errorText(cause) });
      },
      (tool, problems) => {
        invalidInputs += 1;
        note(`tool ${tool} input invalid`, { problems });
      },
    );
    const messages: ModelMessage[] = [
      ...historyForModel(history).map((row) => ({ role: row.role, content: row.content })),
      { role: "user", content: command ? commandQuestion(command, turn.language) : question },
    ];
    const outputUsdPerToken = tokenCostUsd(mode.model, 0, 1_000_000) / 1_000_000;
    // The planned maximum of the step in flight: booked if it is cut off or reports no cost.
    let inFlightUsd = 0;
    let lastFinishReason: string | null = null;

    const result = streamText({
      model: maskedModel(deps.model?.(request.mode) ?? mode.model, redactor),
      system,
      messages,
      tools,
      stopWhen: isStepCount(MAX_CHAT_STEPS),
      maxOutputTokens: mode.maxOutputTokens,
      providerOptions: { ...gatewayOptions, openai: { reasoningEffort: mode.reasoningEffort } },
      abortSignal: controller.signal,
      // Errors also arrive as "error" parts below; this keeps raw provider text in one log line.
      onError: ({ error }) => note("model error", { error: errorText(error) }),
      prepareStep: ({ stepNumber, messages: stepMessages }) => {
        const inputUsd =
          estimateRequestMaximumUsd({
            model: mode.model,
            requestBody: { system, messages: stepMessages },
            maxOutputTokens: 0,
          }).maxCostUsd + tokenCostUsd(mode.model, TOOL_SCHEMA_TOKENS, 0);
        const plan = planStep({
          stepNumber,
          spentUsd: spend.usd + spend.toolUsd,
          capUsd: cap,
          inputUsd,
          outputUsdPerToken,
          maxOutputTokens: mode.maxOutputTokens,
        });
        if (plan.kind === "stop") {
          controller.abort(BUDGET_ABORT);
          return undefined;
        }
        if (plan.kind === "final") {
          inFlightUsd = inputUsd + plan.maxOutputTokens * outputUsdPerToken;
          // Low reasoning on the last step, so the allowance goes to the answer, not to thinking.
          return {
            toolChoice: "none",
            activeTools: [],
            instructions: `${system}\n\n${FINAL_STEP_NOTE}`,
            maxOutputTokens: plan.maxOutputTokens,
            providerOptions: { ...gatewayOptions, openai: { reasoningEffort: "low" } },
          };
        }
        inFlightUsd = inputUsd + mode.maxOutputTokens * outputUsdPerToken;
        return undefined;
      },
    });

    // A command's fixed opening (the devil's advocate says it is one-sided) is written by the
    // engine, so no model can skip it.
    const prefix =
      [
        webUnavailable ? translate(turn.language ?? "da", "brainServer.chat.webUnavailable") : null,
        command ? commandAnswerPrefix(command.command, turn.language) : null,
      ]
        .filter(Boolean)
        .join("\n\n") || null;
    let text = prefix ? `${prefix}\n\n` : "";
    if (prefix) yield { type: "delta", text };
    const leakFilter = createLeakFilter();
    let streamError: unknown = null;
    let stepIndex = webSteps;
    let lastStep = "";
    let writing = false;
    const toolCalls: Array<{ name: string; input: unknown }> = [];
    const stepEvent = (label: string): ChatStreamEvent | null => {
      if (label === lastStep || stepIndex >= MAX_STEP_EVENTS) return null;
      lastStep = label;
      return { type: "step", index: stepIndex++, text: label };
    };

    try {
      for await (const part of result.fullStream) {
        if (part.type === "tool-call") {
          toolCalls.push({ name: part.toolName, input: part.input });
          const event = stepEvent(toolStepText(part.toolName, turn.language));
          if (event) yield event;
        } else if (part.type === "text-delta") {
          const shown = leakFilter.push(part.text);
          if (!shown) continue;
          if (!writing) {
            writing = true;
            const event = stepEvent(writingStepText(turn.language));
            if (event) yield event;
          }
          text += shown;
          yield { type: "delta", text: shown };
        } else if (part.type === "finish-step") {
          const rest = leakFilter.flush();
          if (rest) {
            if (!writing) {
              writing = true;
              const event = stepEvent(writingStepText(turn.language));
              if (event) yield event;
            }
            text += rest;
            yield { type: "delta", text: rest };
          }
          lastFinishReason = part.finishReason;
          const gatewayUsd = extractGatewayCostUsd({ providerMetadata: part.providerMetadata });
          const { inputTokens, outputTokens } = part.usage;
          let stepUsd: number;
          if (gatewayUsd !== null) stepUsd = gatewayUsd;
          else if (inputTokens !== undefined || outputTokens !== undefined) {
            stepUsd = tokenCostUsd(mode.model, inputTokens ?? 0, outputTokens ?? 0);
          } else {
            // Billed, but neither a price nor tokens came back: book the step's maximum.
            stepUsd = inFlightUsd;
            note("step without cost or usage, booked at its maximum", { usd: stepUsd });
          }
          inFlightUsd = 0;
          spend.requests += 1;
          spend.inputTokens += inputTokens ?? 0;
          spend.outputTokens += outputTokens ?? 0;
          spend.usd += stepUsd;
        } else if (part.type === "tool-result") {
          toolResults += 1;
        } else if (part.type === "tool-error") {
          // Only when AI SDK cannot read the call (no JSON, an unknown tool): the model's mistake,
          // not a technical failure. The model sees the error and may try again.
          note(`tool ${part.toolName} error`, { error: errorText(part.error) });
        } else if (part.type === "error") {
          streamError = part.error;
        }
      }
    } catch (cause) {
      note("stream threw", {
        error: errorText(cause),
        aborted: controller.signal.aborted ? String(controller.signal.reason) : null,
      });
      if (!controller.signal.aborted) streamError = cause;
    }
    // A step cut off by the cap or the timeout: what was held back still belongs to it. After
    // Stop the user has left, and only what they saw is saved.
    const heldBack = leakFilter.flush();
    if (heldBack && !signal.aborted) {
      text += heldBack;
      yield { type: "delta", text: heldBack };
    }
    if (leakFilter.leaks > 0) note("leaked tool call removed", { leaks: leakFilter.leaks });
    // A step that was cut off may still have been billed: book its maximum.
    spend.usd += inFlightUsd;
    inFlightUsd = 0;
    // A step that spent its whole output limit on reasoning ends with "length" and no text, after
    // all those lookups were paid for. One closing step without tools, at low reasoning,
    // writes the answer from what was found, if the question's cap allows it.
    if (
      !text.trim() &&
      lastFinishReason === "length" &&
      streamError === null &&
      !controller.signal.aborted
    ) {
      try {
        const inputUsd =
          estimateRequestMaximumUsd({
            model: mode.model,
            requestBody: { system, messages },
            maxOutputTokens: 0,
          }).maxCostUsd +
          tokenCostUsd(mode.model, TOOL_SCHEMA_TOKENS, 0) +
          tokenCostUsd(mode.model, CLOSING_CONTEXT_TOKENS, 0);
        const plan = planStep({
          stepNumber: MAX_CHAT_STEPS,
          spentUsd: spend.usd + spend.toolUsd,
          capUsd: cap,
          inputUsd,
          outputUsdPerToken,
          maxOutputTokens: mode.maxOutputTokens,
        });
        if (plan.kind === "final") {
          note("closing step after an empty length stop", { steps: spend.requests });
          const closing = streamText({
            model: maskedModel(deps.model?.(request.mode) ?? mode.model, redactor),
            system: `${system}\n\n${FINAL_STEP_NOTE}`,
            messages: [...messages, ...(await result.response).messages],
            maxOutputTokens: plan.maxOutputTokens,
            providerOptions: { ...gatewayOptions, openai: { reasoningEffort: "low" } },
            abortSignal: controller.signal,
            onError: ({ error }) => note("closing step error", { error: errorText(error) }),
          });
          inFlightUsd = inputUsd + plan.maxOutputTokens * outputUsdPerToken;
          for await (const part of closing.fullStream) {
            if (part.type === "text-delta") {
              const shown = leakFilter.push(part.text);
              if (!shown) continue;
              if (!writing) {
                writing = true;
                const event = stepEvent(writingStepText(turn.language));
                if (event) yield event;
              }
              text += shown;
              yield { type: "delta", text: shown };
            } else if (part.type === "finish-step") {
              const rest = leakFilter.flush();
              if (rest) {
                text += rest;
                yield { type: "delta", text: rest };
              }
              lastFinishReason = part.finishReason;
              const gatewayUsd = extractGatewayCostUsd({ providerMetadata: part.providerMetadata });
              const { inputTokens, outputTokens } = part.usage;
              spend.usd +=
                gatewayUsd ??
                (inputTokens !== undefined || outputTokens !== undefined
                  ? tokenCostUsd(mode.model, inputTokens ?? 0, outputTokens ?? 0)
                  : inFlightUsd);
              inFlightUsd = 0;
              spend.requests += 1;
              spend.inputTokens += inputTokens ?? 0;
              spend.outputTokens += outputTokens ?? 0;
            } else if (part.type === "error") {
              streamError = part.error;
            }
          }
          const rest = leakFilter.flush();
          if (rest) {
            text += rest;
            yield { type: "delta", text: rest };
          }
        }
      } catch (cause) {
        note("closing step threw", { error: errorText(cause) });
        if (!controller.signal.aborted) streamError = cause;
      }
      // A closing step that was cut off may still have been billed: book its maximum.
      spend.usd += inFlightUsd;
      inFlightUsd = 0;
    }
    const abortReason = controller.signal.aborted ? String(controller.signal.reason) : null;
    const answer = text.trim().slice(0, ANSWER_MAX_CHARS);

    const outcome = {
      abortReason,
      finishReason: lastFinishReason,
      steps: spend.requests,
      toolResults,
      toolFailures: toolFailures.length,
      invalidInputs,
    };
    if (streamError !== null && abortReason === null) {
      note("stream failed", { ...outcome, error: errorText(streamError) });
      yield { type: "error", code: "failed" };
      return;
    }
    // Every lookup failed: an answer now would read as "Brain knows nothing", which is not true.
    // An input that did not fit found nothing, but nothing broke either.
    if (toolFailures.length > 0 && toolResults - toolFailures.length - invalidInputs <= 0) {
      note("all tools failed", outcome);
      if (abortReason !== CLIENT_ABORT) {
        yield {
          type: "error",
          code: toolFailures.some((failure) => failure.budget)
            ? "budget_reached"
            : toolFailures.some((failure) => failure.policy)
              ? "blocked_by_policy"
              : "failed",
        };
      }
      return;
    }
    // Stopped before the first word (only the steps were shown) is still saved as stopped, so a
    // reload shows the stop instead of a question without an answer.
    if (!answer && abortReason !== CLIENT_ABORT) {
      note("no answer text", outcome);
      yield { type: "error", code: "failed" };
      return;
    }
    // Cut off by the output limit, a filter, the timeout or the question's cap: saved, but marked.
    const incomplete =
      abortReason === TIMEOUT_ABORT ||
      abortReason === BUDGET_ABORT ||
      (abortReason === null && lastFinishReason !== "stop" && lastFinishReason !== "tool-calls");
    let content = answer;
    if (incomplete) {
      note("answer incomplete", outcome);
      content = `${answer}\n\n${incompleteNote(turn.language)}`;
      yield { type: "delta", text: `\n\n${incompleteNote(turn.language)}` };
    } else if (abortReason === CLIENT_ABORT) {
      content = answer ? `${answer}\n\n${stoppedNote(turn.language)}` : stoppedNote(turn.language);
    }

    const check = checkCitations(answer, registry);
    let confidence: ChatConfidence | null = incomplete ? "low" : null;
    let missing: string[] = [];
    // The after-call only runs on a whole answer and when it still fits under the cap.
    if (
      abortReason === null &&
      !incomplete &&
      spend.usd + spend.toolUsd + AFTER_CALL_RESERVE_USD <= cap
    ) {
      try {
        const after = await (deps.afterCall ?? defaultAfterCall)({
          question,
          answer,
          sourceCount: check.cited.length,
          language: answerLanguage,
          redactor,
        });
        spend.usd += after.costUsd;
        spend.requests += 1;
        confidence = after.confidence;
        missing = after.missing;
      } catch (cause) {
        // Stopped by the data rules before it was sent: nothing to book.
        if (!(cause instanceof AiDataPolicyError)) spend.usd += AFTER_CALL_RESERVE_USD;
        note("after-call failed", { error: errorText(cause) });
      }
    }

    const caseIds = [
      ...new Set(
        check.cited
          .map((n) => registry.get(n)?.caseId)
          .filter((id): id is string => typeof id === "string"),
      ),
    ];
    let caseNames = new Map<string, string>();
    try {
      caseNames = await store.caseNames(fundId, caseIds);
    } catch (cause) {
      note("case names failed", { error: errorText(cause) });
    }
    const citations = citationsFor(check, registry, caseNames);

    try {
      await store.insertMessage({
        id: messageId,
        fundId,
        threadId,
        role: "assistant",
        content,
        citations,
        toolCalls,
        model: mode.model,
        costUsd: Number((spend.usd + spend.toolUsd).toFixed(6)),
      });
    } catch (cause) {
      note("saving the answer failed", { error: errorText(cause) });
      yield { type: "error", code: "failed" };
      return;
    }
    try {
      const cited = new Set(
        check.cited.flatMap((n) => {
          const source = registry.get(n);
          return source && (source.kind === "chunk" || source.kind === "fact")
            ? [`${source.kind}:${source.id}`]
            : [];
        }),
      );
      await store.markCited(fundId, messageId, cited);
    } catch (cause) {
      note("marking cited searches failed", { error: errorText(cause) });
    }

    yield { type: "sources", citations };
    yield {
      type: "done",
      messageId,
      confidence,
      missing,
      unsourcedClaims: check.unknown.length > 0 || check.invalid.length > 0,
    };
  } catch (cause) {
    note("turn failed", { error: errorText(cause) });
    yield { type: "error", code: "failed" };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onClientAbort);
    await settle();
  }
}

/** "efterkald": mini, at most ~0,02 kr. */
export const defaultAfterCall: AfterCaller = async ({
  question,
  answer,
  sourceCount,
  language,
  redactor,
}) => {
  const result = await generateText({
    model: maskedModel(AFTER_CALL_MODEL, redactor),
    prompt: afterCallPrompt(question, answer, sourceCount, language),
    maxOutputTokens: AFTER_CALL_MAX_OUTPUT_TOKENS,
    providerOptions: {
      ...aiGatewayOptions({ model: AFTER_CALL_MODEL, data: "confidential" }),
      openai: { reasoningEffort: "low" },
    },
    abortSignal: AbortSignal.timeout(20_000),
    output: Output.object({
      name: "answer_check",
      schema: jsonSchema<{ confidence: ChatConfidence; missing: string[] }>(
        AFTER_CALL_SCHEMA as unknown as Parameters<typeof jsonSchema>[0],
      ),
    }),
  });
  const output = result.output as { confidence?: unknown; missing?: unknown } | undefined;
  const confidence =
    output?.confidence === "high" || output?.confidence === "medium" || output?.confidence === "low"
      ? output.confidence
      : null;
  const missing = Array.isArray(output?.missing)
    ? output.missing
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .map((item) => item.trim().slice(0, 200))
        .slice(0, 3)
    : [];
  const costUsd =
    extractGatewayCostUsd({ providerMetadata: result.providerMetadata }) ??
    tokenCostUsd(
      AFTER_CALL_MODEL as PricedModel,
      result.totalUsage.inputTokens ?? 0,
      result.totalUsage.outputTokens ?? 0,
    );
  return { confidence, missing, costUsd };
};

/** Message plus the HTTP status of a provider error (AI SDK APICallError), for the log. */
function errorText(cause: unknown): string {
  if (!(cause instanceof Error)) return String(cause);
  const status = (cause as { statusCode?: unknown }).statusCode;
  return typeof status === "number" ? `${cause.message} (HTTP ${status})` : cause.message;
}

/**
 * What a tool input got wrong, in the schema's own terms (field, rule, allowed values), for the
 * hint to the model. Never the model's value: it may be a name.
 */
function inputProblems(error: unknown, input: unknown): string[] {
  if (!(error instanceof ZodError)) return [];
  return [
    ...new Set(
      error.issues.map((issue) => `${issue.path.join(".") || "input"} ${inputRule(issue, input)}`),
    ),
  ];
}

/** The input's value at an issue's path (zod 4 issues do not carry it). */
function valueAt(input: unknown, path: readonly PropertyKey[]): unknown {
  let value = input;
  for (const key of path) {
    if (value === null || typeof value !== "object") return undefined;
    value = (value as Record<PropertyKey, unknown>)[key];
  }
  return value;
}

function inputRule(issue: z.core.$ZodIssue, input: unknown): string {
  const unit = (origin: string) =>
    origin === "string" ? " characters" : origin === "array" ? " items" : "";
  switch (issue.code) {
    case "invalid_format":
      return issue.format === "guid" || issue.format === "uuid"
        ? "must be a full uuid copied exactly from an earlier tool result, never a name or a shortened id"
        : "has the wrong format (see the tool's schema)";
    case "invalid_value":
      // zod 4 reports a missing enum or literal here, not as invalid_type.
      return valueAt(input, issue.path) === undefined
        ? "is required"
        : `must be one of: ${issue.values.map(String).join(", ")}`;
    case "too_small":
      return `must be at least ${issue.minimum}${unit(issue.origin)}`;
    case "too_big":
      return `must be at most ${issue.maximum}${unit(issue.origin)}`;
    case "invalid_type":
      return valueAt(input, issue.path) === undefined
        ? "is required"
        : `must be a ${issue.expected}`;
    default:
      return "does not fit the tool's schema";
  }
}

/**
 * A tool that throws gets TOOL_FAILED instead of its raw error text (AI SDK would otherwise
 * pass the database or Gateway message to the model, which could quote it to the user).
 * The input is checked here, not by AI SDK: one that does not fit the schema gets a
 * short hint about the format as its result, so a wrong id is not a technical failure. The
 * model sees the same schema as before.
 */
export function guardTools(
  tools: ToolSet,
  onError: (tool: string, cause: unknown) => void,
  onInvalidInput: (tool: string, problems: string[]) => void,
): ToolSet {
  return Object.fromEntries(
    Object.entries(tools).map(([name, definition]) => {
      const execute = definition.execute;
      if (!execute) return [name, definition];
      const schema = asSchema(definition.inputSchema);
      return [
        name,
        {
          ...definition,
          inputSchema: jsonSchema(() => schema.jsonSchema, {
            validate: (value) => ({ success: true, value }),
          }),
          execute: async (input: unknown, options: Parameters<typeof execute>[1]) => {
            try {
              // A schema that throws (not one that says no) is a technical failure.
              const checked = schema.validate
                ? await schema.validate(input)
                : { success: true as const, value: input };
              if (!checked.success) {
                const problems = inputProblems(checked.error, input);
                onInvalidInput(name, problems);
                return { error: toolInputInvalid(problems) };
              }
              return await execute(checked.value, options);
            } catch (cause) {
              onError(name, cause);
              return { error: TOOL_FAILED };
            }
          },
        },
      ];
    }),
  ) as ToolSet;
}
