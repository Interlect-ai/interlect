/**
 * The browser's side of `POST /api/brain/chat` (contract: chat-contract.ts). One NDJSON line per
 * event; broken or unknown lines are skipped (and counted in the console); a refusal before the stream starts, a network
 * failure or a stream that ends without `done` or `error` becomes an `error` event with a fixed
 * code (the UI never shows raw errors). Aborting (the Stop button) ends the iteration quietly.
 */
import {
  BRAIN_CHAT_ENDPOINT,
  chatErrorFromStatus,
  parseChatStreamLine,
  splitNdjson,
  type ChatStreamEvent,
  type ChatTransport,
} from "./chat-contract.ts";

export interface HttpTransportOptions {
  fetchImpl?: typeof fetch;
  /** The user's access token (Authorization: Bearer), as server functions use. */
  getToken: () => Promise<string | null>;
  endpoint?: string;
}

export function createHttpChatTransport(options: HttpTransportOptions): ChatTransport {
  const { getToken, endpoint = BRAIN_CHAT_ENDPOINT } = options;
  return async function* transport(request, signal): AsyncGenerator<ChatStreamEvent> {
    const doFetch = options.fetchImpl ?? fetch;
    let response: Response;
    try {
      const token = await getToken();
      response = await doFetch(endpoint, {
        method: "POST",
        signal,
        headers: {
          "content-type": "application/json",
          accept: "application/x-ndjson",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(request),
      });
    } catch {
      if (signal.aborted) return;
      yield { type: "error", code: "failed" };
      return;
    }
    if (!response.ok || !response.body) {
      // A 4xx is a refusal before the engine saved anything; a 5xx or a missing body is not
      // known to be one (the question may be saved), so it is not marked.
      const refused = response.status >= 400 && response.status < 500;
      yield {
        type: "error",
        code: chatErrorFromStatus(response.status),
        ...(refused ? { beforeStream: true as const } : {}),
      };
      return;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finished = false;
    // Lines that do not fit the contract are skipped; a count in the console makes drift visible.
    let dropped = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const { lines, rest } = splitNdjson(buffer);
        buffer = rest;
        for (const line of lines) {
          const event = parseChatStreamLine(line);
          if (!event) {
            if (line.trim()) dropped += 1;
            continue;
          }
          yield event;
          if (event.type === "done" || event.type === "error") finished = true;
        }
        if (finished) return;
      }
      const last = parseChatStreamLine(buffer + decoder.decode());
      if (last) {
        yield last;
        if (last.type === "done" || last.type === "error") return;
      }
    } catch {
      if (signal.aborted) return;
    } finally {
      reader.cancel().catch(() => undefined);
      if (dropped > 0)
        console.warn(`[brain-chat] ${dropped} stream line(s) did not fit the contract`);
    }
    if (!signal.aborted && !finished) yield { type: "error", code: "failed" };
  };
}
