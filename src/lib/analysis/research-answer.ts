import type { PublicResearchOutput } from "./public-research.ts";

/**
 * The research answer as the run keeps it in `analysis_runs.raw_response`. Every role in
 * the team can read that column, so only the answer's own fields stay; the step's log, plan,
 * follow-up and neutralizer (model ids, the provider's own error text) never go along. An
 * allowlist, so a new field on the step does not leak by default. The same keys are cleaned from
 * old rows by migration 0130.
 */
export const PUBLIC_RESEARCH_ANSWER_KEYS = [
  "schemaVersion",
  "companyName",
  "findings",
  "gaps",
  "identityAmbiguity",
  "companyProfile",
] as const satisfies readonly (keyof PublicResearchOutput)[];

export function publicResearchAnswer(stored: object): PublicResearchOutput {
  const source = stored as Record<string, unknown>;
  return Object.fromEntries(
    PUBLIC_RESEARCH_ANSWER_KEYS.filter((key) => key in source).map((key) => [key, source[key]]),
  ) as PublicResearchOutput;
}
