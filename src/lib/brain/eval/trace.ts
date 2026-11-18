/**
 * The trace of one exam attempt: every tool call with its input, the
 * output the model saw and its time, and the numbered sources it could cite. Caught by wrapping
 * the chat's tools in the exam run, so the product's chat engine is unchanged. The search
 * candidates with rank and score come from brain_retrieval_events (the search logs them per
 * message) and are added by the runner. Pure apart from the clock.
 */
import type { ToolSet } from "ai";
import type { NumberedSource, SourceRegistry } from "../chat/sources.ts";

export type TraceToolCall = {
  name: string;
  input: unknown;
  /** The output as the model saw it (JSON), or the error text. */
  output: string;
  ms: number;
  failed: boolean;
};

export type AttemptTrace = {
  toolCalls: TraceToolCall[];
  /** The numbered sources the answer could cite ([n] → kind, id, ref). */
  sources: Array<Pick<NumberedSource, "n" | "kind" | "id" | "ref" | "caseId" | "trustTier">>;
  /** Search candidates with rank and score, from brain_retrieval_events. */
  candidates: unknown[];
  /** Why the candidates are missing, when they could not be read (the answer is kept). */
  candidatesError?: string;
};

/** Longest stored output of one tool call; the model sees at most this much anyway. */
const OUTPUT_MAX = 60_000;

export function createTraceSink() {
  const toolCalls: TraceToolCall[] = [];
  return {
    toolCalls,
    /** Wraps every tool so its input, output and time are recorded; behaviour is unchanged. */
    wrap(tools: ToolSet): ToolSet {
      const wrapped: ToolSet = {};
      for (const [name, definition] of Object.entries(tools)) {
        const execute = definition.execute;
        if (!execute) {
          wrapped[name] = definition;
          continue;
        }
        wrapped[name] = {
          ...definition,
          execute: async (input: unknown, options: unknown) => {
            const started = Date.now();
            try {
              const output = await (execute as (i: unknown, o: unknown) => Promise<unknown>)(
                input,
                options,
              );
              toolCalls.push({
                name,
                input,
                output: JSON.stringify(output ?? null).slice(0, OUTPUT_MAX),
                ms: Date.now() - started,
                failed: false,
              });
              return output;
            } catch (cause) {
              toolCalls.push({
                name,
                input,
                output: cause instanceof Error ? cause.message : String(cause),
                ms: Date.now() - started,
                failed: true,
              });
              throw cause;
            }
          },
        } as ToolSet[string];
      }
      return wrapped;
    },
  };
}

/** The sources registered during the turn, by number. */
export function registeredSources(registry: SourceRegistry): AttemptTrace["sources"] {
  const sources: AttemptTrace["sources"] = [];
  for (let n = 1; n <= registry.size; n += 1) {
    const source = registry.get(n);
    if (!source) continue;
    sources.push({
      n: source.n,
      kind: source.kind,
      id: source.id,
      ref: source.ref ?? null,
      caseId: source.caseId ?? null,
      trustTier: source.trustTier ?? null,
    });
  }
  return sources;
}

/** Everything the tools gave the model, as one text (attribution.ts looks for facts in it). */
export function contextText(toolCalls: readonly TraceToolCall[]): string {
  return toolCalls
    .filter((call) => !call.failed)
    .map((call) => call.output)
    .join("\n");
}
