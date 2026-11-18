import type { SupabaseClient } from "@supabase/supabase-js";
import { extractGatewayCostUsd } from "../analysis/gateway-response.ts";
import type { Redactor } from "./redact.ts";

/**
 * The AI log: one row per model call in `ai_call_log` (0073) with the time, the
 * flow, the model, the provider, the region, ZDR, tokens, the price and the payload that was sent,
 * which is the masked one. Only the service role can read it; there is no screen. The payload is
 * removed after 90 days (the metadata stays) and when a person is forgotten; an export is made on
 * request with scripts/export-ai-log.ts.
 *
 * A call is logged when its Redactor came from redactorForFund, which knows the fund and the flow.
 * Writing is best effort and bounded: it waits at most CALL_LOG_TIMEOUT_MS, a row the database
 * refuses is written again without its payload (so tokens and price are kept), and a call that
 * was answered is never lost because its row could not be written; the failure is logged without
 * the payload. Files (deck pages) are never stored: only their type and size. A payload over
 * MAX_PAYLOAD_CHARS is cut. The masked counts are those of the Redactor, which a chat turn or an
 * L1 batch shares, so a row counts what was masked in its call and the calls before it.
 */

/** Which part of Interlect made the call, e.g. "screening", "brain_chat", "brain_l1_extract". */
export type AiFlow = string;

export interface CallLogContext {
  fundId: string;
  flow: AiFlow;
  service: SupabaseClient;
}

export interface CallLogEntry {
  model: string;
  status: "ok" | "failed";
  /** What was sent, already masked. */
  payload: unknown;
  /** The call's provider options: whether ZDR and an EU region were asked for. */
  providerOptions: unknown;
  /** Gateway metadata of the answer (provider, ZDR applied, price), when there is one. */
  providerMetadata?: unknown;
  /** A Chat Completions body, for its price and usage. */
  body?: unknown;
  inputTokens?: number | null | undefined;
  outputTokens?: number | null | undefined;
}

const contexts = new WeakMap<Redactor, CallLogContext>();

/** How long a call waits for its log row. */
export const CALL_LOG_TIMEOUT_MS = 3_000;
/** A logged payload longer than this (as JSON) is cut. */
export const MAX_PAYLOAD_CHARS = 1_000_000;

export function attachCallLog(redactor: Redactor, context: CallLogContext): Redactor {
  contexts.set(redactor, context);
  return redactor;
}

export function callLogOf(redactor: Redactor): CallLogContext | undefined {
  return contexts.get(redactor);
}

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | undefined {
  return value !== null && typeof value === "object" ? (value as UnknownRecord) : undefined;
}

/** The size of a file part's data: bytes, base64 text or the SDK's { type, data } wrapper. */
function byteSize(data: unknown): number | null {
  if (data instanceof Uint8Array || data instanceof ArrayBuffer) return data.byteLength;
  if (typeof data === "string") return data.length;
  const inner = record(data)?.["data"];
  return inner === undefined ? null : byteSize(inner);
}

/** What is stored of a payload: files replaced by their type and size, the size capped. */
export function payloadForLog(value: unknown): unknown {
  const strip = (item: unknown): unknown => {
    if (item instanceof Uint8Array || item instanceof ArrayBuffer) {
      return { omitted: "bytes", bytes: item.byteLength };
    }
    if (item instanceof URL) return { omitted: "url" };
    if (Array.isArray(item)) return item.map(strip);
    const object = record(item);
    if (!object) return typeof item === "string" ? item.replaceAll("\u0000", "") : item;
    if (object["type"] === "file" || object["type"] === "reasoning-file") {
      return {
        type: object["type"],
        mediaType: object["mediaType"] ?? null,
        omitted: "file",
        bytes: byteSize(object["data"]),
      };
    }
    return Object.fromEntries(Object.entries(object).map(([key, entry]) => [key, strip(entry)]));
  };
  const stripped = strip(value);
  const text = JSON.stringify(stripped) ?? "null";
  return text.length > MAX_PAYLOAD_CHARS
    ? { truncated: true, chars: text.length, text: text.slice(0, MAX_PAYLOAD_CHARS) }
    : stripped;
}

/** The flow as the database accepts it (a-z, 0-9 and _, 2-40 characters). */
function flowName(flow: string): string {
  const name = flow
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .slice(0, 40);
  return name.length >= 2 ? name : "unknown";
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : null;
}

/** The row for one call; pure, so it can be tested without a database. */
export function callLogRow(context: CallLogContext, entry: CallLogEntry, redactor: Redactor) {
  const requested = record(record(entry.providerOptions)?.["gateway"]);
  const body = record(entry.body);
  const metadata =
    entry.providerMetadata ?? body?.["provider_metadata"] ?? body?.["providerMetadata"];
  const gateway = record(record(metadata)?.["gateway"]);
  const routing = record(gateway?.["routing"]);
  const region = record(requested?.["inferenceRegion"]);
  const applied = gateway?.["enabledZeroDataRetention"];
  const masked = Object.fromEntries(Object.entries(redactor.counts()).filter(([, n]) => n > 0));
  return {
    fund_id: context.fundId,
    flow: flowName(context.flow),
    model: entry.model,
    provider: typeof routing?.["finalProvider"] === "string" ? routing["finalProvider"] : null,
    region: typeof region?.["geoRegion"] === "string" ? region["geoRegion"] : null,
    // What the Gateway reports it applied; without that (a failed call), what was asked for.
    zdr: typeof applied === "boolean" ? applied : requested?.["zeroDataRetention"] === true,
    status: entry.status,
    input_tokens: count(entry.inputTokens),
    output_tokens: count(entry.outputTokens),
    cost_usd: extractGatewayCostUsd(entry.body ?? { providerMetadata: metadata }),
    masked,
    payload: entry.payload === undefined ? null : payloadForLog(entry.payload),
    generation_id: typeof gateway?.["generationId"] === "string" ? gateway["generationId"] : null,
  };
}

function within<T>(promise: PromiseLike<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no answer within ${ms} ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (cause: unknown) => {
        clearTimeout(timer);
        reject(cause instanceof Error ? cause : new Error(String(cause)));
      },
    );
  });
}

/** Writes the row; never throws, and waits at most `timeoutMs`. */
export async function writeCallLog(
  redactor: Redactor,
  entry: CallLogEntry,
  timeoutMs = CALL_LOG_TIMEOUT_MS,
): Promise<void> {
  const context = callLogOf(redactor);
  if (!context) return;
  const insert = async (row: ReturnType<typeof callLogRow>) => {
    const { error } = await context.service.from("ai_call_log").insert(row);
    if (error) throw new Error(error.message);
  };
  const run = async () => {
    const row = callLogRow(context, entry, redactor);
    try {
      await insert(row);
    } catch (cause) {
      // Refused (a payload too large or with a character Postgres cannot store): keep the rest.
      if (row.payload === null) throw cause;
      await insert({ ...row, payload: null });
    }
  };
  try {
    await within(run(), timeoutMs);
  } catch (cause) {
    console.error(
      JSON.stringify({
        event: "ai_call_log_failed",
        fundId: context.fundId,
        flow: context.flow,
        model: entry.model,
        error: cause instanceof Error ? cause.message : String(cause),
      }),
    );
  }
}
