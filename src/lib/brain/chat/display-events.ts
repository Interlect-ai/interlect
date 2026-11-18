import type { DisplayNamer } from "@/lib/display/display-names";
import type { ChatStreamEvent } from "../chat-contract";

/**
 * Demo view on the answer stream: every event that carries text passes the team's
 * namer on its way to the screen (from `loadDemoView`: names, web addresses and register numbers).
 * The answer's deltas go through one streaming namer, so a name, address or number split over two
 * chunks is still replaced and nothing is lost; what it holds back is sent before the next event
 * that is not a delta (sources, done, error), so the order never changes.
 */
export function createEventAliaser(
  namer: DisplayNamer | null,
): (event: ChatStreamEvent) => ChatStreamEvent[] {
  if (!namer) return (event) => [event];
  const answer = namer.stream();
  return (event) => {
    if (event.type === "delta") {
      const text = answer.push(event.text);
      return text ? [{ type: "delta", text }] : [];
    }
    const held = answer.flush();
    const before: ChatStreamEvent[] = held ? [{ type: "delta", text: held }] : [];
    switch (event.type) {
      case "thread":
        return [
          ...before,
          { ...event, title: event.title ? namer.apply(event.title) : event.title },
        ];
      case "step":
        return [...before, { ...event, text: namer.apply(event.text) }];
      case "sources":
        return [...before, namer.applyJson(event)];
      case "done":
        return [...before, namer.applyJson(event)];
      default:
        return [...before, event];
    }
  };
}
