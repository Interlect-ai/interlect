/**
 * Removes leaked tool calls from the streamed answer, pure. Live test 4 Oct 2026: gpt-5.4 (via
 * the AI Gateway, with tools) sometimes writes a tool call into the answer text instead of
 * calling the tool: "to=functions.search_brain" followed by junk tokens and the JSON arguments
 * ({"query": ...}), and then the real answer. That text must never reach the user or be saved.
 *
 * A second form (same day, the forced last step): the block opens with the tool arguments
 * themselves, no marker: {"caseId": "…"} RTLU {"query": …} Det ved Brain … A block that starts
 * with a JSON object drops it, and any junk word followed by another object, until real text.
 *
 * The filter holds back the start of every text block until it can tell, and the last few
 * characters of anything it lets through (a marker can be split across deltas). From a marker it
 * drops everything up to the end of the first complete JSON object after it, then lets the rest
 * through. Text that is still being dropped when the step ends is discarded.
 */
const MARKER = "to=functions.";
const HEAD = 32;
/** Held back in pass mode: a split marker plus the whitespace before it. */
const TAIL = MARKER.length + 1;
/** Without a JSON object this soon after a marker, the rest of the block is dropped. */
const DROP_MAX = 6_000;

export type LeakFilter = {
  /** The text that may be shown now. */
  push(delta: string): string;
  /** End of a step: what is left (held back text), and back to "start of a block". */
  flush(): string;
  /** How many leaks were removed so far. */
  readonly leaks: number;
};

export function createLeakFilter(): LeakFilter {
  let state: "head" | "pass" | "drop" | "rejoin" = "head";
  let buffer = "";
  let leaks = 0;
  /** Whether this block has shown text, and the whitespace that stood before a leak. */
  let shown = false;
  let separator = "";
  /** This block opened with leaked tool arguments; a junk word before the next object goes too. */
  let leadDropped = false;

  /** The text before a marker, without its trailing whitespace (kept for the join). */
  const beforeLeak = (pre: string): string => {
    const trimmed = pre.replace(/\s+$/, "");
    const gap = pre.slice(trimmed.length);
    separator = gap.includes("\n") ? "\n\n" : gap ? " " : "";
    leaks += 1;
    state = "drop";
    return emit(trimmed);
  };
  const emit = (text: string): string => {
    if (text) shown = true;
    return text;
  };

  /** Drop mode: looks for the end of the first JSON object; returns the text after it, or null. */
  const afterJson = (text: string): string | null => {
    const open = text.indexOf("{");
    if (open < 0) return null;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = open; i < text.length; i += 1) {
      const char = text[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') inString = true;
      else if (char === "{") depth += 1;
      else if (char === "}") {
        depth -= 1;
        if (depth === 0) return text.slice(i + 1);
      }
    }
    return null;
  };

  const run = (final: boolean): string => {
    let out = "";
    for (;;) {
      if (state === "head") {
        if (buffer.includes(MARKER)) {
          const at = buffer.indexOf(MARKER);
          out += beforeLeak(buffer.slice(0, at));
          buffer = buffer.slice(at);
          continue;
        }
        const lead = buffer.replace(/^\s+/, "");
        if (lead.startsWith("{")) {
          // An answer never opens with JSON: these are tool arguments written as text.
          const rest = afterJson(lead);
          if (rest === null) {
            if (final || lead.length > DROP_MAX) buffer = "";
            return out;
          }
          if (!leadDropped) leaks += 1;
          leadDropped = true;
          buffer = rest;
          continue;
        }
        if (leadDropped) {
          const junk = /^[^\s{}]{1,24}\s*(?=\{)/.exec(lead);
          if (junk) {
            buffer = lead.slice(junk[0].length);
            continue;
          }
          // Still one short word: it may be junk before another object, so wait.
          if (!final && lead.length < 26 && !/\s/.test(lead.trimEnd())) return out;
          buffer = lead;
        }
        if (!final && buffer.length < HEAD && !buffer.includes("\n")) return out;
        state = "pass";
        continue;
      }
      if (state === "pass") {
        const at = buffer.indexOf(MARKER);
        if (at >= 0) {
          out += beforeLeak(buffer.slice(0, at));
          buffer = buffer.slice(at);
          continue;
        }
        if (final) {
          out += emit(buffer);
          buffer = "";
          return out;
        }
        const keep = Math.min(TAIL, buffer.length);
        out += emit(buffer.slice(0, buffer.length - keep));
        buffer = buffer.slice(buffer.length - keep);
        return out;
      }
      if (state === "rejoin") {
        // After a leak: skip whitespace, then join with the whitespace that stood before it.
        buffer = buffer.replace(/^\s+/, "");
        if (!buffer) return out;
        if (shown) buffer = separator + buffer;
        state = "pass";
        continue;
      }
      // drop
      const rest = afterJson(buffer);
      if (rest !== null) {
        buffer = rest;
        state = "rejoin";
        continue;
      }
      if (final || buffer.length > DROP_MAX) {
        buffer = "";
        if (!final) state = "drop";
        return out;
      }
      return out;
    }
  };

  return {
    push(delta) {
      buffer += delta;
      return run(false);
    },
    flush() {
      const out = run(true);
      state = "head";
      buffer = "";
      shown = false;
      separator = "";
      leadDropped = false;
      return out;
    },
    get leaks() {
      return leaks;
    },
  };
}
