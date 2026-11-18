import {
  embed as sdkEmbed,
  embedMany as sdkEmbedMany,
  gateway,
  generateText as sdkGenerateText,
  streamText as sdkStreamText,
  wrapLanguageModel,
  type LanguageModel,
  type LanguageModelMiddleware,
} from "ai";
import { writeCallLog } from "./call-log.ts";
import { AiDataPolicyError, shouldEnforceZdr } from "./gateway-options.ts";
import { serverText } from "../i18n/server-text.ts";
import { REDACTION_INSTRUCTION, type Redactor } from "./redact.ts";
import { aiModelPolicy } from "./zdr-models.ts";

/**
 * The one way to an AI model. Every model call goes through this file: the text
 * is masked with the fund's Redactor (redact-dictionary.server.ts) before it leaves, and the
 * answer is restored on the server before anything is saved or shown. Masked: the system prompt,
 * the prompt and the history, tool calls and tool results between steps, embedding values and
 * the messages of a raw Chat Completions request. A text that is JSON (a packet built with
 * JSON.stringify) is masked value by value, since "\nAnna Berg" inside JSON text is not a name to
 * the masking. Tool definitions and response schemas are written by us and are not masked.
 *
 * Nothing else may import generateText, streamText, embed or embedMany from "ai", or post to the
 * AI Gateway: ESLint (eslint.config.js) and model-call.test.ts stop it, and the wrappers below
 * stop a model that is not masked and a call without the data rules (aiGatewayOptions).
 *
 * Files (images, PDF bytes) cannot be masked. They are refused unless the call names why they
 * may go unmasked (`unmaskedFiles`), so that every such exception can be found in the code.
 */

/** Why a call may send files that cannot be masked; shown in the code, never sent. */
export type UnmaskedFiles = "deck_pages_for_ocr";

type CallOptions = Parameters<NonNullable<LanguageModelMiddleware["transformParams"]>>[0]["params"];
type Prompt = CallOptions["prompt"];
type GenerateResult = Awaited<ReturnType<NonNullable<LanguageModelMiddleware["wrapGenerate"]>>>;
type StreamResult = Awaited<ReturnType<NonNullable<LanguageModelMiddleware["wrapStream"]>>>;
type StreamPart = StreamResult["stream"] extends ReadableStream<infer P> ? P : never;
export type WrappableModel = Parameters<typeof wrapLanguageModel>[0]["model"];

const maskedModels = new WeakSet<object>();

/**
 * A call stopped before anything was sent, because it was not masked or could not be. A data
 * rules stop like the ZDR check, so callers release their reservation and book nothing.
 */
export class UnmaskedCallError extends AiDataPolicyError {
  constructor(model: string, message: string) {
    super("not_masked", model, message);
    this.name = "UnmaskedCallError";
  }
}

/**
 * The fund's masking dictionary could not be loaded (a database hiccup). Nothing was sent, as for
 * any data rules stop, but unlike them a later attempt can succeed: background jobs retry it.
 */
export class MaskingUnavailableError extends UnmaskedCallError {
  readonly transient = true;

  constructor() {
    super("unknown", serverText("appServer.ai.maskingNotReady"));
    this.name = "MaskingUnavailableError";
  }
}

/** A data rules stop that will stop the same way on every attempt. */
export function isPermanentPolicyStop(cause: unknown): boolean {
  return cause instanceof AiDataPolicyError && !(cause instanceof MaskingUnavailableError);
}

function modelName(model: unknown): string {
  if (typeof model === "string") return model;
  const id = (model as { modelId?: unknown } | null)?.modelId;
  return typeof id === "string" ? id : "unknown";
}

// ---------------------------------------------------------------------------------------------
// Masking a whole payload in one pass, so a name found next to a CPR number in one message is
// also masked in the messages before it (point 1).
// ---------------------------------------------------------------------------------------------

type Piece = { text: string } | { json: unknown; source: string };

/**
 * A text as the masking must see it: JSON (the whole text, or after a short lead-in such as
 * "Materiale:\n") is unpacked, so its values are masked as values; the rest stays text.
 */
function splitJson(text: string): Piece[] {
  const starts = [text.indexOf("{"), text.indexOf("[")].filter((i) => i >= 0).sort((a, b) => a - b);
  for (const start of starts) {
    const end = text.lastIndexOf(text[start] === "{" ? "}" : "]");
    if (end <= start) continue;
    const source = text.slice(start, end + 1);
    let json: unknown;
    try {
      json = JSON.parse(source);
    } catch {
      continue;
    }
    if (json === null || typeof json !== "object") continue;
    return [
      ...(start > 0 ? [{ text: text.slice(0, start) }] : []),
      { json, source },
      ...(end + 1 < text.length ? [{ text: text.slice(end + 1) }] : []),
    ];
  }
  return [{ text }];
}

/** Collects the texts and values of one payload, masks them together and hands them back. */
class PayloadMask {
  private readonly values: unknown[] = [];
  private readonly texts: Array<Array<{ at: number; source?: string }>> = [];

  /** Registers a text; returns its handle for `text()`. */
  text(value: string): number {
    const pieces = splitJson(value).map((piece) =>
      "text" in piece
        ? { at: this.values.push(piece.text) - 1 }
        : { at: this.values.push(piece.json) - 1, source: piece.source },
    );
    return this.texts.push(pieces) - 1;
  }

  /** Registers a JSON value (tool input, tool output); returns its handle for `json()`. */
  json(value: unknown): number {
    return this.values.push(value) - 1;
  }

  apply(redactor: Redactor): { text(handle: number): string; json(handle: number): unknown } {
    const masked = redactor.redactJson(this.values);
    return {
      text: (handle) =>
        (this.texts[handle] ?? [])
          .map(({ at, source }) => {
            if (source === undefined) return masked[at] as string;
            const text = JSON.stringify(masked[at]);
            // Nothing masked in it: the JSON goes exactly as it came (formatting, numbers).
            return text === JSON.stringify(this.values[at]) ? source : text;
          })
          .join(""),
      json: (handle) => masked[handle],
    };
  }
}

function anythingMasked(redactor: Redactor): boolean {
  return Object.values(redactor.counts()).some((count) => count > 0);
}

function refuseFile(unmaskedFiles: UnmaskedFiles | undefined, model: string): void {
  if (unmaskedFiles) return;
  refuse(model, serverText("appServer.ai.filesNotMasked"));
}

function refuse(model: string, message: string): never {
  throw new UnmaskedCallError(model, message);
}

/** A part the masking does not know may carry text: closed on doubt. */
function unknownPart(model: string, kind: string): never {
  refuse(model, serverText("appServer.ai.unknownPart", { kind }));
}

type ToolOutput = Extract<Prompt[number], { role: "tool" }>["content"][number] extends infer P
  ? P extends { type: "tool-result"; output: infer O }
    ? O
    : never
  : never;

/** Registers the texts and values of one payload; each getter gives the masked one back. */
type Register = {
  text(value: string): () => string;
  json(value: unknown): () => unknown;
  /** A file: refused unless the call names its exception. */
  file(): void;
  model: string;
};

function maskToolOutput(output: ToolOutput, register: Register): () => ToolOutput {
  switch (output.type) {
    case "text":
    case "error-text": {
      const value = register.text(output.value);
      return () => ({ ...output, value: value() });
    }
    case "json":
    case "error-json": {
      const value = register.json(output.value);
      return () => ({ ...output, value: value() as typeof output.value });
    }
    case "execution-denied": {
      if (output.reason === undefined) return () => output;
      const reason = register.text(output.reason);
      return () => ({ ...output, reason: reason() });
    }
    case "content": {
      const parts = output.value.map((item) => {
        if (item.type === "text") {
          const text = register.text(item.text);
          return () => ({ ...item, text: text() });
        }
        register.file();
        return () => item;
      });
      return () => ({ ...output, value: parts.map((part) => part()) });
    }
    default:
      return unknownPart(register.model, (output as { type: string }).type);
  }
}

/** Masks every text of a model prompt (system, user, assistant, tool calls and results). */
function maskPrompt(
  prompt: Prompt,
  redactor: Redactor,
  options: { unmaskedFiles?: UnmaskedFiles | undefined; model: string },
): Prompt {
  const mask = new PayloadMask();
  let result: ReturnType<PayloadMask["apply"]> | null = null;
  const masked = () => {
    if (!result) throw new Error("masking read before it ran");
    return result;
  };
  const register: Register = {
    text(value) {
      const handle = mask.text(value);
      return () => masked().text(handle);
    },
    json(value) {
      const handle = mask.json(value);
      return () => masked().json(handle);
    },
    file: () => refuseFile(options.unmaskedFiles, options.model),
    model: options.model,
  };

  const builders = prompt.map((message): (() => Prompt[number]) => {
    switch (message.role) {
      case "system": {
        const content = register.text(message.content);
        return () => ({ ...message, content: content() });
      }
      case "user": {
        const parts = message.content.map((part) => {
          if (part.type === "text") {
            const text = register.text(part.text);
            return () => ({ ...part, text: text() });
          }
          register.file();
          return () => part;
        });
        return () => ({ ...message, content: parts.map((part) => part()) });
      }
      case "assistant": {
        const parts = message.content.map((part) => {
          switch (part.type) {
            case "text":
            case "reasoning": {
              const text = register.text(part.text);
              return () => ({ ...part, text: text() });
            }
            case "tool-call": {
              const input = register.json(part.input);
              return () => ({ ...part, input: input() });
            }
            case "tool-result": {
              const output = maskToolOutput(part.output, register);
              return () => ({ ...part, output: output() });
            }
            case "file":
            case "reasoning-file":
              register.file();
              return () => part;
            case "custom":
              // A provider-specific marker without text.
              return () => part;
            default:
              return unknownPart(options.model, (part as { type: string }).type);
          }
        });
        return () => ({ ...message, content: parts.map((part) => part()) });
      }
      case "tool": {
        const parts = message.content.map((part) => {
          switch (part.type) {
            case "tool-result": {
              const output = maskToolOutput(part.output, register);
              return () => ({ ...part, output: output() });
            }
            case "tool-approval-response": {
              if (part.reason === undefined) return () => part;
              const reason = register.text(part.reason);
              return () => ({ ...part, reason: reason() });
            }
            default:
              return unknownPart(options.model, (part as { type: string }).type);
          }
        });
        return () => ({ ...message, content: parts.map((part) => part()) });
      }
      default:
        return unknownPart(options.model, (message as { role: string }).role);
    }
  });

  result = mask.apply(redactor);
  const out = builders.map((build) => build());
  if (!anythingMasked(redactor)) return out;
  // Tell the model to keep the placeholders as they are (point 2).
  const first = out[0];
  if (first?.role === "system") {
    return [{ ...first, content: `${first.content}\n\n${REDACTION_INSTRUCTION}` }, ...out.slice(1)];
  }
  return [{ role: "system", content: REDACTION_INSTRUCTION }, ...out];
}

// ---------------------------------------------------------------------------------------------
// Restoring the answer
// ---------------------------------------------------------------------------------------------

// Any short bracketed text; the redactor decides whether it is one of this call's placeholders.
const BRACKETED = /\[[^[\]\n]{1,24}\]/gu;
/** "[Adresse 123456]" with a no-break space is the longest placeholder. */
const MAX_PLACEHOLDER_CHARS = 26;

/** Restores placeholders inside JSON text, escaping the real value for its string literal. */
export function restoreJsonText(redactor: Redactor, text: string): string {
  return text.replace(BRACKETED, (whole) => {
    const value = redactor.restore(whole);
    return value === whole ? whole : JSON.stringify(value).slice(1, -1);
  });
}

/**
 * Restores a streamed text: a placeholder can be split between two chunks (point 7), so
 * an unfinished "[..." at the end is held back until it closes or the text ends.
 */
export function createStreamRestorer(restore: (text: string) => string): {
  push(delta: string): string;
  flush(): string;
} {
  let pending = "";
  return {
    push(delta) {
      const all = pending + delta;
      const open = all.lastIndexOf("[");
      const unfinished =
        open !== -1 && !all.includes("]", open) && all.length - open <= MAX_PLACEHOLDER_CHARS;
      const cut = unfinished ? open : all.length;
      pending = all.slice(cut);
      return restore(all.slice(0, cut));
    },
    flush() {
      const rest = pending;
      pending = "";
      return rest ? restore(rest) : "";
    },
  };
}

function maskingMiddleware(
  redactor: Redactor,
  options: { unmaskedFiles?: UnmaskedFiles; restore: boolean },
): LanguageModelMiddleware {
  const restorerFor = (params: CallOptions) => {
    if (!options.restore) return (text: string) => text;
    return params.responseFormat?.type === "json"
      ? (text: string) => restoreJsonText(redactor, text)
      : (text: string) => redactor.restore(text);
  };
  return {
    specificationVersion: "v4",
    transformParams: async ({ params, model }) => ({
      ...params,
      prompt: maskPrompt(params.prompt, redactor, {
        unmaskedFiles: options.unmaskedFiles,
        model: model.modelId,
      }),
    }),
    wrapGenerate: async ({ doGenerate, params, model }): Promise<GenerateResult> => {
      // params is what was sent: the masked prompt goes to the AI log.
      const sent = {
        model: model.modelId,
        payload: params.prompt,
        providerOptions: params.providerOptions,
      };
      let result: GenerateResult;
      try {
        result = await doGenerate();
      } catch (cause) {
        await writeCallLog(redactor, { ...sent, status: "failed" });
        throw cause;
      }
      await writeCallLog(redactor, {
        ...sent,
        status: "ok",
        providerMetadata: result.providerMetadata,
        inputTokens: result.usage.inputTokens.total,
        outputTokens: result.usage.outputTokens.total,
      });
      const restore = restorerFor(params);
      return {
        ...result,
        content: result.content.map((part) => {
          if (part.type === "text" || part.type === "reasoning") {
            return { ...part, text: restore(part.text) };
          }
          if (part.type === "tool-call" && options.restore) {
            return { ...part, input: restoreJsonText(redactor, part.input) };
          }
          return part;
        }),
      };
    },
    wrapStream: async ({ doStream, params, model }): Promise<StreamResult> => {
      const sent = {
        model: model.modelId,
        payload: params.prompt,
        providerOptions: params.providerOptions,
      };
      let result: StreamResult;
      try {
        result = await doStream();
      } catch (cause) {
        await writeCallLog(redactor, { ...sent, status: "failed" });
        throw cause;
      }
      // One AI log row per step, when it finishes, fails or is cut off.
      let logged = false;
      const log = async (entry: Omit<Parameters<typeof writeCallLog>[1], keyof typeof sent>) => {
        if (logged) return;
        logged = true;
        await writeCallLog(redactor, { ...sent, ...entry });
      };
      const restore = restorerFor(params);
      type Delta = "text-delta" | "reasoning-delta";
      type Controller = TransformStreamDefaultController<StreamPart>;
      // One restorer per open text or reasoning block; what it holds back goes out at its end.
      const open = new Map<
        string,
        { type: Delta; restorer: ReturnType<typeof createStreamRestorer> }
      >();
      const flush = (controller: Controller, id: string) => {
        const block = open.get(id);
        if (!block) return;
        open.delete(id);
        const rest = block.restorer.flush();
        if (rest) controller.enqueue({ type: block.type, id, delta: rest });
      };
      const flushAll = (controller: Controller) => {
        for (const id of [...open.keys()]) flush(controller, id);
      };
      return {
        ...result,
        stream: result.stream.pipeThrough(
          new TransformStream<StreamPart, StreamPart>({
            async transform(part, controller) {
              if (part.type === "finish") {
                await log({
                  status: "ok",
                  providerMetadata: part.providerMetadata,
                  inputTokens: part.usage.inputTokens.total,
                  outputTokens: part.usage.outputTokens.total,
                });
              } else if (part.type === "error") {
                await log({ status: "failed" });
              }
              if (part.type === "text-delta" || part.type === "reasoning-delta") {
                let block = open.get(part.id);
                if (!block) {
                  block = { type: part.type, restorer: createStreamRestorer(restore) };
                  open.set(part.id, block);
                }
                const delta = block.restorer.push(part.delta);
                if (delta) controller.enqueue({ ...part, delta });
                return;
              }
              if (part.type === "text-end" || part.type === "reasoning-end") {
                flush(controller, part.id);
              } else if (part.type === "finish" || part.type === "error") {
                flushAll(controller);
              }
              if (part.type === "tool-call" && options.restore) {
                controller.enqueue({ ...part, input: restoreJsonText(redactor, part.input) });
                return;
              }
              controller.enqueue(part);
            },
            async flush(controller) {
              flushAll(controller);
              await log({ status: "failed" });
            },
            // A reader that stops early (the user's Stop) cancels instead of flushing; Node runs
            // it, but the DOM typings do not list it yet.
            ...({ cancel: () => log({ status: "failed" }) } as object),
          }),
        ),
      };
    },
  };
}

/**
 * A model whose every request is masked with `redactor` and whose answer is restored. One
 * redactor per call (a chat turn is one call), so the placeholders stay the same across steps.
 * `restore: false` leaves the placeholders in the answer, for a caller that must compare the
 * answer with the masked text before restoring it itself (L1's quote check, point 3).
 */
export function maskedModel(
  model: string | WrappableModel,
  redactor: Redactor,
  options: { unmaskedFiles?: UnmaskedFiles; restore?: boolean } = {},
): LanguageModel {
  const wrapped = wrapLanguageModel({
    model: typeof model === "string" ? gateway(model) : model,
    middleware: maskingMiddleware(redactor, {
      restore: options.restore ?? true,
      ...(options.unmaskedFiles ? { unmaskedFiles: options.unmaskedFiles } : {}),
    }),
  });
  maskedModels.add(wrapped);
  return wrapped;
}

// ---------------------------------------------------------------------------------------------
// The calls
// ---------------------------------------------------------------------------------------------

/**
 * The data rules (aiGatewayOptions) must be on every call: no training, and ZDR on every model
 * that is not a search engine while ZDR is enforced.
 */
function assertDataRules(providerOptions: unknown, model: unknown): void {
  const name = modelName(model);
  const rules = (
    providerOptions as {
      gateway?: { disallowPromptTraining?: unknown; zeroDataRetention?: unknown };
    } | null
  )?.gateway;
  if (rules?.disallowPromptTraining !== true) {
    refuse(name, serverText("appServer.ai.noDataRules"));
  }
  if (
    shouldEnforceZdr() &&
    aiModelPolicy(name)?.kind !== "search" &&
    rules.zeroDataRetention !== true
  ) {
    refuse(name, serverText("appServer.ai.noZdr"));
  }
}

function assertMasked(model: unknown): void {
  if (typeof model !== "object" || model === null || !maskedModels.has(model)) {
    refuse(modelName(model), serverText("appServer.ai.notMasked"));
  }
}

type StepSettings = { model?: unknown; providerOptions?: unknown } | undefined | null;

/** Checks the call, and every step's own model and options from prepareStep, before sending. */
function guarded<O extends { model: unknown; providerOptions?: unknown; prepareStep?: unknown }>(
  options: O,
): O {
  assertMasked(options.model);
  assertDataRules(options.providerOptions, options.model);
  const prepareStep = options.prepareStep as
    ((step: unknown) => StepSettings | PromiseLike<StepSettings>) | undefined;
  if (!prepareStep) return options;
  return {
    ...options,
    prepareStep: async (step: unknown) => {
      const settings = await prepareStep(step);
      if (settings?.model !== undefined) assertMasked(settings.model);
      if (settings?.providerOptions !== undefined) {
        assertDataRules(settings.providerOptions, settings.model ?? options.model);
      }
      return settings;
    },
  };
}

/** The AI SDK's generateText, for a masked model only. */
export const generateText: typeof sdkGenerateText = (options) => {
  try {
    return sdkGenerateText(guarded(options));
  } catch (cause) {
    return Promise.reject(cause);
  }
};

/** The AI SDK's streamText, for a masked model only. */
export const streamText: typeof sdkStreamText = (options) => sdkStreamText(guarded(options));

type EmbedOptions = Parameters<typeof sdkEmbed>[0];
type EmbedManyOptions = Parameters<typeof sdkEmbedMany>[0];

/** One embedding of the masked value. */
export async function embed(options: EmbedOptions & { redactor: Redactor }) {
  const { redactor, ...rest } = options;
  assertDataRules(rest.providerOptions, rest.model);
  const value = redactor.redact(rest.value);
  const sent = {
    model: modelName(rest.model),
    payload: [value],
    providerOptions: rest.providerOptions,
  };
  try {
    const result = await sdkEmbed({ ...rest, value });
    await writeCallLog(redactor, {
      ...sent,
      status: "ok",
      providerMetadata: result.providerMetadata,
      inputTokens: result.usage.tokens,
    });
    return result;
  } catch (cause) {
    await writeCallLog(redactor, { ...sent, status: "failed" });
    throw cause;
  }
}

/** Embeddings of the masked values, masked together as one payload. */
export async function embedMany(options: EmbedManyOptions & { redactor: Redactor }) {
  const { redactor, ...rest } = options;
  assertDataRules(rest.providerOptions, rest.model);
  const values = redactor.redactAll(rest.values);
  const sent = {
    model: modelName(rest.model),
    payload: values,
    providerOptions: rest.providerOptions,
  };
  try {
    const result = await sdkEmbedMany({ ...rest, values });
    await writeCallLog(redactor, {
      ...sent,
      status: "ok",
      providerMetadata: result.providerMetadata,
      inputTokens: result.usage.tokens,
    });
    return result;
  } catch (cause) {
    await writeCallLog(redactor, { ...sent, status: "failed" });
    throw cause;
  }
}

const CHAT_COMPLETIONS_URL = "https://ai-gateway.vercel.sh/v1/chat/completions";
/** The request fields the masking knows; anything else could carry text and is refused. */
const CHAT_FIELDS = new Set([
  "model",
  "messages",
  "providerOptions",
  "response_format",
  "stream",
  "max_tokens",
  "max_completion_tokens",
  "reasoning",
  "temperature",
  "top_p",
  "seed",
]);
const NULL_BODY_STATUS = new Set([101, 204, 205, 304]);

type ChatMessage = { role: string; content: unknown };

export interface ChatCompletionRequest {
  model: string;
  messages: readonly ChatMessage[];
  providerOptions: unknown;
  response_format?: { type: string };
  stream?: boolean;
  [key: string]: unknown;
}

/**
 * POST to the AI Gateway's Chat Completions endpoint with masked messages. The answer's message
 * content is restored (as JSON text when a JSON format was asked for) and handed back as a
 * Response, so the caller reads status and body as before. No streaming: a streamed answer could
 * not be restored here.
 */
export async function postChatCompletion(input: {
  body: ChatCompletionRequest;
  redactor: Redactor;
  token: string;
  signal?: AbortSignal;
}): Promise<Response> {
  const { body, redactor } = input;
  assertDataRules(body.providerOptions, body.model);
  for (const field of Object.keys(body)) {
    if (!CHAT_FIELDS.has(field))
      refuse(body.model, serverText("appServer.ai.fieldNotMasked", { field }));
  }
  if (body.stream === true) refuse(body.model, serverText("appServer.ai.streamNotRestored"));
  const mask = new PayloadMask();
  const builders = body.messages.map((message) => {
    for (const field of Object.keys(message)) {
      if (field !== "role" && field !== "content") {
        refuse(body.model, serverText("appServer.ai.messageFieldNotMasked", { field }));
      }
    }
    if (typeof message.content === "string") {
      const handle = mask.text(message.content);
      return (m: ReturnType<PayloadMask["apply"]>) => ({ ...message, content: m.text(handle) });
    }
    if (!Array.isArray(message.content)) {
      refuse(body.model, serverText("appServer.ai.messageNotReadable"));
    }
    const parts = (message.content as unknown[]).map((part) => {
      const { type, text } = (part ?? {}) as { type?: unknown; text?: unknown };
      if (type !== "text" || typeof text !== "string") {
        refuseFile(undefined, body.model);
        return () => part;
      }
      const handle = mask.text(text);
      return (m: ReturnType<PayloadMask["apply"]>) => ({
        ...(part as object),
        text: m.text(handle),
      });
    });
    return (m: ReturnType<PayloadMask["apply"]>) => ({
      ...message,
      content: parts.map((part) => part(m)),
    });
  });
  const applied = mask.apply(redactor);
  const messages = builders.map((build) => build(applied));
  if (anythingMasked(redactor)) {
    const first = messages[0];
    if (first?.role === "system" && typeof first.content === "string") {
      messages[0] = { ...first, content: `${first.content}\n\n${REDACTION_INSTRUCTION}` };
    } else {
      messages.unshift({ role: "system", content: REDACTION_INSTRUCTION });
    }
  }

  const sent = { model: body.model, payload: messages, providerOptions: body.providerOptions };
  let response: Response;
  let raw: string;
  try {
    response = await fetch(CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${input.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, messages }),
      ...(input.signal ? { signal: input.signal } : {}),
    });
    raw = NULL_BODY_STATUS.has(response.status) ? "" : await response.text();
  } catch (cause) {
    await writeCallLog(redactor, { ...sent, status: "failed" });
    throw cause;
  }
  const headers = new Headers(response.headers);
  // The body is rebuilt below, so its length and encoding no longer hold.
  headers.delete("content-length");
  headers.delete("content-encoding");
  const init = { status: response.status, statusText: response.statusText, headers };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = undefined;
  }
  const usage = (parsed as { usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } })
    ?.usage;
  await writeCallLog(redactor, {
    ...sent,
    status: response.ok ? "ok" : "failed",
    body: parsed,
    inputTokens: typeof usage?.prompt_tokens === "number" ? usage.prompt_tokens : null,
    outputTokens: typeof usage?.completion_tokens === "number" ? usage.completion_tokens : null,
  });
  if (NULL_BODY_STATUS.has(response.status)) return new Response(null, init);
  if (parsed === undefined) return new Response(raw, init);
  const choices = (parsed as { choices?: unknown } | null)?.choices;
  const json = body.response_format?.type?.startsWith("json") === true;
  for (const choice of Array.isArray(choices) ? choices : []) {
    const message = (choice as { message?: { content?: unknown } } | null)?.message;
    if (message && typeof message.content === "string") {
      message.content = json
        ? restoreJsonText(redactor, message.content)
        : redactor.restore(message.content);
    }
  }
  return new Response(JSON.stringify(parsed), init);
}
